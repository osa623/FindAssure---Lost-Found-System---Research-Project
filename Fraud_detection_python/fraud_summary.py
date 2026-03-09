from bson import ObjectId


# =====================
# HELPERS
# =====================
def safe_avg(values):
    return sum(values) / len(values) if values else None

def build_user_selector(owner_id):
    owner_id = str(owner_id).strip()
    selectors = [{"firebaseUid": owner_id}]
    if ObjectId.is_valid(owner_id):
        selectors.append({"_id": ObjectId(owner_id)})
    return {"$or": selectors}

def find_owner_profile(owner_id, users_col, owners_col=None):
    owner = users_col.find_one(build_user_selector(owner_id))
    if owner:
        return owner
    if owners_col is not None:
        return owners_col.find_one({"owner_id": owner_id})
    return None


# =====================
# CORE FRAUD ENGINE
# =====================
def analyze_fraud_for_owner(owner_id, users_col, verification_col, behavior_col, owners_col=None):
    owner_id = str(owner_id).strip()
    owner = find_owner_profile(owner_id, users_col, owners_col)
    if not owner:
        return None

    verification_sessions = list(
        verification_col.find({"owner_id": owner_id}).sort("created_at", 1)
    )

    behavior_sessions = list(
        behavior_col.find({"owner_id": owner_id}).sort("created_at", 1)
    )
    suspicious_behavior_sessions = [b for b in behavior_sessions if bool(b.get("is_suspicious"))]
    suspicious_behavior_count = len(suspicious_behavior_sessions)
    suspicious_behavior_events = []
    for b in suspicious_behavior_sessions[-10:]:
        created_at = b.get("created_at")
        ai_explanation = (b.get("AI_explanation") or {}).get("behavior_summary")
        xai = b.get("xai") or {}
        top_negative = xai.get("negative") or []
        negative_labels = []
        for item in top_negative[:3]:
            if isinstance(item, (list, tuple)) and item:
                negative_labels.append(str(item[0]))
            elif isinstance(item, dict) and item.get("feature"):
                negative_labels.append(str(item.get("feature")))
            elif item is not None:
                negative_labels.append(str(item))
        suspicious_behavior_events.append({
            "created_at": created_at,
            "suspicion_score": b.get("suspicion_score"),
            "face_missing_ratio": ((b.get("features") or {}).get("face_missing_ratio")),
            "look_away_ratio": ((b.get("features") or {}).get("look_away_ratio")),
            "top_negative_factors": negative_labels,
            "ai_behavior_summary": ai_explanation,
        })

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
    if suspicious_behavior_count > 5:
        risk_score += 0.35
        reasons.append(
            f"Suspicious behavior repeated {suspicious_behavior_count} times."
        )

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
            "avg_behavior_suspicion": avg_behavior,
            "suspicious_behavior_count": suspicious_behavior_count,
        },
        "suspicious_behavior_count": suspicious_behavior_count,
        "suspicious_behavior_events": suspicious_behavior_events,
        "last_seen_at": owner.get("last_seen_at") or owner.get("updatedAt"),
        "flags": owner.get("flags", []),
        "is_active": owner.get("is_active", True),
        "is_suspicious": owner.get("is_suspicious", is_suspicious),
    }



