def explain_with_shap(features, score):
    """
    Model-agnostic SHAP-style contribution explanation
    """

    baseline = 0.4
    contributions = {}

    weights = {
        "eye_contact_ratio": -0.6,
        "look_away_ratio": 0.7,
        "face_missing_ratio": 0.9,
        "avg_video_duration": -0.1
    }

    for k, w in weights.items():
        contributions[k] = round(w * features.get(k, 0), 4)

    explanation = {
        "baseline_risk": baseline,
        "feature_contributions": contributions,
        "final_score": round(score, 4),
        "top_positive_factors": sorted(
            contributions.items(),
            key=lambda x: x[1],
            reverse=True
        )[:2],
        "top_negative_factors": sorted(
            contributions.items(),
            key=lambda x: x[1]
        )[:2]
    }

    return explanation
