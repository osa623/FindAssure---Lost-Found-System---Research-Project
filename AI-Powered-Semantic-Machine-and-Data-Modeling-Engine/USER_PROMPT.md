You are a Senior Software Engineer + Applied ML Engineer.

Context:
I’m building a Lost & Found system. My responsibility is ONLY the text matching/ranking component.
I do NOT own:
- image-to-text extraction (handled by another component)
- location matching/scoring (handled by another component)

What I DO have:
- Lost item: user enters a free-text description (often incomplete and not grammatically correct)
- Found items: already have a text description stored in the database (generated elsewhere)
- User selects a category first, and my matching must search only within that category
- I have access to Gemini API
- I have access to the database (I can read and write extra fields like extracted attributes, logs, scores)

Current behavior:
- I do semantic matching on text (embeddings cosine similarity) + some basic structured filtering by category
- I return a ranked list of found items to the user

Problems:
- User descriptions are messy/incomplete
- Found descriptions may be inconsistent in wording
- I want to enhance matching quality without touching image extraction or location
- Users do NOT give explicit feedback like “this is mine / not mine / not sure”
  They only select ONE item from the ranked list
- Secure handover verification exists in the system (OTP/QR/ID), and the verification result is saved in DB
  (I can use verification outcomes as ground-truth labels)

Goal:
Design and generate a production-ready improvement plan + pseudocode + data schema so I can implement:
1) Text normalization + attribute extraction using Gemini (for LOST description, and optionally for FOUND description text from DB)
2) Hybrid retrieval and scoring (semantic + keyword + attribute match + identifier rules)
3) Feedback data logging using only:
   - impression logs (what results were shown)
   - selection logs (which item was chosen)
   - verification logs (handover verified true/false)
4) A learning system to improve ranking:
   - Start with rule-based + hybrid scoring improvements
   - Then train a re-ranker / pair classifier from verified outcomes (LightGBM/XGBoost recommended)
   - Deploy the re-ranker to re-rank the top K results from semantic retrieval

Hard Constraints:
- DO NOT propose changing the image extraction component
- DO NOT propose location-based scoring (assume location is handled elsewhere)
- Keep UI unchanged (user only selects from list)
- Assume category is already selected and used to filter candidates
- The output must be implementable in a typical backend stack (Node.js or Python) and a relational DB (PostgreSQL) or MongoDB
- Prefer scalable approaches (cache extraction results, avoid calling Gemini on every request for every candidate)

What I need you to output (structured, detailed):

A) Architecture (textual diagram + data flow)
- Show modules: LostTextNormalizer (Gemini), FoundTextAttributeCache (optional), CandidateRetriever, ReRanker, Logging, Training Pipeline
- Explain request-time vs offline/batch jobs

B) Gemini Prompt Design (VERY IMPORTANT)
1) Provide a best-practice Gemini prompt to convert the LOST user description into JSON:
   - clean_description
   - keywords
   - attributes: brand, model, color, material, size, identifiers (serial/IMEI/ID/name), unique_marks
   - must_match_tokens (identifiers that must match if present)
   - missing_fields
   - language_detected
   The prompt must be robust for incomplete grammar and mixed language.
2) Provide an optional Gemini prompt to extract the same JSON schema from FOUND item descriptions (text only), to be run offline and stored.

C) Matching / Ranking Algorithm
1) Candidate generation within the selected category:
   - Embedding search to get top N (e.g., 200)
   - Keyword/BM25 search for IDs, model numbers, rare tokens (top M)
   - Merge + deduplicate candidates
2) Scoring:
   - Define a final scoring formula using:
     - semantic similarity
     - keyword overlap score
     - attribute match score (brand/color/model/material)
     - identifier match (must-match rule)
     - penalties for contradictory attributes
   Provide exact example formulas and thresholds.
3) “Must-match” logic:
   - If lost contains serial/ID/IMEI, require candidate to contain it (or else heavy penalty)
   - If identifier matches, force to top ranks

D) Database Schema
Provide tables/collections for:
1) Items table (lost/found)
   - id, type, category, description_text, created_at
   - optional: normalized_text, extracted_attributes_json, keywords_array, embedding_vector_id
2) MatchImpressions table (must have)
   - impression_id, lost_id, shown_found_ids (ordered), shown_scores, timestamp, session_id/user_id(optional)
3) MatchSelection table
   - selection_id, impression_id, lost_id, selected_found_id, timestamp
4) HandoverVerification table (existing but describe required fields)
   - lost_id, found_id, verified_boolean, verified_at
Explain why impressions are critical for negative sampling.

E) Feedback-to-Training Dataset Builder
- How to produce labeled pairs (lost, found, label, weight)
- Label strategy:
  - verified selected pair => strong positive
  - other shown candidates => negatives (strong if verified positive exists)
  - if verification failed or missing => ignore or weak labels
- Hard negative sampling (use top-ranked non-selected candidates)
- Recommended ratios (1 pos : 5-10 neg)

F) Model Training (re-ranker)
- Recommend LightGBM/XGBoost first
- Feature list + feature computation
- Train/validation split that avoids leakage (e.g., split by lost_id and time)
- Evaluation metrics: Precision@1, Precision@5, MRR, verified match rate
- Model versioning and retraining schedule

G) Deployment
- How to deploy re-ranker as a service or library
- Runtime flow:
  1) normalize lost text (Gemini)
  2) retrieve candidates (vector + keyword)
  3) compute features
  4) score with trained model to re-rank
  5) log impression
- Safe rollout plan (shadow scoring, A/B testing)

H) Pseudocode (must include)
- normalize_lost_description() using Gemini prompt
- get_candidates() merging semantic + keyword retrieval
- compute_features(lost, found)
- score_and_rank_candidates()
- log_impression(), log_selection()
- build_training_dataset()
- train_reranker_model()
- inference_rerank()

Important:
- Keep the response production-grade and very practical.
- Do NOT use vague statements; provide clear steps, schema fields, and algorithm details.
- Assume I will copy your output directly into my design doc and start implementing.

Now generate the complete design and pseudocode per the above requirements.