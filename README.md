# FindAssure - Smart Lost & Found System

> **AI-Powered Lost and Found Platform for University Campuses**

## 📖 Project Overview

FindAssure is a Smart Lost and Found System designed for university campuses, initially targeting SLIIT Marakech Campus (10-20 buildings). The system uses AI, machine learning, and NLP to reunite lost items with owners through intelligent matching and video-based verification.

**Key Capabilities:**
- AI-powered image recognition and categorization
- Smart question generation for ownership verification  
- NLP-based description and location matching
- Video-based verification with dual-layer validation
- Fraud detection and admin oversight
- Optional anonymous reporting for finders

---

## 🔄 System Workflow

### 1. Found Item Submission
```
Finder Finds Item
    ↓
Upload Image → AI Recognition (YOLOv8m, Florence-2)
    ↓
System Generates 10 Questions
    ↓
Finder Selects & Answers 5 Questions
    ↓
Enter Location (Building/Floor/Room) + Finder Details
    ↓
Item Saved to Database (Available for Matching)
```

### 2. Lost Item Search & Matching
```
Owner Logs In
    ↓
Create Lost Request (Category, Description, Location, Confidence)
    ↓
System Runs Matching Algorithm:
  - NLP Description Similarity (60% weight)
  - Location-Based Matching (40% weight)
    ↓
Display Ranked Results by Match Score
```

### 3. Ownership Verification
```
Owner Selects Item to Claim
    ↓
System Shows 5 Verification Questions
    ↓
Owner Records 5-Second Video Answer for Each Question
    ↓
System Processes Videos:
  - Extracts Audio → Speech-to-Text
  - NLP Checker (40%) + Gemini AI (60%)
    ↓
If Score ≥ 70% → ✅ Verified → Show Finder Details
If Score < 70% → ❌ Failed → Log Fraud Attempt
```

### 4. Fraud Detection
```
Continuous Monitoring:
  - Low verification scores
  - Rapid item claiming
  - Abandoned claims
  - Abnormal patterns
    ↓
Calculate Fraud Score
    ↓
If High Risk → Alert Admin Dashboard
```

---

## 📁 Repository Structure

```
FindAssure---Lost-Found-System---Research-Project/
│
├── 📂 Backend/                                    # Node.js/Express REST API
│   ├── src/
│   │   ├── controllers/                          # Request handlers
│   │   ├── models/                               # MongoDB schemas
│   │   ├── services/                             # Business logic (Gemini, matching)
│   │   ├── middleware/                           # Auth, error handling
│   │   └── routes/                               # API endpoints
│   └── package.json
│
├── 📂 FindAssure/                                 # React Native Mobile App (Expo)
│   ├── app/                                      # Expo Router screens
│   ├── src/
│   │   ├── screens/                              # UI screens (Finder/Owner flows)
│   │   ├── components/                           # Reusable components
│   │   ├── api/                                  # API client
│   │   └── navigation/                           # App navigation
│   └── package.json
│
├── 📂 WebApp/                                     # React Admin Dashboard (Vite)
│   ├── src/
│   │   ├── pages/                                # Dashboard pages
│   │   ├── components/                           # UI components
│   │   ├── services/                             # API integration
│   │   └── context/                              # State management
│   └── package.json
│
├── 📂 Image-Processing-&-Object-Recognition-Pipeline/  # FastAPI AI Vision Service
│   ├── app/
│   │   ├── main.py                               # FastAPI entry point
│   │   ├── services/
│   │   │   ├── unified_pipeline.py               # Main processing pipeline
│   │   │   ├── yolo_service.py                   # YOLOv8m detection
│   │   │   ├── florence_service.py               # Florence-2 VLM
│   │   │   ├── gemini_reasoner.py                # Gemini reasoning
│   │   │   └── dino_embedder.py                  # DINOv2 embeddings
│   │   └── models/                               # Pre-trained models
│   └── requirements.txt
│
├── 📂 Similarity_python/                          # Flask NLP Verification Service
│   ├── app.py                                    # Flask API
│   ├── local_nlp_checker.py                      # spaCy NLP verification
│   ├── gemini_batch_checker.py                   # Gemini AI verification
│   └── requirement.txt
│
├── 📂 Sugestion_python/                           # Flask Location Matching Service
│   ├── app.py                                    # Flask API
│   ├── building_location_matcher.py              # Building-level matching
│   ├── ground_location_matcher.py                # Floor/room-level matching
│   └── data/                                     # Location data (buildings, floors, rooms)
│
├── 📂 Suggestion_UI/                              # React Suggestion Interface (Vite)
│   └── src/                                      # Suggestion UI components
│
├── 📂 AI-Powered-Semantic-Machine-and-Data-Modeling-Engine/  # Semantic Engine
│   ├── app/                                      # Application code
│   ├── data/                                     # Data storage (indices, models)
│   └── scripts/                                  # Training & utility scripts
│
└── 📄 README.md                                   # This file
```

### Component Ports

