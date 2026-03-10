import { Types } from 'mongoose';
import { Verification, IVerification, VerificationStatus, IVerificationAnswer } from '../models/Verification';
import { FoundItem } from '../models/FoundItem';
import { LostRequest } from '../models/LostRequest';
import { User } from '../models/User';
import { verifyOwnershipWithPython, PythonVerificationRequest, PythonVerificationResponse, VideoFile } from './pythonVerificationService';
import { sendFounderVerificationPassedEmail, sendManualVerificationReviewEmail } from './emailService';

export interface OwnerAnswerInput {
  questionId: number;
  answer: string;
  videoKey?: string;
}

export interface CreateVerificationData {
  foundItemId: string;
  ownerId: string;
  ownerAnswers: OwnerAnswerInput[];
  videoFiles?: Map<string, VideoFile>;
}

export interface EvaluateVerificationData {
  status: VerificationStatus;
  similarityScore?: number;
}

const notifyFounderAfterVerifiedOwnership = async (verificationId: Types.ObjectId | string): Promise<void> => {
  const verification = await Verification.findById(verificationId)
    .populate('foundItemId', 'category description founderContact')
    .populate('ownerId', 'name email phone');

  if (!verification || verification.status !== 'passed' || verification.founderNotificationSentAt) {
    return;
  }

  const foundItem = verification.foundItemId as unknown as {
    category?: string;
    description?: string;
    imageUrl?: string;
    founderContact?: {
      name?: string;
      email?: string;
      phone?: string;
    };
  } | null;

  const owner = verification.ownerId as unknown as {
    name?: string;
    email?: string;
    phone?: string;
  } | null;

  const founderEmail = foundItem?.founderContact?.email?.trim();
  const ownerEmail = owner?.email?.trim();

  if (!founderEmail || !ownerEmail) {
    console.warn(
      'Founder verification email skipped: founder or owner email missing.',
      JSON.stringify({
        verificationId: verification._id,
        founderEmail: founderEmail || null,
        ownerEmail: ownerEmail || null,
      })
    );
    return;
  }

  const sent = await sendFounderVerificationPassedEmail({
    founderName: foundItem?.founderContact?.name || 'Founder',
    founderEmail,
    ownerName: owner?.name || 'Verified owner',
    ownerEmail,
    ownerPhone: owner?.phone || null,
    itemCategory: foundItem?.category || 'reported item',
    itemDescription: foundItem?.description || 'No description provided',
    itemImageUrl: foundItem?.imageUrl || null,
  });

  if (!sent) {
    return;
  }

  await Verification.findByIdAndUpdate(verification._id, {
    founderNotificationSentAt: new Date(),
  });
};

/**
 * Create a verification record
 */
