import os
import requests
import json

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"
GEMINI_KEY = os.getenv("GEMINI_API_KEY")

def build_prompt(owner_id, features, decision, xai):
   return f"""You are an AI auditor verifying suspicious behavior detection.

Context:
- Owner ID: {{owner_id}}
- The decision was made using deterministic rules (not ML hallucination).
- You must NOT override the decision.
- Your task is to explain and validate it.

Behavior metrics:
{{features_json}}

XAI explanation (SHAP-style):
{{xai_json}}

Decision:
is_suspicious = {{true_or_false}}

Instructions:
1. Explain WHY the user is or is not suspicious.
2. Reference the strongest contributing factors.
3. Highlight any uncertainty or edge cases.
4. Use neutral, professional language.
5. Do NOT speculate beyond the data.
6. Keep the explanation under 6 sentences.

Return only the explanation.
""".format(
        owner_id=owner_id,
        features_json=json.dumps(features, indent=2),
        xai_json=json.dumps(xai, indent=2),
        true_or_false=str(decision).lower()
    )


def gemini_reason(owner_id, features, decision, xai):
    prompt = build_prompt(owner_id, features, decision, xai)

    body = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 300
        }
    }

    r = requests.post(
        f"{GEMINI_API_URL}?key={GEMINI_KEY}",
        headers={"Content-Type": "application/json"},
        json=body,
        timeout=30
    )

    r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]
