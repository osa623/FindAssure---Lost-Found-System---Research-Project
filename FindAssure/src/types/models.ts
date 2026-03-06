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

export interface FoundItem {
  _id: string;
  imageUrl: string;
  category: string;
  description: string;
  questions: string[];        // Questions chosen by founder (5 questions)
  founderAnswers: string[];   // Founder's text answers - DO NOT SHOW to owner in UI
  founderContact: FounderContact;
  found_location: LocationDetail[]; // Array of location details
  status: 'available' | 'pending_verification' | 'claimed';
  createdAt: string;
  updatedAt?: string;
}

export interface LostItem {
  _id: string;
  userId: string;
  category: string;
  description: string;
  location: string;
  confidenceLevel: number;
  status: 'searching' | 'found' | 'closed';
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
  
  // Founder Flow
  ReportFoundStart: undefined;
  ReportFoundDetails: { imageUri: string };
  ReportFoundQuestions: { imageUri: string; category: string; description: string };
  ReportFoundAnswers: { imageUri: string; category: string; description: string; selectedQuestions: string[] };
  ReportFoundLocation: { 
    imageUri: string; 
    category: string; 
    description: string; 
    selectedQuestions: string[]; 
    founderAnswers: string[] 
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
