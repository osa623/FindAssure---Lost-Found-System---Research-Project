import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ILostRequest extends Document {
  ownerId: Types.ObjectId;
  category: string;
  description: string;
  owner_location: string;
  floor_id?: string | null;
  hall_name?: string | null;
  owner_location_confidence_stage: number; // 1: Pretty Sure, 2: Sure, 3: Not Sure, 4: Do not remember surely
  matchedFoundItemIds?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const lostRequestSchema = new Schema<ILostRequest>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    owner_location: {
      type: String,
      required: true,
      trim: true,
    },
    floor_id: {
      type: String,
      default: null,
    },
    hall_name: {
      type: String,
      default: null,
    },
    owner_location_confidence_stage: {
      type: Number,
      required: true,
      min: 1,
      max: 4,
      default: 2, // Default to "Sure"
    },
    matchedFoundItemIds: {
      type: [Schema.Types.ObjectId],
      ref: 'FoundItem',
      default: [],
    },
  },
  {
    timestamps: true,
  }
);


// Index for efficient querying by owner
lostRequestSchema.index({ ownerId: 1, createdAt: -1 });

export const LostRequest = mongoose.model<ILostRequest>('LostRequest', lostRequestSchema);
