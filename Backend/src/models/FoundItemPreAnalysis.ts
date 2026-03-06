import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFoundItemPreAnalysis extends Document {
  token: string;
  createdBy?: Types.ObjectId;
  imageCount: number;
  analysisMode?: 'pp1' | 'pp2' | null;
  pythonItemId?: string | null;
  faissId?: number | null;
  faissIds: number[];
  detectedCategory?: string | null;
  detectedDescription?: string | null;
  detectedColor?: string | null;
  vector128: number[];
  searchable: boolean;
  pipelineResponse?: Record<string, unknown> | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const foundItemPreAnalysisSchema = new Schema<IFoundItemPreAnalysis>(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    imageCount: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
    },
    analysisMode: {
      type: String,
      enum: ['pp1', 'pp2'],
      default: null,
    },
    pythonItemId: {
      type: String,
      default: null,
    },
    faissId: {
      type: Number,
      default: null,
    },
    faissIds: {
      type: [Number],
      default: [],
    },
    detectedCategory: {
      type: String,
      default: null,
    },
    detectedDescription: {
      type: String,
      default: null,
    },
    detectedColor: {
      type: String,
      default: null,
    },
    vector128: {
      type: [Number],
      default: [],
    },
    searchable: {
      type: Boolean,
      default: false,
    },
    pipelineResponse: {
      type: Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  }
);

export const FoundItemPreAnalysis = mongoose.model<IFoundItemPreAnalysis>(
  'FoundItemPreAnalysis',
  foundItemPreAnalysisSchema
);
