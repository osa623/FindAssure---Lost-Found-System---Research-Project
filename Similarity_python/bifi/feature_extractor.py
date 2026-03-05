from deepface import DeepFace
import numpy as np
import cv2
import mediapipe as mp

class FeatureExtractor:
    def __init__(self):
        self.mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            refine_landmarks=True,
            max_num_faces=1
        )

    def extract_emotion(self, frame):
        try:
            analysis = DeepFace.analyze(
                frame, actions=["emotion"], enforce_detection=False
            )
            return analysis.get("dominant_emotion")
        except:
            return None

    def extract_mesh_features(self, frame):
        try:
            result = self.mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if not result.multi_face_landmarks:
                return None
            lm = result.multi_face_landmarks[0].landmark
            return np.array([[p.x, p.y, p.z] for p in lm]).flatten()
        except:
            return None
