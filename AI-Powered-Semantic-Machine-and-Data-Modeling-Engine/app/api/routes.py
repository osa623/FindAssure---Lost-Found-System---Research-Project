from fastapi import APIRouter, BackgroundTasks, Depends
from app.schemas.item import ItemCreate
from app.schemas.search import (
    SearchQuery, SearchResponse, MatchResult, SelectionLog,
    VerificationLog, FeedbackRequest, RetrainRequest,
)
from app.core.semantic import SemanticEngine
from app.core.modeling import DataModelingEngine
from app.core.fraud import FraudDetectionEngine
from app.core.scorer import inference_rerank
from app.core.impression_logger import ImpressionLogger
from app.core.normalizer import LostTextNormalizer
from app.core.database import get_database
import logging
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)
router = APIRouter()

# Dependency Injection
def get_semantic():
    return SemanticEngine()

def get_modeling():
    return DataModelingEngine()

def get_fraud():
    return FraudDetectionEngine()

def get_db():
    return get_database()


# ---------------------------------------------------------------------------
# POST /index — Add a found item (unchanged behaviour; adds Gemini batch trigger)
# ---------------------------------------------------------------------------

@router.post("/index", summary="Add Found Item to Database")
async def index_item(item: ItemCreate, engine: SemanticEngine = Depends(get_semantic)):
    """Add a FOUND item to the database for future matching.

    Automatically corrects grammar/spelling in the description via Gemini
    before saving, so all stored descriptions are clean English.
    """
    item_dict = item.dict()

    # --- Grammar correction before saving ---
    normalizer = LostTextNormalizer()
    grammar = await normalizer.correct_grammar(item_dict["description"])
    original_description = item_dict["description"]
    if grammar.get("was_corrected"):
        item_dict["description"] = grammar["corrected_text"]
        logger.info(
            f"Grammar auto-corrected for /index: "
            f"'{original_description[:80]}' → '{grammar['corrected_text'][:80]}'"
        )

    item_id = await engine.add_item(item_dict)
    return {
        "message": "Found item added successfully",
        "item_id": item_id,
        "status": "indexed",
        "grammar_corrected": grammar.get("was_corrected", False),
        "corrected_description": item_dict["description"] if grammar.get("was_corrected") else None,
    }


# ---------------------------------------------------------------------------
# POST /correct-grammar — Live grammar correction for frontend textarea
# ---------------------------------------------------------------------------

@router.post("/correct-grammar", summary="Live Grammar Correction")
async def correct_grammar(payload: dict):
    """Correct only grammar/spelling errors in user text. Used by the
    frontend to auto-fix the textarea as the user types."""
    text = (payload.get("text") or "").strip()
    if not text or len(text) < 5:
        return {"corrected_text": text, "was_corrected": False, "corrections": []}
    normalizer = LostTextNormalizer()
    return await normalizer.correct_grammar(text)


# ---------------------------------------------------------------------------
# POST /search — Main endpoint  (now uses full hybrid pipeline)
# ---------------------------------------------------------------------------

