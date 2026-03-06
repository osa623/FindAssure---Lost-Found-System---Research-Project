from datetime import datetime
from flask import Flask, request, jsonify
import os
import json
import uuid
import tempfile
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from pymongo import MongoClient
from bson import ObjectId
import requests

from video_to_text import extract_text
from local_nlp_checker import LocalNLP
from gemini_batch_checker import gemini_batch_similarity

MONGO_URI = os.getenv("MONGO_URI")
SUSPICION_SERVICE_URL = os.getenv("PYTHON_SUSPICION_BACKEND_URL", "http://127.0.0.1:5005")

client = MongoClient(MONGO_URI)
db = client["findassure"]

users_col = db["users"]
verification_col = db["verification_sessions"]
behavior_col = db["behavior_sessions"]
app = Flask(__name__)
nlp = LocalNLP()

TMP_DIR = tempfile.gettempdir()
MAX_WORKERS = 5


# -----------------------------
def classify_status(score):
    if score >= 0.70:
        return "match"
    if score >= 0.40:
        return "partial_match"
    return "mismatch"


def to_percent(v):
    return None if v is None else f"{int(round(v * 100))}%"


def extract_face_score(face_confidence_result):
    if not face_confidence_result:
        return None
    videos = face_confidence_result.get("videos", [])
    overalls = []
    for v in videos:
        try:
            overalls.append(float(v.get("overall")))
        except Exception:
            continue
    if not overalls:
        return None
    return sum(overalls) / len(overalls)

def build_user_selector(owner_id):
    owner_id = str(owner_id).strip()
    selectors = [{"firebaseUid": owner_id}]
    if ObjectId.is_valid(owner_id):
        selectors.append({"_id": ObjectId(owner_id)})
    return {"$or": selectors}


def touch_owner(owner_id):
    selector = build_user_selector(owner_id)
    now = datetime.utcnow()

    result = users_col.update_one(
        selector,
        {"$set": {"last_seen_at": now}}
    )

    if result.matched_count == 0:
        print(f"Warning: user not found for owner_id={owner_id}. Skipping user profile update.")
        return

    users_col.update_one(
        {**selector, "risk_level": {"$exists": False}},
        {"$set": {"risk_level": "low"}}
    )
    users_col.update_one(
        {**selector, "flags": {"$exists": False}},
        {"$set": {"flags": []}}
    )


def trigger_suspicion_async(data, saved_paths):
    expected_keys = []
    for a in data.get("answers", []):
        key = a.get("video_key")
        if key:
            expected_keys.append(str(key))

    if not expected_keys:
        expected_keys = list(saved_paths.keys())

    files_payload = []
    for key in expected_keys:
        path = saved_paths.get(key)
        if not path or not os.path.exists(path):
            continue
        try:
            with open(path, "rb") as f:
                content = f.read()
            files_payload.append((key, (os.path.basename(path), content, "video/mp4")))
        except Exception as e:
            print(f"Warning: failed preparing suspicion upload for {key}: {e}")

    if not files_payload:
        print("Suspicion trigger skipped: no video files to forward.")
        return

    form_data = {"data": json.dumps(data)}

    def _run():
        try:
            r = requests.post(
                f"{SUSPICION_SERVICE_URL}/analyze-suspicion",
                data=form_data,
                files=files_payload,
                timeout=60
            )
            print(f"Suspicion trigger status={r.status_code}")
            if r.status_code >= 400:
                print(f"Suspicion service error ({r.status_code}): {r.text}")
        except Exception as e:
            print(f"Error calling suspicion analysis service: {e}")

    threading.Thread(target=_run, daemon=True).start()


