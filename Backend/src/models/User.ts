import mongoose, { Schema, Document } from 'mongoose';

// Only 'owner' and 'admin' roles - founders don't need to register
export type UserRole = 'owner' | 'admin';

export interface IUser extends Document {
  firebaseUid: string;
  name?: string;
  email: string;
  phone?: string;
  role: UserRole;
  isSuspended: boolean;
  suspendedAt?: Date | null;
  suspendedUntil?: Date | null;
  suspensionMode?: '3d' | '7d' | 'manual' | null;
  suspensionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}


const userSchema = new Schema<IUser>(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin'],
      default: 'owner',
    },
    isSuspended: {
      type: Boolean,
      default: false,
      index: true,
    },
    suspendedAt: {
      type: Date,
      default: null,
    },
    suspendedUntil: {
      type: Date,
      default: null,
    },
    suspensionMode: {
      type: String,
      default: null,
    },
    suspensionReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model<IUser>('User', userSchema);
