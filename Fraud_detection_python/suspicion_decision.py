def compute_suspicion_score(features):
    """
    Weighted linear risk model (transparent & explainable)
    """

    weights = {
        "eye_contact_ratio": -0.6,      # good behavior reduces suspicion
        "look_away_ratio": 0.7,
        "face_missing_ratio": 0.9,
        "avg_video_duration": -0.1
    }

    bias = 0.4  # baseline risk

    score = bias
    for k, w in weights.items():
        score += w * features.get(k, 0)

    # clamp to [0,1]
    score = max(0.0, min(1.0, score))

    return score


def is_suspicious(score, threshold=0.55):
    return score >= threshold