# -----------------------------
@app.route("/verify-owner", methods=["POST"])
def verify_owner():
    start_time = time.time()
    saved_paths = {}
    try:
        if "data" not in request.form:
            return jsonify({"error": "Missing data field"}), 400

        try:
            data = json.loads(request.form["data"])
        except Exception:
            return jsonify({"error": "Invalid JSON in data"}), 400

        owner_id = data.get("owner_id")
        category = data.get("category")
        answers = data.get("answers", [])

        if not owner_id:
            return jsonify({"error": "owner_id required"}), 400

        if not answers:
            return jsonify({"error": "No answers provided"}), 400

        print(f"Starting verification for {len(answers)} answers...")

        # -----------------------------
        # Save all files once so they can be reused by multiple stages.
        # -----------------------------
        for a in answers:
            key = a["video_key"]
            if key not in request.files:
                return jsonify({"error": f"Missing file: {key}"}), 400
            file = request.files[key]
            path = os.path.join(TMP_DIR, f"{uuid.uuid4().hex}_{file.filename}")
            file.save(path)
            saved_paths[key] = path

        # Trigger behavior analysis in parallel for direct calls to :5000.
        trigger_suspicion_async(data, saved_paths)

        # -----------------------------
        # FACE CONFIDENCE (ANTI-SPOOF)
        # -----------------------------
        face_confidence_result = None
        face_check_status = "not_provided"
        face_check_error = None
        face_keys = [key for key in request.files if key.startswith("owner_answer_")]
        if face_keys:
            try:
                face_confidence_result = analyze_face_confidence_from_paths(
                    [saved_paths[k] for k in face_keys if k in saved_paths]
                )
                face_check_status = "completed"
            except Exception as e:
                face_check_status = "failed"
                face_check_error = str(e)
                print(f"Face confidence check failed: {face_check_error}")
        else:
            print("Warning: No face videos provided. Face confidence was not evaluated.")

        # -----------------------------
        # VIDEO -> TEXT (PARALLEL)
        # -----------------------------
        def process_single_video(answer_data):
            key = answer_data["video_key"]
            video_path = saved_paths.get(key)

            try:
                owner_text = extract_text(video_path)
                if not owner_text or not owner_text.strip():
                    print(f"Warning: Empty transcript for {key} (question {answer_data.get('question_id')})")
                return {
                    "question_id": answer_data["question_id"],
                    "founder_answer": answer_data["founder_answer"],
                    "owner_answer": owner_text,
                    "success": True
                }
            except Exception as e:
                print(f"Error processing {key}: {str(e)}")
                return {
                    "question_id": answer_data.get("question_id", 0),
                    "founder_answer": answer_data.get("founder_answer", ""),
                    "owner_answer": "[Processing Error]",
                    "error": str(e),
                    "success": False
                }
            finally:
                if video_path and os.path.exists(video_path):
                    os.remove(video_path)
                saved_paths[key] = None

        enriched = []
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_map = {
                executor.submit(process_single_video, answer): answer
                for answer in answers
            }
            for future in as_completed(future_map):
                enriched.append(future.result())

        enriched.sort(key=lambda x: x["question_id"])

        video_processing_time = time.time() - start_time
        print(f"Video processing completed in {video_processing_time:.2f}s (parallel)")

        failed_count = sum(1 for item in enriched if not item.get("success", True))
        if failed_count:
            print(f"Warning: {failed_count} video(s) failed to process")

        # -----------------------------
        # GEMINI BATCH
        # -----------------------------
        gemini_payload = [
            {
                "question": f"Question {x['question_id']}",
                "founder": x["founder_answer"],
                "owner": x["owner_answer"]
            }
            for x in enriched
        ]

        gemini = gemini_batch_similarity(gemini_payload)
        gemini_failed = isinstance(gemini, dict) and "error" in gemini

        if gemini_failed:
            gemini_details = []
            gemini_recommendation = "LOCAL_NLP_ONLY"
            error_msg = gemini.get("message", "Gemini API unavailable")

            if "quota" in error_msg.lower() or "429" in str(error_msg):
                gemini_reasoning = (
                    "Using Local NLP verification only (Gemini API quota exceeded). "
                    "Results are based on sentence similarity analysis."
                )
            else:
                gemini_reasoning = (
                    "Using Local NLP verification only (Gemini AI unavailable). "
                    "Results are based on sentence similarity analysis."
                )

            print(f"Gemini API failed: {error_msg}. Fallback to Local NLP only.")
        else:
            gemini_details = gemini.get("matchDetails", []) if isinstance(gemini, dict) else []
            gemini_recommendation = gemini.get("recommendation") if isinstance(gemini, dict) else None
            gemini_reasoning = gemini.get("reasoning") if isinstance(gemini, dict) else None

        # -----------------------------
        # LOCAL NLP + FUSION
        # -----------------------------
        results = []
        final_scores = []

        for i, a in enumerate(enriched):
            local = nlp.score_pair(
                a["founder_answer"],
                a["owner_answer"]
            )

            local_score = float(local["fused"])
            gem_score = None

            if i < len(gemini_details):
                try:
                    gem_score = gemini_details[i]["similarityScore"] / 100.0
                except Exception:
                    gem_score = None

            # Rule 1: trust Gemini directly when very confident.
            if gem_score is None:
                fused = local_score
            elif gem_score >= 0.80:
                fused = gem_score
            else:
                fused = (local_score * 0.5) + (gem_score * 0.5)

            final_scores.append(fused)

            results.append({
                "question_id": a["question_id"],
                "founder_answer": a["founder_answer"],
                "owner_transcript": a["owner_answer"],
                "local_score": to_percent(local_score),
                "gemini_score": to_percent(gem_score),
                "final_similarity": to_percent(fused),
                "status": classify_status(fused),
                "gemini_analysis": gemini_details[i].get("analysis")
                if i < len(gemini_details) and isinstance(gemini_details[i], dict) else None
            })

        semantic_avg_final = sum(final_scores) / len(final_scores)
        face_score = extract_face_score(face_confidence_result)
        face_decision = (
            face_confidence_result.get("final_decision")
            if isinstance(face_confidence_result, dict) else None
        )
        has_missing_face_video = False
        if isinstance(face_confidence_result, dict):
            has_missing_face_video = any(
                isinstance(v, dict) and v.get("label") == "face_not_detected"
                for v in face_confidence_result.get("videos", [])
            )

        # Final confidence combines semantic verification and face confidence.
        # If face score is unavailable, keep semantic score only.
        if face_score is None:
            avg_final = semantic_avg_final
        else:
            avg_final = (semantic_avg_final * 0.75) + (face_score * 0.25)

        # Rule 2: reject if any single question is critically low.
        min_score = min(final_scores)
        has_zero_match = min_score <= 0.25

        if has_zero_match:
            is_owner = False
            rejection_reason = (
                f"Critical failure: Question {final_scores.index(min_score) + 1} has "
                f"{to_percent(min_score)} similarity (<=25%). Owner failed at least one "
                "critical question."
            )
        else:
            if has_missing_face_video:
                is_owner = False
                rejection_reason = (
                    "Critical failure: Face not detected in at least one required answer video."
                )
            elif face_decision == "possible_thief":
                is_owner = False
                rejection_reason = (
                    "Critical failure: Face analysis marked this session as possible_thief."
                )
            elif face_score is not None and face_score < 0.55:
                is_owner = False
                rejection_reason = (
                    f"Face confidence too low ({to_percent(face_score)} < 55%)."
                )
            else:
                is_owner = avg_final >= 0.70
                rejection_reason = None

        total_time = time.time() - start_time
        print(f"Total verification time: {total_time:.2f}s")

        touch_owner(owner_id)

        verification_col.insert_one({
            "owner_id": owner_id,
            "category": category,
            "created_at": datetime.utcnow(),

            "final_confidence": avg_final,
            "semantic_confidence": semantic_avg_final,
            "face_confidence_score": face_score,
            "face_decision": face_decision,
            "is_absolute_owner": is_owner,
            "has_zero_match_question": has_zero_match,
            "minimum_question_score": min_score,
            "rejection_reason": rejection_reason,
            "verification_mode": "local_nlp_only" if gemini_failed else "gemini_enhanced",
            "processing_time_seconds": round(total_time, 2),
            "video_processing_time_seconds": round(video_processing_time, 2),

            "face_confidence": face_confidence_result,
            "face_check_status": face_check_status,
            "face_check_error": face_check_error,

            "answers": [
                {
                    "question_id": r["question_id"],
                    "final_similarity": r["final_similarity"],
                    "status": r["status"]
                } for r in results
            ],
            "AI_recommendations": {
                "recommendation": gemini_recommendation,
                "reasoning": gemini_reasoning,
                "per_question_analysis": [
                    {
                        "question_id": r["question_id"],
                        "analysis": r.get("gemini_analysis")
                    }
                    for r in results
                ]
            },

            "flags": {
                "semantic_inconsistency": semantic_avg_final < 0.7,
                "critical_zero_match": has_zero_match,
                "missing_face_video": has_missing_face_video,
                "suspicious_face_pattern": face_decision == "possible_thief",
                "low_face_confidence": (face_score is not None and face_score < 0.55),
                "face_not_evaluated": face_check_status != "completed"
            }
        })

        return jsonify({
            "owner_id": owner_id,
            "category": category,
            "final_confidence": to_percent(avg_final),
            "semantic_confidence": to_percent(semantic_avg_final),
            "face_confidence_score": to_percent(face_score),
            "face_decision": face_decision,
            "is_absolute_owner": is_owner,
            "has_zero_match_question": has_zero_match,
            "minimum_question_score": to_percent(min_score),
            "rejection_reason": rejection_reason,
            "results": results,
            "gemini_recommendation": gemini_recommendation,
            "gemini_reasoning": gemini_reasoning,
            "verification_mode": "local_nlp_only" if gemini_failed else "gemini_enhanced",
            "processing_time_seconds": round(total_time, 2),
            "video_processing_time_seconds": round(video_processing_time, 2),
            "face_confidence": face_confidence_result,
            "face_check_status": face_check_status,
            "face_check_error": face_check_error,
        })
    except Exception as e:
        print(f"Unhandled /verify-owner error: {str(e)}")
        return jsonify({"error": "Internal verification error", "details": str(e)}), 500
    finally:
        for p in saved_paths.values():
            if p and os.path.exists(p):
                os.remove(p)


