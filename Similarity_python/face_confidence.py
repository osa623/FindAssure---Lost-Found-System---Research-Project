# face_confidence.py
import os, uuid
from bifi.video_utils import extract_frames
from bifi.feature_extractor import FeatureExtractor
from bifi.truthfulness_scorer import TruthfulnessScorer

extractor = FeatureExtractor()
scorer = TruthfulnessScorer()

UPLOAD_DIR = "uploads/temp"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def analyze_face_confidence(video_files):
    """
    video_files: list of Werkzeug FileStorage objects
    returns: dict with per-video scores + final decision
    """

    results = []
    suspicious_count = 0

    for idx, video in enumerate(video_files, start=1):
        file_id = f"{uuid.uuid4()}.mp4"
        path = os.path.join(UPLOAD_DIR, file_id)
        video.save(path)

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

            if score["label"] == "suspicious":
                suspicious_count += 1

            results.append({
                "video_id": f"video{idx}",
                **score
            })
        finally:
            # BUG FIX: Always clean up the temp file after processing.
            # Previously these files were never deleted, causing disk leaks.
            if os.path.exists(path):
                os.remove(path)

    if suspicious_count >= 2:
        final = "possible_thief"
    elif suspicious_count == 1:
        final = "uncertain"
    else:
        final = "not_thief"

    return {
        "videos": results,
        "final_decision": final
    }