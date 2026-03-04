
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
6. [Fine-Tuning Procedure](#fine-tuning-procedure)
7. [Feedback Loop & Training Data](#feedback-loop--training-data)
8. [MongoDB Collections](#mongodb-collections)
9. [Setup & Running](#setup--running)
10. [Configuration](#configuration)
11. [Scripts (Offline Jobs)](#scripts-offline-jobs)

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
│  │(Gemini)  │ │(FAISS+BM25│ │(Rule/ML) │ │ (MongoDB logging)     ││
│  └──────────┘ └───────────┘ └──────────┘ └────────────────────────┘│
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────────────┐│
│  │ Semantic │ │ RL Agent  │ │ Trainer  │ │ Fraud Detection        ││
│  │ Engine   │ │(Q-Learning│ │(LightGBM)│ │                        ││
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
┌─ Stage 5: Feature Scoring (18 features) ──────────┐
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
│   f_money_amount_match                             │
└────────────────────┬──────────────────────────────┘
                     ▼
┌─ Stage 6: Ranking ────────────────────────────────┐
│ IF LightGBM model exists → ML re-ranker            │
│ ELSE → Rule-based weighted formula:                 │
│   score = penalty × (0.55×semantic + 0.20×keyword   │
│           + 0.25×attribute)                         │
│ identifier_exact match → forced to top (0.99+)     │
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
| **LostTextNormalizer** | `app/core/normalizer.py` | Gemini-powered grammar correction, lost-item attribute extraction (cached), found-item attribute extraction (batch). Uses strict grammar prompt that only fixes errors. |
| **SemanticEngine** | `app/core/semantic.py` | Sentence-Transformers (`all-mpnet-base-v2`), FAISS IndexFlatIP, vectorize/search/add_item, load from MongoDB or disk cache |
| **CandidateRetriever** | `app/core/retriever.py` | Merges FAISS vector search + MongoDB $text BM25 search + exact identifier lookup into deduplicated candidate pool |
| **ReRanker / FeatureComputer** | `app/core/scorer.py` | Computes 18 pair features, applies rule-based scoring or LightGBM re-ranker. Handles `must_match_tokens` logic and A/B routing |
| **ImpressionLogger** | `app/core/impression_logger.py` | Async logging of search impressions and user selections to MongoDB |
| **RLRankingAgent** | `app/core/rl_agent.py` | Q-learning agent (ε-greedy) that adjusts ranking weights from user feedback rewards |
| **TrainingPipeline** | `app/core/trainer.py` | Builds labeled (lost, found) pair datasets from logs, trains LightGBM lambdarank model |
| **DataModelingEngine** | `app/core/modeling.py` | Knowledge-graph context suggestions per category |
| **FraudDetectionEngine** | `app/core/fraud.py` | Behavioral fraud scoring on user metadata |
| **Database** | `app/core/database.py` | Motor async MongoDB connection with DNS fix (Google/Cloudflare public DNS for SRV resolution), SSL CA bundle via certifi |

---

## Scoring & Feature Engineering

### 18 Feature Columns (per lost-found pair)

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

### Rule-Based Scoring Formula (default, before ML model is trained)

```
IF identifier_exact → score = 0.99 + tie_breaker
ELSE:
  score = contradiction_penalty × (
      0.55 × semantic_sim
    + 0.20 × keyword_score
    + 0.25 × attribute_score
  )
```

Results are converted to a 0–100% scale. **Only matches >50% are shown to users.**

---

## Fine-Tuning Procedure

The system uses **three levels of fine-tuning**, each building on user interaction data:

### Level 1 — Sentence-Transformer Embedding Model

**Model**: `all-mpnet-base-v2` (768 dimensions)

**Training data**: `data/raw/text_pairs_english.json` — manually curated pairs of lost/found descriptions with similarity labels.

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
5. LightGBM trains with lambdarank objective
6. Model saved to `data/models/reranker/` with version timestamp
7. `current_model_ptr.txt` updated to point to new model
8. Model hot-swapped into the running server (no restart needed)

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

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| API Framework | FastAPI + uvicorn |
| Database | MongoDB Atlas (motor async driver) |
| Embeddings | sentence-transformers (`all-mpnet-base-v2`, 768-dim) |
| Vector Search | FAISS (IndexFlatIP, cosine similarity) |
| Text Normalization | Google Gemini (`gemini-2.0-flash`) |
| Re-Ranker | LightGBM (lambdarank) / Rule-based fallback |
| RL Agent | Q-learning (NumPy) |
| Keyword Search | rank_bm25 + MongoDB $text index |
| Fuzzy Matching | thefuzz + python-Levenshtein |
| Frontend | React 19 + CRACO + Tailwind CSS v4 |

---

*Last updated: March 2026*