def analyze_face_confidence_from_paths(video_paths):
    """
    Wrapper that calls the face confidence analyzer using already-saved
    file paths, avoiding the double-consumption bug of file streams.
    """
    from bifi.video_utils import extract_frames
    from bifi.feature_extractor import FeatureExtractor
    from bifi.truthfulness_scorer import TruthfulnessScorer

    extractor = FeatureExtractor()
    scorer = TruthfulnessScorer()

    results = []
    suspicious_count = 0
    scored_count = 0

    for idx, path in enumerate(video_paths, start=1):
        try:
            frames = extract_frames(path, max_frames=8)
            if not frames:
                raise ValueError("Could not extract frames")

            emotions = []
            mesh_vecs = []

            for f in frames:
                em = extractor.extract_emotion(f)
                if em:
                    emotions.append(em)

                mesh = extractor.extract_mesh_features(f)
                if mesh is not None:
                    mesh_vecs.append(mesh)

            if not mesh_vecs:
                raise ValueError("Face not detected")

            if len(mesh_vecs) == 1:
                mesh_vecs *= 2

            if not emotions:
                emotions = ["neutral"] * len(mesh_vecs)

            score = scorer.score_video(emotions, mesh_vecs)
            scored_count += 1

            if score["label"] == "suspicious":
                suspicious_count += 1

            results.append({
                "video_id": f"video{idx}",
                **score
            })
        except Exception as e:
            # Keep per-video failure without aborting full face stage.
            results.append({
                "video_id": f"video{idx}",
                "label": "face_not_detected",
                "error": str(e)
            })

    if scored_count == 0:
        raise ValueError("Face not detected in any video")
    elif suspicious_count >= 2:
        final = "possible_thief"
    elif suspicious_count == 1:
        final = "uncertain"
    else:
        final = "not_thief"

    return {
        "videos": results,
        "final_decision": final
    }


if __name__ == "__main__":
    app.run(debug=False, use_reloader=False, threaded=True, port=5000)
