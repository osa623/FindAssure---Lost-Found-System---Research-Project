import { Types } from 'mongoose';
import { Verification, IVerification, VerificationStatus, IVerificationAnswer } from '../models/Verification';
import { FoundItem } from '../models/FoundItem';
import { verifyOwnershipWithPython, PythonVerificationRequest, PythonVerificationResponse, VideoFile } from './pythonVerificationService';

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
    };
  });

  // Create verification record
  const verification = await Verification.create({
    foundItemId: new Types.ObjectId(data.foundItemId),
    ownerId: new Types.ObjectId(data.ownerId),
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
