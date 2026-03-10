from app.services.founder_prefill_analytics import compute_founder_prefill_analytics


def test_compute_founder_prefill_analytics_normalizes_color_and_tracks_text_change():
    result = compute_founder_prefill_analytics(
        {
            "analysisMode": "pp1",
            "predictedCategory": "Wallet",
            "predictedDescription": "Navy blue leather wallet with zipper",
            "predictedColor": "navy",
            "finalCategory": "Wallet",
            "finalDescription": "Blue leather wallet with zipper",
            "analysisEvidence": {
                "pp1": {
                    "final_description": "Navy blue leather wallet with zipper",
                    "category_details": {
                        "features": ["zipper"],
                    },
                }
            },
        }
    )

    assert result["finalExtractedColor"] == "blue"
    assert result["changeMetrics"]["colorChanged"] is False
    assert result["changeMetrics"]["categoryChangePct"] == 0.0
    assert result["changeMetrics"]["descriptionEditPct"] > 0.0


def test_compute_founder_prefill_analytics_extracts_multiview_metrics():
    result = compute_founder_prefill_analytics(
        {
            "analysisMode": "pp2",
            "predictedCategory": "Smart Phone",
            "predictedDescription": "Black phone with cracked screen",
            "predictedColor": "black",
            "finalCategory": "Smart Phone",
            "finalDescription": "Black phone with cracked screen",
            "analysisEvidence": {
                "verification": {
                    "mode": "two_view",
                    "passed": True,
                    "used_views": [0, 1],
                    "dropped_views": [{"view_index": 2, "reason": "not_best_pair_lower_similarity"}],
                    "failure_reasons": [],
                    "cosine_sim_matrix": [
                        [1.0, 0.92, 0.81],
                        [0.92, 1.0, 0.79],
                        [0.81, 0.79, 1.0],
                    ],
                    "faiss_sim_matrix": [
                        [1.0, 0.95, 0.83],
                        [0.95, 1.0, 0.8],
                        [0.83, 0.8, 1.0],
                    ],
                    "geometric_scores": {
                        "0-1": {"pair_strength": "strong"},
                        "0-2": {"pair_strength": "near_miss"},
                        "1-2": {"pair_strength": "weak"},
                    },
                },
                "fused": {
                    "caption": "black smart phone with cracked screen",
                    "attributes": {"camera module": True},
                    "defects": ["cracked screen"],
                },
                "per_view": [],
            },
        }
    )

    multiview = result["multiviewVerification"]
    assert multiview["available"] is True
    assert multiview["passed"] is True
    assert multiview["usedViews"] == [0, 1]
    assert multiview["strongPairCount"] == 1
    assert multiview["nearMissPairCount"] == 1
    assert multiview["weakPairCount"] == 1
    assert multiview["bestPair"] == "0-1"
