import json
import os
import cv2
import numpy as np
import mediapipe as mp
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename

# Internal modules
from fraud_summary import analyze_fraud_for_owner
from suspicion_decision import compute_suspicion_score, is_suspicious
from xai_explainer import explain_with_shap
from gemini_reasoner import gemini_reason

from pymongo import MongoClient
from datetime import datetime

MONGO_URI = os.getenv("MONGO_URI")

client = MongoClient(MONGO_URI)
db = client["fraud_detection_db"]

owners_col = db["owners"]
verification_col = db["verification_sessions"]
behavior_col = db["behavior_sessions"]

# =====================================================
# CONFIG
# =====================================================
UPLOAD_FOLDER = "uploads"
ALLOWED_EXTENSIONS = {"mp4", "avi", "mov", "mkv"}
FPS_ASSUMED = 30

MAX_HEAD_ANGLE = 15
MIN_EYE_OPENNESS = 0.2
FRAME_SKIP = 2

# =====================================================
# APP
# =====================================================
app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# =====================================================
# MEDIAPIPE
# =====================================================
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=False,
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)

LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380]
RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144]

# =====================================================
# HELPERS
# =====================================================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS



def calculate_ear(eye):
    A = np.linalg.norm(eye[1] - eye[5])
    B = np.linalg.norm(eye[2] - eye[4])
    C = np.linalg.norm(eye[0] - eye[3])
    return (A + B) / (2.0 * C)

def touch_owner(owner_id):
    owners_col.update_one(
        {"owner_id": owner_id},
        {
            "$setOnInsert": {
                "created_at": datetime.utcnow(),
                "risk_level": "low",
                "flags": []
            },
            "$set": {
                "last_seen_at": datetime.utcnow()
            }
        },
        upsert=True
    )

# =====================================================
# VIDEO ANALYSIS
# =====================================================
def analyze_video(video_path):
    cap = cv2.VideoCapture(video_path)

    results = {
        "total_frames": 0,
        "eye_contact_frames": 0,
        "look_away_frames": 0,
        "face_not_detected_frames": 0,
    }

    frame_number = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_number += 1
        if frame_number % FRAME_SKIP != 0:
            continue

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        output = face_mesh.process(rgb)

        if not output.multi_face_landmarks:
            results["face_not_detected_frames"] += 1
            results["total_frames"] += 1
            continue

        lm = output.multi_face_landmarks[0].landmark
        h, w, _ = frame.shape
        pts = [(int(p.x * w), int(p.y * h)) for p in lm]

        left_eye = np.array([pts[i] for i in LEFT_EYE_INDICES])
        right_eye = np.array([pts[i] for i in RIGHT_EYE_INDICES])

        left_ear = calculate_ear(left_eye)
        right_ear = calculate_ear(right_eye)

        eyes_open = left_ear > MIN_EYE_OPENNESS and right_ear > MIN_EYE_OPENNESS

        if eyes_open:
            results["eye_contact_frames"] += 1
        else:
            results["look_away_frames"] += 1

        results["total_frames"] += 1

    cap.release()
    return results


# =====================================================
# FEATURE ENGINEERING
# =====================================================
def compute_features(summary):
    tf = summary["total_frames"]

    return {
        "eye_contact_ratio": summary["eye_contact_frames"] / tf,
        "look_away_ratio": summary["look_away_frames"] / tf,
        "face_missing_ratio": summary["face_not_detected_frames"] / tf,
        "videos_analyzed": summary["videos_analyzed"],
        "avg_video_duration": (tf / FPS_ASSUMED) / summary["videos_analyzed"],
    }


