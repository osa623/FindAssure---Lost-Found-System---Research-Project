import requests
import json

GEMINI_KEY = "API-Key"
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"


def test_gemini_what_is_ai():
    prompt = "Explain Artificial Intelligence in plain English for a beginner. Use 3 sentences."


    body = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 200
        }
    }

    r = requests.post(
        f"{API_URL}?key={GEMINI_KEY}",
        headers={"Content-Type": "application/json"},
        json=body,
        timeout=30
    )

    if r.status_code != 200:
        print("❌ API Error")
        print(r.status_code, r.text)
        return

    data = r.json()

    text = data["candidates"][0]["content"]["parts"][0]["text"]

    print("✅ Gemini Response:\n")
    print(text)


if __name__ == "__main__":
    test_gemini_what_is_ai()
