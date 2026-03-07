# FindAssure — Lost & Found System

> A research project providing an AI-powered lost and found system for institutional environments (e.g., a university campus). The system connects **Founders** (people who find items) with **Owners** (people who lost items) through an intelligent verification pipeline that uses video answers, semantic search, similarity scoring, and fraud detection.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [User Roles](#2-user-roles)
3. [Mobile App — Flow & Screens](#3-mobile-app--flow--screens)
   - [Onboarding](#31-onboarding)
   - [Home Screen](#32-home-screen)
   - [Authentication Flow](#33-authentication-flow)
   - [Founder Flow — Reporting a Found Item](#34-founder-flow--reporting-a-found-item)
   - [Owner Flow — Finding a Lost Item](#35-owner-flow--finding-a-lost-item)
   - [Admin Flow](#36-admin-flow)
4. [Node.js Backend — Architecture & Flow](#4-nodejs-backend--architecture--flow)
   - [Server Setup](#41-server-setup)
   - [Database Models](#42-database-models)
   - [API Routes Reference](#43-api-routes-reference)
   - [Authentication Middleware](#44-authentication-middleware)
   - [AI & External Service Integrations](#45-ai--external-service-integrations)
5. [Python Microservices](#5-python-microservices)
6. [End-to-End Verification Pipeline](#6-end-to-end-verification-pipeline)
7. [Configuration](#7-configuration)
8. [Running the System](#8-running-the-system)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FindAssure Mobile App                     │
│            (React Native / Expo — iOS & Android)             │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP (REST API)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               Node.js / Express Backend  :5001               │
│   Firebase Auth  │  MongoDB  │  Cloudinary  │  Gemini AI    │
└──────┬──────────────────┬────────────────┬──────────────────┘
       │                  │                │
       ▼                  ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Similarity  │  │  Suggestion  │  │Image Process │
│  Python :5000│  │  Python :5004│  │  Python      │
│ (Video NLP + │  │ (Location    │  │  Pipeline    │
│  Face Check) │  │  Matching)   │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│     Fraud Detection Python :5005     │
│  (Suspicion Analysis + Gemini XAI)   │
└──────────────────────────────────────┘
```

**Technology Stack:**

| Layer | Technology |
|---|---|
| Mobile App | React Native, Expo, TypeScript |
| Navigation | React Navigation (Stack Navigator) |
| Auth (client) | Firebase Auth (Email/Password) |
| State | React Context API |
| HTTP Client | Axios |
| Backend | Node.js, Express, TypeScript |
| Auth (server) | Firebase Admin SDK (token verification) |
| Database | MongoDB (Mongoose ODM) |
| File Storage | Cloudinary (item images + verification videos) |
| AI Questions | Google Gemini 2.5 Flash |
| Semantic Search | Python FastAPI (AI-Powered Semantic Engine) |
| Similarity | Python (NLP + face confidence scoring) |
| Location Match | Python (location/floor/hall matching) |
| Fraud Detection | Python + Gemini (suspicion scoring) |

---

## 2. User Roles

| Role | Description | Registration Required |
|---|---|---|
| **Founder** | A person who finds a lost item and reports it | No — anonymous submission allowed |
| **Owner** | A person who lost an item and searches for it | Yes — Firebase + MongoDB account |
| **Admin** | System administrator who oversees verifications | Yes — assigned by existing admin |

---

## 3. Mobile App — Flow & Screens

### 3.1 Onboarding

**Screen:** `OnboardingScreen`

- Shown **only once** on first launch, tracked via `AsyncStorage`.
- Introduces the app's purpose and two main actions: "I Found Something" and "I Lost Something".
- After viewing, a flag `hasSeenOnboarding = true` is saved so the user goes directly to Home on future launches.

```
App Launch
    │
    ▼
AsyncStorage.getItem('hasSeenOnboarding')
    │
    ├── false / null ──► OnboardingScreen ──► Home
    │
    └── true ──────────► Home
```

---

### 3.2 Home Screen

**Screen:** `HomeScreen`

The central hub of the app. Two primary actions:

| Button | Destination | Who Uses It |
|---|---|---|
| "I Found Something" | `ReportFoundStart` | Founders (no login required) |
| "I Lost Something" | `FindLostStart` | Owners (login required) |

A profile icon in the header navigates to `Profile` if logged in, or `Login` if not.

---

### 3.3 Authentication Flow

All auth screens are in `src/screens/auth/`. The backend is Firebase Auth on the client side, with a mirror user record in MongoDB.

```
Login Screen
    │
    ├── Enter email + password
    ├── Firebase signInWithEmailAndPassword()
    ├── GET /api/auth/login  (sends Firebase ID token)
    │       └── Backend verifies token, returns MongoDB user
    └── User stored in AuthContext

Register Screen
    │
    ├── Enter name, email, phone, password
    ├── Firebase createUserWithEmailAndPassword()
    ├── POST /api/auth/register  (sends Firebase ID token + user details)
    │       └── Backend creates MongoDB user with role: 'owner'
    └── Redirect to Home

Forgot Password Screen
    │
    └── Firebase sendPasswordResetEmail()

Profile Screen
    │
    ├── View current user info (name, email, phone, role)
    ├── Edit profile details
    │       └── PATCH /api/auth/me
    └── Sign Out
            └── Firebase signOut() + clear AuthContext
```

**Account Suspension:** If a user is suspended by an admin, the backend returns HTTP 403 with a `suspendedUntil` date. The app displays a descriptive message and prevents login.

---

### 3.4 Founder Flow — Reporting a Found Item

No registration required. A founder goes through a **6-step wizard**:

```
[Step 1] ReportFoundStartScreen
    │  Enter founder contact info: name, email, phone number
    ▼
[Step 2] ReportFoundDetailsScreen
    │  Upload a photo of the item (camera or gallery)
    │  Select item category (Electronics, Clothing, Accessories, etc.)
    │  Write a description of the found item
    ▼
[Step 3] ReportFoundQuestionsScreen
    │  POST /api/items/generate-questions  ──► Gemini AI generates 10
    │  verification questions based on category + description
    │  (e.g., "What color is the strap?", "Any scratches on the screen?")
    ▼
[Step 4] ReportFoundAnswersScreen
    │  Founder answers each of the 10 AI-generated questions
    │  (These answers are stored privately — owners cannot see them)
    ▼
[Step 5] ReportFoundLocationScreen
    │  Select where the item was found:
    │    - Building / location name
    │    - Floor ID (optional)
    │    - Hall name (optional)
    │  Supports multiple location entries
    ▼
[Step 6] ReportFoundSuccessScreen
    │  POST /api/items/found  — submits all data to backend
    │  Image uploaded to Cloudinary
    └  Confirmation screen with item ID
```

**Data collected from founder:**
- Contact info (name, email, phone)
- Item image (uploaded to Cloudinary)
- Category + description
- 10 AI-generated questions
- Founder's private answers to those 10 questions
- Found location(s) with optional floor/hall details

---

### 3.5 Owner Flow — Finding a Lost Item

Requires login. The owner goes through a **search and verification** pipeline:

```
[Step 1] FindLostStartScreen
    │  Describe the lost item (free text)
    │  Select category
    │  Specify where they lost it (location, floor, hall)
    │  Select location confidence:
    │      1 = Pretty Sure | 2 = Sure | 3 = Not Sure | 4 = Don't remember
    │
    │  POST /api/items/lost  ──► Creates LostRequest in MongoDB
    │  POST semantic search  ──► Python Semantic Engine matches descriptions
    │  POST /api/locations/find-items ──► Python location matcher filters by location
    ▼
[Step 2] FindLostResultsScreen
    │  Displays matched found items (images, category, location, date)
    │  Items are ranked by combined semantic + location score
    ▼
[Step 3] ItemDetailScreen
    │  View full details of a specific found item:
    │    - Photo, category, description, found location, date
    │    - Founder contact info is hidden until verification passes
    │  "Claim This Item" button
    ▼
[Step 4] AnswerQuestionsVideoScreen
    │  Owner sees the same 10 questions generated for the item
    │  For each question, owner records a SHORT video answer (≈5 seconds)
    │  Videos are uploaded to Cloudinary
    │
    │  POST /api/items/verification ──► submits answers + video files
    │       ├── Node backend receives videos
    │       ├── Forwards to Python Similarity Service
    │       │     ├── Transcribes owner video using ASR
    │       │     ├── Compares transcript to founder's text answer
    │       │     │     ├── Local NLP similarity score
    │       │     │     └── Gemini AI semantic similarity score
    │       │     └── Face confidence scoring per video
    │       └── Forwards to Python Fraud Detection Service
    │             ├── Suspicion analysis on owner behavior
    │             └── Gemini XAI reasoning for final decision
    ▼
[Step 5] VerificationPendingScreen
    │  Shows that verification is under review
    │  Polls GET /api/items/verification/:id  until status changes
    ▼
[Step 6] VerificationResultScreen
    │
    ├── PASSED: Shows founder contact info (name, email, phone)
    │           Owner can now contact the founder to collect item
    │
    └── FAILED: Shows failure reason
                Owner may try another item
```

---

### 3.6 Admin Flow

Admin has a separate login at `AdminLoginScreen` using the same Firebase Auth. Backend checks `role === 'admin'` before granting access to any admin endpoints.

```
AdminLoginScreen
    │  Login with admin credentials
    ▼
AdminDashboardScreen
    │  Overview statistics:
    │    - Total found items
    │    - Pending verifications
    │    - Total users
    │    - Claimed items count
    │
    ├── "Found Items" tab ──► list of all found items
    │       └── AdminItemDetailScreen
    │               ├── View full item + founder answers (confidential)
    │               ├── Update item status (available / pending / claimed)
    │               └── View linked verifications
    │
    └── "Users" tab ──► AdminUsersScreen
            ├── View all registered users
            ├── Change user role (owner ↔ admin)
            ├── Suspend user (3 days / 7 days / manual)
            ├── Unsuspend user
            └── Delete user (removes from MongoDB + Firebase)
```

---

## 4. Node.js Backend — Architecture & Flow

### 4.1 Server Setup

**File:** `Backend/src/server.ts`

- Starts Express app on port `5001` (default), configurable via `PORT` env var.
- Binds to `0.0.0.0` — accessible from all network interfaces, enabling mobile device access over LAN.
- Connects to MongoDB on startup.
- Initializes Firebase Admin SDK for token verification.
- Logs the local IPv4 address for mobile access.

**File:** `Backend/src/app.ts`

- Configures CORS to allow mobile app (port 8081), Expo dev server (19006), Vite web frontends (3000, 5173).
- Mounts all route groups under `/api/`.
- Provides `GET /health` endpoint for connectivity checks.
- Global error handler via `errorHandler` middleware.

### 4.2 Database Models

#### `User`
Stores registered users (owners and admins only — founders don't register).

| Field | Type | Description |
|---|---|---|
| `firebaseUid` | String | Unique Firebase UID, used to link Firebase Auth to MongoDB |
| `name` | String | Display name |
| `email` | String | Lowercase unique email |
| `phone` | String | Contact phone number |
| `role` | `owner` \| `admin` | User role |
| `isSuspended` | Boolean | Whether account is currently suspended |
| `suspendedUntil` | Date | Suspension expiry date |
| `suspensionMode` | `3d` \| `7d` \| `manual` | How the suspension was applied |
| `suspensionReason` | String | Admin's reason for suspension |

---

#### `FoundItem`
Stores items that have been found and reported.

| Field | Type | Description |
|---|---|---|
| `imageUrl` | String | Cloudinary URL of item photo |
| `category` | String | Item category (Electronics, Clothing, etc.) |
| `description` | String | Founder's description of the item |
| `questions` | String[] | 10 AI-generated verification questions |
| `founderAnswers` | String[] | Founder's private answers (hidden from owners) |
| `founderContact` | Object | `{ name, email, phone }` — revealed only after verification passes |
| `found_location` | Array | `[{ location, floor_id, hall_name }]` — supports multiple locations |
| `status` | `available` \| `pending_verification` \| `claimed` | Item lifecycle state |
| `createdBy` | ObjectId | Optional — links to User if founder was logged in |

---

#### `LostRequest`
Created when an owner searches for a lost item.

| Field | Type | Description |
|---|---|---|
| `ownerId` | ObjectId | Reference to User |
| `category` | String | Reported item category |
| `description` | String | Owner's description of the lost item |
| `owner_location` | String | Where the owner believes they lost it |
| `floor_id` | String | Optional floor identifier |
| `hall_name` | String | Optional hall name |
| `owner_location_confidence_stage` | Number | 1–4 scale: 1=Pretty Sure, 2=Sure, 3=Not Sure, 4=Don't remember |
| `matchedFoundItemIds` | ObjectId[] | IDs of found items the system matched |

---

#### `Verification`
Represents a single ownership claim attempt by an owner for a specific found item.

| Field | Type | Description |
|---|---|---|
| `foundItemId` | ObjectId | Reference to FoundItem |
| `ownerId` | ObjectId | Reference to User |
| `ownerLostRequestId` | ObjectId | Linked lost request (for context) |
| `ownerLostDescription` | String | Description from the linked lost request |
| `foundItemSnapshot` | Object | Snapshot of item data at time of verification |
| `answers` | Array | Per-question: `{ question, founderAnswer, ownerAnswer, videoKey }` |
| `status` | `pending` \| `passed` \| `failed` | Verification outcome |
| `similarityScore` | Number | Computed similarity score (0–1) |
| `pythonVerificationResult` | Object | Full raw response from Python similarity service |

---

### 4.3 API Routes Reference

#### Auth Routes — `/api/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/register` | Firebase token | Register new user, creates MongoDB record |
| POST | `/login` | Firebase token | Verify token, return MongoDB user data |
| GET | `/me` | Bearer token | Get current authenticated user |
| PATCH | `/me` | Bearer token | Update profile (name, phone, etc.) |
| POST | `/register-extra` | Bearer token | Save extra registration info |
| GET | `/claimed-items` | Bearer token | Get all items the user has claimed |

---

#### Item Routes — `/api/items`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/found` | Optional | Submit a new found item report |
| GET | `/found` | Public | List all available found items (owner view — no founder answers) |
| GET | `/found/:id` | Public | Get a single found item by ID |
| POST | `/found/batch` | Public | Get multiple found items by IDs array |
| POST | `/lost` | Optional | Create a lost item search request |
| GET | `/lost/me` | Required | Get current user's lost requests |
| POST | `/generate-questions` | Public | Generate 10 AI questions via Gemini for a given category + description |
| POST | `/verification` | Required | Submit verification (owner answers + video files) |
| GET | `/verification/:id` | Required | Check verification status and result |
| GET | `/verification/me` | Required | Get all verifications submitted by current user |
| GET | `/users` | Public | Get user list (used by suggestion system) |

---

#### Admin Routes — `/api/admin` *(Admin role required)*

| Method | Endpoint | Description |
|---|---|---|
| GET | `/overview` | Dashboard stats (totals, pending counts) |
| GET | `/found-items` | All found items with confidential founder answers visible |
| PATCH | `/found-items/:id` | Update item status |
| GET | `/users` | All registered users |
| PATCH | `/users/:id` | Update user details or role |
| PATCH | `/users/:id/suspension` | Suspend or unsuspend a user |
| DELETE | `/users/:id` | Delete user from MongoDB and Firebase |
| GET | `/verifications` | All verifications with full detail |
| PUT | `/verifications/:id/evaluate` | Manually evaluate a verification |

---

#### Upload Routes — `/api/upload`

Handles direct file uploads to Cloudinary (used for item images and verification videos).

---

#### Location Routes — `/api/locations`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/find-items` | Delegates to Python Location Match Service to filter items by spatial proximity |

---

### 4.4 Authentication Middleware

**File:** `Backend/src/middleware/authMiddleware.ts`

All protected routes pass through `requireAuth`:

```
Incoming request with Authorization: Bearer <Firebase ID Token>
    │
    ▼
Firebase Admin SDK verifyIdToken(token)
    │
    ├── Invalid / expired ──► 401 Unauthorized
    │
    └── Valid ──► Decode uid
            │
            ▼
        MongoDB User.findOne({ firebaseUid: uid })
            │
            ├── Not found ──► 404 User not found
            │
            ├── isSuspended = true ──► 403 Forbidden (with suspendedUntil)
            │
            └── Valid ──► attach user to req.user ──► next()

requireAdmin:
    └── Check req.user.role === 'admin'
            ├── No  ──► 403 Forbidden
            └── Yes ──► next()
```

---

### 4.5 AI & External Service Integrations

#### Google Gemini AI — Question Generation
**Service:** `Backend/src/services/geminiService.ts`

- Model: `gemini-2.5-flash`
- Called on `POST /api/items/generate-questions`
- Given the item's **category** and **description**, Gemini generates exactly **10 short, specific verification questions** that only the true owner could answer accurately (e.g., about markings, accessories, serial numbers, wear patterns).
- Falls back to generic template questions if `GEMINI_API_KEY` is not configured.

---

#### Python Semantic Search Service — `http://127.0.0.1:8001`
**Service:** `Backend/src/services/pythonSearchService.ts`

- Called when an owner submits a lost item search.
- Accepts the owner's text description and category.
- Returns ranked matches from all available found items using NLP semantic similarity.
- Also performs grammar correction on the owner's query.
- Returns: `matches[]` with `id`, `score`, and `reason`.

---

#### Python Location Match Service — `http://127.0.0.1:5004`
**Service:** `Backend/src/services/locationMatchService.ts`

- Called after semantic search to spatially filter and re-rank results.
- Takes the owner's location, floor, hall, confidence stage, and the semantically matched items.
- Returns the final `matched_item_ids[]` that are both semantically and spatially compatible.

---

#### Python Similarity & Verification Service — `http://127.0.0.1:5000`
**Service:** `Backend/src/services/pythonVerificationService.ts`

- Called when an owner submits their video answers for a found item.
- Receives: question answers, owner ID, category, and video files (multipart/form-data).
- For each question:
  - Transcribes the owner's video answer using Automatic Speech Recognition (ASR).
  - Computes **local NLP similarity** between transcript and founder's stored answer.
  - Optionally sends both texts to **Gemini** for semantic similarity scoring.
  - Scores each question: `match` | `partial_match` | `mismatch`.
- Runs a **face confidence check** on the videos.
- Returns: `final_confidence`, `is_absolute_owner`, `gemini_recommendation`, per-question results.

---

#### Python Fraud Detection Service — `http://127.0.0.1:5005`
**Service:** (called alongside verification)

- Performs suspicion analysis on the submitted verification.
- Uses Gemini for explainable AI (XAI) reasoning.
- Returns a suspicion score and decision logic to flag potentially fraudulent claims.

---

## 5. Python Microservices

| Service | Port | Folder | Purpose |
|---|---|---|---|
| Similarity + Verification | 5000 | `Similarity_python/` | ASR transcription, NLP scoring, face confidence, Gemini comparison |
| AI Semantic Search Engine | 8001 | `AI-Powered-Semantic-Machine-and-Data-Modeling-Engine/` | Semantic matching of lost item descriptions to found items |
| Location Match | 5004 | `Sugestion_python/` | Spatial filtering of matched items by location/floor/hall |
| Fraud Detection | 5005 | `Fraud_detection_python/` | Suspicion analysis and XAI fraud reasoning |
| Image Processing | — | `Image-Processing-&-Object-Recognition-Pipeline/` | Object detection and recognition on uploaded item images |

---

## 6. End-to-End Verification Pipeline

This is the core research innovation of FindAssure. When an owner claims a found item:

```
Owner submits video answers
         │
         ▼
Node Backend: POST /api/items/verification
         │
         ├─ Fetch FoundItem from MongoDB
         │   (questions + founder's private answers)
         │
         ├─ Link to owner's LostRequest (for context)
         │
         ├─ Upload videos to Cloudinary
         │
         ├─ Create Verification record (status: pending)
         │
         ├─ Forward to Python Similarity Service (port 5000)
         │     │
         │     ├─ ASR: transcribe each owner video answer
         │     ├─ Local NLP: cosine similarity vs founder answer
         │     ├─ Gemini API: semantic understanding score
         │     ├─ Face confidence: is a real person on camera?
         │     └─ Returns: per-question scores + overall confidence
         │
         ├─ Forward to Fraud Detection Service (port 5005)
         │     ├─ Suspicion scoring on behavior patterns
         │     └─ Returns: suspicion level + Gemini XAI reasoning
         │
         └─ Update Verification record:
               ├─ status: 'passed' ──► reveal founder contact info to owner
               └─ status: 'failed' ──► show failure reason, deny contact
```

**Verification Outcome in the App:**
- `passed`: Owner receives founder's name, email, and phone number to arrange item collection.
- `failed`: Owner sees a reason (wrong answers, low confidence, suspicious behavior) and can try again with a different item.

---

## 7. Configuration

### Backend Environment Variables (`Backend/.env`)

```env
# Server
PORT=5001
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/findassure

# Firebase Admin
FIREBASE_SERVICE_ACCOUNT_KEY=<JSON string of Firebase service account>

# Cloudinary (file storage)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Python Microservices
PYTHON_BACKEND_URL=http://127.0.0.1:5000
PYTHON_SEMANTIC_BACKEND_URL=http://127.0.0.1:8001
LOCATION_MATCH_BACKEND_URL=http://127.0.0.1:5004
PYTHON_SUSPICION_BACKEND_URL=http://127.0.0.1:5005

# CORS
FRONTEND_URL=http://localhost:8081
```

### Mobile App Configuration (`FindAssure/src/config/api.config.ts`)

```typescript
export const API_CONFIG = {
  BACKEND_IP: '192.168.x.x',  // ← Your laptop's WiFi IP address
  BACKEND_PORT: 5001,
  REQUEST_TIMEOUT: 60000,
};
```

> To find your IP: `Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi" | Select-Object IPAddress`

---

## 8. Running the System

### Prerequisites

- Node.js 18+
- Python 3.9+
- MongoDB running locally or Atlas URI
- Expo Go app on iPhone/Android

### Step 1 — Start the Node Backend

```powershell
cd Backend
npm install
npm run dev
```

Backend starts at `http://0.0.0.0:5001`. Accessible from mobile via `http://<YOUR_IP>:5001`.

### Step 2 — Start Python Microservices

```powershell
# Similarity + Verification (port 5000)
cd Similarity_python
python app_for_confident_check.py

# AI Semantic Search Engine (port 8001)
cd AI-Powered-Semantic-Machine-and-Data-Modeling-Engine
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001

# Location Match (port 5004)
cd Sugestion_python
python app_for_check_location.py

# Fraud Detection (port 5005)
cd Fraud_detection_python
python gemini_reasoner.py
```

### Step 3 — Start the Mobile App

```powershell
cd FindAssure
npm install
npx expo start --tunnel   # For physical device over any network
# OR
npx expo start            # For physical device on same WiFi (requires firewall rules)
```

Scan the QR code with the **iPhone Camera app** to open in **Expo Go**.

### Step 4 — Verify Connectivity

```powershell
# Check backend is reachable
curl http://<YOUR_IP>:5001/health
# Expected: {"status":"ok","message":"FindAssure Backend API is running"}
```

### Port Summary

| Service | Port |
|---|---|
| Node.js Backend | 5001 |
| Expo Metro Bundler | 8081 |
| AI Semantic Engine | 8001 |
| Similarity / Verification | 5000 |
| Location Match | 5004 |
| Fraud Detection | 5005 |

---

*FindAssure — Research Project, 2026*
