# FindAssure — AI-Powered Text Matching & Ranking Engine
## Production Design Document · v2.0

> **Scope**: Text normalization, hybrid retrieval, re-ranking, feedback logging, and learning pipeline.
> **Out of scope**: Image extraction, location scoring, UI changes.

---

## Table of Contents
- [A. Architecture & Data Flow](#a-architecture--data-flow)
- [B. Gemini Prompt Design](#b-gemini-prompt-design)
- [C. Matching & Ranking Algorithm](#c-matching--ranking-algorithm)
- [D. Database Schema](#d-database-schema)
- [E. Feedback-to-Training Dataset Builder](#e-feedback-to-training-dataset-builder)
- [F. Model Training (Re-Ranker)](#f-model-training-re-ranker)
- [G. Deployment](#g-deployment)
- [H. Pseudocode](#h-pseudocode)

---

## A. Architecture & Data Flow

### Module Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        REQUEST-TIME PATH (< 500ms budget)                   │
│                                                                             │
│   User Search Request                                                       │
│        │                                                                    │
│        ▼                                                                    │
│  ┌─────────────────────┐                                                    │
│  │  LostTextNormalizer  │  — Gemini API call (cached by content hash)       │
│  │  (Gemini Extractor)  │    Returns: clean_description, keywords,          │
│  └──────────┬──────────┘    attributes{brand,color,model,serial...},        │
│             │               must_match_tokens, missing_fields               │
│             ▼                                                               │
│  ┌─────────────────────┐                                                    │
│  │  CandidateRetriever  │  — Two parallel sub-queries:                      │
│  │                      │    1) FAISS vector ANN search → top-200           │
│  │                      │    2) BM25/keyword search for IDs/models → top-50 │
│  │                      │    3) Merge + deduplicate → candidate pool         │
│  └──────────┬──────────┘                                                    │
│             │                                                               │
│             ▼                                                               │
│  ┌─────────────────────┐                                                    │
│  │  FeatureComputer     │  — Per-candidate feature vector                   │
│  │                      │    (semantic sim, keyword overlap, attr match,     │
│  │                      │     identifier flags, penalties)                   │
│  └──────────┬──────────┘                                                    │
│             │                                                               │
│             ▼                                                               │
│  ┌─────────────────────┐                                                    │
│  │  ReRanker            │  — Phase 1: Rule-based formula (always active)    │
│  │                      │    Phase 2: LightGBM model (when trained)         │
│  └──────────┬──────────┘                                                    │
│             │                                                               │
│             ▼                                                               │
│  ┌─────────────────────┐     ┌─────────────────────────┐                   │
│  │  ResultShaper        │────▶│  ImpressionLogger        │                  │
│  │  (top-K to user)     │     │  (async, non-blocking)   │                  │
│  └─────────────────────┘     └─────────────────────────┘                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                     OFFLINE / BATCH JOBS (async, scheduled)                 │
│                                                                             │
│  ┌──────────────────────────────┐                                           │
│  │  FoundTextAttributeCache Job │  — Runs nightly or on new FOUND item add  │
│  │  (Gemini batch extractor)    │    Reads description_text from DB         │
│  │                              │    Writes extracted_attributes_json        │
│  │                              │    Skips if already extracted              │
│  └──────────────────────────────┘                                           │
│                                                                             │
│  ┌──────────────────────────────┐                                           │
│  │  TrainingDatasetBuilder      │  — Joins impression + selection +          │
│  │                              │    verification logs                       │
│  │                              │    Emits labeled (lost, found, label)      │
│  └──────────────────────────────┘                                           │
│                                                                             │
│  ┌──────────────────────────────┐                                           │
│  │  ReRankerTrainer             │  — LightGBM/XGBoost training               │
│  │                              │    Versioned model artifacts               │
│  │                              │    A/B routing table update                │
│  └──────────────────────────────┘                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Narrative

1. **Request-time**: User submits a lost item description + selected category.
2. **Normalization**: `LostTextNormalizer` calls Gemini with the raw text. The result is cached by SHA-256 hash of the raw text so identical (or near-identical) queries are free. Returns a structured JSON.
3. **Candidate Retrieval**: Two parallel retrieval paths are merged:
   - FAISS ANN search on normalized embedding (category pre-filtered index or post-filter).
   - BM25/keyword search targetting serial numbers, IMEI, model codes, rare tokens from `must_match_tokens`.
4. **Feature Computation**: For each candidate in the merged pool, compute a feature vector.
5. **Re-Ranking**: Apply the scoring formula (rule-based always; ML model once trained). Return top-K.
6. **Logging**: Impression is logged asynchronously (fire-and-forget, queue-backed). If user selects an item, selection is logged. If handover verified, that record already exists.
7. **Offline**: The `FoundTextAttributeCache` job extracts attributes from found item descriptions and stores them in MongoDB. This makes runtime attribute matching fast without calling Gemini per candidate on every request.

---

## B. Gemini Prompt Design

### B1. Lost Item Extraction Prompt (Request-Time)

This prompt is called once per user search. Cache the output keyed on `sha256(raw_text + category)`.

```python
LOST_EXTRACTION_PROMPT = """
You are an expert at understanding lost item descriptions written by regular people.
Descriptions may be:
- Incomplete (missing some details)
- Grammatically incorrect or informal
- Written in mixed languages (English + Sinhala / Singlish)
- Using abbreviations, slang, or brand nicknames

Your job is to extract structured information from the description below.

=== LOST ITEM DESCRIPTION ===
{raw_description}

=== ITEM CATEGORY ===
{category}

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object. No explanation, no markdown, no code fence.

{{
  "clean_description": "<rewrite the description in clean English, filling obvious gaps>",
  "language_detected": "<english | sinhala | singlish | mixed>",
  "keywords": ["<important content words only, no stop words, lowercase>"],
  "attributes": {{
    "brand": "<brand/manufacturer or null>",
    "model": "<model name/number or null>",
    "color": "<primary color(s) or null>",
    "material": "<material type or null>",
    "size": "<size/dimensions in any unit or null>",
    "identifiers": [
      {{
        "type": "<serial | imei | id_number | name | phone | other>",
        "value": "<exact value as written>"
      }}
    ],
    "unique_marks": "<scratches, stickers, engravings, damage marks, or null>"
  }},
  "must_match_tokens": [
    "<if identifiers exist (serial/IMEI/ID/name/phone), list their values here verbatim>"
  ],
  "missing_fields": ["<list attribute names the user didn't mention>"],
  "confidence": "<high | medium | low>"
}}

=== RULES ===
1. If a field is not mentioned, set it to null (not empty string).
2. must_match_tokens MUST only contain values that are unique identifiers — not common words.
3. For mixed language (Singlish/Sinhala), translate to English in clean_description.
4. Do not guess. Only extract what is clearly stated or strongly implied.
5. keywords should be 3-10 terms that best identify the item (colors, brand, model, type).
6. If the description is ambiguous, set confidence to "low".
"""
```

**Usage in code:**
```python
import hashlib, json
import google.generativeai as genai

def normalize_lost_description(raw_text: str, category: str) -> dict:
    cache_key = hashlib.sha256(f"{raw_text}|{category}".encode()).hexdigest()
    
    # Check Redis/in-memory cache first
    cached = cache.get(cache_key)
    if cached:
        return json.loads(cached)
    
    prompt = LOST_EXTRACTION_PROMPT.format(
        raw_description=raw_text.strip()[:2000],  # hard cap to control tokens
        category=category
    )
    
    model = genai.GenerativeModel("gemini-2.0-flash")
    response = model.generate_content(
        prompt,
        generation_config=genai.types.GenerationConfig(
            temperature=0.1,          # low temperature for determinism
            max_output_tokens=512,
            response_mime_type="application/json"  # Gemini JSON mode
        )
    )
    
    result = json.loads(response.text)
    cache.set(cache_key, json.dumps(result), ex=3600)  # 1hr TTL
    return result
```

---

### B2. Found Item Attribute Extraction Prompt (Offline / Batch)

Run this ONCE per found item. Store result in `extracted_attributes_json`. Skip if already populated.

```python
FOUND_EXTRACTION_PROMPT = """
You are an expert at analyzing lost-and-found item descriptions.
The description below was written by someone who found an item.

=== FOUND ITEM DESCRIPTION ===
{raw_description}

=== ITEM CATEGORY ===
{category}

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object. No explanation, no markdown, no code fence.

{{
  "clean_description": "<clean, normalized English version of the description>",
  "language_detected": "<english | sinhala | singlish | mixed>",
  "keywords": ["<key identifying terms, lowercase>"],
  "attributes": {{
    "brand": "<brand/manufacturer or null>",
    "model": "<model name/number or null>",
    "color": "<primary color(s) or null>",
    "material": "<material type or null>",
    "size": "<size or null>",
    "identifiers": [
      {{
        "type": "<serial | imei | id_number | name | phone | other>",
        "value": "<exact value>"
      }}
    ],
    "unique_marks": "<any distinctive physical marks or null>"
  }},
  "searchable_tokens": [
    "<list all identifier values and any rare/unique tokens for BM25 indexing>"
  ]
}}

=== RULES ===
1. null for missing fields — never empty string.
2. searchable_tokens must include all identifier values verbatim.
3. Translate any non-English text to English in clean_description.
4. Do not infer details not present in the description.
"""
```

**Batch Runner (async, with rate limiting):**
```python
async def batch_extract_found_attributes(db, batch_size=50):
    """Run nightly. Process found items that haven't been extracted yet."""
    cursor = db.found_items.find(
        {"extracted_attributes_json": {"$exists": False}},
        {"_id": 1, "description": 1, "category": 1}
    ).limit(batch_size)
    
    items = await cursor.to_list(length=None)
    
    for item in items:
        try:
            attrs = extract_found_attributes(
                item["description"], 
                item["category"]
            )
            await db.found_items.update_one(
                {"_id": item["_id"]},
                {"$set": {
                    "extracted_attributes_json": attrs,
                    "attributes_extracted_at": datetime.utcnow()
                }}
            )
            await asyncio.sleep(0.5)  # ~2 RPS to respect Gemini rate limits
        except Exception as e:
            logger.error(f"Extraction failed for {item['_id']}: {e}")
```

---

## C. Matching & Ranking Algorithm

### C1. Candidate Generation

```
Category pre-filter → Vector ANN search (top-200)
                   ↘
                     Merge & Deduplicate → Candidate Pool (≤ 250 items)
                   ↗
BM25 keyword search for must_match_tokens + rare keywords (top-50)
```

**Two-path retrieval:**

1. **Vector path** (semantic): Query the FAISS index (or a per-category sub-index) with the embedding of `clean_description`. Get top-200.

2. **Keyword path** (exact token matching):
   - Targets: serial numbers, IMEI, model codes, ID numbers from `must_match_tokens`.
   - Use MongoDB text index (`$text` search) or BM25 via `rank_bm25` library.
   - Get top-50.
   - **Why**: A serial number like `SN123456` will never match semantically — it needs exact/fuzzy token matching.

3. **Merge**: Union of both sets. Deduplicate by `found_id`. Result is the **candidate pool** (≤ 250 items).

### C2. Final Scoring Formula

For each candidate in the pool, compute:

```
final_score = (
    W_sem  * semantic_score       # 0.40
  + W_kw   * keyword_score        # 0.20
  + W_attr * attribute_score      # 0.25
  + W_id   * identifier_bonus     # 0.15
  - penalty_contradictions        # subtracted
)
```

**Default weights** (tune via offline evaluation):
```
W_sem  = 0.40   (cosine similarity of embeddings, normalized 0-1)
W_kw   = 0.20   (BM25 score normalized 0-1, or Jaccard overlap)
W_attr = 0.25   (attribute match score, see below)
W_id   = 0.15   (identifier match bonus, see below)
```

#### Semantic Score
```python
# Uses existing FAISS IndexFlatIP with normalized vectors
# raw_cosine is already in [-1, 1]; normalize to [0, 1]
semantic_score = (raw_cosine + 1) / 2
```

#### Keyword Score (BM25)
```python
from rank_bm25 import BM25Okapi

# Index is built over found item descriptions in the category
query_tokens = lost_attrs["keywords"] + [t for t in lost_attrs["must_match_tokens"]]
bm25_scores = bm25_index.get_scores(query_tokens)  # per-document BM25 scores
keyword_score = normalize_minmax(bm25_scores[candidate_index])
```

#### Attribute Match Score
```python
def attribute_score(lost_attrs: dict, found_attrs: dict) -> float:
    """
    Compare attribute dicts. Returns score in [0.0, 1.0].
    Weights: color=0.3, brand=0.3, model=0.25, material=0.15
    """
    weights = {"color": 0.30, "brand": 0.30, "model": 0.25, "material": 0.15}
    total_weight = 0.0
    matched_weight = 0.0
    
    for attr, w in weights.items():
        lost_val = lost_attrs.get(attr)
        found_val = found_attrs.get(attr)
        
        if lost_val is None:   # user didn't mention it — skip
            continue
        
        total_weight += w
        
        if found_val is None:  # found item unknown — partial credit
            matched_weight += w * 0.3
        elif fuzzy_match(lost_val, found_val) >= 0.85:  # fuzz.ratio
            matched_weight += w
        elif fuzzy_match(lost_val, found_val) >= 0.60:
            matched_weight += w * 0.5
    
    if total_weight == 0:
        return 0.5  # no attributes to compare — neutral
    
    return matched_weight / total_weight
```

#### Identifier Bonus / Penalty
```python
def identifier_score(lost_attrs: dict, found_attrs: dict) -> tuple[float, float]:
    """
    Returns (bonus, penalty).
    bonus in [0, 1], penalty in [0, 1].
    """
    must_match = lost_attrs.get("must_match_tokens", [])
    found_identifiers = [i["value"] for i in (found_attrs.get("identifiers") or [])]
    found_text = " ".join(found_identifiers).lower()
    
    if not must_match:
        return 0.0, 0.0  # no identifiers — no bonus/penalty
    
    matched = sum(
        1 for token in must_match
        if token.lower() in found_text or fuzz.ratio(token.lower(), found_text) > 90
    )
    
    match_ratio = matched / len(must_match)
    
    if match_ratio == 1.0:
        return 1.0, 0.0   # all identifiers matched → max bonus
    elif match_ratio > 0:
        return match_ratio * 0.5, 0.0
    else:
        # Identifiers declared but not found → hard penalty
        return 0.0, 0.50  # subtract 50% from final score
```

#### Contradiction Penalty
```python
def contradiction_penalty(lost_attrs: dict, found_attrs: dict) -> float:
    """
    Returns penalty value [0.0, 0.5].
    Triggered when attributes clearly contradict each other.
    """
    penalty = 0.0
    
    # Color contradiction (e.g., lost=red, found=black)
    if (lost_attrs.get("color") and found_attrs.get("color") and
        fuzzy_match(lost_attrs["color"], found_attrs["color"]) < 0.40):
        penalty += 0.15
    
    # Brand contradiction (e.g., lost=Apple, found=Samsung)
    if (lost_attrs.get("brand") and found_attrs.get("brand") and
        fuzzy_match(lost_attrs["brand"], found_attrs["brand"]) < 0.40):
        penalty += 0.20
    
    # model contradiction
    if (lost_attrs.get("model") and found_attrs.get("model") and
        fuzzy_match(lost_attrs["model"], found_attrs["model"]) < 0.40):
        penalty += 0.10
    
    return min(penalty, 0.50)
```

#### Final Assembly
```python
def compute_final_score(
    semantic: float,      # [0, 1]
    keyword: float,       # [0, 1]
    attr: float,          # [0, 1]
    id_bonus: float,      # [0, 1]
    id_penalty: float,    # [0, 1]
    contradiction: float  # [0, 0.5]
) -> float:
    
    score = (
        0.40 * semantic +
        0.20 * keyword +
        0.25 * attr +
        0.15 * id_bonus
    )
    score = max(0.0, score - id_penalty - contradiction)
    return round(score, 4)
```

### C3. Must-Match Logic (Hard Rule)

```python
def apply_must_match_rule(candidates: list, lost_attrs: dict) -> list:
    """
    If must_match_tokens are present:
      - Any candidate that matches ALL tokens gets forced to rank #1.
      - Any candidate with an identifier declared in must_match that DOESN'T match
        gets the maximum penalty (set score to max 0.1 unless the identifier isn't in the
        found item's field at all — in which case only the normal id_penalty applies).
    """
    must = lost_attrs.get("must_match_tokens", [])
    if not must:
        return candidates  # no force-ranking needed
    
    forced_top = []
    normal = []
    
    for c in candidates:
        found_id_text = " ".join(
            i["value"] for i in (c["found_attrs"].get("identifiers") or [])
        ).lower()
        
        all_matched = all(
            m.lower() in found_id_text or fuzz.ratio(m.lower(), found_id_text) > 90
            for m in must
        )
        
        if all_matched:
            c["score"] = min(1.0, c["score"] + 0.30)  # boost
            forced_top.append(c)
        else:
            normal.append(c)
    
    # forced_top candidates always appear first
    forced_top.sort(key=lambda x: x["score"], reverse=True)
    normal.sort(key=lambda x: x["score"], reverse=True)
    
    return forced_top + normal
```

---

## D. Database Schema

### D1. Items Collection (MongoDB)

```javascript
// Collection: found_items
{
  _id: ObjectId,
  item_id: "unique-found-item-uuid",          // External system ID
  type: "found",                               // always "found" in this index
  category: "Electronics",                    // user-selected category
  description_text: "Black Samsung Galaxy...", // original description (immutable)
  created_at: ISODate("2025-01-01T00:00:00Z"),

  // --- Fields added by this engine (optional, filled by batch job) ---
  normalized_text: "black samsung galaxy s21...",
  extracted_attributes_json: {
    clean_description: "...",
    keywords: ["samsung", "galaxy", "black", "s21"],
    attributes: {
      brand: "samsung",
      model: "galaxy s21",
      color: "black",
      material: null,
      size: null,
      identifiers: [{ type: "imei", value: "354632110934567" }],
      unique_marks: "cracked back cover"
    },
    searchable_tokens: ["354632110934567", "galaxy", "s21"]
  },
  attributes_extracted_at: ISODate("2025-01-02T00:00:00Z"),
  
  // --- Vector (stored for index rebuild) ---
  embedding_vector: [0.123, -0.456, ...],      // float32[], dimension=768

  // --- Indexes ---
  // create_index([("item_id", ASCENDING)], unique=True)
  // create_index([("category", ASCENDING)])
  // create_index([("created_at", DESCENDING)])
  // create_index([("$**", "text")])             // full-text index for BM25 fallback
}

// Separate collection for LOST item descriptions (if you track them)
// Collection: lost_item_queries
{
  _id: ObjectId,
  query_id: "uuid",
  user_id: "optional",
  category: "Electronics",
  raw_description: "...",
  normalized_result: { /* full Gemini JSON output */ },
  normalized_at: ISODate("..."),
  cache_key: "sha256-hash-string"
}
```

### D2. MatchImpressions Collection

**Critical for negative sampling.** Without impressions, you cannot know what was shown but NOT selected.

```javascript
// Collection: match_impressions
{
  _id: ObjectId,
  impression_id: "uuid-v4",
  query_id: "ref to lost_item_queries._id",    // which lost search
  lost_item_raw: "user's raw description",      // denormalized for convenience
  category: "Electronics",
  session_id: "optional-session-token",
  user_id: "optional",
  timestamp: ISODate("2025-01-01T10:00:00Z"),

  shown_results: [
    {
      rank: 1,
      found_id: "found-item-uuid",
      score: 0.847,
      score_breakdown: {
        semantic: 0.82,
        keyword: 0.71,
        attribute: 0.90,
        identifier_bonus: 0.0,
        penalty: 0.0
      },
      model_version: "rule_based_v1"  // or "lgbm_v2"
    },
    { rank: 2, found_id: "...", score: 0.761, ... },
    ...
  ],

  // Indexes:
  // create_index([("impression_id", ASCENDING)], unique=True)
  // create_index([("timestamp", DESCENDING)])
  // create_index([("query_id", ASCENDING)])
}
```

**Why impressions are critical for negative sampling:**
> A model trained only on positive pairs (selected=1) will overfit. You need negatives: items that were shown alongside the correct item but were NOT selected. The impression log gives you the full ranked list so you can sample the non-selected items as negatives. Without this, you cannot build a valid training dataset.

### D3. MatchSelections Collection

```javascript
// Collection: match_selections
{
  _id: ObjectId,
  selection_id: "uuid",
  impression_id: "ref to match_impressions.impression_id",
  query_id: "ref to lost_item_queries",
  lost_item_raw: "...",          // denormalized
  selected_found_id: "found-item-uuid",
  selected_rank: 2,              // what position was selected
  timestamp: ISODate("2025-01-01T10:05:00Z"),

  // Indexes:
  // create_index([("impression_id", ASCENDING)])
  // create_index([("selected_found_id", ASCENDING)])
}
```

### D4. HandoverVerification Collection (Existing — Required Fields)

Ensure these fields exist (add if missing):

```javascript
// Collection: handover_verifications (existing)
{
  _id: ObjectId,
  verification_id: "uuid",
  lost_id: "ref to lost_item_queries or Items",
  found_id: "found-item-uuid",
  
  // --- REQUIRED FIELDS ---
  verified: true,                              // boolean — handover succeeded
  verified_at: ISODate("2025-01-01T10:20:00Z"),
  
  // --- OPTIONAL but useful ---
  verification_method: "otp",                  // otp | qr | id_check
  
  // Indexes:
  // create_index([("lost_id", ASCENDING)])
  // create_index([("found_id", ASCENDING)])
  // create_index([("verified_at", DESCENDING)])
}
```

---

## E. Feedback-to-Training Dataset Builder

### E1. Label Strategy

```
pair (lost, found) → label

1. verified=true  + selected=true   → label=1, weight=3.0  (STRONG POSITIVE)
2. selected=true  + verified=false  → label=1, weight=1.0  (WEAK POSITIVE — user thought it matched)
3. selected=true  + no verification → label=1, weight=0.5  (VERY WEAK POSITIVE)
4. shown but NOT selected           → label=0, weight=1.0  (NEGATIVE)
   -- only when a verified positive exists in the same impression --
   -- otherwise: ignore this impression entirely (ambiguous signal) --
5. selected=false + verified=false  → IGNORE (user rejected, but we don't know why)
```

### E2. Hard Negative Mining

Hard negatives are the most informative training examples — they are typically ranked high by the current model but are wrong.

```python
def sample_hard_negatives(impression: dict, positive_found_id: str, n_neg: int = 8):
    """
    From an impression, take the top-ranked items that are NOT the positive.
    These are hard negatives: our current model ranked them highly but they were wrong.
    """
    shown = impression["shown_results"]
    negatives = [
        r for r in shown
        if r["found_id"] != positive_found_id
    ]
    # Prefer items ranked closer to rank 1 (harder negatives)
    negatives_sorted = sorted(negatives, key=lambda x: x["rank"])
    return negatives_sorted[:n_neg]
```

### E3. Recommended Ratios

```
1 strong positive : 5-8 hard negatives : 2-3 random negatives
```

Random negatives (sampled from entire category) help prevent overfitting to local hard negatives.

### E4. Dataset Output Schema

```python
# Each row in training_data.csv or training_pairs list
{
    "query_id": "uuid",
    "lost_raw": "my black samsung phone lost...",
    "found_id": "found-item-uuid",
    "found_description": "Black Samsung Galaxy S21...",
    "label": 1,         # 0 or 1
    "weight": 3.0,      # sample weight for LightGBM

    # Pre-computed features (compute at build time, store in CSV)
    "f_semantic_sim": 0.847,
    "f_keyword_score": 0.612,
    "f_attr_color_match": 1.0,
    "f_attr_brand_match": 1.0,
    "f_attr_model_match": 0.5,
    "f_attr_material_match": -1,   # -1 means not comparable (null on either side)
    "f_identifier_match": 0.0,
    "f_contradiction_penalty": 0.0,
    "f_rank_in_impression": 2,     # what rank this candidate was shown at
    "f_n_must_match_tokens": 0,    # how many must-match tokens the lost item has
    "f_query_len_tokens": 8,
    "f_found_desc_len_tokens": 15,
    
    "split": "train",  # or "val" — assigned by lost_id hash
}
```

---

## F. Model Training (Re-Ranker)

### F1. Why LightGBM First

- Works well with small-to-medium datasets (hundreds to thousands of verified pairs).
- Natively supports sample weights.
- Has a `lambdarank` objective for learning-to-rank.
- Fast inference (< 1ms per candidate, in-process).
- Interpretable via feature importance.
- No GPU required.

Move to a neural re-ranker (e.g., cross-encoder) only if you have 50k+ verified pairs.

### F2. Feature List

```python
FEATURE_COLUMNS = [
    # Retrieval scores
    "f_semantic_sim",          # cosine similarity [0, 1]
    "f_bm25_score_norm",       # normalized BM25 [0, 1]
    
    # Attribute match features
    "f_attr_color_match",      # [-1=N/A, 0=mismatch, 0.5=partial, 1=match]
    "f_attr_brand_match",
    "f_attr_model_match",
    "f_attr_material_match",
    
    # Identifier features
    "f_identifier_match_ratio",  # 0-1: fraction of must-match tokens present in found
    "f_n_must_match_tokens",     # integer: how many identifiers user provided
    "f_identifier_in_found_text",# binary: any identifier found in raw found text
    
    # Penalty features
    "f_contradiction_score",     # sum of contradiction penalties [0, 0.5]
    
    # Positional / context features
    "f_initial_rank",            # candidate's rank before re-ranking
    "f_candidate_pool_size",     # how many candidates in this impression
    
    # Query complexity features
    "f_query_n_tokens",          # token count of lost description
    "f_found_n_tokens",          # token count of found description  
    "f_query_missing_fields",    # count of attributes user didn't mention
    
    # Text length ratio
    "f_len_ratio",               # len(lost_desc) / len(found_desc)
]
```

### F3. Training Configuration

```python
import lightgbm as lgb
from sklearn.model_selection import GroupShuffleSplit

def train_reranker_model(df_train, df_val):
    """
    df_train: training DataFrame with FEATURE_COLUMNS + label + weight + query_id
    df_val:   validation DataFrame (same schema)
    
    Split strategy: GroupShuffleSplit by query_id (no leakage across queries)
    Time constraint: val set uses only queries after a cutoff date
    """
    X_train = df_train[FEATURE_COLUMNS]
    y_train = df_train["label"]
    w_train = df_train["weight"]
    g_train = df_train.groupby("query_id").size().values  # group sizes for lambdarank
    
    X_val = df_val[FEATURE_COLUMNS]
    y_val = df_val["label"]
    g_val = df_val.groupby("query_id").size().values
    
    train_dataset = lgb.Dataset(
        X_train, label=y_train, weight=w_train, group=g_train
    )
    val_dataset = lgb.Dataset(
        X_val, label=y_val, group=g_val, reference=train_dataset
    )
    
    params = {
        "objective": "lambdarank",
        "metric": "ndcg",
        "ndcg_eval_at": [1, 3, 5],
        "learning_rate": 0.05,
        "num_leaves": 31,
        "min_data_in_leaf": 10,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "verbose": -1,
        "lambdarank_truncation_level": 10,  # evaluate top-10 positions
    }
    
    model = lgb.train(
        params,
        train_dataset,
        num_boost_round=500,
        valid_sets=[val_dataset],
        callbacks=[lgb.early_stopping(50), lgb.log_evaluation(50)]
    )
    
    return model
```

### F4. Evaluation Metrics

| Metric | Formula | Target |
|---|---|---|
| **Precision@1** | correct match in rank 1 / total queries | > 0.70 |
| **Precision@5** | correct match in top-5 / total queries | > 0.85 |
| **MRR** | mean(1 / rank_of_correct) | > 0.75 |
| **Verified Match Rate** | verified=true / total handover attempts | > 0.80 |
| **NDCG@5** | standard nDCG | > 0.80 |

### F5. Train/Validation Split (No Leakage)

```python
from sklearn.model_selection import GroupShuffleSplit

# Split by query_id (lost item), NOT randomly
gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=42)
train_idx, val_idx = next(gss.split(df, groups=df["query_id"]))

# Additionally: enforce time boundary — val queries must be after a cutoff
cutoff_date = df["timestamp"].quantile(0.80)
df_val = df[(df.index.isin(val_idx)) & (df["timestamp"] >= cutoff_date)]
df_train = df[df.index.isin(train_idx) & (df["timestamp"] < cutoff_date)]

# LEAKAGE CHECK: No query_id should appear in both splits
assert set(df_train["query_id"]).isdisjoint(set(df_val["query_id"]))
```

### F6. Model Versioning & Retraining

```
data/models/
  lgbm_v1_2025-01-15.pkl       # initial model
  lgbm_v2_2025-02-20.pkl       # retrained with more data
  current_model_ptr.txt        # points to active model filename
```

- **Retrain trigger**: every 200 new verified pairs, or weekly (whichever comes first).
- **Minimum threshold**: don't train until ≥ 100 verified positive pairs exist.
- **Rollback**: keep previous 2 versions; revert if NDCG@5 drops by > 5%.

---

## G. Deployment

### G1. Runtime Flow

```
User Request
    │
    ▼
① normalize_lost_description(raw_text, category)
    └─ Gemini API call (or cache hit ~0ms)
    └─ Returns: structured JSON with attributes, must_match_tokens, clean_description
    │
    ▼
② get_candidates(category, embedding, must_match_tokens)
    └─ Parallel:
       ├─ FAISS search → top-200 by cosine similarity (category-filtered)
       └─ BM25/text search → top-50 by must_match_tokens + rare keywords
    └─ Merge + deduplicate → candidate pool (≤ 250)
    │
    ▼
③ load_found_attributes(candidate_ids)
    └─ Batch DB fetch: found_items.extracted_attributes_json for all candidates
    └─ If not extracted: use raw description as fallback (no Gemini at runtime)
    │
    ▼
④ compute_features(lost_attrs, found_attrs_list)
    └─ One feature vector per candidate
    │
    ▼
⑤ score_and_rank_candidates(feature_vectors)
    └─ Phase 1: Rule-based formula (always active)
    └─ Phase 2: LightGBM model (when model_ptr.txt points to a valid model)
    └─ Apply must-match forced ranking
    └─ Return top-K (e.g., top-10 or top-20)
    │
    ▼
⑥ log_impression(query_id, shown_results) — ASYNC, non-blocking
    │
    ▼
Return ranked results to caller
```

**Total latency budget**: < 500ms for the synchronous path (Gemini call dominates at ~150-250ms for cache miss).

### G2. Service Architecture

```python
# Option A: In-process library (simplest, for monolith)
# Just import and call reranker.rank(query, candidates)

# Option B: Sidecar microservice (recommended for scale)
# POST /rank
# Body: { lost_text, category, candidates: [{found_id, description}] }
# Returns: { ranked_candidates: [{found_id, score, rank}] }
```

### G3. Safe Rollout Plan

**Step 1 — Shadow Scoring** (Week 1-2):
- New scoring runs alongside old, logs both scores.
- No user impact; validate correlation between rule-based and ML scores.

**Step 2 — A/B Test** (Week 3-4):
- 10% of traffic → ML re-ranker, 90% → rule-based.
- Compare: selection rate, verified match rate, MRR.

**Step 3 — Gradual Rollout**:
- 25% → 50% → 75% → 100% based on metrics.
- Automated rollback if verified match rate drops by > 5%.

```python
# A/B routing logic
import hashlib

def get_model_variant(session_id: str, rollout_pct: float = 0.10) -> str:
    """Deterministic, sticky assignment per session."""
    h = int(hashlib.sha256(session_id.encode()).hexdigest(), 16)
    if (h % 100) < (rollout_pct * 100):
        return "lgbm_v2"
    return "rule_based_v1"
```

---

## H. Pseudocode

### H1. `normalize_lost_description()`

```python
def normalize_lost_description(raw_text: str, category: str) -> dict:
    """
    Normalize raw lost item description using Gemini.
    Returns structured JSON with attributes.
    """
    # Step 1: cache lookup
    cache_key = sha256(f"{raw_text.strip()}|{category}".encode()).hexdigest()
    cached = redis_cache.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # Step 2: build prompt
    prompt = LOST_EXTRACTION_PROMPT.format(
        raw_description=raw_text.strip()[:2000],
        category=category
    )
    
    # Step 3: call Gemini with JSON mode
    response = gemini_model.generate_content(
        prompt,
        generation_config=GenerationConfig(
            temperature=0.1,
            max_output_tokens=512,
            response_mime_type="application/json"
        )
    )
    
    # Step 4: parse and validate
    result = json.loads(response.text)
    assert "clean_description" in result
    assert "attributes" in result
    assert "must_match_tokens" in result
    
    # Step 5: store embedding of clean_description
    result["embedding"] = embedding_model.encode(result["clean_description"]).tolist()
    
    # Step 6: cache for 1hr
    redis_cache.set(cache_key, json.dumps(result), ex=3600)
    
    return result
```

### H2. `get_candidates()`

```python
def get_candidates(
    category: str,
    query_embedding: np.ndarray,
    must_match_tokens: list,
    keywords: list,
    top_vector: int = 200,
    top_keyword: int = 50
) -> list[dict]:
    """
    Merge semantic + keyword retrieval into a candidate pool.
    """
    # --- Path 1: Vector search ---
    vector_candidates = faiss_index.search_category(
        category=category,
        query_vec=query_embedding,
        top_k=top_vector
    )
    # Returns list of {found_id, description, vector_score}
    
    # --- Path 2: Keyword / BM25 search ---
    keyword_candidates = []
    if must_match_tokens or keywords:
        search_tokens = must_match_tokens + keywords[:5]  # cap keywords
        keyword_candidates = bm25_searcher.search(
            category=category,
            tokens=search_tokens,
            top_k=top_keyword
        )
    # Returns list of {found_id, description, bm25_score}
    
    # --- Merge & Deduplicate ---
    seen_ids = set()
    merged = []
    
    for c in vector_candidates + keyword_candidates:
        if c["found_id"] not in seen_ids:
            seen_ids.add(c["found_id"])
            merged.append(c)
    
    return merged  # up to top_vector + top_keyword items
```

### H3. `compute_features()`

```python
def compute_features(lost_attrs: dict, found_item: dict) -> dict:
    """
    Compute feature vector for a (lost, found) pair.
    """
    found_attrs = found_item.get("extracted_attributes_json") or {}
    
    sem = cosine_similarity(
        lost_attrs["embedding"],
        found_item["embedding_vector"]
    )
    
    kw = bm25_score_normalized(
        lost_attrs["keywords"] + lost_attrs["must_match_tokens"],
        found_item["found_id"]
    )
    
    attr_scores = {}
    for field in ["color", "brand", "model", "material"]:
        lv = (lost_attrs.get("attributes") or {}).get(field)
        fv = (found_attrs.get("attributes") or {}).get(field)
        attr_scores[f"f_attr_{field}_match"] = compute_attr_match(lv, fv)
    
    id_bonus, id_penalty = identifier_score(lost_attrs, found_attrs)
    contradiction = contradiction_penalty(lost_attrs, found_attrs)
    
    return {
        "f_semantic_sim":            sem,
        "f_bm25_score_norm":         kw,
        **attr_scores,
        "f_identifier_match_ratio":  id_bonus,
        "f_n_must_match_tokens":     len(lost_attrs.get("must_match_tokens", [])),
        "f_identifier_in_found_text":int(id_bonus > 0),
        "f_contradiction_score":     contradiction,
        "f_query_n_tokens":          len(lost_attrs.get("keywords", [])),
        "f_found_n_tokens":          len(found_item.get("description_text", "").split()),
        "f_query_missing_fields":    len(lost_attrs.get("missing_fields", [])),
        "f_len_ratio": (
            len((lost_attrs.get("clean_description") or "").split()) /
            max(1, len(found_item.get("description_text", "").split()))
        ),
        # placeholders for positional features (filled by score_and_rank)
        "f_initial_rank":            0,
        "f_candidate_pool_size":     0,
        
        # pass-through for final score computation
        "_id_penalty": id_penalty,
    }
```

### H4. `score_and_rank_candidates()`

```python
def score_and_rank_candidates(
    lost_attrs: dict,
    candidates: list[dict],        # enriched with features
    model_variant: str = "rule_based_v1"
) -> list[dict]:
    """
    Score and rank candidate pool.
    Returns sorted list with scores.
    """
    pool_size = len(candidates)
    
    for i, c in enumerate(candidates):
        c["features"]["f_initial_rank"] = i + 1
        c["features"]["f_candidate_pool_size"] = pool_size
    
    if model_variant.startswith("lgbm") and lgbm_model is not None:
        # --- ML re-ranking ---
        X = pd.DataFrame([c["features"] for c in candidates])[FEATURE_COLUMNS]
        scores = lgbm_model.predict(X)  # returns probability / ranking score
        for c, s in zip(candidates, scores):
            c["score"] = float(s)
    else:
        # --- Rule-based scoring ---
        for c in candidates:
            f = c["features"]
            c["score"] = compute_final_score(
                semantic=f["f_semantic_sim"],
                keyword=f["f_bm25_score_norm"],
                attr=(
                    f["f_attr_color_match"] * 0.30 +
                    f["f_attr_brand_match"] * 0.30 +
                    f["f_attr_model_match"] * 0.25 +
                    f["f_attr_material_match"] * 0.15
                ),
                id_bonus=f["f_identifier_match_ratio"],
                id_penalty=f["_id_penalty"],
                contradiction=f["f_contradiction_score"]
            )
    
    # Apply must-match hard rules
    ranked = apply_must_match_rule(candidates, lost_attrs)
    
    return ranked
```

### H5. `log_impression()` and `log_selection()`

```python
async def log_impression(
    query_id: str,
    lost_raw: str,
    category: str,
    session_id: str,
    shown_results: list[dict],    # top-K results with scores
    model_version: str
) -> str:
    """Non-blocking impression log. Returns impression_id."""
    impression_id = str(uuid4())
    
    doc = {
        "impression_id": impression_id,
        "query_id": query_id,
        "lost_item_raw": lost_raw,
        "category": category,
        "session_id": session_id,
        "timestamp": datetime.utcnow(),
        "shown_results": [
            {
                "rank": i + 1,
                "found_id": r["found_id"],
                "score": r["score"],
                "score_breakdown": r.get("features", {}),
                "model_version": model_version
            }
            for i, r in enumerate(shown_results)
        ]
    }
    
    # Fire-and-forget (asyncio.create_task or a background queue)
    asyncio.create_task(db.match_impressions.insert_one(doc))
    
    return impression_id


async def log_selection(
    impression_id: str,
    query_id: str,
    lost_raw: str,
    selected_found_id: str,
    selected_rank: int
):
    """Called when user clicks/selects an item from the list."""
    doc = {
        "selection_id": str(uuid4()),
        "impression_id": impression_id,
        "query_id": query_id,
        "lost_item_raw": lost_raw,
        "selected_found_id": selected_found_id,
        "selected_rank": selected_rank,
        "timestamp": datetime.utcnow()
    }
    await db.match_selections.insert_one(doc)
```

### H6. `build_training_dataset()`

```python
def build_training_dataset(
    min_date: datetime = None,
    max_date: datetime = None
) -> pd.DataFrame:
    """
    Join impressions + selections + verifications to produce labeled training pairs.
    """
    rows = []
    
    # Step 1: get all impressions that have a selection
    pipeline = [
        {"$lookup": {
            "from": "match_selections",
            "localField": "impression_id",
            "foreignField": "impression_id",
            "as": "selection"
        }},
        {"$unwind": "$selection"},
        # Optional: filter by date
    ]
    
    if min_date:
        pipeline.insert(0, {"$match": {"timestamp": {"$gte": min_date}}})
    
    impressions_with_selection = list(db.match_impressions.aggregate(pipeline))
    
    # Step 2: get all verifications indexed by (lost_id, found_id)
    verifications = {
        (v["lost_id"], v["found_id"]): v
        for v in db.handover_verifications.find()
    }
    
    for imp in impressions_with_selection:
        sel = imp["selection"]
        pos_found_id = sel["selected_found_id"]
        query_id = imp["query_id"]
        
        # --- Determine label and weight for the POSITIVE pair ---
        ver_key = (query_id, pos_found_id)
        ver = verifications.get(ver_key)
        
        if ver and ver["verified"]:
            pos_label, pos_weight = 1, 3.0   # STRONG positive
        elif ver and not ver["verified"]:
            continue                           # failed verification → skip
        else:
            pos_label, pos_weight = 1, 0.5   # no verification → weak positive
        
        # Positive pair
        pos_features = precompute_features_from_impression(imp, pos_found_id)
        rows.append({
            "query_id": query_id,
            "found_id": pos_found_id,
            "label": pos_label,
            "weight": pos_weight,
            **pos_features,
            "timestamp": imp["timestamp"]
        })
        
        # Hard negatives (only if we have a verified positive)
        neg_candidates = sample_hard_negatives(imp, pos_found_id, n_neg=8)
        for neg in neg_candidates:
            neg_features = precompute_features_from_impression(imp, neg["found_id"])
            rows.append({
                "query_id": query_id,
                "found_id": neg["found_id"],
                "label": 0,
                "weight": 1.0 if pos_weight == 3.0 else 0.3,
                **neg_features,
                "timestamp": imp["timestamp"]
            })
    
    df = pd.DataFrame(rows)
    
    # Assign splits by query_id (no leakage)
    unique_queries = df["query_id"].unique()
    np.random.shuffle(unique_queries)
    val_queries = set(unique_queries[:int(len(unique_queries) * 0.20)])
    df["split"] = df["query_id"].apply(lambda x: "val" if x in val_queries else "train")
    
    return df
```

### H7. `train_reranker_model()`

```python
def train_reranker_model(df: pd.DataFrame) -> lgb.Booster:
    """
    Train LightGBM lambdarank re-ranker from labeled dataset.
    """
    # Minimum data check
    n_positives = (df["label"] == 1).sum()
    if n_positives < 50:
        raise ValueError(f"Insufficient data: only {n_positives} positives. Need >= 50.")
    
    df_train = df[df["split"] == "train"].copy()
    df_val   = df[df["split"] == "val"].copy()
    
    # Group sizes (required by lambdarank)
    g_train = df_train.groupby("query_id", sort=False).size().values
    g_val   = df_val.groupby("query_id", sort=False).size().values
    
    train_ds = lgb.Dataset(
        df_train[FEATURE_COLUMNS],
        label=df_train["label"],
        weight=df_train["weight"],
        group=g_train
    )
    val_ds = lgb.Dataset(
        df_val[FEATURE_COLUMNS],
        label=df_val["label"],
        group=g_val,
        reference=train_ds
    )
    
    params = {
        "objective": "lambdarank",
        "metric": "ndcg",
        "ndcg_eval_at": [1, 3, 5],
        "learning_rate": 0.05,
        "num_leaves": 31,
        "min_data_in_leaf": 10,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "lambdarank_truncation_level": 10,
        "verbose": -1,
    }
    
    model = lgb.train(
        params,
        train_ds,
        num_boost_round=500,
        valid_sets=[val_ds],
        callbacks=[lgb.early_stopping(50), lgb.log_evaluation(50)]
    )
    
    # Save with version
    version = f"lgbm_v{datetime.utcnow().strftime('%Y%m%d_%H%M')}"
    model_path = f"data/models/{version}.pkl"
    with open(model_path, "wb") as f:
        pickle.dump(model, f)
    
    # Update model pointer
    with open("data/models/current_model_ptr.txt", "w") as f:
        f.write(model_path)
    
    logger.info(f"Model saved to {model_path}")
    return model
```

### H8. `inference_rerank()`

```python
def inference_rerank(
    raw_lost_text: str,
    category: str,
    session_id: str,
    top_k: int = 10
) -> dict:
    """
    Full end-to-end inference: normalize → retrieve → feature → rank → log.
    Returns top-K results and impression_id.
    """
    # Step 1: Normalize lost description
    lost_attrs = normalize_lost_description(raw_lost_text, category)
    query_id = str(uuid4())
    
    # Step 2: Retrieve candidates
    query_embedding = np.array(lost_attrs["embedding"], dtype=np.float32)
    candidates = get_candidates(
        category=category,
        query_embedding=query_embedding,
        must_match_tokens=lost_attrs.get("must_match_tokens", []),
        keywords=lost_attrs.get("keywords", [])
    )
    
    if not candidates:
        return {"ranked_results": [], "impression_id": None, "query_id": query_id}
    
    # Step 3: Load found item attributes from DB for all candidates
    found_ids = [c["found_id"] for c in candidates]
    found_attrs_map = batch_fetch_found_attributes(found_ids)  # dict[found_id → doc]
    
    for c in candidates:
        c.update(found_attrs_map.get(c["found_id"], {}))
    
    # Step 4: Compute features
    for c in candidates:
        c["features"] = compute_features(lost_attrs, c)
    
    # Step 5: Determine model variant (A/B)
    model_variant = get_model_variant(session_id, rollout_pct=AB_ROLLOUT_PCT)
    
    # Step 6: Score and rank
    ranked = score_and_rank_candidates(lost_attrs, candidates, model_variant)
    top_results = ranked[:top_k]
    
    # Step 7: Log impression (non-blocking)
    impression_id = asyncio.create_task(
        log_impression(
            query_id=query_id,
            lost_raw=raw_lost_text,
            category=category,
            session_id=session_id,
            shown_results=top_results,
            model_version=model_variant
        )
    )
    
    return {
        "query_id": query_id,
        "impression_id": impression_id,
        "ranked_results": [
            {
                "rank": i + 1,
                "found_id": r["found_id"],
                "score": r["score"],
                "description": r.get("description_text", ""),
            }
            for i, r in enumerate(top_results)
        ]
    }
```

---

## Implementation Roadmap

| Phase | Work | Estimated Effort |
|---|---|---|
| **Phase 0** | Add impression + selection logging to existing search API | 1-2 days |
| **Phase 1** | Integrate `LostTextNormalizer` (Gemini, Redis cache) | 2-3 days |
| **Phase 2** | Run `FoundTextAttributeCache` batch job for existing DB | 1 day + Gemini cost |
| **Phase 3** | Replace `_hybrid_score()` with full feature-based rule scoring | 2-3 days |
| **Phase 4** | Build BM25 keyword search as a second retrieval path | 1-2 days |
| **Phase 5** | Collect 100+ verified pairs → run `build_training_dataset()` | ongoing |
| **Phase 6** | Train first LightGBM model, deploy in shadow mode | 2-3 days |
| **Phase 7** | A/B test → full rollout | 2 weeks |

---

*Document version: 2.0 | Generated: February 2026 | FindAssure AI Engine*
