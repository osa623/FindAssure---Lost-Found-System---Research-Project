import numpy as np
import cv2
import mediapipe as mp
from deepface import DeepFace

class FeatureExtractor:
    def __init__(self):
        self.mesh = mp.solutions.face_mesh.FaceMesh(
            # Process sampled frames independently for more robust per-frame detection.
            static_image_mode=True,
            refine_landmarks=True,
            max_num_faces=1,
            min_detection_confidence=0.4
        )

    def extract_emotion(self, frame):
        try:
            analysis = DeepFace.analyze(
                frame, actions=["emotion"], enforce_detection=False
            )
            if isinstance(analysis, list):
                analysis = analysis[0] if analysis else {}
            if isinstance(analysis, dict):
                return analysis.get("dominant_emotion")
            return None
        except Exception:
            # Keep TensorFlow/DeepFace in the pipeline, but don't fail the whole
            # video when one frame's emotion inference is noisy.
            return None

    def extract_mesh_features(self, frame):
        try:
            # Try multiple orientations because mobile videos may carry rotation metadata
            # that OpenCV does not always apply when decoding frames.
            for candidate in (
                frame,
                cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE),
                cv2.rotate(frame, cv2.ROTATE_180),
                cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE),
            ):
                rgb = cv2.cvtColor(candidate, cv2.COLOR_BGR2RGB)
                result = self.mesh.process(rgb)

                if not result.multi_face_landmarks:
                    # Fallback: upscale small frames to improve landmark detection.
                    h, w = candidate.shape[:2]
                    if min(h, w) < 480:
                        scaled = cv2.resize(
                            candidate,
                            (int(w * 1.5), int(h * 1.5)),
                            interpolation=cv2.INTER_CUBIC
                        )
                        scaled_rgb = cv2.cvtColor(scaled, cv2.COLOR_BGR2RGB)
                        result = self.mesh.process(scaled_rgb)

                if result.multi_face_landmarks:
                    lm = result.multi_face_landmarks[0].landmark
                    return np.array([[p.x, p.y, p.z] for p in lm]).flatten()

            return None
        except Exception:
            return None
