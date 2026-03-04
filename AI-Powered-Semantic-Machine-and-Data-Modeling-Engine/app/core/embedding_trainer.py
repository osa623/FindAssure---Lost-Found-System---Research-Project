"""
Embedding Fine-Tuning from User Feedback
=========================================

Fine-tunes the sentence-transformer embedding model using real (lost, found)
text pairs collected from confirmed user matches.

How it works:
  1. Users search for lost items and see ranked results.
  2. When a user confirms "Yes, this is mine", the (lost_description, found_description)
     pair is saved to the `embedding_training_pairs` MongoDB collection.
  3. Once enough pairs are collected (default 50), this module fine-tunes the
     sentence-transformer so it produces better embeddings for real-world descriptions.

This is different from train_english_only.py (manual curated pairs) because:
  - These pairs come from REAL USERS confirming actual matches
  - They reflect the exact language and phrasing real users write
  - The model continuously improves as more users interact with the system

Training approach:
  - Loads existing fine-tuned model (or base model as fallback)
  - Merges feedback pairs WITH the original curated dataset (so we don't lose
    what the base model already learned)
  - Uses MultipleNegativesRankingLoss (best for semantic search)
  - Saves the updated model back to data/models/fine_tuned_bert/
"""

import json
import logging
import os
import random
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(BASE_DIR, "data", "models", "fine_tuned_bert")
CURATED_PAIRS_PATH = os.path.join(BASE_DIR, "data", "raw", "text_pairs_english.json")
FEEDBACK_PAIRS_BACKUP = os.path.join(BASE_DIR, "data", "raw", "feedback_pairs.json")


