import mongoose, { Document, Schema, Types } from 'mongoose';

export type FounderPrefillPipelineSyncStatus = 'pending' | 'synced' | 'failed';

export interface IFounderPrefillFeedback extends Document {
  foundItemId: Types.ObjectId;
  createdBy?: Types.ObjectId | null;
  preAnalysisToken: string;
  taskId?: string | null;
  analysisMode?: 'pp1' | 'pp2' | null;
  pythonItemId?: string | null;
  imageCount: number;
  imageUrls: string[];
  predictedCategory?: string | null;
  predictedDescription?: string | null;
  predictedColor?: string | null;
  analysisEvidence?: Record<string, unknown> | null;
  finalExtractedColor?: string | null;
  finalCategory: string;
  finalDescription: string;
  categoryChanged: boolean;
  descriptionChanged: boolean;
  acceptedAsIs: boolean;
  pipelineAnalyticsVersion?: string | null;
  changeMetrics?: Record<string, unknown> | null;
  comparisonEvidence?: Record<string, unknown> | null;
  multiviewVerification?: Record<string, unknown> | null;
  pipelineSyncStatus: FounderPrefillPipelineSyncStatus;
  pipelineSyncAttempts: number;
  pipelineSyncedAt?: Date | null;
  pipelineLastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const founderPrefillFeedbackSchema = new Schema<IFounderPrefillFeedback>(
  {
    foundItemId: {
      type: Schema.Types.ObjectId,
      ref: 'FoundItem',
      required: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    preAnalysisToken: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    taskId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    analysisMode: {
      type: String,
      enum: ['pp1', 'pp2'],
      default: null,
    },
    pythonItemId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    imageCount: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
    },
    imageUrls: {
      type: [String],
      default: [],
    },
    predictedCategory: {
      type: String,
      default: null,
      trim: true,
    },
    predictedDescription: {
      type: String,
      default: null,
      trim: true,
    },
    predictedColor: {
      type: String,
      default: null,
      trim: true,
    },
    analysisEvidence: {
      type: Schema.Types.Mixed,
      default: null,
    },
    finalExtractedColor: {
      type: String,
      default: null,
      trim: true,
    },
    finalCategory: {
      type: String,
      required: true,
      trim: true,
    },
    finalDescription: {
      type: String,
      required: true,
      trim: true,
    },
    categoryChanged: {
      type: Boolean,
      required: true,
      default: false,
    },
    descriptionChanged: {
      type: Boolean,
      required: true,
      default: false,
    },
    acceptedAsIs: {
      type: Boolean,
      required: true,
      default: false,
    },
    pipelineAnalyticsVersion: {
      type: String,
      default: null,
      trim: true,
    },
    changeMetrics: {
      type: Schema.Types.Mixed,
      default: null,
    },
    comparisonEvidence: {
      type: Schema.Types.Mixed,
      default: null,
    },
    multiviewVerification: {
      type: Schema.Types.Mixed,
      default: null,
    },
    pipelineSyncStatus: {
      type: String,
      enum: ['pending', 'synced', 'failed'],
      default: 'pending',
      index: true,
    },
    pipelineSyncAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    pipelineSyncedAt: {
      type: Date,
      default: null,
    },
    pipelineLastError: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

founderPrefillFeedbackSchema.index({ createdAt: -1 });
founderPrefillFeedbackSchema.index({ pipelineSyncStatus: 1, createdAt: -1 });
founderPrefillFeedbackSchema.index({ foundItemId: 1, preAnalysisToken: 1 }, { unique: true });

export const FounderPrefillFeedback = mongoose.model<IFounderPrefillFeedback>(
  'FounderPrefillFeedback',
  founderPrefillFeedbackSchema
);
