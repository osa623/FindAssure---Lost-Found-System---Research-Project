
# AI-Powered Semantic Machine & Data Modeling Engine

> **Component of [FindAssure](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project)** — an intelligent Lost & Found system that uses deep learning, natural language processing, and reinforcement learning to match lost items with found items through semantic understanding of natural-language descriptions.

---

## What This System Does

When someone loses an item (e.g., "I lost my black Samsung phone near the library"), the system takes that noisy, natural-language description and intelligently matches it against a database of found items — even when the descriptions use completely different words, have typos, or describe the same item from different perspectives.

The engine goes far beyond simple keyword matching. It understands that "spectacles" and "glasses" are the same thing, that a "navy blue hiking bag" is likely the same as a "dark blue North Face backpack", and that a phone found 2 hours ago is more relevant than one found 3 weeks ago. It does this through a multi-stage pipeline combining **transformer-based semantic embeddings**, **cross-encoder re-ranking**, **Gemini-powered text normalization**, **synonym-aware keyword matching**, and a **22-feature scoring system** — all of which continuously improve through a four-level feedback-driven learning loop.

---

## Table of Contents

1. [Technology Stack](#technology-stack)
2. [System Architecture](#system-architecture)
3. [How the Matching Pipeline Works](#how-the-matching-pipeline-works)
4. [22-Feature Scoring System](#22-feature-scoring-system)
5. [Accuracy Enhancement Techniques](#accuracy-enhancement-techniques)
6. [Four-Level Continuous Learning System](#four-level-continuous-learning-system)
7. [Feedback-Driven Data Flow](#feedback-driven-data-flow)
8. [API Endpoints](#api-endpoints)
9. [Core Modules](#core-modules)
10. [Data Storage Design](#data-storage-design)

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **API Framework** | FastAPI + Uvicorn | Asynchronous REST API with automatic OpenAPI documentation |
| **Database** | MongoDB Atlas (Motor async driver) | Document storage for items, feedback logs, training data, and caching |
| **Sentence Embeddings** | `all-mpnet-base-v2` (768-dim, fine-tuned) | Converts item descriptions into dense vector representations for semantic comparison |
| **Cross-Encoder** | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Jointly reads both lost and found descriptions together for precise re-ranking |
| **Vector Search** | FAISS (IndexFlatIP) | Fast approximate nearest neighbor search over 768-dimensional embeddings using cosine similarity |
| **Text Normalization** | Google Gemini (`gemini-2.0-flash`) | Grammar correction, structured attribute extraction, and query expansion |
| **Re-Ranking Model** | LightGBM (LambdaRank objective) | Learning-to-rank model trained on 22 features from user feedback signals |
| **Confidence Calibration** | Platt Scaling (scikit-learn LogisticRegression) | Converts raw match scores into genuine probability estimates |
| **Reinforcement Learning** | Q-Learning Agent (ε-greedy, NumPy) | Real-time weight adjustment from user feedback rewards |
| **Keyword Search** | BM25 (rank_bm25) + MongoDB $text Index | Sparse retrieval to complement dense vector search |
| **Fuzzy Matching** | thefuzz + python-Levenshtein | Attribute-level string similarity for brands, colors, materials |
| **Frontend** | React 19 + Tailwind CSS v4 | User interface for reporting found items, searching, and providing feedback |

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     React Frontend (Tailwind CSS)                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────┐ │
│  │ Report Found  │  │ Find My Item     │  │ Statistics Dashboard   │ │
│  │ (POST /index) │  │ (POST /search)   │  │ (GET /feedback-stats) │ │
│  └──────┬───────┘  └───────┬──────────┘  └────────────────────────┘ │
│         │  Live Grammar     │  User Feedback (Yes/No)                │
│         │  Correction       │  POST /feedback                        │
└─────────┼───────────────────┼────────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend (Uvicorn)                         │
│                                                                      │
│  ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ Normalizer │  │  Retriever  │  │   Scorer   │  │  Impression  │ │
│  │ (Gemini +  │  │ (FAISS +    │  │ (Rule/ML + │  │   Logger     │ │
│  │  Query     │  │  BM25 +     │  │  CrossEnc +│  │ (MongoDB)    │ │
│  │  Expansion)│  │  Synonyms)  │  │  Calibratr)│  │              │ │
│  └────────────┘  └─────────────┘  └────────────┘  └──────────────┘ │
│  ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │  Semantic  │  │  RL Agent   │  │  Trainer   │  │    Fraud     │ │
│  │  Engine    │  │ (Q-Learning)│  │ (LightGBM +│  │  Detection   │ │
│  │ (BERT 768) │  │             │  │  Embedding │  │              │ │
│  │            │  │             │  │  Feedback)  │  │              │ │
│  └────────────┘  └─────────────┘  └────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
          │                                        │
          ▼                                        ▼
┌─────────────────────┐                ┌───────────────────────┐
│   MongoDB Atlas      │                │   FAISS Vector Index   │
│   (6 collections)    │                │   (768-dim, cosine)    │
└─────────────────────┘                └───────────────────────┘
```

---

## How the Matching Pipeline Works

When a user searches for a lost item, the system executes a multi-stage pipeline that progressively narrows and refines candidates. Each stage adds intelligence on top of the previous one.

### Stage 1 — Grammar Correction (Gemini)

The user's raw text goes through two passes of grammar correction using Google Gemini. The first pass happens live in the frontend as the user types (debounced at 1.2 seconds), showing corrections like "blak wallet neer library" → "black wallet near library". The second pass runs on the backend when the form is submitted, catching anything the first pass missed. The Gemini prompt strictly corrects only errors — it does not rephrase or paraphrase, preserving the user's original intent.

### Stage 2 — Structured Attribute Extraction (Gemini)

The corrected text is passed to Gemini for structured extraction. This converts unstructured prose into a machine-readable format:

```
Input:  "I lost my black leather Samsung Galaxy S24 near the science building"
Output: {
  item_type: "phone",
  color: "black",
  brand: "Samsung",
  model: "Galaxy S24",
  material: "leather",
  identifiers: [],
  keywords: ["samsung", "galaxy", "s24", "phone", "black", "leather"],
  missing_fields: ["size"]
}
```

Results are cached in MongoDB with a 1-hour TTL to avoid redundant API calls.

### Stage 3 — Query Expansion (Gemini)

Before retrieval, Gemini generates three alternative phrasings of the lost item description, 3–8 additional keywords a finder might use, and attribute variants (e.g., "red" → "crimson", "scarlet"). This bridges the vocabulary gap between how people describe items they lost versus how finders describe what they found. The expanded keywords are merged into the retrieval query to broaden the candidate pool.

### Stage 4 — Hybrid Candidate Retrieval (FAISS + BM25 + Exact Match)

Three independent retrieval paths run in parallel:

| Path | Method | Returns |
|------|--------|---------|
| **A** | FAISS vector search (cosine similarity over 768-dim embeddings) | Top 200 semantically similar items |
| **B** | MongoDB $text index + BM25 keyword scoring | Top 50 keyword-matched items |
| **C** | Exact identifier lookup (serial numbers, student IDs) | Precise matches if identifiers exist |

Results are merged and deduplicated by item ID, producing a unified candidate pool.

### Stage 5 — 22-Feature Scoring

For every (lost, found) candidate pair, the system computes 22 features spanning semantic similarity, keyword overlap, attribute matching, cross-encoder analysis, temporal relevance, and statistical signals. These features feed into either the LightGBM re-ranker (when trained) or the rule-based scoring formula v2.

### Stage 6 — Ranking & Calibration

The final ranking combines all signals through a weighted formula:

```
final = 0.77 × base_score
      + 0.10 × cross_encoder_score
      + 0.05 × synonym_keyword_boost
      + 0.05 × category_weight_score
      + 0.03 × time_decay

calibrated_score = platt_scaling(final)  →  true match probability
```

The base score itself is a weighted combination: 55% semantic similarity + 20% keyword overlap + 25% attribute matching, adjusted by contradiction penalties and category-specific attribute weights. After scoring, Platt scaling converts raw scores to genuine probability estimates, so a displayed 85% represents an actual 85% confidence that the items match.

### Stage 7 — Logging & Response

The search impression — including the query, all ranked results, features, model version, and session — is logged to MongoDB for future training. Results above 50% confidence are returned to the frontend, where users see match cards with confidence badges and "Yes, it's mine" / "No" feedback buttons.

---

## 22-Feature Scoring System

Each lost-found candidate pair is evaluated across 22 engineered features. These features capture different aspects of similarity — from deep semantic understanding to surface-level keyword matches to temporal signals.

### Semantic & Retrieval Features

| Feature | What It Measures |
|---------|-----------------|
| `f_semantic_sim` | Cosine similarity between 768-dimensional sentence embeddings from the fine-tuned transformer model. Captures deep meaning even when words differ completely. |
| `f_bm25_score_norm` | Normalized BM25 keyword overlap score. A classical information retrieval signal based on term frequency and inverse document frequency. |
| `f_cross_encoder_score` | A cross-encoder model reads both descriptions jointly as a single input. Unlike bi-encoders that encode texts separately, this captures fine-grained interactions between the two descriptions. Uses `cross-encoder/ms-marco-MiniLM-L-6-v2`. |
| `f_synonym_keyword_boost` | Keyword overlap after expanding both keyword sets with a 50+ entry domain-specific synonym dictionary (e.g., "phone" ↔ "mobile" ↔ "cellphone", "spectacles" ↔ "glasses"). |

### Attribute Matching Features

| Feature | What It Measures |
|---------|-----------------|
| `f_attr_color_match` | Fuzzy match between extracted color attributes using Levenshtein distance. |
| `f_attr_brand_match` | Brand name similarity (e.g., "Samsung" vs "samsung galaxy" → high match). |
| `f_attr_model_match` | Model number/name comparison for precision matching. |
| `f_attr_material_match` | Material attribute similarity (leather, fabric, metal, etc.). |
| `f_identifier_match_ratio` | Proportion of unique identifiers (serial numbers, student IDs) that match between lost and found descriptions. |
| `f_identifier_in_found_text` | Binary: whether an extracted identifier appears anywhere in the found item's raw description text. |
| `f_contradiction_score` | Penalty signal when attributes explicitly contradict (e.g., lost says "black" but found says "red"). Reduces score to prevent false matches. |
| `f_category_weight_score` | Category-aware attribute importance score. The system maintains 27 category-specific weight profiles — for electronics, brand and model matter most; for wallets, color and material dominate; for documents, identifiers are critical. |

### Temporal & Context Features

| Feature | What It Measures |
|---------|-----------------|
| `f_time_decay` | Exponential freshness score with a 72-hour half-life. Recently found items score higher because they are statistically more likely to match a recent loss report. |
| `f_initial_rank` | The item's position in the initial retrieval stage (lower = retrieved earlier = more likely relevant). |
| `f_candidate_pool_size` | Total number of candidates in the current search. Provides normalization context for the ranking model. |

### Statistical & Numeric Features

| Feature | What It Measures |
|---------|-----------------|
| `f_query_n_tokens` | Token count in the lost item query. Longer descriptions provide more matching signals. |
| `f_found_n_tokens` | Token count in the found item description. |
| `f_query_missing_fields` | Number of expected attribute fields missing from the query. Indicates description completeness. |
| `f_len_ratio` | Ratio of query length to found description length. Very large ratios suggest a mismatch in description granularity. |
| `f_numeric_match` | Overlap of extracted numeric values (prices, quantities, measurements) between lost and found. |
| `f_money_amount_match` | Proximity of monetary values. Score of 1.0 for exact match, decaying toward 0 as amounts diverge. |
| `f_n_must_match_tokens` | Count of must-match tokens in the query (typically identifiers and unique marks that must appear in any valid match). |

---

## Accuracy Enhancement Techniques

### Cross-Encoder Re-Ranking

Standard search systems encode the query and each candidate separately into vectors, then compare those vectors. This "bi-encoder" approach is fast but can miss subtle relationships. The cross-encoder takes a different approach — it reads both the lost and found descriptions together as a single input to a transformer model. This allows the model to attend across both texts simultaneously, picking up on nuanced semantic connections that separate encodings miss. For example, it can understand that "dark blue hiking bag with North Face logo" and "navy blue North Face backpack" describe the same item, even though the wording is substantially different. The cross-encoder contributes 10% of the final score.

### Category-Specific Attribute Weighting

Not all attributes matter equally for all types of items. A laptop is best identified by its brand and model number, while a wallet is best identified by its color and material. The system maintains 27 category-specific attribute weight profiles that automatically adjust scoring priorities based on the item type:

- **Electronics** (laptop, phone, tablet): brand 35%, model 35%, color 15%, material 15%
- **Wallet / Purse**: color 35%, material 35%, brand 15%, model 15%
- **Documents** (ID card, passport): identifier 50%, brand 20%, color 15%, material 15%
- **Jewelry** (ring, necklace): material 40%, color 35%, brand 15%, model 10%

### Synonym-Aware Keyword Matching

A built-in dictionary of 50+ domain-specific synonym groups ensures that different words for the same concept still produce high keyword overlap. Coverage includes electronics ("phone" ↔ "mobile" ↔ "cellphone"), accessories ("spectacles" ↔ "glasses" ↔ "eyewear"), clothing ("jacket" ↔ "coat" ↔ "blazer"), colors ("grey" ↔ "gray" ↔ "silver"), containers ("bag" ↔ "backpack" ↔ "rucksack"), and more.

### Time-Decay (Freshness Boost)

An exponential decay function with a 72-hour half-life gives recently found items a natural advantage. A phone found 2 hours ago is statistically far more likely to match a loss reported today than one found 3 weeks ago. The decay is gentle — it nudges close scores rather than eliminating old items.

### Query Expansion via Gemini

Users describe lost items from their perspective ("my favorite coffee mug"), while finders describe what they see ("white ceramic cup with a chip on the rim"). Gemini generates alternative phrasings, extra keywords, and attribute variants to bridge this vocabulary gap, broadening the retrieval pool to include candidates that would otherwise be missed.

### Confidence Calibration (Platt Scaling)

Raw model scores are not true probabilities. Platt scaling applies a logistic regression calibration layer that maps raw scores to genuine match probabilities. After calibration, a displayed 85% means the system is statistically 85% confident the items match. This makes the >50% display threshold meaningful and gives users trustworthy confidence percentages.

### Hard Negative Mining

The training pipeline mines the hardest-to-classify examples from real system logs — items the model ranked highly but were actually wrong. Three strategies extract verification failures, high-rank user rejects, and cross-category confusions. These hard negatives force the model to learn subtle distinctions (e.g., "black Samsung Galaxy S23" vs "black Samsung Galaxy S24") rather than trivially easy ones.

---

## Four-Level Continuous Learning System

The system implements four distinct levels of learning that progressively improve accuracy as more users interact with it. Each level targets a different component of the matching pipeline.

### Level 1 — Sentence-Transformer Fine-Tuning (Base Embeddings)

**What it trains**: The `all-mpnet-base-v2` sentence-transformer that converts descriptions into 768-dimensional vectors.

**Training data**: 105 manually curated (lost, found) text pairs covering 50+ item categories — from common items like phones and wallets to specialized items like violins, drones, archery guards, and laboratory equipment.

**How it trains**: Uses MultipleNegativesRankingLoss to pull matching pair embeddings closer together in vector space while pushing non-matching pairs apart. Trains for 20 epochs with a learning rate of 2e-5, batch size of 2 (small because descriptions can be very long), and data augmentation through pair reversal.

**Impact**: After training, the embedding model understands domain-specific semantics — it knows that "lost my specs" and "found eyeglasses" should produce similar vectors, even though general-purpose embedding models would not.

```
python scripts/train_english_only.py
```

### Level 1b — Embedding Fine-Tuning from User Feedback (Adaptive Learning)

**What it trains**: The same sentence-transformer, incrementally refined using real user-confirmed matches.

**How feedback pairs are collected**: Every time a user searches for a lost item, picks a result from the ranked list, and confirms "Yes, this is mine", the system automatically extracts and stores the (lost_description, found_description) text pair to MongoDB. This happens silently in the background — no manual labeling required.

**How it trains**: When enough pairs are collected (default: 50), the model is fine-tuned using a mix of feedback pairs (weighted 2×) and the original 105 curated pairs (weighted 1×). The curated pairs prevent catastrophic forgetting — the model refines its understanding without losing what it already knows. A lower learning rate (1e-5, half of Level 1) ensures gentle refinement rather than aggressive overwriting.

**Why this matters**: Developer-curated training pairs reflect how developers *think* users describe items. Real feedback pairs capture how users *actually* describe items — their exact words, abbreviations, regional slang, and phrasing patterns. Over time, the model becomes uniquely adapted to the specific user base.

```bash
# Via API (hot-reloads model into running server)
curl -X POST http://localhost:8001/retrain-embeddings

# Via CLI
python scripts/train_from_feedback.py
```

### Level 2 — LightGBM Re-Ranker (Learning-to-Rank from Feedback)

**What it trains**: A LightGBM model with LambdaRank objective that learns optimal weights for all 22 features.

**How training data is collected**: Three feedback signals feed the training pipeline, each with a different confidence weight:

| Signal | Source | Weight | Description |
|--------|--------|--------|-------------|
| Handover Verification | External system confirms item ownership | 3.0 | Strongest signal — actual verification |
| User Feedback | "Yes, it's mine" / "No" buttons | 1.0 | Direct user confirmation |
| Implicit Selection | User clicks on a result | 0.5 | Weakest signal — click ≠ match |

Hard negatives (top-ranked but wrong items) are automatically sampled from the same search impression, with priority given to items ranked above the true positive (the hardest negatives). The training pipeline also incorporates mined hard negatives from historical logs.

**How it trains**: Joins `match_impressions`, `match_selections`, and `handover_verifications` from MongoDB to build labeled (query, candidate, label, weight, 22-feature) tuples. LightGBM trains with LambdaRank objective to learn the optimal ranking function. A confidence calibrator (Platt scaling) is automatically trained afterward. Both the model and calibrator are hot-swapped into the running server.

**A/B Testing**: The `AB_ROLLOUT_PCT` parameter controls what percentage of traffic uses the ML re-ranker vs. the rule-based scorer, allowing gradual rollout with safety.

```bash
# Via API
curl -X POST http://localhost:8001/retrain

# Via CLI
python scripts/train_reranker.py
```

### Level 3 — Reinforcement Learning Agent (Real-Time Adaptation)

**What it trains**: A Q-learning agent with ε-greedy exploration that adjusts ranking weight parameters in real-time.

**How it works**: Every single piece of user feedback triggers an immediate update. The agent models each search context as a state (category match status × semantic score range), chooses actions (increase / keep / decrease ranking emphasis), and receives rewards (+1.0 for correct matches, -1.0 for wrong ones). The Q-table is updated via the Bellman equation and persisted to disk after every interaction.

**Why this level exists**: Levels 1–2 require accumulating data and triggering retraining. Level 3 responds instantly — the very next search after a user gives feedback benefits from the updated weights. This creates a flywheel effect where every interaction makes the system slightly better.

### Learning Architecture Summary

```
                     Manual Effort              Automatic & Continuous
                     ──────────────             ──────────────────────
Level 1:   ██████████████████████████           (curated text pairs)
           Sentence-Transformer
           ↓ domain-specific embeddings

Level 1b:  ██                                   ██████████████████████
           (trigger via API)                     (pairs auto-collected
           ↓ user-adapted embeddings              on every confirmed match)

Level 2:   ██                                   ██████████████████
           (set AB_ROLLOUT_PCT)                  (feedback → retrain)
           ↓ learned ranking function

Level 3:                                        ██████████████████████
                                                (instant, every feedback)
           ↓ real-time weight tuning
```

Each level targets a different timescale: Level 1 is a one-time setup, Level 1b improves every few weeks as feedback accumulates, Level 2 retrains periodically from verified data, and Level 3 adapts after every single user interaction.

---

## Feedback-Driven Data Flow

Every user interaction feeds back into the system's learning pipeline, creating a closed loop where the system continuously improves.

```
User searches for lost item
         │
         ▼
System shows ranked results (logged as match_impression)
         │
         ▼
User clicks a result (logged as match_selection)
         │
         ▼
User confirms "Yes, this is mine" or "No"
         │
         ├──► embedding_training_pairs     (text pairs for Level 1b)
         ├──► handover_verifications       (labels for Level 2)
         ├──► RL Agent Q-table update      (instant reward for Level 3)
         │
         ▼
┌─────────────────────┐    ┌──────────────────────────┐
│ build_training_      │    │ fine_tune_from_           │
│ dataset()            │    │ feedback()                │
│                      │    │                           │
│ Joins impressions +  │    │ Merges feedback pairs     │
│ selections +         │    │ with curated dataset      │
│ verifications →      │    │ → fine-tunes sentence-    │
│ labeled feature      │    │ transformer embeddings    │
│ vectors              │    │                           │
└──────────┬───────────┘    └────────────┬──────────────┘
           │                             │
           ▼                             ▼
┌──────────────────┐         ┌────────────────────────┐
│ LightGBM Model   │         │ Updated Embedding      │
│ + Calibrator     │         │ Model                  │
│ (hot-swapped)    │         │ (hot-swapped)          │
└──────────────────┘         └────────────────────────┘
```

The `/feedback-stats` endpoint provides real-time visibility into data collection progress:

```json
{
  "impressions": 142,
  "selections": 38,
  "verifications": { "total": 25, "positive": 18, "negative": 7 },
  "training_ready": false,
  "min_required": 50,
  "embedding_fine_tuning": {
    "collected_pairs": 37,
    "ready": false,
    "message": "Need 13 more confirmed matches for embedding fine-tuning."
  }
}
```

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Health check — reports system status, Gemini availability, A/B rollout percentage |
| `POST` | `/index` | Add a found item — auto-corrects grammar, extracts attributes, generates embedding, adds to FAISS index |
| `POST` | `/correct-grammar` | Live grammar correction — called by frontend as user types (debounced) |
| `POST` | `/search` | Full 7-stage matching pipeline — returns ranked results with confidence scores |
| `POST` | `/log-selection` | Log which result the user clicked (implicit feedback signal) |
| `POST` | `/feedback` | User yes/no feedback — feeds Level 1b, Level 2, and Level 3 learning |
| `POST` | `/log-verification` | External handover system reports claim verification (strongest training signal) |
| `POST` | `/fraud-check` | Behavioral fraud scoring on user metadata |
| `POST` | `/retrain` | Trigger LightGBM re-ranker retraining (Level 2) |
| `POST` | `/retrain-embeddings` | Trigger sentence-transformer fine-tuning from feedback (Level 1b) |
| `GET` | `/feedback-stats` | Dashboard — impressions, selections, verifications, embedding training readiness |

---

## Core Modules

| Module | File | What It Does |
|--------|------|-------------|
| **LostTextNormalizer** | `normalizer.py` | Gemini-powered grammar correction, structured attribute extraction with caching, query expansion that generates alternative phrasings and keywords |
| **SemanticEngine** | `semantic.py` | Manages the fine-tuned `all-mpnet-base-v2` sentence-transformer and FAISS vector index. Handles encoding, search, indexing, and model hot-reloading |
| **CandidateRetriever** | `retriever.py` | Orchestrates three parallel retrieval paths (FAISS vector + BM25 keyword + exact identifier) and merges them into a deduplicated candidate pool |
| **ReRanker / FeatureComputer** | `scorer.py` | Computes all 22 features per pair, applies rule-based v2 scoring or LightGBM re-ranking, runs cross-encoder and synonym expansion, applies Platt calibration, manages A/B routing |
| **EmbeddingTrainer** | `embedding_trainer.py` | Fine-tunes sentence-transformer from user feedback pairs merged with curated data, with 2× feedback weight and lower learning rate to prevent catastrophic forgetting |
| **TrainingPipeline** | `trainer.py` | Builds labeled datasets from MongoDB feedback logs, trains LightGBM LambdaRank model, trains confidence calibrator, supports hard negatives |
| **RLRankingAgent** | `rl_agent.py` | Q-learning agent with ε-greedy exploration — updates ranking weights instantly from every feedback event |
| **ImpressionLogger** | `impression_logger.py` | Async logging of search impressions, user selections, and model versions to MongoDB for training pipeline consumption |
| **FraudDetectionEngine** | `fraud.py` | Behavioral fraud scoring on user metadata to detect suspicious claiming patterns |
| **DataModelingEngine** | `modeling.py` | Knowledge-graph-based context suggestions per item category |
| **Database** | `database.py` | Motor async MongoDB connection with DNS resolution fixes and SSL certificate management |

---

## Data Storage Design

### MongoDB Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `found_items` | All reported found items with descriptions, embeddings, and extracted attributes | `item_id`, `description`, `category`, `vector[]`, `extracted_attributes`, `keywords` |
| `text_normalizations` | Gemini extraction cache (1-hour TTL) to avoid redundant API calls | `cache_key` (SHA-256), `result`, `created_at` |
| `match_impressions` | Full log of every search — what was queried, what was shown, in what order | `query_id`, `impression_id`, `shown_results[]`, `model_version`, `session_id` |
| `match_selections` | Records of which result the user clicked from the ranked list | `impression_id`, `query_id`, `selected_found_id`, `selected_rank` |
| `handover_verifications` | User feedback and external verification records (strongest training signal) | `lost_id`, `found_id`, `verified`, `verification_method`, `source` |
| `embedding_training_pairs` | Confirmed (lost, found) text pairs automatically collected for embedding fine-tuning | `pair_id`, `anchor`, `positive`, `category`, `source`, `created_at` |

### On-Disk Models & Indices

| Path | Contents |
|------|----------|
| `data/models/fine_tuned_bert/` | Fine-tuned sentence-transformer model (768-dim) |
| `data/models/reranker/` | Versioned LightGBM models + confidence calibrators |
| `data/models/rl_q_table.pkl` | Persisted Q-learning agent state |
| `data/indices/faiss.index` | FAISS vector index for fast nearest-neighbor search |
| `data/raw/text_pairs_english.json` | 105 curated training pairs for base embedding fine-tuning |

---

*Last updated: March 2026*