# =====================================================
# API
# =====================================================
@app.route("/analyze-suspicion", methods=["POST"])
def analyze_suspicion():

    if "data" not in request.form:
        return jsonify({"error": "Missing data field"}), 400

    try:
        data = json.loads(request.form["data"])
    except Exception:
        return jsonify({"error": "Invalid JSON in data"}), 400

    owner_id = data.get("owner_id")
    if not owner_id:
        return jsonify({"error": "owner_id required"}), 400

    # -------------------------------------------------
    # Collect videos
    # -------------------------------------------------
    video_files = [
        request.files[k]
        for k in request.files
        if k.startswith("owner_answer_")
    ]

    if not video_files:
        return jsonify({"error": "No owner answer videos provided"}), 400

    # -------------------------------------------------
    # Per-video + summary
    # -------------------------------------------------
    per_video_results = []

    summary = {
        "videos_analyzed": 0,
        "total_frames": 0,
        "eye_contact_frames": 0,
        "look_away_frames": 0,
        "face_not_detected_frames": 0,
    }

    for idx, file in enumerate(video_files):
        if not allowed_file(file.filename):
            continue

        filename = secure_filename(file.filename)
        path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(path)

        result = analyze_video(path)
        os.remove(path)

        if result["total_frames"] == 0:
            continue

        per_video_results.append({
            "video_key": f"owner_answer_{idx}",
            "duration_seconds": round(result["total_frames"] / FPS_ASSUMED, 1),
            "eye_contact_pct": f"{round(result['eye_contact_frames'] / result['total_frames'],1) * 100}%",
            "look_away_pct": f"{round(result['look_away_frames'] / result['total_frames'],1) * 100}%",
            "face_missing_pct": f"{round(result['face_not_detected_frames'] / result['total_frames'],1) * 100}%",
        })

        summary["videos_analyzed"] += 1
        summary["total_frames"] += result["total_frames"]
        summary["eye_contact_frames"] += result["eye_contact_frames"]
        summary["look_away_frames"] += result["look_away_frames"]
        summary["face_not_detected_frames"] += result["face_not_detected_frames"]

    if summary["total_frames"] == 0:
        return jsonify({"error": "No valid frames processed"}), 400

    # -------------------------------------------------
    # Decision + XAI
    # -------------------------------------------------
    features = compute_features(summary)
    suspicion_score = compute_suspicion_score(features)
    suspicious = is_suspicious(suspicion_score)

    xai = explain_with_shap(features, suspicion_score)

    gemini_explanation = gemini_reason(
        owner_id=owner_id,
        features=features,
        decision=suspicious,
        xai=xai,
    )
    
    touch_owner(owner_id)

    behavior_col.insert_one({
        "owner_id": owner_id,
        "created_at": datetime.utcnow(),

        "videos_analyzed": summary["videos_analyzed"],
        "avg_video_duration": features["avg_video_duration"],

        "features": {
            "eye_contact_ratio": features["eye_contact_ratio"],
            "look_away_ratio": features["look_away_ratio"],
            "face_missing_ratio": features["face_missing_ratio"]
        },

        "suspicion_score": suspicion_score,
        "is_suspicious": suspicious,

        "xai": {
            "positive": xai["top_positive_factors"],
            "negative": xai["top_negative_factors"]
        },

         "AI_explanation": {
        "behavior_summary": gemini_explanation,
        "decision": "suspicious" if suspicious else "normal"
        },


        "per_video": per_video_results
    })



    return jsonify({
        "owner": {
            "owner_id": owner_id,
            "videos_analyzed": summary["videos_analyzed"]
        },

        "decision": {
            "is_suspicious": suspicious,
            "suspicion_score": f"{suspicion_score * 100:.2f}%",
        },

        "features": {
            "eye_contact_ratio": f"{round(features['eye_contact_ratio'],1) * 100}%",
            "look_away_ratio": f"{round(features['look_away_ratio'],1) * 100}%",
            "face_missing_ratio": f"{round(features['face_missing_ratio'],1) * 100}%",
            "avg_video_duration_seconds": f"{round(features['avg_video_duration'],1)}s",
        },

        "xai": {
            "baseline_risk": xai["baseline_risk"],
            "final_score": xai["final_score"],
            "negative_contributors": [
                {"feature": k, "contribution": v}
                for k, v in xai["top_negative_factors"]
            ],
            "positive_contributors": [
                {"feature": k, "contribution": v}
                for k, v in xai["top_positive_factors"]
            ]
        },

        "video_analysis": {
            "per_video": per_video_results,
            "aggregate_frames": summary
        },
         "explanation": gemini_explanation
        
    })

# =====================
# API: ONE OWNER
# =====================
@app.route("/fraud-summary/<owner_id>", methods=["GET"])
def fraud_summary(owner_id):
    owner_id = owner_id.strip().lower()
    result = analyze_fraud_for_owner(owner_id,owners_col, verification_col, behavior_col)

    if not result:
        return jsonify({"error": "Owner not found"}), 404

    return jsonify(result)


# =====================
# API: ALL OWNERS
# =====================
@app.route("/fraud-summary-all", methods=["GET"])
def fraud_summary_all():
    results = []

    for o in owners_col.find({}, {"owner_id": 1}):
        r = analyze_fraud_for_owner(o["owner_id"], owners_col, verification_col, behavior_col)
        if r:
            results.append(r)

    return jsonify({
        "generated_at": datetime.utcnow(),
        "total_owners": len(results),
        "results": results
    })
# =====================================================
# RUN
# =====================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005, debug=True)
