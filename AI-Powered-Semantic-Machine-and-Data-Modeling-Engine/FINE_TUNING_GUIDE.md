# Fine-Tuning Implementation Guide

## Current System Architecture

The AI Python backend (`AI-Powered-Semantic-Machine-and-Data-Modeling-Engine`) has **5 distinct training/learning systems**. The Node.js backend (`Backend`) handles user interactions and verification. Both share the same MongoDB database (`lost_and_found`).

```
┌─────────────────────────┐         ┌───────────────────────────────────┐
│   Node.js Backend       │         │   Python AI Backend               │
│   (port 5001)           │         │   (port 8001)                     │
│                         │         │                                   │
│  Verification Flow      │  same   │  5 Training Systems:              │
│  Item CRUD              │◄═══DB══►│  1. Embedding Fine-Tuning         │
│  User Auth              │         │  2. LightGBM Re-Ranker            │
│                         │         │  3. RL Q-Learning Agent           │
│  NEW: Auto-triggers on  │         │  4. Hard Negative Mining          │
│  verification (all 3    │         │  5. Platt Scaling Calibrator      │
│  phases implemented)    │         │                                   │
└─────────────────────────┘         └───────────────────────────────────┘
         │                                        │
         └──────── MongoDB (lost_and_found) ──────┘
```

---

## What's Already Implemented

### Embedding Fine-Tuning Data Collection (DONE)

**Status:** Fully implemented and auto-triggered.

When a verification passes in the Node.js backend, a Mongoose `post('save')` hook on the Verification model automatically:

1. Reads `ownerLostDescription` from the Verification record
2. Reads `description` from the FoundItem via `foundItemId`
3. Saves the pair to `feedback_finetuning` collection (tracking table)
4. Writes to `embedding_training_pairs` collection (Python pipeline reads this)

**Collections involved:**
- `feedback_finetuning` — Node.js tracking table (new)
- `embedding_training_pairs` — Python's data source for `/retrain-embeddings` (existing, no changes needed)

**Python changes needed:** None. The Python backend already reads from `embedding_training_pairs` and the documents use the exact format it expects:
```json
{
  "pair_id": "uuid",
  "lost_id": "string",
  "found_id": "string",
  "anchor": "lost description text (max 2000 chars)",
  "positive": "found description text (max 2000 chars)",
  "category": "string",
  "source": "verification_pass",
  "created_at": "datetime"
}
```

**How to train:** Call `POST http://localhost:8001/retrain-embeddings` (needs minimum 50 pairs, or use `force: true`).

---

## All Fine-Tuning Data Pipelines — Implementation Status

### 1. LightGBM Re-Ranker Training (DONE — Data flows implemented)

**What it does:** Trains a learning-to-rank model that re-orders search results beyond simple semantic similarity. Uses 22 features per candidate item.

**Python endpoint:** `POST /retrain`

**Collections it reads from:**

| Collection | Purpose | Populated? |
|---|---|---|
| `match_impressions` | Search results shown to users | YES (auto-logged on every `/search` call) |
| `match_selections` | Which result the user clicked/selected | YES — via `POST /api/finetuning/log-selection` |
| `handover_verifications` | Whether selected item was verified as correct | YES — auto-triggered on verification save |

#### a) Selection Logging — `POST /api/finetuning/log-selection` (DONE)

The Node.js backend has a new route that forwards selection data to Python:

**Frontend calls:** `POST /api/finetuning/log-selection`

**Payload:**
```json
{
  "impressionId": "the impression_id returned by the /search call",
  "queryId": "the query_id returned by the /search call",
  "lostItemRaw": "the original search text the user typed",
  "selectedFoundId": "the found item ID the user selected",
  "selectedRank": 3
}
```

**Prerequisite:** The frontend needs to capture `impression_id` and `query_id` from the search response and pass them when the user selects a result. The `PythonSearchResponse` already returns these fields.

#### b) Verification Logging (DONE — Auto-triggered)

The Verification `post('save')` hook automatically calls `logVerificationToPython()` for both `passed` and `failed` verifications. This writes to `handover_verifications` in the Python backend.

**Payload sent automatically:**
```json
{
  "lost_id": "<ownerLostRequestId or verificationId>",
  "found_id": "<foundItemId>",
  "verified": true,
  "verification_method": "video_qa"
}
```

**How to train:** Call `POST http://localhost:8001/retrain` after accumulating enough data (50+ verified selections).

---

### 2. RL Q-Learning Agent (DONE — Data flow implemented)

**What it does:** Learns weight adjustments for scoring based on user feedback.

**Python endpoint:** Updated automatically inside `POST /feedback`

**Implementation:** The Verification `post('save')` hook automatically calls `sendFeedbackToPython()` for both `passed` and `failed` verifications. This:
- Updates the RL Q-table with +1.0 (passed) or -1.0 (failed) reward
- Also triggers `_collect_embedding_pair()` inside Python for additional embedding data
- Writes to `handover_verifications` with `source: "frontend_feedback"`

**Payload sent automatically:**
```json
{
  "query_id": "<ownerLostRequestId or verificationId>",
  "found_id": "<foundItemId>",
  "is_correct": true
}
```

**Python-side improvements (optional, not implemented):**
1. Replace hardcoded state values in `/feedback` handler with actual impression features
2. Call `choose_action()` during inference in `scorer.py` to apply learned weights

