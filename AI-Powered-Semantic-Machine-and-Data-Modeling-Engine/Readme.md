
# AI-Powered Semantic Machine & Data Modeling Engine

> **Component of [FindAssure](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project)** — a smart Lost & Found system.

This service handles the complete text-matching and ranking pipeline: converting noisy user descriptions into structured attributes, retrieving candidate items via hybrid search, ranking them with a multi-signal scorer, and continuously improving through user feedback.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Current Workflow (End-to-End)](#current-workflow-end-to-end)
3. [API Endpoints](#api-endpoints)
4. [Core Modules](#core-modules)
5. [Scoring & Feature Engineering](#scoring--feature-engineering)
6. [Accuracy Improvement Features](#accuracy-improvement-features)
7. [Fine-Tuning Procedure](#fine-tuning-procedure)
8. [Feedback Loop & Training Data](#feedback-loop--training-data)
9. [MongoDB Collections](#mongodb-collections)
10. [Setup & Running](#setup--running)
11. [Configuration](#configuration)
12. [Scripts (Offline Jobs)](#scripts-offline-jobs)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Frontend (CRA + Tailwind CSS)          │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐ │
│  │ Report Found  │  │ Find My Item     │  │ Statistics Dashboard  │ │
│  │ (POST /index) │  │ (POST /search)   │  │ (GET /feedback-stats)│ │
│  └──────┬───────┘  └───────┬──────────┘  └───────────────────────┘ │
│         │    Live Grammar   │ Feedback (Yes/No)                     │
│         │    Correction     │ POST /feedback                        │
│         │    POST /correct- │                                       │
│         │    grammar        │                                       │
└─────────┼───────────────────┼───────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   FastAPI Backend (uvicorn)                          │
│                                                                     │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────────────┐│
│  │Normalizer│ │ Retriever │ │  Scorer  │ │ Impression Logger      ││
│  │(Gemini + │ │(FAISS+BM25│ │(Rule/ML +│ │ (MongoDB logging)     ││
│  │ Query Exp│ │+ Synonyms)│ │CrossEnc) │ │                        ││
│  └──────────┘ └───────────┘ └──────────┘ └────────────────────────┘│
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────────────┐│
│  │ Semantic │ │ RL Agent  │ │ Trainer  │ │ Fraud Detection        ││
│  │ Engine   │ │(Q-Learning│ │(LightGBM+│ │                        ││
│  │          │ │)          │ │Calibratr)│ │                        ││
│  └──────────┘ └───────────┘ └──────────┘ └────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
          │                                        │
          ▼                                        ▼
┌────────────────────┐                 ┌──────────────────────┐
│  MongoDB Atlas     │                 │  FAISS Index (disk)  │
│  (motor async)     │                 │  data/indices/       │
└────────────────────┘                 └──────────────────────┘
```

---

## Current Workflow (End-to-End)

### A. Server Startup (`app/main.py`)

| Step | Action | Module |
|------|--------|--------|
| 1/4 | Connect to MongoDB Atlas (DNS fix for SRV records via `dnspython`) | `database.py` |
| 2/4 | Load sentence-transformers model (`all-mpnet-base-v2`, 768-dim embeddings) | `semantic.py` |
| 3/4 | Load existing found-item vectors from MongoDB into FAISS index | `semantic.py` |
| 4/4 | Initialize Gemini normalizer (`gemini-2.0-flash`) + LightGBM re-ranker (if trained) | `normalizer.py`, `scorer.py` |

### B. Report Found Item Flow (`POST /index`)

```
User fills form → category + description
         │
         ▼
┌─ Gemini Grammar Correction ──────────────────────┐
│ Fix ONLY typos & grammar errors (no paraphrasing) │
│ "blak wallet neer library" → "black wallet near   │
│ library"                                           │
└────────────────────┬──────────────────────────────┘
                     ▼
         Store corrected text in MongoDB
         Generate 768-dim embedding
         Add to FAISS in-memory index
                     ▼
         Response: { item_id, grammar_corrected }
```

### C. Find My Lost Item Flow (`POST /search`) — 7 Stages

```
User types lost item description
         │
         ▼
┌─ Stage 1: Live Grammar Correction (Frontend) ────┐
│ Debounced (1.2s after typing stops)               │
│ POST /correct-grammar → fixes typos in-place      │
│ Shows green ✓ note: "blak → black"                │
└────────────────────┬──────────────────────────────┘
                     ▼
┌─ Stage 2: Grammar Correction (Backend, on submit) ┐
│ Second pass to catch any remaining errors           │
│ Uses same Gemini prompt (errors-only, no rewrite)   │
└────────────────────┬───────────────────────────────┘
                     ▼
┌─ Stage 3: Gemini Text Normalization ──────────────┐
│ Extract structured attributes via Gemini:          │
│   item_type, color, brand, material, size,         │
│   identifiers[], unique_marks[],                   │
│   numeric_values[], keywords[], missing_fields[]   │
│ Result cached in MongoDB (TTL = 1 hour)            │
└────────────────────┬──────────────────────────────┘
                     ▼
┌─ Stage 4: Hybrid Candidate Retrieval ─────────────┐
│ Path A: FAISS vector search (cosine, top 200)      │
│ Path B: MongoDB $text keyword/BM25 search (top 50) │
│ Path C: Exact identifier lookup (if present)       │
│ ─→ Merge + deduplicate by item_id                  │
└────────────────────┬──────────────────────────────┘
                     ▼
┌─ Stage 5: Feature Scoring (22 features) ──────────┐
│ Per (lost, found) pair compute:                    │
│   f_semantic_sim, f_bm25_score_norm,               │
│   f_attr_color_match, f_attr_brand_match,          │
│   f_attr_model_match, f_attr_material_match,       │
│   f_identifier_match_ratio, f_n_must_match_tokens, │
│   f_identifier_in_found_text,                      │
│   f_contradiction_score, f_initial_rank,           │
│   f_candidate_pool_size, f_query_n_tokens,         │
│   f_found_n_tokens, f_query_missing_fields,        │
│   f_len_ratio, f_numeric_match,                    │
│   f_money_amount_match,                            │
│ ★ NEW accuracy signals:                            │
│   f_cross_encoder_score, f_time_decay,             │
│   f_synonym_keyword_boost, f_category_weight_score │
└────────────────────┬──────────────────────────────┘
                     ▼
┌─ Stage 5½: Query Expansion (Gemini) ──────────────┐
│ Generate 3 alternative phrasings + extra keywords   │
│ + attribute variants via Gemini                     │
│ Merged into retrieval to broaden candidate pool     │
└────────────────────┬──────────────────────────────┘
                     ▼
┌─ Stage 6: Ranking ────────────────────────────────┐
│ IF LightGBM model exists → ML re-ranker            │
│ ELSE → Rule-based v2 weighted formula:              │
│   score = penalty × category_weights × (            │
│     0.55×semantic + 0.20×keyword + 0.25×attribute)  │
│   + 0.10×cross_encoder + 0.05×synonym_boost         │
│   + 0.05×category_weight + 0.03×time_decay          │
│ identifier_exact match → forced to top (0.99+)     │
│ Scores calibrated to true match probability         │
│ A/B split via AB_ROLLOUT_PCT env variable          │
└────────────────────┬──────────────────────────────┘
                     ▼
┌─ Stage 7: Response + Logging ─────────────────────┐
│ Log impression to MongoDB (query_id, impression_id,│
│   ranked results, model_version, session_id)       │
│ Return ranked matches + grammar_corrected flag     │
│ Frontend filters: only display score > 50%         │
└────────────────────┬──────────────────────────────┘
                     ▼
         Results rendered as cards with score badges
         User sees "Yes, it's mine" / "No" buttons
```

### D. Feedback Loop

```
User clicks "Yes, it's mine" or "No"
         │
         ▼
    POST /feedback
         │
    ┌────┴────────────────────────────────┐
    │ Store in handover_verifications      │
    │ RL Agent gets reward (+1 or -1)     │
    │ Q-table updated via Q-learning      │
    └────┬────────────────────────────────┘
         │
         ▼  (when ≥50 verified positive pairs collected)
    POST /retrain
         │
    ┌────┴────────────────────────────────┐
    │ Build labeled dataset from logs     │
    │ Train LightGBM lambdarank model     │
    │ Hot-swap: new model deployed live   │
    └─────────────────────────────────────┘
```

### E. External Verification (from Handover System)

```
Handover system confirms/rejects claim
         │
         ▼
    POST /log-verification
         │
    Stores STRONGEST training signal:
      verified=true  → weight=3.0 (strong positive)
      verified=false → pair excluded from training
```

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Health check (status, gemini enabled, A/B rollout %) |
| `POST` | `/index` | Add a FOUND item (auto grammar-corrected, vectorized, indexed) |
| `POST` | `/correct-grammar` | Live grammar correction — frontend calls this as user types |
| `POST` | `/search` | Search for LOST item (full 7-stage pipeline) |
| `POST` | `/log-selection` | Log which result the user clicked (ties to impression_id) |
| `POST` | `/feedback` | User yes/no feedback on match quality |
| `POST` | `/log-verification` | External handover system reports claim verification |
| `POST` | `/fraud-check` | Check user metadata for suspicious behavior |
| `POST` | `/retrain` | Trigger LightGBM re-ranker retraining |
| `GET` | `/feedback-stats` | Dashboard: impressions, selections, verifications, training readiness |

---

## Core Modules

| Module | File | Responsibility |
|--------|------|----------------|
| **LostTextNormalizer** | `app/core/normalizer.py` | Gemini-powered grammar correction, lost-item attribute extraction (cached), found-item attribute extraction (batch), **query expansion** (generates alternative phrasings + extra keywords). Uses strict grammar prompt that only fixes errors. |
| **SemanticEngine** | `app/core/semantic.py` | Sentence-Transformers (`all-mpnet-base-v2`), FAISS IndexFlatIP, vectorize/search/add_item, load from MongoDB or disk cache |
| **CandidateRetriever** | `app/core/retriever.py` | Merges FAISS vector search + MongoDB $text BM25 search + exact identifier lookup into deduplicated candidate pool |
| **ReRanker / FeatureComputer** | `app/core/scorer.py` | Computes 22 pair features (including cross-encoder, time-decay, synonym boost, category weights), applies rule-based v2 scoring or LightGBM re-ranker with confidence calibration. Handles `must_match_tokens` logic and A/B routing |
| **ImpressionLogger** | `app/core/impression_logger.py` | Async logging of search impressions and user selections to MongoDB |
| **RLRankingAgent** | `app/core/rl_agent.py` | Q-learning agent (ε-greedy) that adjusts ranking weights from user feedback rewards |
| **TrainingPipeline** | `app/core/trainer.py` | Builds labeled (lost, found) pair datasets from logs, trains LightGBM lambdarank model, trains confidence calibrator (Platt scaling), supports mined hard negatives |
| **DataModelingEngine** | `app/core/modeling.py` | Knowledge-graph context suggestions per category |
| **FraudDetectionEngine** | `app/core/fraud.py` | Behavioral fraud scoring on user metadata |
| **Database** | `app/core/database.py` | Motor async MongoDB connection with DNS fix (Google/Cloudflare public DNS for SRV resolution), SSL CA bundle via certifi |

---

## Scoring & Feature Engineering

### 22 Feature Columns (per lost-found pair)

| # | Feature | Description |
|---|---------|-------------|
| 1 | `f_semantic_sim` | Cosine similarity between sentence embeddings (0–1) |
| 2 | `f_bm25_score_norm` | Normalized BM25 keyword overlap score |
| 3 | `f_attr_color_match` | Color attribute match (fuzzy string match) |
| 4 | `f_attr_brand_match` | Brand name match |
| 5 | `f_attr_model_match` | Model number match |
| 6 | `f_attr_material_match` | Material match |
| 7 | `f_identifier_match_ratio` | Ratio of matched unique identifiers |
| 8 | `f_n_must_match_tokens` | Count of must-match tokens in query |
| 9 | `f_identifier_in_found_text` | Whether identifier appears in found description text |
| 10 | `f_contradiction_score` | Penalty for contradicting attributes (e.g., "black" vs "red") |
| 11 | `f_initial_rank` | Original retrieval rank (lower = better) |
| 12 | `f_candidate_pool_size` | Total candidates in current pool |
| 13 | `f_query_n_tokens` | Number of tokens in lost query |
| 14 | `f_found_n_tokens` | Number of tokens in found description |
| 15 | `f_query_missing_fields` | How many expected fields are missing from query |
| 16 | `f_len_ratio` | Length ratio between query and found text |
| 17 | `f_numeric_match` | Overlap ratio of extracted numeric values |
| 18 | `f_money_amount_match` | Proximity of monetary values (0=far, 1=exact match) |
| 19 | `f_cross_encoder_score` | **NEW** — Cross-encoder re-ranker score (reads both texts jointly) |
| 20 | `f_time_decay` | **NEW** — Freshness score (recent found items score higher) |
| 21 | `f_synonym_keyword_boost` | **NEW** — Keyword overlap after synonym expansion |
| 22 | `f_category_weight_score` | **NEW** — Category-aware attribute importance score |

### Rule-Based Scoring Formula v2 (default, before ML model is trained)

```
IF identifier_exact → score = 0.99 + tie_breaker
ELSE:
  base = contradiction_penalty × category_specific_weights × (
      0.55 × semantic_sim
    + 0.20 × keyword_score
    + 0.25 × attribute_score
  )

  final = 0.77 × base
        + 0.10 × cross_encoder_score
        + 0.05 × synonym_keyword_boost
        + 0.05 × category_weight_score
        + 0.03 × time_decay

  calibrated_score = calibrate(final)   # Platt scaling → true probability
```

Results are converted to a 0–100% scale. **Only matches >50% are shown to users.**

The calibration step (Platt scaling) converts raw scores into real-world match probabilities, so a displayed "85%" genuinely means the system is 85% confident the items match.

---

## Accuracy Improvement Features

The matching engine includes several advanced features designed to improve accuracy beyond basic semantic similarity. Here is what each one does in plain English:

### 1. Cross-Encoder Re-Ranker

**What it does**: Most search systems encode the query and each candidate item separately, then compare them. A cross-encoder is different — it reads both the lost description and a found description *together* as a single piece of text, allowing it to pick up on subtle relationships between the two that get missed when they are encoded separately.

**How it helps**: Suppose someone lost a "navy blue North Face backpack" and there is a found item described as "dark blue hiking bag, North Face logo". A regular encoder might score this lower because the words differ, but the cross-encoder reads both side by side and understands they are describing the same thing.

**Model used**: `cross-encoder/ms-marco-MiniLM-L-6-v2` — a small, fast model that adds minimal latency.

**Weight in final score**: 10%

---

### 2. Time-Decay (Freshness Boost)

**What it does**: Items that were reported as found more recently get a slight score boost, while very old found items get penalized. The system uses an exponential decay formula with a 72-hour half-life — this means a found item loses half its freshness bonus every 3 days.

**How it helps**: If you just lost your phone today, a phone found 2 hours ago at the same campus is far more likely to be yours than one found 3 weeks ago. Time-decay captures this common-sense reasoning. It does not eliminate old items — it just nudges recent ones higher when scores are otherwise close.

**Weight in final score**: 3%

---

### 3. Synonym-Aware Keyword Matching

**What it does**: Before comparing keywords between the lost and found descriptions, the system expands both keyword sets using a built-in synonym dictionary with 50+ domain-specific word groups. For example, "phone" expands to include "mobile", "cell", "smartphone", "cellphone"; "bag" expands to include "backpack", "rucksack", "sack", "pouch".

**How it helps**: People describe the same item using different words. One person writes "I lost my spectacles" while another reports finding "glasses". Without synonym expansion, the keyword matcher would see zero overlap. With it, the system recognizes these are the same thing.

**Covered domains**: Electronics, accessories, documents, clothing, colors, containers, stationery, and more.

**Weight in final score**: 5%

---

### 4. Category-Specific Attribute Weights

**What it does**: Different categories of items have different attributes that matter most. For a laptop, the brand and model are the most important matching signals. For a wallet, the color and material matter more. The system maintains 27 category-specific weight profiles that automatically adjust which attributes carry the most importance when scoring.

**How it helps**: Imagine two wallets — one black leather, one brown fabric. Even if both are "wallets found near the library", the color and material differences are critical. But for electronics, two phones might look identical from outside, so the brand and serial number matter much more. Category weights ensure the system focuses on what actually matters for each type of item.

**Examples**:
- **Electronics** (laptop, phone, tablet): brand (35%), model (35%), color (15%), material (15%)
- **Wallet / Purse**: color (35%), material (35%), brand (15%), model (15%)
- **Documents** (ID card, passport): identifier (50%), brand (20%), color (15%), material (15%)
- **Jewelry** (ring, necklace): material (40%), color (35%), brand (15%), model (10%)

**Weight in final score**: 5%

---

### 5. Query Expansion via Gemini

**What it does**: When a user types a lost item description, the system asks Google Gemini to generate three alternative ways to describe the same item, plus 3–8 additional keywords that someone finding the item might use, plus attribute variants (e.g., if you said "red", it might add "crimson", "scarlet").

**How it helps**: Users tend to describe items from their own perspective ("my favorite coffee mug") while finders describe what they see ("white ceramic cup with a chip on the rim"). Query expansion bridges this gap by generating the kinds of words a finder might use, so the retrieval stage pulls in candidates that would otherwise be missed.

**Fallback**: If Gemini is unavailable, the system continues without expansion — no errors, no delays.

---

### 6. Confidence Calibration (Platt Scaling)

**What it does**: Raw match scores from the model are not true probabilities — a raw score of 0.80 does not necessarily mean an 80% chance the items match. Confidence calibration applies a statistical technique called Platt scaling (logistic regression on raw scores vs. actual match outcomes) to convert raw scores into genuine probability estimates.

**How it helps**: Before calibration, the system might show most results clustered between 60–90% with no clear separation. After calibration, scores are spread more meaningfully — true matches tend to score 85%+ while non-matches drop to 30–40%. This makes the >50% display threshold much more reliable and gives users trustworthy confidence percentages.

**Training**: The calibrator is automatically trained at the end of every LightGBM re-ranker training. A sigmoid fallback is used until the first calibrator is trained.

---

### 7. Hard Negative Mining

**What it does**: During training, the system needs examples of items that are *not* matches ("negatives") to learn from. Hard negatives are the trickiest kind — found items that *look similar* to the lost item but are actually different. The mining script identifies three types:
- **Verification failures**: Items the system thought matched but the handover system rejected
- **High-rank rejects**: Items ranked highly in search results but the user said "No, that's not mine"
- **Cross-category confusions**: Items from different categories that the system incorrectly scored highly

**How it helps**: Learning from easy negatives (e.g., a phone vs. a jacket) is trivial and teaches the model nothing useful. Hard negatives force the model to learn subtle distinctions — like the difference between a "black Samsung Galaxy S23" and a "black Samsung Galaxy S24". This is where real accuracy gains happen.

---

### 8. Expanded Training Data (40 → 105 pairs)

**What it does**: The sentence-transformer fine-tuning dataset was expanded from 40 manually curated text pairs to 105 diverse pairs covering a much wider range of item categories.

**How it helps**: More diverse training data means the embedding model produces better vector representations across all item types — not just the common ones like phones and wallets. The expanded dataset includes: MacBooks, Kindles, iPads, Bluetooth speakers, Nintendo Switches, passports, camera lenses, wedding rings, AirPods, violins, drones, skateboards, baby strollers, lab coats, safety equipment, and 50+ more item types.

---

### Feature Integration Summary

| Feature | Where | Weight | Runs When |
|---------|-------|--------|-----------|
| Cross-Encoder Re-Ranker | scorer.py | 10% | Every search |
| Time-Decay | scorer.py | 3% | Every search |
| Synonym Keyword Boost | scorer.py | 5% | Every search |
| Category Weights | scorer.py | 5% | Every search |
| Query Expansion | normalizer.py → scorer.py | N/A (broadens retrieval) | Every search |
| Confidence Calibration | scorer.py | N/A (post-processing) | Every search |
| Hard Negative Mining | scripts/mine_hard_negatives.py | N/A (training improvement) | Offline |
| Expanded Training Data | data/raw/text_pairs_english.json | N/A (embedding improvement) | Offline |

---

## Fine-Tuning Procedure

The system uses **three levels of fine-tuning**, each building on user interaction data:

### Level 1 — Sentence-Transformer Embedding Model

**Model**: `all-mpnet-base-v2` (768 dimensions)

**Training data**: `data/raw/text_pairs_english.json` — 105 manually curated pairs of lost/found descriptions with similarity labels.

**Script**: `scripts/train_english_only.py`

```bash
python scripts/train_english_only.py
```

**What it does**:
1. Loads the base `all-mpnet-base-v2` model
2. Trains on domain-specific (lost, found) text pairs
3. Uses CosineSimilarityLoss to bring matching pairs closer in embedding space
4. Saves fine-tuned model to `data/models/fine_tuned_bert/`
5. Runs evaluation on held-out pairs, saves results to `data/models/fine_tuned_bert/eval/`

**When to retrain**: When you have new manual text pairs or want to improve the base embedding quality for this domain.

### Level 2 — LightGBM Re-Ranker (Automated from Feedback)

**Model**: LightGBM with lambdarank objective

**Training data**: Automatically built from MongoDB logs — no manual labeling needed.

**How training data is collected** (3 feedback signals, strongest to weakest):

| Signal | Source | Label | Weight | Description |
|--------|--------|-------|--------|-------------|
| Handover Verification | `POST /log-verification` | 1 (true) / skip (false) | 3.0 | External system confirms ownership — **strongest signal** |
| User Feedback | `POST /feedback` | 1 (yes) / 0 (no) | 1.0 | User clicks "Yes, it's mine" or "No" in the UI |
| Implicit Selection | `POST /log-selection` | 1 (selected) / 0 (not selected) | 0.5 | User clicks on a result — **weakest signal** |

**Trigger retraining** (requires ≥50 verified positive pairs by default):

```bash
# Via API
curl -X POST http://localhost:8001/retrain -H "Content-Type: application/json" -d '{"force": false}'

# Via script
python scripts/train_reranker.py
```

**What it does**:
1. `build_training_dataset()` joins `match_impressions` + `match_selections` + `handover_verifications`
2. For each verified positive pair: label=1. Hard negatives sampled from same impression (top-ranked but wrong items): label=0
3. Target ratio: 1 positive : 5–10 negatives
4. Features are the 18 columns from the scorer
5. LightGBM trains with lambdarank objective (22 features including new accuracy signals)
6. Confidence calibrator trained automatically (Platt scaling on raw scores vs labels)
7. Model saved to `data/models/reranker/` with version timestamp
8. `current_model_ptr.txt` updated to point to new model
9. Model + calibrator hot-swapped into the running server (no restart needed)

**A/B Testing**: Set `AB_ROLLOUT_PCT` in `.env` to gradually shift traffic from rule-based to ML re-ranker (0.0 = all rule-based, 1.0 = all ML).

### Level 3 — RL Agent (Real-Time Weight Adjustment)

**Model**: Q-learning with ε-greedy exploration

**How it works**:
1. State = (category_matched, semantic_score_range)
2. Actions = decrease / keep / increase ranking weight
3. Reward = +1.0 for positive feedback, -1.0 for negative
4. Q-table updated after every user feedback via Bellman equation
5. Q-table persisted to `data/models/rl_q_table.pkl`

**This runs automatically** — every `POST /feedback` call updates the RL agent. No manual intervention needed.

### Fine-Tuning Summary

```
                    Manual Effort              Automatic
                    ──────────────             ──────────
Level 1:  ██████████████████████████           (curated text pairs)
          train_english_only.py
          ↓ improves base embeddings

Level 2:  ██                                   ██████████████████
          (set AB_ROLLOUT_PCT)                  (feedback → retrain)
          ↓ improves re-ranking

Level 3:                                       ██████████████████████
                                               (every feedback auto-updates)
          ↓ fine-tunes ranking weights in real-time
```

---

## Feedback Loop & Training Data

### Data Flow

```
User searches → sees ranked results → gives feedback
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
              match_impressions    match_selections    handover_verifications
              (what was shown)    (what was clicked)   (was claim correct?)
                     │                    │                    │
                     └────────────────────┼────────────────────┘
                                          ▼
                              build_training_dataset()
                                          │
                                          ▼
                              ┌──────────────────────┐
                              │ Labeled pairs:        │
                              │  (lost, found, label, │
                              │   weight, 18 features)│
                              └──────────┬───────────┘
                                          ▼
                              train_reranker_model()
                                          │
                                          ▼
                              LightGBM model deployed
                              (hot-swapped, no restart)
```

### Training Readiness

The `/feedback-stats` endpoint returns current collection status:

```json
{
  "status": "ok",
  "impressions": 142,
  "selections": 38,
  "verifications": { "total": 25, "positive": 18, "negative": 7 },
  "training_ready": false,
  "min_required": 50,
  "message": "Need 32 more verified pairs before training."
}
```

The frontend **Statistics** tab shows this as a progress bar.

---

## MongoDB Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `found_items` | Stored found item documents | `item_id`, `description`, `category`, `vector[]`, `extracted_attributes`, `keywords` |
| `text_normalizations` | Gemini extraction cache (TTL 1hr) | `cache_key` (sha256), `result`, `created_at` |
| `match_impressions` | Search result logs | `query_id`, `impression_id`, `shown_results[]`, `model_version`, `session_id` |
| `match_selections` | User click logs | `impression_id`, `query_id`, `selected_found_id`, `selected_rank` |
| `handover_verifications` | Feedback + verification records | `lost_id`, `found_id`, `verified`, `verification_method`, `source` |

---

## Setup & Running

### Prerequisites

- Python 3.12+
- MongoDB Atlas cluster (or local MongoDB)
- Google Gemini API key

### Installation

```bash
cd AI-Powered-Semantic-Machine-and-Data-Modeling-Engine

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```dotenv
# .env
MONGODB_URL=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?appName=<app>
DATABASE_NAME=lost_and_found
GEMINI_API_KEY=<your-gemini-api-key>
GEMINI_MODEL=gemini-2.0-flash
AB_ROLLOUT_PCT=0.0
MIN_TRAIN_POSITIVES=50
```

> **Important**: Never hardcode credentials in `config.py`. All secrets are loaded from `.env` via `python-dotenv`.

### Running the Server

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

Startup logs will show 4 initialization steps completing.

### Running the Frontend

```bash
cd ../frontend-semantic
npm install
npx craco start    # development mode on localhost:3000
npx craco build    # production build to build/
```

---

## Configuration

All configuration is in `app/config.py`, loaded from `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URL` | (empty) | MongoDB Atlas connection string |
| `DATABASE_NAME` | `lost_and_found` | Database name |
| `GEMINI_API_KEY` | (empty) | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model name |
| `GEMINI_CACHE_TTL_SECONDS` | `3600` | Normalization cache TTL |
| `AB_ROLLOUT_PCT` | `0.0` | ML model traffic percentage (0.0–1.0) |
| `MIN_TRAIN_POSITIVES` | `50` | Minimum verified pairs before allowing retrain |

---

## Scripts (Offline Jobs)

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `scripts/train_english_only.py` | Fine-tune sentence-transformer on domain pairs | When you have new curated text pairs |
| `scripts/train_reranker.py` | Train LightGBM re-ranker from MongoDB feedback logs | When ≥50 verified pairs collected (or use `POST /retrain`) |
| `scripts/train_semantic.py` | Train semantic model (alternative trainer) | Domain-specific embedding improvement |
| `scripts/batch_extract_found_attributes.py` | Run Gemini attribute extraction on all existing found items | After bulk-importing found items |
| `scripts/rebuild_index.py` | Rebuild FAISS index from MongoDB vectors | After bulk changes to found items |
| `scripts/build_graph.py` | Build knowledge graph for context suggestions | When updating item ontology |
| `scripts/test_accuracy.py` | Evaluate retrieval accuracy metrics | After retraining any model |
| `scripts/mine_hard_negatives.py` | **NEW** — Mine hard negatives from MongoDB logs for training | Periodically, to improve re-ranker training data |
| `scripts/expand_training_data.py` | **NEW** — Expand text_pairs_english.json with diverse pairs | One-time (already expanded 40 → 105 pairs) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| API Framework | FastAPI + uvicorn |
| Database | MongoDB Atlas (motor async driver) |
| Embeddings | sentence-transformers (`all-mpnet-base-v2`, 768-dim) |
| Cross-Encoder | `cross-encoder/ms-marco-MiniLM-L-6-v2` (joint re-ranking) |
| Vector Search | FAISS (IndexFlatIP, cosine similarity) |
| Text Normalization | Google Gemini (`gemini-2.0-flash`) + query expansion |
| Re-Ranker | LightGBM (lambdarank) / Rule-based v2 fallback + Platt calibration |
| RL Agent | Q-learning (NumPy) |
| Keyword Search | rank_bm25 + MongoDB $text index |
| Fuzzy Matching | thefuzz + python-Levenshtein |
| Frontend | React 19 + CRACO + Tailwind CSS v4 |

---

*Last updated: March 2026*