| Component | Type | Port | Purpose |
|-----------|------|------|---------|
| Backend | Node.js/Express | 5001 | Main REST API |
| FindAssure | React Native | - | Mobile app (iOS/Android) |
| WebApp | React/Vite | 5173 | Admin dashboard |
| Image Processing | FastAPI | 8000 | AI vision pipeline |
| Similarity | Flask | 5000 | NLP verification |
| Suggestion | Flask | 5002 | Location matching |

---

## 🚀 Setup & Installation

### Prerequisites
- Node.js 18+, Python 3.9+
- MongoDB Atlas account
- Firebase project (Auth & Storage)
- Google Gemini API key
- Cloudinary account

### Quick Start

```bash
# Clone repository
git clone https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project.git
cd FindAssure---Lost-Found-System---Research-Project
```

#### 1. Backend Setup
```bash
cd Backend
npm install
cp .env.example .env  # Configure with your credentials
npm run dev  # Runs on http://localhost:5001
```

**Required .env variables:**
```env
MONGODB_URI=your_mongodb_connection_string
FIREBASE_PROJECT_ID=your_project_id
GEMINI_API_KEY=your_gemini_key
CLOUDINARY_CLOUD_NAME=your_cloudinary_name
PYTHON_SIMILARITY_SERVICE_URL=http://localhost:5000
IMAGE_PROCESSING_SERVICE_URL=http://localhost:8000
```

#### 2. Mobile App (FindAssure)
```bash
cd FindAssure
npm install
npm start  # Start Expo dev server
```

#### 3. Admin Dashboard (WebApp)
```bash
cd WebApp
npm install
npm run dev  # Runs on http://localhost:5173
```

#### 4. Python Services
```bash
# Image Processing Service
cd Image-Processing-&-Object-Recognition-Pipeline
python -m venv venv
venv\Scripts\activate  # Windows | source venv/bin/activate (Mac/Linux)
pip install -r requirements.txt
python run_server.py  # Port 8000

# NLP Similarity Service
cd Similarity_python
pip install -r requirement.txt
python -m spacy download en_core_web_lg
python app.py  # Port 5000

# Location Matching Service
cd Sugestion_python
pip install -r requirements.txt
python app.py  # Port 5002
```

### Running All Services

Open 6 terminals and run:
1. **Backend:** `cd Backend && npm run dev`
2. **Image Processing:** `cd Image-Processing-&-Object-Recognition-Pipeline && python run_server.py`
3. **Similarity Service:** `cd Similarity_python && python app.py`
4. **Location Service:** `cd Sugestion_python && python app.py`
5. **Web App:** `cd WebApp && npm run dev`
6. **Mobile App:** `cd FindAssure && npm start`

---

### 🎬 Running the Complete System

**Terminal 1: Backend**
```bash
cd Backend
npm run dev
# ✅ Backend running on http://localhost:5001
```

**Terminal 2: Image Processing Service**
```bash
cd Image-Processing-&-Object-Recognition-Pipeline
venv\Scripts\activate  # or source venv/bin/activate
python run_server.py
# ✅ Vision API running on http://localhost:8000
```

**Terminal 3: Similarity Service**
```bash
cd Similarity_python
venv\Scripts\activate
python app.py
# ✅ NLP Service running on http://localhost:5000
```

**Terminal 4: Suggestion Service**
```bash
cd Sugestion_python
venv\Scripts\activate
python app.py
# ✅ Location Service running on http://localhost:5002
```

**Terminal 5: Web App**
```bash
cd WebApp
npm run dev
# ✅ Admin Dashboard running on http://localhost:5173
```

**Terminal 6: Mobile App**
```bash
cd FindAssure
npm start
# ✅ Expo Dev Server running
# Scan QR code with Expo Go app on your phone
```

### ✅ Verification Checklist

After setup, verify all services are running:

- [ ] Backend API: http://localhost:5001
- [ ] Image Processing: http://localhost:8000
- [ ] Similarity Service: http://localhost:5000
- [ ] Suggestion Service: http://localhost:5002
- [ ] Web App: http://localhost:5173
- [ ] Mobile App: Expo running
- [ ] MongoDB connected
- [ ] Firebase configured
- [ ] Gemini API working
- [ ] Cloudinary working

**Test Backend Health:**
```bash
curl http://localhost:5001/health
# Expected: {"status": "ok", "timestamp": "..."}
```

**Test Image Processing:**
```bash
curl http://localhost:8000/
# Expected: {"status": "Vision Core Backend is running"}
```

---

## 🔀 Development & Pull Request History

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make commits
git commit -m "Clear description of changes"

