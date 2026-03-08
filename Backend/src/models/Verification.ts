import mongoose, { Schema, Document, Types } from 'mongoose';

export type VerificationStatus = 'pending' | 'passed' | 'failed';

export interface IVerificationAnswer {
  questionId: number;
  question: string;
  founderAnswer: string;
  ownerAnswer: string;
  videoKey: string;
}

export interface IVerification extends Document {
  foundItemId: Types.ObjectId;
  ownerId: Types.ObjectId;
  ownerLostRequestId?: Types.ObjectId | null;
  ownerLostDescription?: string | null;
  foundItemSnapshot?: {
    category?: string;
    description?: string;
    imageUrl?: string;
    found_location?: Array<{
      location: string;
      floor_id?: string | null;
      hall_name?: string | null;
    }>;
    status?: string;
  } | null;
  answers: IVerificationAnswer[];
  status: VerificationStatus;
  similarityScore: number | null;
  founderNotificationSentAt?: Date | null;
  pythonVerificationResult?: any; // Store complete Python backend response
  createdAt: Date;
  updatedAt: Date;
}

const verificationAnswerSchema = new Schema<IVerificationAnswer>(
  {
    questionId: {
      type: Number,
      required: true,
    },
    question: {
      type: String,
      required: true,
    },
    founderAnswer: {
      type: String,
      required: true,
    },
    ownerAnswer: {
      type: String,
      required: true,
    },
    videoKey: {
      type: String,
      required: true,
      default: 'default_video_placeholder',
    },
  },
  { _id: false }
);

const verificationSchema = new Schema<IVerification>(
  {
    foundItemId: {
      type: Schema.Types.ObjectId,
      ref: 'FoundItem',
      required: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    ownerLostRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'LostRequest',
      default: null,
      index: true,
    },
    ownerLostDescription: {
      type: String,
      default: null,
      trim: true,
    },
    foundItemSnapshot: {
      type: Schema.Types.Mixed,
      default: null,
    },
    answers: {
      type: [verificationAnswerSchema],
      required: true,
      validate: {
        validator: function (v: IVerificationAnswer[]) {
          return v.length > 0;
        },
        message: 'At least one answer is required',
      },
    },
    status: {
      type: String,
      enum: ['pending', 'passed', 'failed'],
      default: 'pending',
    },
    similarityScore: {
      type: Number,
      default: null,
    },
    founderNotificationSentAt: {
      type: Date,
      default: null,
    },
    pythonVerificationResult: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying
verificationSchema.index({ foundItemId: 1, ownerId: 1 });
verificationSchema.index({ status: 1, createdAt: -1 });
verificationSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

// Auto-collect fine-tuning data when verification status is resolved
verificationSchema.post('save', async function (doc: IVerification) {
  if (doc.status === 'pending') return;
  try {
    // Dynamic import to avoid circular dependency
    const finetuning = await import('../services/finetuningService');

    // Phase 1: Collect embedding training pair (only for passed)
    if (doc.status === 'passed') {
      const result = await finetuning.collectPairFromVerification(doc._id.toString());
      if (result.collected) {
        console.log(`🧠 Fine-tuning pair auto-collected for verification ${doc._id}`);
      }
    }

    // Phase 2: Log verification result to Python (passed AND failed)
    await finetuning.logVerificationToPython(doc);

    // Phase 2: Send feedback to Python RL agent + embedding pair collector
    await finetuning.sendFeedbackToPython(doc);
  } catch (err) {
    // Non-blocking — don't let fine-tuning break the verification flow
    console.error('Fine-tuning hook failed (non-blocking):', err);
  }
});

export const Verification = mongoose.model<IVerification>('Verification', verificationSchema);
