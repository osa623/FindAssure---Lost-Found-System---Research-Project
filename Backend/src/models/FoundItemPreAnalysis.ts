import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFoundItemPreAnalysis extends Document {
  token: string;
  taskId?: string | null;
  createdBy?: Types.ObjectId;
  imageCount: number;
  analysisMode?: 'pp1' | 'pp2' | null;
  pythonItemId?: string | null;
  faissId?: number | null;
  faissIds: number[];
  detectedCategory?: string | null;
  detectedDescription?: string | null;
  detailedDescription?: string | null;
  detectedColor?: string | null;
  ocrText?: string | null;
  ocrTextDisplay?: string | null;
  categoryDetails?: {
    features: string[];
    defects: string[];
    attachments: string[];
  } | null;
  descriptionEvidenceUsed?: {
    summary: string[];
    detailed: string[];
  } | null;
  descriptionFiltersApplied?: string[];
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
    taskId: {
      type: String,
      default: null,
      index: {
        unique: true,
        sparse: true,
      },
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
    detailedDescription: {
      type: String,
      default: null,
    },
    detectedColor: {
      type: String,
      default: null,
    },
    ocrText: {
      type: String,
      default: null,
    },
    ocrTextDisplay: {
      type: String,
      default: null,
    },
    categoryDetails: {
      type: Schema.Types.Mixed,
      default: null,
    },
    descriptionEvidenceUsed: {
      type: Schema.Types.Mixed,
      default: null,
    },
    descriptionFiltersApplied: {
      type: [String],
      default: [],
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
