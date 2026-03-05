"""
Fine-tune sentence-transformer from user feedback pairs.

Usage:
    python scripts/train_from_feedback.py [--epochs 10] [--force]

This script:
  1. Connects to MongoDB and fetches all confirmed (lost, found) text pairs
     from the `embedding_training_pairs` collection.
  2. Merges them with the curated text_pairs_english.json dataset.
  3. Fine-tunes the sentence-transformer model.
  4. Saves the updated model to data/models/fine_tuned_bert/.

Pairs are automatically collected whenever a user confirms "Yes, this is mine"
via POST /feedback with is_correct=true.
"""

import argparse
import asyncio
import json
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main():
    parser = argparse.ArgumentParser(description="Fine-tune embeddings from user feedback")
    parser.add_argument("--epochs", type=int, default=10, help="Training epochs (default: 10)")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate (default: 1e-5)")
    parser.add_argument("--force", action="store_true", help="Train even with <50 pairs")
    args = parser.parse_args()

    print("=" * 70)
    print("EMBEDDING FINE-TUNING FROM USER FEEDBACK")
    print("=" * 70)

    # Connect to MongoDB
    from app.core.database import connect_db, get_database
    await connect_db()
    db = get_database()

    if db is None:
        print("ERROR: Could not connect to MongoDB. Check your .env configuration.")
        sys.exit(1)

    # Fetch pairs
    print("\nFetching feedback pairs from MongoDB...")
    cursor = db.embedding_training_pairs.find(
        {},
        {"anchor": 1, "positive": 1, "category": 1, "_id": 0},
    )
    pairs = await cursor.to_list(length=10000)
    print(f"Found {len(pairs)} feedback pairs.")

    from app.config import settings
    if len(pairs) < settings.MIN_TRAIN_POSITIVES and not args.force:
        print(
            f"\nInsufficient data: {len(pairs)} pairs (need {settings.MIN_TRAIN_POSITIVES})."
            f"\nUsers need to confirm more matches, or use --force to train anyway."
        )
        sys.exit(1)

    if not pairs:
        print("\nNo feedback pairs collected yet. Cannot train.")
        print("Pairs are collected when users confirm matches via POST /feedback.")
        sys.exit(1)

    # Train
    print(f"\nStarting fine-tuning with {len(pairs)} feedback pairs...")
    print(f"Epochs: {args.epochs}, Learning rate: {args.lr}")
    print()

    from app.core.embedding_trainer import fine_tune_from_feedback
    result = fine_tune_from_feedback(
        feedback_pairs=pairs,
        epochs=args.epochs,
        learning_rate=args.lr,
    )

    print("\n" + "=" * 70)
    print("FINE-TUNING COMPLETE!")
    print("=" * 70)
    print(f"\nModel source:           {result['model_source']}")
    print(f"Feedback pairs used:    {result['feedback_pairs_used']}")
    print(f"Curated pairs merged:   {result['curated_pairs_merged']}")
    print(f"Total training examples:{result['total_training_examples']}")
    print(f"Epochs:                 {result['epochs']}")
    print(f"Model saved to:         {result['model_saved_to']}")

    if result.get("sample_results"):
        print("\nSample similarity scores on feedback pairs:")
        for r in result["sample_results"]:
            print(f"  Lost:  {r['lost']}")
            print(f"  Found: {r['found']}")
            print(f"  Similarity: {r['similarity']:.4f} ({r['similarity']*100:.1f}%)")
            print()

    print("NEXT STEPS:")
    print("1. Restart the API server to use the new model:")
    print("   uvicorn app.main:app --port 8001")
    print("2. Or call POST /retrain-embeddings from the API (hot-reloads automatically)")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
