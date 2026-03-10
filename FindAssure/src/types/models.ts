// TypeScript type definitions for Lost & Found System

export interface User {
  _id: string;
  name: string;
  email: string;
  phone: string;
  role: 'owner' | 'admin'; // Only owners and admins register
  isSuspended?: boolean;
  suspendedAt?: string | null;
  suspendedUntil?: string | null;
  suspensionMode?: '3d' | '7d' | 'manual' | null;
  suspensionReason?: string | null;
  isSuspicious?: boolean;
  suspiciousSeverity?: 'none' | 'warning' | 'critical';
  fraudRiskScore?: number;
  fraudRiskLevel?: 'low' | 'medium' | 'high';
  fraudReasons?: string[];
  fraudFlags?: string[];
  suspiciousReason?: string | null;
  suspiciousBehaviorCount?: number;
  suspiciousBehaviorEvents?: Array<{
    created_at?: string;
    suspicion_score?: number;
    face_missing_ratio?: number;
    look_away_ratio?: number;
    top_negative_factors?: string[];
    ai_behavior_summary?: string;
  }>;
  createdAt: string;
  updatedAt?: string;
}

export interface FounderContact {
  name: string;
  email: string;
  phone: string;
}

export interface LocationDetail {
  location: string;
  floor_id?: string | null;
  hall_name?: string | null;
}

export interface SelectedImageAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface FounderImagePreAnalysisResponse {
  status: 'queued' | 'processing' | 'ok' | 'manual_fallback' | 'failed';
  taskId?: string;
  preAnalysisToken?: string | null;
  analysisMode?: 'pp1' | 'pp2';
  imageCount?: number;
  analysisPathLabel?: string;
  analysisSummary?: string;
  retryAfterMs?: number;
  stageKey?: string | null;
  stageLabel?: string | null;
  stageMessage?: string | null;
  detectedCategory?: string | null;
  detectedDescription?: string | null;
  detailedDescription?: string | null;
  detectedColor?: string | null;
  searchable?: boolean;
  message?: string;
}

export interface FoundItem {
  _id: string;
  imageUrl: string;
  category: string;
  description: string;
  questions: string[];
  founderAnswers?: string[];
  founderContact?: FounderContact;
  found_location: LocationDetail[]; // Array of location details
  status: 'available' | 'pending_verification' | 'claimed';
  imageMatch?: {
    score: number;
  } | null;
  createdAt: string;
  updatedAt?: string;
}

export interface LostItem {
  _id: string;
  ownerId: string;
  category: string;
  description: string;
  owner_location: string;
  floor_id?: string | null;
  hall_name?: string | null;
  owner_location_confidence_stage: number;
  matchedFoundItemIds?: string[];
  ownerImageUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface VerificationAnswer {
  questionId: number;
  question: string;
  founderAnswer?: string;  // Only visible to admin
  ownerAnswer: string;
  videoKey: string;
}

export interface OwnerAnswerInput {
  questionId: number;
  answer: string;
  videoKey?: string;
  videoUri?: string; // Local video file URI for mobile app
}

export interface VerificationRequest {
  _id: string;
  foundItemId: string;
  ownerId: string;
  answers: VerificationAnswer[];
  status: 'pending' | 'passed' | 'failed';
  similarityScore?: number | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminOverview {
  totalUsers: number;
  totalFoundItems: number;
  totalLostRequests: number;
  pendingVerifications: number;
}

// Auth types
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  phone: string;
  password: string;
  // Role is always 'owner' for new registrations
}

export interface AuthResponse {
  user: User;
  token: string;
}

// Navigation types
export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  Profile: undefined;
  Settings: undefined;
  FAQ: undefined;
  
  // Founder Flow
  ReportFoundStart: undefined;
  ReportFoundDetails: {
    images: SelectedImageAsset[];
    preAnalysisToken?: string | null;
    category?: string;
    description?: string;
    analysisMessage?: string;
  };
  ReportFoundQuestions: {
    images: SelectedImageAsset[];
    preAnalysisToken?: string | null;
    category: string;
    description: string;
  };
  ReportFoundAnswers: {
    images: SelectedImageAsset[];
    preAnalysisToken?: string | null;
    category: string;
    description: string;
    selectedQuestions: string[];
    suggestedAnswersByQuestion?: Record<string, string>;
  };
  ReportFoundLocation: { 
    images: SelectedImageAsset[];
    preAnalysisToken?: string | null;
    category: string;
    description: string;
    selectedQuestions: string[];
    founderAnswers: string[];
  };
  ReportFoundSuccess: undefined;
  
  // Owner Flow
  FindLostStart: undefined;
  FindLostResults: { foundItems: FoundItem[] };
  ItemDetail: { foundItem: FoundItem };
  AnswerQuestionsVideo: { foundItem: FoundItem };
  VerificationPending: undefined;
  VerificationResult: { verificationId: string };
  
  // Admin Flow
  AdminLogin: undefined;
  AdminDashboard: undefined;
  AdminItemDetail: { foundItem: FoundItem };
  AdminUsers: undefined;
};
