import os
import json
import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"


def gemini_batch_similarity(q_list):
    if not GEMINI_KEY:
        return {"error": "Missing GEMINI_API_KEY"}

    block = "\n\n".join(
        [
            f"Question {i+1}: {q['question']}\n"
            f"Founder's Answer: \"{q['founder']}\"\n"
            f"Owner's Answer: \"{q['owner']}\""
            for i, q in enumerate(q_list)
        ]
    )

    prompt = f"""
You are an AI assistant verifying if the owner truly matches the founder's answers.

Questions and Answers:
{block}

Return ONLY JSON:

{{
  "overallScore": <0-100>,
  "matchDetails": [
    {{
      "questionNumber": 1,
      "question": "<question>",
      "similarityScore": <0-100>,
      "analysis": "<short>",
      "isMatch": <true/false>
    }}
  ],
  "recommendation": "<VERIFIED | LIKELY_MATCH | UNCERTAIN | NOT_MATCH>",
  "reasoning": "<overall explanation>"
}}
"""

    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "topK": 20,
            "topP": 0.8,
            "maxOutputTokens": 2048,
        },
    }

    try:
        r = requests.post(f"{API_URL}?key={GEMINI_KEY}", json=body, timeout=40)
        r.raise_for_status()  # Raise error for bad status codes
        data = r.json()

        # Check for error in response
        if "error" in data:
            error_message = data["error"].get("message", "Unknown Gemini API error")
            return {
                "error": "GEMINI_API_ERROR",
                "message": error_message,
                "fallback_mode": True
            }

        text = data["candidates"][0]["content"]["parts"][0]["text"]
        text = text.replace("```json", "").replace("```", "").strip()

        return json.loads(text)

    except requests.exceptions.HTTPError as e:
        # Handle HTTP errors (like 429 quota exceeded)
        try:
            error_data = r.json()
            error_message = error_data.get("error", {}).get("message", str(e))
        except:
            error_message = str(e)
        
        return {
            "error": "GEMINI_API_ERROR",
            "message": error_message,
            "fallback_mode": True
        }
    except Exception as e:
        return {
            "error": "GEMINI_API_ERROR",
            "message": str(e),
            "fallback_mode": True
        }