# Push and create PR
git push origin feature/your-feature-name
```

### Merged Pull Requests

| Date | PR # | Branch | Summary |
|------|------|--------|---------|
| 2026-02-17 | [#47](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/47) | Dev-Stable | Dev stable |
| 2026-02-16 | [#46](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/46) | Dev-Stable | Add image pipeline & normalize logs |
| 2026-02-11 | [#44](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/44) | AI-Powered-Semantic-Machine-and-Data-Modeling-Engine | AI powered semantic machine and data modeling engine |
| 2026-02-10 | [#43](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/43) | FindAssure-Dev | Find assure dev |
| 2026-02-10 | [#41](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/41) | AI-Powered-Semantic-Machine-and-Data-Modeling-Engine | Temp changes |
| 2026-02-10 | [#38](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/38) | main | Updating the dev branch with main codebase |
| 2026-02-10 | [#37](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/37) | FindAssure-Dev | Merged AI-Powered-Semantic-Machine branch |
| 2026-01-10 | [#36](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/36) | get-answers-from-video-capture-from-mobile | Final readme updated |
| 2026-01-09 | [#35](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/35) | get-answers-from-video-capture-from-mobile | Readme updated v2 |
| 2026-01-09 | [#34](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/34) | get-answers-from-video-capture-from-mobile | Readme PR log |
| 2026-01-09 | [#33](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/33) | get-answers-from-video-capture | README documentation updated |
| 2026-01-09 | [#32](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/32) | get-answers-from-video-capture | Fixed project file structure |
| 2026-01-07 | [#29](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/29) | Image-Processing-Pipeline | Image processing pipeline implemented |
| 2026-01-07 | [#28](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/28) | get-answers-from-video-capture | Mobile video capture feature |
| 2026-01-06 | [#26](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/26) | Suggestion_UI | Confidence stages with emoji indicators |
| 2026-01-05 | [#25](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/25) | question-answers-similarity | Improved similarity accuracy |
| 2026-01-05 | [#24](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/24) | Suggestion_UI | System documentation added |
| 2026-01-05 | [#23](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/23) | Suggestion_UI | Suggestion UI implemented |
| 2026-01-05 | [#22](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/22) | Suggestion_UI | Location picker enhanced |
| 2026-01-05 | [#21](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/21) | question-answers-similarity | Mobile app improvements |
| 2026-01-05 | [#20](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/20) | question-answers-similarity | Claimed item display |
| 2026-01-05 | [#19](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/19) | question-answers-similarity | Ownership calculation enhanced |
| 2026-01-05 | [#18](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/18) | Secure-Handover | Founder details display after verification |
| 2026-01-04 | [#17](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/17) | Secure-Handover | Web interface improved |
| 2026-01-03 | [#16](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/16) | Suggestion_UI | Suggestion UI improvements |
| 2026-01-03 | [#15](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/15) | Suggestion_UI | UI enhancements |
| 2026-01-03 | [#14](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/14) | Secure-Handover | Secure handover web UI |
| 2026-01-03 | [#13](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/13) | Secure-Handover | Secure handover implemented |
| 2025-12-31 | [#12](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/12) | FindAssure-Dev | Mobile app development |
| 2025-12-31 | [#11](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/11) | AI-Semantic-Engine | AI semantic modeling engine |
| 2025-12-25 | [#10](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/10) | Secure-Handover | Secure handover functionality |
| 2025-12-24 | [#9](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/9) | Image-Processing-Pipeline | Unified image analysis pipeline |
| 2025-12-24 | [#8](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/8) | Image-Processing-Pipeline | Gemini evidence extraction |
| 2025-12-24 | [#7](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/7) | Image-Processing-Pipeline | Image processing pipeline |
| 2025-12-23 | [#6](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/6) | Image-Processing-Pipeline | Image recognition pipeline |
| 2025-12-23 | [#5](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/5) | Image-Processing-Pipeline | FastAPI backend initialized |
| 2025-12-23 | [#4](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/4) | Image-Processing-Pipeline | Project structure initialized |
| 2025-12-20 | [#3](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/3) | Secure-Handover | Secure handover feature |
| 2025-12-04 | [#2](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/2) | Secure-Handover | Secure handover feature |
| 2025-12-03 | [#1](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pull/1) | Secure-Handover | Initial secure handover |

---

## 📚 Additional Resources

- **Backend Documentation:** [Backend/README.md](Backend/README.md)
- **Mobile App Guide:** [FindAssure/PROJECT_DOCUMENTATION.md](FindAssure/PROJECT_DOCUMENTATION.md)
- **Web App Docs:** [WebApp/WEB_README.md](WebApp/WEB_README.md)
- **Image Processing:** [Image-Processing-&-Object-Recognition-Pipeline/OVERVIEW.md](Image-Processing-&-Object-Recognition-Pipeline/OVERVIEW.md)
- **CORS Guide:** [CORS_FIX_GUIDE.md](CORS_FIX_GUIDE.md)

---

## 📞 Contact & Support

**Repository:** [FindAssure on GitHub](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project)  
**Issues:** [Report Issues](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/issues)  
**Pull Requests:** [View PRs](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/pulls)

**Research Project:** SLIIT Final Year Project 2025/2026  
**Institution:** Sri Lanka Institute of Information Technology

---

<div align="center">

**Made with ❤️ by the FindAssure Team**

[Report Bug](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/issues) • [Request Feature](https://github.com/LSYDananjaya/FindAssure---Lost-Found-System---Research-Project/issues)

</div>

