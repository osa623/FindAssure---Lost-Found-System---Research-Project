import numpy as np
from collections import Counter

class TruthfulnessScorer:
    def __init__(self):
        self.jitter_low = 0.008
        self.jitter_mid = 0.015
        self.blink_low = 0.2
        self.blink_mid = 0.4
        self.emotion_weight = 0.6
        self.behavior_weight = 0.4

    def _dist(self, a, b):
        return np.linalg.norm(a - b)

    def _compute_eye_mar(self, mesh_reshaped):
        left_outer, left_inner = 33, 133
        left_top, left_bottom = 159, 145
        right_outer, right_inner = 263, 362
        right_top, right_bottom = 386, 374
        mouth_left, mouth_right = 61, 291
        mouth_top, mouth_bottom = 13, 14

        def safe(idx1, idx2):
            try:
                return self._dist(mesh_reshaped[idx1], mesh_reshaped[idx2])
            except:
                return 0.0

        L_vert = safe(left_top, left_bottom)
        L_horz = safe(left_outer, left_inner) + 1e-6
        R_vert = safe(right_top, right_bottom)
        R_horz = safe(right_outer, right_inner) + 1e-6

        left_ear = L_vert / L_horz
        right_ear = R_vert / R_horz

        M_vert = safe(mouth_top, mouth_bottom)
        M_horz = safe(mouth_left, mouth_right) + 1e-6
        mar = M_vert / M_horz

        return (left_ear + right_ear) / 2, mar

    def score_video(self, emotions, mesh_vecs):
        # ---------- Emotion Score ----------
        emotion_map = {
            "neutral": 0.90, "happy": 0.85,
            "sad": 0.65, "angry": 0.55,
            "disgust": 0.50, "surprise": 0.45,
            "fear": 0.40
        }

        if not emotions:
            emotions = ["neutral"]

        emotion_vals = [emotion_map.get(e, 0.70) for e in emotions]
        emotion_score = np.mean(emotion_vals)

        # Stability penalty
        if len(set(emotions)) > 3:
            emotion_score -= 0.15
        elif len(set(emotions)) > 2:
            emotion_score -= 0.10

        emotion_score = max(0, min(1, emotion_score))

        # ---------- Behavior Score ----------
        mesh_stack = np.stack(mesh_vecs)
        jitter = float(np.mean(np.std(mesh_stack, axis=0)))

        ears, mars = [], []
        for v in mesh_vecs:
            resh = v.reshape((-1, 3))
            ear, mar = self._compute_eye_mar(resh)
            ears.append(ear)
            mars.append(mar)

        med_ear = np.median(ears)
        blink_thresh = med_ear * 0.55
        blinks = sum(1 for e in ears if e < blink_thresh)
        blink_rate = blinks / len(ears)

        mar_var = np.var(mars)

        # jitter score
        if jitter < self.jitter_low:
            jitter_score = 0.95
        elif jitter < self.jitter_mid:
            jitter_score = 0.75
        else:
            jitter_score = 0.45

        # blink score
        if blink_rate < self.blink_low:
            blink_score = 0.95
        elif blink_rate < self.blink_mid:
            blink_score = 0.75
        else:
            blink_score = 0.45

        # mouth tension
        if mar_var < 1e-5:
            mouth_score = 0.95
        elif mar_var < 5e-5:
            mouth_score = 0.80
        else:
            mouth_score = 0.60

        behavior_score = (
            0.45 * jitter_score +
            0.35 * blink_score +
            0.20 * mouth_score
        )

        # ---------- Final Score ----------
        final = (self.emotion_weight * emotion_score) + \
                (self.behavior_weight * behavior_score)

        if final >= 0.80:
            label = "truthful"
        elif final >= 0.55:
            label = "uncertain"
        else:
            label = "suspicious"

        return {
            "emotion_score": round(emotion_score,3),
            "behavior_score": round(behavior_score,3),
            "overall": round(final,3),
            "label": label,
            "diagnostics": {
                "jitter": jitter,
                "blink_rate": blink_rate,
                "mar_var": mar_var,
                "dominant_emotions": emotions
            }
        }