def fine_tune_from_feedback(
    feedback_pairs: list[dict],
    epochs: int = 10,
    batch_size: int = 2,
    learning_rate: float = 1e-5,
) -> dict:
    """
    Fine-tune the sentence-transformer using feedback-collected pairs.

    Args:
        feedback_pairs: List of dicts with 'anchor' and 'positive' keys
                        (lost_text and found_text from confirmed matches).
        epochs: Number of training epochs (default 10, less aggressive than
                initial training since we're refining not starting fresh).
        batch_size: Batch size (small because descriptions can be long).
        learning_rate: Learning rate (lower than initial training to avoid
                       catastrophic forgetting of what the model already learned).

    Returns:
        Dict with training statistics.
    """
    from sentence_transformers import SentenceTransformer, InputExample, losses
    from sentence_transformers.evaluation import EmbeddingSimilarityEvaluator
    from torch.utils.data import DataLoader

    logger.info(f"Starting embedding fine-tuning with {len(feedback_pairs)} feedback pairs")

    # --- 1. Load existing model (fine-tuned preferred, base as fallback) ---
    try:
        model = SentenceTransformer(MODEL_PATH)
        model_source = "existing fine-tuned model"
        logger.info(f"Loaded existing fine-tuned model from {MODEL_PATH}")
    except Exception:
        model = SentenceTransformer("all-mpnet-base-v2")
        model_source = "base model (all-mpnet-base-v2)"
        logger.info("No fine-tuned model found, starting from base model")

    # --- 2. Load original curated pairs (to merge and prevent forgetting) ---
    curated_pairs = []
    if os.path.exists(CURATED_PAIRS_PATH):
        try:
            with open(CURATED_PAIRS_PATH, "r", encoding="utf-8") as f:
                curated_pairs = json.load(f)
            logger.info(f"Loaded {len(curated_pairs)} curated pairs for merge")
        except Exception as e:
            logger.warning(f"Could not load curated pairs: {e}")

    # --- 3. Save feedback pairs to disk as backup ---
    try:
        os.makedirs(os.path.dirname(FEEDBACK_PAIRS_BACKUP), exist_ok=True)
        with open(FEEDBACK_PAIRS_BACKUP, "w", encoding="utf-8") as f:
            json.dump(feedback_pairs, f, indent=2, ensure_ascii=False, default=str)
        logger.info(f"Feedback pairs backed up to {FEEDBACK_PAIRS_BACKUP}")
    except Exception as e:
        logger.warning(f"Could not backup feedback pairs: {e}")

    # --- 4. Prepare combined training data ---
    # Feedback pairs get higher weight (repeated 2x) since they are real user data
    all_examples = []

    # Add feedback pairs (2x weight — these are real confirmed matches)
    for pair in feedback_pairs:
        anchor = pair.get("anchor", "")
        positive = pair.get("positive", "")
        if anchor and positive:
            all_examples.append(InputExample(texts=[anchor, positive]))
            all_examples.append(InputExample(texts=[positive, anchor]))  # reverse
            # Extra copy for emphasis on real user data
            all_examples.append(InputExample(texts=[anchor, positive]))

    # Add curated pairs (1x weight — reinforcement to prevent catastrophic forgetting)
    for pair in curated_pairs:
        anchor = pair.get("anchor", "")
        positive = pair.get("positive", "")
        if anchor and positive:
            all_examples.append(InputExample(texts=[anchor, positive]))

    if not all_examples:
        raise ValueError("No valid training examples after merging")

    # --- 5. Split into train/eval ---
    random.seed(42)
    random.shuffle(all_examples)

    # Use 10% of feedback pairs as eval
    n_eval = max(4, len(feedback_pairs) // 10)
    eval_anchors = [p["anchor"] for p in feedback_pairs[:n_eval] if p.get("anchor")]
    eval_positives = [p["positive"] for p in feedback_pairs[:n_eval] if p.get("positive")]
    eval_scores = [1.0] * min(len(eval_anchors), len(eval_positives))

    evaluator = None
    if len(eval_anchors) >= 2:
        evaluator = EmbeddingSimilarityEvaluator(
            eval_anchors, eval_positives, eval_scores,
            name="feedback_eval",
        )

    # --- 6. Configure training ---
    train_dataloader = DataLoader(all_examples, shuffle=True, batch_size=batch_size)
    train_loss = losses.MultipleNegativesRankingLoss(model)
    warmup_steps = int(len(train_dataloader) * epochs * 0.1)

    logger.info(
        f"Training config: {len(all_examples)} examples "
        f"({len(feedback_pairs)} feedback + {len(curated_pairs)} curated), "
        f"{epochs} epochs, batch_size={batch_size}, lr={learning_rate}"
    )

    # --- 7. Train ---
    os.makedirs(MODEL_PATH, exist_ok=True)

    model.fit(
        train_objectives=[(train_dataloader, train_loss)],
        evaluator=evaluator,
        epochs=epochs,
        warmup_steps=warmup_steps,
        evaluation_steps=len(train_dataloader) if evaluator else 0,
        output_path=MODEL_PATH,
        save_best_model=True if evaluator else False,
        show_progress_bar=True,
        optimizer_params={"lr": learning_rate, "weight_decay": 0.01},
    )

    # If no evaluator, save manually
    if not evaluator:
        model.save(MODEL_PATH)

    logger.info(f"Fine-tuned model saved to {MODEL_PATH}")

    # --- 8. Quick test with a few feedback pairs ---
    test_results = []
    test_pairs = feedback_pairs[:5]
    for pair in test_pairs:
        anchor = pair.get("anchor", "")
        positive = pair.get("positive", "")
        if anchor and positive:
            a_emb = model.encode(anchor, normalize_embeddings=True)
            p_emb = model.encode(positive, normalize_embeddings=True)
            sim = float(a_emb @ p_emb)
            test_results.append({
                "lost": anchor[:80] + "..." if len(anchor) > 80 else anchor,
                "found": positive[:80] + "..." if len(positive) > 80 else positive,
                "similarity": round(sim, 4),
            })

    stats = {
        "model_source": model_source,
        "feedback_pairs_used": len(feedback_pairs),
        "curated_pairs_merged": len(curated_pairs),
        "total_training_examples": len(all_examples),
        "epochs": epochs,
        "learning_rate": learning_rate,
        "model_saved_to": MODEL_PATH,
        "sample_results": test_results,
        "trained_at": datetime.utcnow().isoformat(),
    }

    logger.info(f"Embedding fine-tuning complete: {stats}")
    return stats
