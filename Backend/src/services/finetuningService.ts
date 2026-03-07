import crypto from 'crypto';
import axios from 'axios';
import mongoose from 'mongoose';
import { FeedbackFinetuning } from '../models/FeedbackFinetuning';
import { Verification, IVerification } from '../models/Verification';
import { FoundItem } from '../models/FoundItem';

// Python AI backend URL (same as pythonSearchService.ts)
const PYTHON_SEMANTIC_BACKEND_URL =
  process.env.PYTHON_SEMANTIC_BACKEND_URL ||
  process.env.PYTHON_BACKEND_URL ||
  'http://127.0.0.1:8001';

/**
 * Collect a (lost, found) text pair from a passed verification and store it
 * in feedback_finetuning. Also write to embedding_training_pairs so the
 * Python fine-tuning pipeline picks it up without any changes.
 *
 * This function is designed to be called independently — it does NOT modify
 * the existing verification flow. Call it after a verification passes.
 */
export const collectPairFromVerification = async (
  verificationId: string
): Promise<{ collected: boolean; reason?: string }> => {
  const verification = await Verification.findById(verificationId);

  if (!verification) {
    return { collected: false, reason: 'Verification not found' };
  }

  if (verification.status !== 'passed') {
    return { collected: false, reason: `Verification status is '${verification.status}', not 'passed'` };
  }

  // Check if pair already collected for this verification
  const existing = await FeedbackFinetuning.findOne({ verificationId: verification._id });
  if (existing) {
    return { collected: false, reason: 'Pair already collected for this verification' };
  }

  // Get lost description from the verification record
  const lostDescription = verification.ownerLostDescription;
  if (!lostDescription || lostDescription.trim().length === 0) {
    return { collected: false, reason: 'No lost description available on verification' };
  }

  // Get found description from the found item
  const foundItem = await FoundItem.findById(verification.foundItemId);
  if (!foundItem || !foundItem.description || foundItem.description.trim().length === 0) {
    return { collected: false, reason: 'No found item description available' };
  }

  const pairId = crypto.randomUUID();
  const anchor = lostDescription.substring(0, 2000);
  const positive = foundItem.description.substring(0, 2000);
  const category = foundItem.category || '';

  // 1. Save to feedback_finetuning collection (tracking table)
  await FeedbackFinetuning.create({
    pairId,
    verificationId: verification._id,
    foundItemId: verification.foundItemId,
    lostRequestId: verification.ownerLostRequestId || null,
    anchor,
    positive,
    category,
    source: 'verification_pass',
    syncedToTraining: false,
  });

  // 2. Write to embedding_training_pairs (the collection Python reads from)
  //    Uses the native MongoDB driver to write to a collection without a Mongoose model
  const db = mongoose.connection.db;
  if (db) {
    const embeddingPairs = db.collection('embedding_training_pairs');

    // Deduplicate by verification-based pair
    const existingPair = await embeddingPairs.findOne({
      lost_id: verification.ownerLostRequestId?.toString() || verificationId,
      found_id: verification.foundItemId.toString(),
    });

    if (!existingPair) {
      await embeddingPairs.insertOne({
        pair_id: pairId,
        lost_id: verification.ownerLostRequestId?.toString() || verificationId,
        found_id: verification.foundItemId.toString(),
        anchor,
        positive,
        category,
        source: 'verification_pass',
        created_at: new Date(),
      });
    }

    // Mark as synced
    await FeedbackFinetuning.updateOne(
      { pairId },
      { $set: { syncedToTraining: true } }
    );
  }

  console.log(
    `✅ Fine-tuning pair collected: verification=${verificationId}, ` +
    `lost="${anchor.substring(0, 60)}...", found="${positive.substring(0, 60)}..."`
  );

  return { collected: true };
};

/**
 * Scan all passed verifications and collect any missing pairs.
 * Useful as a batch catch-up / backfill operation.
 */