@router.post("/search", response_model=SearchResponse, summary="Search for Lost Item")
async def search_items(
    query: SearchQuery,
    db=Depends(get_db),
    modeling: DataModelingEngine = Depends(get_modeling),
):
    """
    Search for a LOST item using the full AI-powered pipeline:
      1. Gemini text normalization + attribute extraction (cached)
      2. FAISS vector search + MongoDB text keyword search
      3. Feature computation per candidate
      4. Rule-based scoring (or LightGBM when deployed)
      5. Async impression logging

    Response includes query_id and impression_id — pass these to /log-selection
    when the user selects an item.
    """
    session_id = query.session_id or str(uuid.uuid4())

    # --- Grammar correction on the search text before matching ---
    search_text = query.text
    grammar_corrected = False
    try:
        normalizer = LostTextNormalizer()
        grammar = await normalizer.correct_grammar(search_text)
        if grammar.get("was_corrected"):
            search_text = grammar["corrected_text"]
            grammar_corrected = True
            logger.info(
                f"Grammar auto-corrected for /search: "
                f"'{query.text[:80]}' → '{search_text[:80]}'"
            )
    except Exception as gc_err:
        logger.debug(f"Grammar correction skipped: {gc_err}")

    # --- Full pipeline (Gemini normalizer + hybrid retrieval + scoring) ---
    try:
        pipeline_result = await inference_rerank(
            db=db,
            raw_lost_text=search_text,
            category=query.category or "",
            session_id=session_id,
            top_k=query.limit or 10,
        )
    except Exception as e:
        logger.error(f"Pipeline error: {e} — falling back to legacy search")
        pipeline_result = None

    # --- Fallback to legacy SemanticEngine if pipeline fails ---
    if pipeline_result is None or not pipeline_result.get("ranked_results"):
        logger.warning("Pipeline returned empty — using legacy SemanticEngine fallback")
        engine = SemanticEngine()
        raw_results = engine.search(
            search_text,
            limit=query.limit or 10,
            category_filter=query.category if query.category else None,
        )
        context_suggestions = []
        if query.category:
            context_suggestions = modeling.get_context(query.category)

        formatted_matches = []
        for res in raw_results:
            reason_parts = [
                f"Raw Cosine: {res['raw_cosine_similarity']:.4f}",
                f"Vector: {res['vector_score']}%",
                f"Keyword: {res['keyword_score']}%",
            ]
            formatted_matches.append(MatchResult(
                id=res["item"]["id"],
                description=res["item"]["description"],
                category=res["item"]["category"],
                score=res["semantic_score"],
                reason=" | ".join(reason_parts),
            ))

        return SearchResponse(
            matches=formatted_matches,
            total_matches=len(formatted_matches),
            inferred_context=context_suggestions,
            grammar_corrected=grammar_corrected,
            corrected_text=search_text if grammar_corrected else None,
        )

    # --- Format full pipeline results ---
    context_suggestions = []
    if query.category:
        try:
            context_suggestions = modeling.get_context(query.category)
        except Exception:
            pass

    formatted_matches = []
    for r in pipeline_result["ranked_results"]:
        breakdown = r.get("score_breakdown") or {}
        reason_parts = [
            f"Score: {r['score']:.4f}",
            f"Semantic: {breakdown.get('f_semantic_sim', '?')}",
            f"BM25: {breakdown.get('f_bm25_score_norm', '?')}",
            f"Attr: brand={breakdown.get('f_attr_brand_match', '?')}"
               f"/color={breakdown.get('f_attr_color_match', '?')}",
            f"Model: {r.get('model_version', 'rule_based_v1')}",
        ]
        formatted_matches.append(MatchResult(
            id=r["found_id"],
            description=r.get("description", ""),
            category=r.get("category", ""),
            score=r["score"],
            reason=" | ".join(reason_parts),
            score_breakdown=breakdown,
            model_version=r.get("model_version"),
        ))

    return SearchResponse(
        matches=formatted_matches,
        total_matches=len(formatted_matches),
        inferred_context=context_suggestions,
        query_id=pipeline_result.get("query_id"),
        impression_id=pipeline_result.get("impression_id"),
        grammar_corrected=grammar_corrected,
        corrected_text=search_text if grammar_corrected else None,
    )


# ---------------------------------------------------------------------------
# POST /log-selection — Called when user selects a result
# ---------------------------------------------------------------------------

@router.post("/log-selection", summary="Log User Item Selection")
async def log_selection(payload: SelectionLog, db=Depends(get_db)):
    """
    Log which item the user selected from the ranked list.
    Call this endpoint from the frontend when user clicks/selects a result.

    Body fields:
      - impression_id:     from the /search response
      - query_id:          from the /search response
      - lost_item_raw:     original search text
      - selected_found_id: the found_id of the item selected
      - selected_rank:     1-indexed rank position of selected item
    """
    impression_logger = ImpressionLogger()
    success = await impression_logger.log_selection(
        db=db,
        impression_id=payload.impression_id,
        query_id=payload.query_id,
        lost_raw=payload.lost_item_raw,
        selected_found_id=payload.selected_found_id,
        selected_rank=payload.selected_rank,
    )
    return {"status": "ok" if success else "skipped", "logged": success}


# ---------------------------------------------------------------------------
# POST /fraud-check — Unchanged
# ---------------------------------------------------------------------------

@router.post("/fraud-check", summary="Check User Behavior for Fraud")
def check_fraud(user_metadata: dict, fraud_engine: FraudDetectionEngine = Depends(get_fraud)):
    result = fraud_engine.predict_fraud(user_metadata)
    return result


