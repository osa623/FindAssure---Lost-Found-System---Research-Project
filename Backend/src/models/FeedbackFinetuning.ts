import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFeedbackFinetuning extends Document {
  pairId: string;
  verificationId: Types.ObjectId;
  foundItemId: Types.ObjectId;
  lostRequestId?: Types.ObjectId | null;
  anchor: string;       // lost description
  positive: string;     // found description
  category: string;
  source: string;
  syncedToTraining: boolean; // whether written to embedding_training_pairs
  createdAt: Date;
  updatedAt: Date;
}

const feedbackFinetuningSchema = new Schema<IFeedbackFinetuning>(
  {
    pairId: {
      type: String,
      required: true,
      unique: true,
    },
    verificationId: {
      type: Schema.Types.ObjectId,
      ref: 'Verification',
      required: true,
      index: true,
    },
    foundItemId: {
      type: Schema.Types.ObjectId,
      ref: 'FoundItem',
      required: true,
    },
    lostRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'LostRequest',
      default: null,
    },
    anchor: {
      type: String,
      required: true,
    },
    positive: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
      default: '',
    },
    source: {
      type: String,
      default: 'verification_pass',
    },
    syncedToTraining: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

feedbackFinetuningSchema.index({ verificationId: 1 }, { unique: true });
feedbackFinetuningSchema.index({ syncedToTraining: 1 });

export const FeedbackFinetuning = mongoose.model<IFeedbackFinetuning>(
  'FeedbackFinetuning',
  feedbackFinetuningSchema
);