export const createVerification = async (
  data: CreateVerificationData
): Promise<IVerification> => {
  // Fetch the found item to get questions and founder answers
  const foundItem = await FoundItem.findById(data.foundItemId);

  if (!foundItem) {
    throw new Error('Found item not found');
  }

  // Validate that owner provided answers for all questions
  if (data.ownerAnswers.length !== foundItem.questions.length) {
    throw new Error('Owner must provide answers for all questions');
  }

  // Build unified answers array
  const answers: IVerificationAnswer[] = data.ownerAnswers.map((ownerAnswer) => {
    const questionIndex = ownerAnswer.questionId;
    
    if (questionIndex < 0 || questionIndex >= foundItem.questions.length) {
      throw new Error(`Invalid questionId: ${questionIndex}`);
    }

    return {
      questionId: questionIndex,
      question: foundItem.questions[questionIndex],
      founderAnswer: foundItem.founderAnswers[questionIndex],
      ownerAnswer: ownerAnswer.answer,
      videoKey: ownerAnswer.videoKey || 'default_video_placeholder',
      questionMetadata: foundItem.questionMetadata?.[questionIndex],
    };
  });

  // Try to link the verification with the owner's related lost request
  // so we can store the original lost description in this same record.
  const ownerObjectId = new Types.ObjectId(data.ownerId);
  const foundItemObjectId = new Types.ObjectId(data.foundItemId);

  let linkedLostRequest = await LostRequest.findOne({
    ownerId: ownerObjectId,
    matchedFoundItemIds: foundItemObjectId,
  }).sort({ createdAt: -1 });

  // Fallback: latest lost request from this owner
  if (!linkedLostRequest) {
    linkedLostRequest = await LostRequest.findOne({ ownerId: ownerObjectId }).sort({ createdAt: -1 });
  }

  // Create verification record
  const verification = await Verification.create({
    foundItemId: foundItemObjectId,
    ownerId: ownerObjectId,
    ownerLostRequestId: linkedLostRequest?._id || null,
    ownerLostDescription: linkedLostRequest?.description || null,
    foundItemSnapshot: {
      category: foundItem.category,
      description: foundItem.description,
      imageUrl: foundItem.imageUrl,
      found_location: foundItem.found_location || [],
      status: foundItem.status,
    },
    answers,
    status: 'pending',
    similarityScore: null,
  });

  // Update found item status to pending_verification
  await FoundItem.findByIdAndUpdate(data.foundItemId, {
    status: 'pending_verification',
  });

  // Call Python backend for verification
  try {
    const pythonRequest: PythonVerificationRequest = {
      owner_id: data.ownerId,
      category: foundItem.category,
      answers: answers.map((answer) => ({
        question_id: answer.questionId + 1, // Python uses 1-based indexing
        video_key: answer.videoKey,
        founder_answer: answer.founderAnswer,
        owner_answer: answer.ownerAnswer,
        question_text: answer.question,
        question_type: answer.questionMetadata?.type,
        question_level: answer.questionMetadata?.level,
        question_weight: answer.questionMetadata?.weight,
      })),
    };

    const pythonResponse = await verifyOwnershipWithPython(
      pythonRequest,
      data.videoFiles || new Map()
    );

    // Update verification with Python backend results
    const parsedConfidence = parseFloat((pythonResponse.final_confidence || '0').replace('%', ''));
    const finalScore = Number.isFinite(parsedConfidence) ? parsedConfidence / 100 : 0;
    const isAbsoluteOwner = typeof pythonResponse.is_absolute_owner === 'boolean'
      ? pythonResponse.is_absolute_owner
      : pythonResponse.gemini_recommendation === 'MATCH';
    const newStatus: VerificationStatus = isAbsoluteOwner ? 'passed' : 'failed';

    verification.status = newStatus;
    verification.similarityScore = finalScore;
    verification.pythonVerificationResult = pythonResponse;
    await verification.save();

    // Update found item status based on verification result
    if (isAbsoluteOwner) {
      await FoundItem.findByIdAndUpdate(data.foundItemId, {
        status: 'claimed',
      });

      try {
        await notifyFounderAfterVerifiedOwnership(verification._id);
      } catch (notificationError) {
        console.error('Founder verification email failed (non-blocking):', notificationError);
      }
    } else {
      await FoundItem.findByIdAndUpdate(data.foundItemId, {
        status: 'available',
      });
    }
  } catch (error) {
    console.error('Python verification failed:', error);
    // Keep status as pending if Python verification fails
  }

  return verification;
};

/**
 * Get verification by ID
 * For owners: exclude founderAnswers from answers array
 * For admins: include all details
 */
export const getVerificationById = async (
  id: string,
  isAdmin: boolean = false
): Promise<any> => {
  const verification = await Verification.findById(id)
    .populate('foundItemId', 'category description imageUrl location founderContact')
    .populate('ownerId', 'name email phone');

  if (!verification) {
    return null;
  }

  const verificationObj = verification.toObject();

  if (isAdmin) {
    // Admin can see everything including founderAnswers
    return verificationObj;
  }

  // Owner view: exclude founderAnswer from each answer in the array
  const ownerView = {
    ...verificationObj,
    answers: verificationObj.answers.map((answer: IVerificationAnswer) => ({
      questionId: answer.questionId,
      question: answer.question,
      ownerAnswer: answer.ownerAnswer,
      videoKey: answer.videoKey,
      // founderAnswer is excluded for owners
    })),
  };

  return ownerView;
};