# ---------------------------------------------------------------------------
# POST /log-verification — External handover system reports yes/no
# ---------------------------------------------------------------------------

@router.post("/log-verification", summary="Log Handover Verification (Yes/No)")
async def log_verification(payload: VerificationLog, db=Depends(get_db)):
    """
    Called by the external handover/verification system to report whether
    a matched item was correctly verified (yes) or rejected (no).

    This is the STRONGEST training signal for the re-ranker:
      - verified=true  → STRONG POSITIVE (weight=3.0)
      - verified=false → SKIP pair (wrong match, discard from training)

    The other team calls this endpoint; we store and use during retraining.
    """
    if db is None:
        return {"status": "skipped", "reason": "database unavailable"}

    doc = {
        "verification_id": str(uuid.uuid4()),
        "lost_id": payload.lost_id,
        "found_id": payload.found_id,
        "verified": payload.verified,
        "verification_method": payload.verification_method or "unknown",
        "verified_at": datetime.utcnow(),
    }

    try:
        await db.handover_verifications.insert_one(doc)
        logger.info(
            f"Verification logged: lost={payload.lost_id}, "
            f"found={payload.found_id}, verified={payload.verified}"
        )
        return {
            "status": "ok",
            "verification_id": doc["verification_id"],
            "verified": payload.verified,
        }
    except Exception as e:
        logger.error(f"Verification log failed: {e}")
        return {"status": "error", "detail": str(e)}


# ---------------------------------------------------------------------------
# POST /feedback — Lightweight user yes/no feedback on match quality
# ---------------------------------------------------------------------------

@router.post("/feedback", summary="User Feedback on Match Quality")
async def submit_feedback(payload: FeedbackRequest, db=Depends(get_db)):
    """
    Lightweight feedback endpoint for the frontend.
    When a user selects an item from the list and says "Yes this is mine"
    or "No this is not mine", the frontend calls this.

    This creates a handover_verifications record that the training pipeline
    already knows how to consume:
      - is_correct=true  → verified=true  (STRONG POSITIVE for retraining)
      - is_correct=false → verified=false (pair is EXCLUDED from training)

    This is separate from /log-verification because:
      - /log-verification is for the external handover system (after claim process)
      - /feedback is for quick user-initiated feedback on match quality
    """
    if db is None:
        return {"status": "skipped", "reason": "database unavailable"}

    doc = {
        "verification_id": str(uuid.uuid4()),
        "lost_id": payload.query_id,
        "found_id": payload.found_id,
        "verified": payload.is_correct,
        "verification_method": "user_feedback",
        "impression_id": payload.impression_id,
        "verified_at": datetime.utcnow(),
        "source": "frontend_feedback",
    }

    try:
        await db.handover_verifications.insert_one(doc)
        logger.info(
            f"User feedback logged: query={payload.query_id}, "
            f"found={payload.found_id}, correct={payload.is_correct}"
        )

        # Also update the RL agent with immediate reward signal
        try:
            from app.core.rl_agent import RLRankingAgent
            rl = RLRankingAgent()
            state = rl.get_state({
                "category_matched": True,
                "semantic_score": 60.0,  # average placeholder
            })
            reward = 1.0 if payload.is_correct else -1.0
            rl.update(state, 1, reward, state)
            rl.save()
        except Exception as rl_err:
            logger.debug(f"RL update skipped: {rl_err}")

        # --- NEW: Collect (lost, found) text pairs for embedding fine-tuning ---
        # When user confirms a match (is_correct=true), save the pair of
        # descriptions so the sentence-transformer can learn from real feedback.
        if payload.is_correct:
            try:
                await _collect_embedding_pair(db, payload)
            except Exception as ep_err:
                logger.debug(f"Embedding pair collection skipped: {ep_err}")

        return {
            "status": "ok",
            "verification_id": doc["verification_id"],
            "message": "Thank you for your feedback! This helps improve matching accuracy.",
        }
    except Exception as e:
        logger.error(f"Feedback log failed: {e}")
        return {"status": "error", "detail": str(e)}


# ---------------------------------------------------------------------------
# POST /retrain — Trigger re-ranker model retraining
# ---------------------------------------------------------------------------