export const backfillPairsFromVerifications = async (): Promise<{
  scanned: number;
  collected: number;
  skipped: number;
  errors: number;
}> => {
  const passedVerifications = await Verification.find({ status: 'passed' })
    .select('_id')
    .lean();

  let collected = 0;
  let skipped = 0;
  let errors = 0;

  for (const v of passedVerifications) {
    try {
      const result = await collectPairFromVerification(v._id.toString());
      if (result.collected) {
        collected++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      console.error(`Error collecting pair for verification ${v._id}:`, err);
    }
  }

  return {
    scanned: passedVerifications.length,
    collected,
    skipped,
    errors,
  };
};

/**
 * Get stats about collected fine-tuning pairs.
 */
export const getFinetuningStats = async (): Promise<{
  totalPairs: number;
  syncedToTraining: number;
  pendingSync: number;
}> => {
  const totalPairs = await FeedbackFinetuning.countDocuments();
  const syncedToTraining = await FeedbackFinetuning.countDocuments({ syncedToTraining: true });

  return {
    totalPairs,
    syncedToTraining,
    pendingSync: totalPairs - syncedToTraining,
  };
};

/**
 * Log a verification result (passed/failed) to the Python backend's
 * /log-verification endpoint. This populates `handover_verifications`
 * which feeds LightGBM re-ranker training and hard negative mining.
 *
 * Called automatically from the Verification post-save hook.
 */
export const logVerificationToPython = async (
  verification: IVerification
): Promise<void> => {
  try {
    await axios.post(
      `${PYTHON_SEMANTIC_BACKEND_URL}/log-verification`,
      {
        lost_id: verification.ownerLostRequestId?.toString() || verification._id.toString(),
        found_id: verification.foundItemId.toString(),
        verified: verification.status === 'passed',
        verification_method: 'video_qa',
      },
      { timeout: 5000 }
    );
    console.log(
      `📊 Verification logged to Python: ${verification._id} (${verification.status})`
    );
  } catch (err) {
    // Non-blocking — Python backend may be offline
    console.error('Failed to log verification to Python (non-blocking):', err instanceof Error ? err.message : err);
  }
};

/**
 * Send yes/no feedback to the Python backend's /feedback endpoint.
 * This triggers:
 *   - RL Q-Learning agent update
 *   - _collect_embedding_pair() for additional embedding training data
 *   - handover_verifications entry (with source: "frontend_feedback")
 *
 * Called automatically from the Verification post-save hook.
 */
export const sendFeedbackToPython = async (
  verification: IVerification
): Promise<void> => {
  try {
    await axios.post(
      `${PYTHON_SEMANTIC_BACKEND_URL}/feedback`,
      {
        query_id: verification.ownerLostRequestId?.toString() || verification._id.toString(),
        found_id: verification.foundItemId.toString(),
        is_correct: verification.status === 'passed',
      },
      { timeout: 5000 }
    );
    console.log(
      `🤖 Feedback sent to Python: ${verification._id} (is_correct=${verification.status === 'passed'})`
    );
  } catch (err) {
    // Non-blocking — Python backend may be offline
    console.error('Failed to send feedback to Python (non-blocking):', err instanceof Error ? err.message : err);
  }
};

/**
 * Log a user's selection of a search result to the Python backend's
 * /log-selection endpoint. This populates `match_selections` which
 * feeds LightGBM re-ranker training.
 *
 * Called from the selection logging route.
 */
export const logSelectionToPython = async (data: {
  impressionId: string;
  queryId: string;
  lostItemRaw: string;
  selectedFoundId: string;
  selectedRank: number;
}): Promise<void> => {
  await axios.post(
    `${PYTHON_SEMANTIC_BACKEND_URL}/log-selection`,
    {
      impression_id: data.impressionId,
      query_id: data.queryId,
      lost_item_raw: data.lostItemRaw,
      selected_found_id: data.selectedFoundId,
      selected_rank: data.selectedRank,
    },
    { timeout: 5000 }
  );
  console.log(
    `📝 Selection logged to Python: found=${data.selectedFoundId}, rank=${data.selectedRank}`
  );
};