/**
 * Get verifications by owner ID
 */
export const getVerificationsByOwner = async (ownerId: string): Promise<IVerification[]> => {
  const verifications = await Verification.find({ ownerId: new Types.ObjectId(ownerId) })
    .sort({ createdAt: -1 })
    .populate('foundItemId', 'category description imageUrl location founderContact');

  return verifications;
};

/**
 * Get all verifications (admin only)
 */
export const getAllVerifications = async (): Promise<IVerification[]> => {
  const verifications = await Verification.find()
    .sort({ createdAt: -1 })
    .populate('foundItemId', 'category description imageUrl location founderContact')
    .populate('ownerId', 'name email phone');

  return verifications;
};

/**
 * Evaluate verification (for future AI implementation)
 */
export const evaluateVerification = async (
  id: string,
  data: EvaluateVerificationData
): Promise<IVerification | null> => {
  const verification = await Verification.findByIdAndUpdate(
    id,
    {
      status: data.status,
      ...(data.similarityScore !== undefined && { similarityScore: data.similarityScore }),
    },
    { new: true, runValidators: true }
  );

  if (!verification) {
    return null;
  }

  // If verification passed, update found item status to claimed
  if (data.status === 'passed') {
    await FoundItem.findByIdAndUpdate(verification.foundItemId, {
      status: 'claimed',
    });

    try {
      await notifyFounderAfterVerifiedOwnership(verification._id);
    } catch (notificationError) {
      console.error('Founder verification email failed during admin evaluation (non-blocking):', notificationError);
    }
  }

  return verification;
};

/**
 * Get pending verifications count
 */
export const getPendingVerificationsCount = async (): Promise<number> => {
  const count = await Verification.countDocuments({ status: 'pending' });
  return count;
};

export const requestManualVerificationReview = async (
  foundItemId: string,
  ownerId: string,
  reason: string
): Promise<void> => {
  const trimmedReason = reason.trim();

  if (!trimmedReason) {
    throw new Error('Reason is required');
  }

  const [foundItem, owner, linkedLostRequest] = await Promise.all([
    FoundItem.findById(foundItemId),
    User.findById(ownerId),
    LostRequest.findOne({
      ownerId: new Types.ObjectId(ownerId),
      matchedFoundItemIds: new Types.ObjectId(foundItemId),
    }).sort({ createdAt: -1 }),
  ]);

  if (!foundItem) {
    throw new Error('Found item not found');
  }

  if (!owner) {
    throw new Error('Owner not found');
  }

  const adminEmail = 'pawarasasmina1@gmail.com';
  const foundLocations = (foundItem.found_location || []).map((entry) => {
    const bits = [entry.location, entry.floor_id || null, entry.hall_name || null].filter(Boolean);
    return bits.join(' | ');
  });

  const sent = await sendManualVerificationReviewEmail({
    adminEmail,
    ownerName: owner.name || null,
    ownerEmail: owner.email || null,
    ownerPhone: owner.phone || null,
    ownerId: owner._id.toString(),
    itemId: foundItem._id.toString(),
    itemCategory: foundItem.category,
    itemDescription: foundItem.description,
    founderName: foundItem.founderContact?.name || null,
    founderEmail: foundItem.founderContact?.email || null,
    founderPhone: foundItem.founderContact?.phone || null,
    foundLocations,
    ownerReason: trimmedReason,
    ownerLostDescription: linkedLostRequest?.description || null,
  });

  if (!sent) {
    throw new Error('Manual review email could not be sent because email is not configured');
  }
};
