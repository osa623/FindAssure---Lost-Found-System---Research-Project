# =====================
# HELPERS
# =====================
def safe_avg(values):
    return sum(values) / len(values) if values else None


# =====================
# CORE FRAUD ENGINE
# =====================
def analyze_fraud_for_owner(owner_id,owners_col, verification_col, behavior_col):
    owner = owners_col.find_one({"owner_id": owner_id})
    if not owner:
        return None

    verification_sessions = list(
        verification_col.find({"owner_id": owner_id}).sort("created_at", 1)
    )

    behavior_sessions = list(
        behavior_col.find({"owner_id": owner_id}).sort("created_at", 1)
    )

    reasons = []
    risk_score = 0.0

    identity_scores = [v["final_confidence"] for v in verification_sessions]
    behavior_scores = [b["suspicion_score"] for b in behavior_sessions]
    is_suspicious = [b["is_suspicious"] for b in behavior_sessions]


    avg_identity = safe_avg(identity_scores)
    avg_behavior = safe_avg(behavior_scores)

    # -------------------
    # Numeric rules
    # -------------------
    if avg_identity is not None and avg_behavior is not None:
        if avg_behavior - avg_identity > 0.25:
            risk_score += 0.4
            reasons.append(
                "High identity confidence but suspicious behavior"
            )

    if len(behavior_scores) >= 2:
        if behavior_scores[-1] - behavior_scores[0] > 0.3:
            risk_score += 0.3
            reasons.append("Behavioral risk increased over time")

    if len(identity_scores) >= 2:
        if identity_scores[0] - identity_scores[-1] > 0.25:
            risk_score += 0.3
            reasons.append("Identity confidence dropped")

    # -------------------
    # Gemini enrichment
    # -------------------
    if verification_sessions:
        ai = verification_sessions[-1].get("AI_recommendations")
        if ai:
            if ai.get("recommendation"):
                reasons.append(f"AI Identity: {ai['recommendation']}")
            if ai.get("reasoning"):
                reasons.append(f"AI Reasoning: {ai['reasoning']}")

    if behavior_sessions:
        ai = behavior_sessions[-1].get("AI_explanation")
        if ai and ai.get("behavior_summary"):
            reasons.append(f"AI Behavior: {ai['behavior_summary']}")

    # -------------------
    # Finalize
    # -------------------
    risk_score = min(risk_score, 1.0)

    if risk_score >= 0.7:
        level = "high"
    elif risk_score >= 0.4:
        level = "medium"
    else:
        level = "low"

    return {
        "owner_id": owner_id,
        "risk_score": round(risk_score, 2),
        "risk_level": level,
        "reasons": reasons,
        "stats": {
            "verification_sessions": len(verification_sessions),
            "behavior_sessions": len(behavior_sessions),
            "avg_identity_confidence": avg_identity,
            "avg_behavior_suspicion": avg_behavior
        },
        "last_seen_at": owner.get("last_seen_at"),
        "flags": owner.get("flags"),
        "is_active": owner.get("is_active", True),
        "is_suspicious": owner.get("is_suspicious", is_suspicious),
    }