@router.post("/retrain", summary="Trigger Model Retraining")
async def trigger_retrain(payload: RetrainRequest, db=Depends(get_db)):
    """
    Trigger the LightGBM re-ranker retraining pipeline.
    Only succeeds when enough verified feedback has been collected.
    """
    if db is None:
        return {"status": "error", "detail": "Database unavailable"}

    from app.config import settings

    try:
        from app.core.trainer import build_training_dataset, train_reranker_model
        from app.core.scorer import reload_lgbm_model

        min_date = None
        if payload.days:
            from datetime import timedelta
            min_date = datetime.utcnow() - timedelta(days=payload.days)

        # Build dataset
        df = await build_training_dataset(db, min_date=min_date)
        if df.empty:
            return {
                "status": "error",
                "detail": "No training data available. Need more user selections + verifications.",
            }

        n_positives = int((df["label"] == 1).sum())
        n_negatives = int((df["label"] == 0).sum())

        if n_positives < settings.MIN_TRAIN_POSITIVES and not payload.force:
            return {
                "status": "insufficient_data",
                "detail": (
                    f"Only {n_positives} positive pairs (need {settings.MIN_TRAIN_POSITIVES}). "
                    f"Collect more verified feedback or set force=true."
                ),
                "stats": {"positives": n_positives, "negatives": n_negatives},
            }

        # Train
        model = train_reranker_model(df)
        reload_lgbm_model()

        return {
            "status": "ok",
            "message": "Re-ranker model retrained and deployed successfully!",
            "stats": {
                "positives": n_positives,
                "negatives": n_negatives,
                "total_rows": len(df),
            },
        }
    except ImportError as e:
        return {"status": "error", "detail": f"Missing dependency: {e}"}
    except Exception as e:
        logger.error(f"Retrain failed: {e}")
        return {"status": "error", "detail": str(e)}


# ---------------------------------------------------------------------------
# GET /feedback-stats — Dashboard: how much training data collected so far
# ---------------------------------------------------------------------------