---

### 3. Hard Negative Mining

**What it does:** Mines difficult negative examples to improve model training:
- **Verification failures:** Items user claimed but failed verification (very hard negatives)
- **High-rank rejects:** Top-ranked items user didn't select (hard negatives)
- **Cross-category confusions:** Items from wrong categories that scored high (medium negatives)

**Python script:** `python scripts/mine_hard_negatives.py`

**Collections it reads from:**
- `handover_verifications` (for verification failures)
- `match_impressions` + `match_selections` (for rejection patterns)
- `founditems` (for item descriptions)

**Data dependencies now met:** `handover_verifications` is auto-populated by the Verification hook. `match_selections` is populated when the frontend calls `/api/finetuning/log-selection`.

**Output:** Writes to `data/raw/hard_negatives.json`

**Current gap:** The mined hard negatives file exists but `load_mined_hard_negatives()` is defined in the trainer yet never called during `build_training_dataset()`. This is a Python-side fix.

**Python changes needed (optional):**
1. Call `load_mined_hard_negatives()` inside `build_training_dataset()` to merge mined negatives into training data
2. Node.js data pipelines are complete — no further Node.js changes needed

---

### 4. Platt Scaling Calibrator

**What it does:** Maps raw LightGBM scores to calibrated probability values (0.0–1.0).

**Trigger:** Runs automatically at the end of LightGBM re-ranker training.

**What's missing:** Nothing specific — this trains automatically when `/retrain` is called. Once LightGBM training works (after selection + verification data flows), calibration follows.

---

## Implementation Priority & Roadmap

### Phase 1 — DONE
- [x] Embedding fine-tuning data collection (auto-triggered on verification pass)
- [x] `feedback_finetuning` tracking table
- [x] Write to `embedding_training_pairs` for Python pipeline
- [x] Backfill endpoint for historical data
- [x] Stats endpoint

### Phase 2 — DONE
- [x] `logVerificationToPython()` — auto-called from Verification post-save hook
- [x] `sendFeedbackToPython()` — auto-called from Verification post-save hook
- [x] Both fire for `passed` AND `failed` verifications
- [x] Populates `handover_verifications` + updates RL agent + collects additional embedding pairs

### Phase 3 — DONE
- [x] `logSelectionToPython()` — new function in `finetuningService.ts`
- [x] `POST /api/finetuning/log-selection` — new route for frontend to call
- [x] Forwards data to Python's `POST /log-selection` → populates `match_selections`

> **Note:** Phase 3 requires the frontend to pass `impression_id` and `query_id` from the search response when logging a selection. These fields are returned by the Python `/search` endpoint but need to be carried through the frontend flow.

### Phase 4 — Python-Side Improvements (Optional)
These improve how training data is used but aren't required for data collection:

| Task | Change |
|---|---|
| Use real features in RL state | Fix `/feedback` handler to read actual impression features |
| Apply RL actions in inference | Call `choose_action()` in `scorer.py` during ranking |
| Incorporate mined hard negatives | Call `load_mined_hard_negatives()` in `build_training_dataset()` |
| Enable LightGBM in production | Set `AB_ROLLOUT_PCT` > 0 in config.py |

---

## MongoDB Collections Summary

| Collection | Written By | Read By | Status |
|---|---|---|---|
| `feedback_finetuning` | Node.js (auto on verification pass) | Node.js (stats/backfill) | NEW — DONE |
| `embedding_training_pairs` | Node.js (auto on verification pass) + Python (`/feedback`) | Python (`/retrain-embeddings`) | DONE |
| `match_impressions` | Python (auto on every `/search`) | Python (LightGBM training, mining) | Already working |
| `match_selections` | Node.js → Python `/log-selection` (via `POST /api/finetuning/log-selection`) | Python (LightGBM training, mining) | DONE |
| `handover_verifications` | Node.js → Python `/log-verification` + `/feedback` (auto on verification save) | Python (LightGBM training, mining) | DONE |

---

## API Reference

### Node.js Backend Endpoints (NEW)

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/finetuning/backfill` | Scan all passed verifications, collect missing pairs | Admin |
| `GET` | `/api/finetuning/stats` | Get pair collection statistics | Auth required |
| `POST` | `/api/finetuning/log-selection` | Log which search result user selected (→ Python) | Auth required |

### Auto-Triggered (No API Call Needed)

| Trigger | What Happens | Python Endpoints Called |
|---|---|---|
| Verification saved with `status: 'passed'` | Collects embedding pair + logs verification + sends feedback | `/log-verification`, `/feedback` |
| Verification saved with `status: 'failed'` | Logs verification + sends negative feedback | `/log-verification`, `/feedback` |

### Python Backend Endpoints (EXISTING — No Changes)

| Method | Endpoint | Purpose | When to Call |
|---|---|---|---|
| `POST` | `/retrain-embeddings` | Train sentence-transformer from collected pairs | After 50+ pairs collected |
| `POST` | `/retrain` | Train LightGBM re-ranker | After 50+ verified selections |
| `POST` | `/log-verification` | Log verification pass/fail | Phase 2: on verification complete |
| `POST` | `/feedback` | Log user feedback + update RL agent | Phase 2: on verification complete |
| `POST` | `/log-selection` | Log which result user selected | Phase 3: on item claim |