@router.get("/feedback-stats", summary="Feedback Collection Statistics")
async def feedback_stats(db=Depends(get_db)):
    """Returns counts of impressions, selections, and verifications to track readiness."""
    if db is None:
        return {"status": "unavailable", "reason": "database not connected"}

    try:
        impressions = await db.match_impressions.count_documents({})
        selections = await db.match_selections.count_documents({})
        verifications_total = await db.handover_verifications.count_documents({})
        verifications_positive = await db.handover_verifications.count_documents({"verified": True})
        verifications_negative = await db.handover_verifications.count_documents({"verified": False})

        from app.config import settings
        ready = verifications_positive >= settings.MIN_TRAIN_POSITIVES

        # --- Embedding fine-tuning stats ---
        embedding_pairs = await db.embedding_training_pairs.count_documents({})
        embedding_ready = embedding_pairs >= settings.MIN_TRAIN_POSITIVES

        return {
            "status": "ok",
            "impressions": impressions,
            "selections": selections,
            "verifications": {
                "total": verifications_total,
                "positive": verifications_positive,
                "negative": verifications_negative,
            },
            "training_ready": ready,
            "min_required": settings.MIN_TRAIN_POSITIVES,
            "embedding_fine_tuning": {
                "collected_pairs": embedding_pairs,
                "ready": embedding_ready,
                "min_required": settings.MIN_TRAIN_POSITIVES,
                "message": (
                    f"Ready to fine-tune embeddings! ({embedding_pairs} pairs collected)"
                    if embedding_ready
                    else f"Need {settings.MIN_TRAIN_POSITIVES - embedding_pairs} more confirmed matches for embedding fine-tuning."
                ),
            },
            "message": (
                f"Ready to retrain! ({verifications_positive} verified pairs)"
                if ready
                else f"Need {settings.MIN_TRAIN_POSITIVES - verifications_positive} more verified pairs before training."
            ),
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# ---------------------------------------------------------------------------
# Helper: Collect (lost, found) text pair for embedding fine-tuning
# ---------------------------------------------------------------------------

async def _collect_embedding_pair(db, payload: FeedbackRequest):
    """
    When user confirms a match, look up the original lost description and
    the matched found description from MongoDB, then store the pair in
    `embedding_training_pairs` for future sentence-transformer fine-tuning.

    This runs inside the /feedback handler for positive feedback only.
    """
    # 1. Get the lost description from the impression log
    lost_text = None
    if payload.impression_id:
        impression = await db.match_impressions.find_one(
            {"impression_id": payload.impression_id},
            {"lost_item_raw": 1},
        )
        if impression:
            lost_text = impression.get("lost_item_raw")

    # Fallback: try match_selections
    if not lost_text:
        selection = await db.match_selections.find_one(
            {"query_id": payload.query_id},
            {"lost_item_raw": 1},
        )
        if selection:
            lost_text = selection.get("lost_item_raw")

    if not lost_text:
        logger.debug("Embedding pair: no lost text found — skipping")
        return

    # 2. Get the found description
    found_doc = await db.found_items.find_one(
        {"item_id": payload.found_id},
        {"description": 1, "category": 1},
    )
    if not found_doc or not found_doc.get("description"):
        logger.debug("Embedding pair: no found description — skipping")
        return

    found_text = found_doc["description"]

    # 3. Deduplicate — don't insert if this pair already exists
    existing = await db.embedding_training_pairs.find_one({
        "lost_id": payload.query_id,
        "found_id": payload.found_id,
    })
    if existing:
        return

    # 4. Store the pair
    pair_doc = {
        "pair_id": str(uuid.uuid4()),
        "lost_id": payload.query_id,
        "found_id": payload.found_id,
        "anchor": lost_text[:2000],
        "positive": found_text[:2000],
        "category": found_doc.get("category", ""),
        "source": "user_feedback",
        "created_at": datetime.utcnow(),
    }
    await db.embedding_training_pairs.insert_one(pair_doc)
    count = await db.embedding_training_pairs.count_documents({})
    logger.info(
        f"Embedding training pair collected: lost={payload.query_id}, "
        f"found={payload.found_id} (total: {count})"
    )


# ---------------------------------------------------------------------------
# POST /retrain-embeddings — Fine-tune sentence-transformer from feedback
# ---------------------------------------------------------------------------

@router.post("/retrain-embeddings", summary="Fine-tune Embedding Model from User Feedback")
async def retrain_embeddings(payload: RetrainRequest, db=Depends(get_db)):
    """
    Fine-tune the sentence-transformer embedding model using (lost, found)
    text pairs collected from confirmed user matches.

    Every time a user picks a found item and confirms "Yes, this is mine",
    the system stores the (lost_description, found_description) pair.
    When enough pairs are collected (default: 50), this endpoint trains the
    embedding model so it learns from real user behavior.

    This is different from /retrain:
      - /retrain trains the LightGBM re-ranker (ranking layer)
      - /retrain-embeddings trains the sentence-transformer (embedding layer)
    """
    if db is None:
        return {"status": "error", "detail": "Database unavailable"}

    from app.config import settings

    try:
        # Count available pairs
        total_pairs = await db.embedding_training_pairs.count_documents({})

        if total_pairs < settings.MIN_TRAIN_POSITIVES and not payload.force:
            return {
                "status": "insufficient_data",
                "detail": (
                    f"Only {total_pairs} feedback pairs collected (need {settings.MIN_TRAIN_POSITIVES}). "
                    f"Collect more confirmed matches or set force=true."
                ),
                "stats": {"collected_pairs": total_pairs, "min_required": settings.MIN_TRAIN_POSITIVES},
            }

        # Fetch all pairs from MongoDB
        cursor = db.embedding_training_pairs.find(
            {},
            {"anchor": 1, "positive": 1, "category": 1, "_id": 0},
        )
        pairs = await cursor.to_list(length=10000)

        if not pairs:
            return {"status": "error", "detail": "No training pairs found."}

        # Run fine-tuning (CPU-bound, runs in thread to avoid blocking)
        import asyncio
        from app.core.embedding_trainer import fine_tune_from_feedback
        result = await asyncio.to_thread(fine_tune_from_feedback, pairs)

        # Reload the semantic engine with the new model
        try:
            engine = SemanticEngine()
            engine.reload_model()
            logger.info("Semantic engine reloaded with fine-tuned model")
        except Exception as reload_err:
            logger.warning(f"Model reload deferred to next restart: {reload_err}")

        return {
            "status": "ok",
            "message": "Embedding model fine-tuned from user feedback and deployed!",
            "stats": result,
        }
    except ImportError as e:
        return {"status": "error", "detail": f"Missing dependency: {e}"}
    except Exception as e:
        logger.error(f"Embedding retrain failed: {e}")
        return {"status": "error", "detail": str(e)}