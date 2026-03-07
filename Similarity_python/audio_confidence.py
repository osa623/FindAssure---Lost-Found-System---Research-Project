import os
import re
import uuid
import tempfile
import subprocess
import threading
from typing import Dict, List, Any

import whisper

TMP_DIR = tempfile.gettempdir()
model = whisper.load_model("base")
whisper_lock = threading.Lock()

FILLER_WORDS = {
    "uh", "um", "ah", "erm", "hmm", "mm",
    "like", "you know", "actually", "basically",
    "well", "so"
}

UNCERTAINTY_PATTERNS = [
    "i think", "maybe", "probably", "not sure", "i guess", "umm", "uhh",
    "could be", "might be", "i dont know", "i don't know", "seems like",
    "kind of", "sort of"
]

# Gap-focused tuning
LONG_PAUSE_SEC = 0.60
VERY_LONG_PAUSE_SEC = 1.00


def _safe_round(v, n=3):
    try:
        return round(float(v), n)
    except Exception:
        return 0.0


def extract_audio_from_video(video_path: str) -> str:
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"File not found: {video_path}")

    audio_path = os.path.join(TMP_DIR, f"{uuid.uuid4().hex}.wav")

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            audio_path
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        check=True
    )
    return audio_path


def _count_words(text: str) -> int:
    if not text:
        return 0
    return len(re.findall(r"\b[a-zA-Z0-9']+\b", text))


def _count_fillers(text: str) -> int:
    if not text:
        return 0

    normalized = re.sub(r"[^a-zA-Z0-9\s']", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()

    count = 0
    for filler in sorted(FILLER_WORDS, key=len, reverse=True):
        pattern = r"\b" + re.escape(filler) + r"\b"
        count += len(re.findall(pattern, normalized))
    return count


def _count_uncertainty_phrases(text: str) -> int:
    if not text:
        return 0
    normalized = re.sub(r"[^a-zA-Z0-9\s']", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    count = 0
    for p in UNCERTAINTY_PATTERNS:
        pattern = r"\b" + re.escape(p) + r"\b"
        count += len(re.findall(pattern, normalized))
    return count


def _repetition_ratio(text: str) -> float:
    if not text:
        return 0.0
    tokens = re.findall(r"\b[a-zA-Z0-9']+\b", text.lower())
    if len(tokens) < 3:
        return 0.0
    unique_tokens = len(set(tokens))
    return max(0.0, 1.0 - (unique_tokens / len(tokens)))


def _asr_confidence_score(segments: List[Dict[str, Any]]) -> float:
    """
    Derive rough ASR confidence from Whisper segment metadata.
    Higher avg_logprob + lower no_speech_prob => better confidence.
    """
    if not segments:
        return 0.40

    logprobs = []
    no_speech_probs = []
    for seg in segments:
        if "avg_logprob" in seg:
            try:
                logprobs.append(float(seg["avg_logprob"]))
            except Exception:
                pass
        if "no_speech_prob" in seg:
            try:
                no_speech_probs.append(float(seg["no_speech_prob"]))
            except Exception:
                pass

    avg_logprob = (sum(logprobs) / len(logprobs)) if logprobs else -1.2
    avg_no_speech = (sum(no_speech_probs) / len(no_speech_probs)) if no_speech_probs else 0.5

    # Normalize logprob roughly from [-2.5, -0.1] -> [0,1]
    logprob_norm = (avg_logprob + 2.5) / 2.4
    logprob_norm = max(0.0, min(1.0, logprob_norm))
    speech_presence = max(0.0, min(1.0, 1.0 - avg_no_speech))

    return (0.7 * logprob_norm) + (0.3 * speech_presence)


def _pause_metrics(segments: List[Dict[str, Any]]) -> Dict[str, float]:
    if not segments or len(segments) < 2:
        return {
            "avg_pause_sec": 0.0,
            "max_pause_sec": 0.0,
            "long_pause_count": 0,
            "very_long_pause_count": 0,
            "pause_count": 0
        }

    pauses = []
    for i in range(len(segments) - 1):
        end_t = float(segments[i].get("end", 0.0))
        next_start = float(segments[i + 1].get("start", 0.0))
        pauses.append(max(0.0, next_start - end_t))

    return {
        "avg_pause_sec": float(sum(pauses) / len(pauses)) if pauses else 0.0,
        "max_pause_sec": float(max(pauses)) if pauses else 0.0,
        "long_pause_count": int(sum(1 for p in pauses if p >= LONG_PAUSE_SEC)),
        "very_long_pause_count": int(sum(1 for p in pauses if p >= VERY_LONG_PAUSE_SEC)),
        "pause_count": int(len(pauses)),
        "total_pause_sec": float(sum(pauses)) if pauses else 0.0,
        "long_pause_ratio": float(sum(1 for p in pauses if p >= LONG_PAUSE_SEC) / len(pauses)) if pauses else 0.0
    }


def _speech_rate_score(wpm: float) -> float:
    if wpm <= 0:
        return 0.20
    if 95 <= wpm <= 155:
        return 0.95
    if 75 <= wpm < 95 or 155 < wpm <= 175:
        return 0.78
    if 55 <= wpm < 75 or 175 < wpm <= 195:
        return 0.58
    return 0.35


def _pause_score(avg_pause_sec: float, long_pause_count: int, very_long_pause_count: int) -> float:
    score = 1.0

    # Stronger penalties for noticeable hesitation.
    if avg_pause_sec > 0.35:
        score -= 0.25
    if avg_pause_sec > 0.55:
        score -= 0.20
    if avg_pause_sec > 0.80:
        score -= 0.20

    score -= min(long_pause_count * 0.08, 0.30)
    score -= min(very_long_pause_count * 0.12, 0.30)

    return max(0.20, min(1.0, score))


def _filler_score(filler_rate: float) -> float:
    if filler_rate <= 0.02:
        return 0.95
    if filler_rate <= 0.05:
        return 0.78
    if filler_rate <= 0.10:
        return 0.58
    return 0.35


def _start_latency_score(start_latency_sec: float) -> float:
    if start_latency_sec <= 0.8:
        return 0.95
    if start_latency_sec <= 1.5:
        return 0.78
    if start_latency_sec <= 2.5:
        return 0.55
    return 0.35


def analyze_audio_confidence(video_path: str) -> Dict[str, Any]:
    audio_path = None
    try:
        audio_path = extract_audio_from_video(video_path)

        # Whisper model access must be serialized across threads.
        with whisper_lock:
            result = model.transcribe(
                audio_path,
                fp16=False,
                verbose=False,
                language="en",
                task="transcribe",
            )
        transcript = (result.get("text") or "").strip()
        segments = result.get("segments") or []

        total_words = _count_words(transcript)
        filler_count = _count_fillers(transcript)
        filler_rate = (filler_count / total_words) if total_words > 0 else 0.0
        uncertainty_count = _count_uncertainty_phrases(transcript)
        uncertainty_rate = (uncertainty_count / max(1, total_words)) if total_words > 0 else 0.0
        repetition_ratio = _repetition_ratio(transcript)

        duration_sec = float(segments[-1].get("end", 0.0)) if segments else 0.0
        speech_rate_wpm = ((total_words / duration_sec) * 60.0) if duration_sec > 0 and total_words > 0 else 0.0
        start_latency_sec = float(segments[0].get("start", 0.0)) if segments else 0.0

        pauses = _pause_metrics(segments)
        pause_ratio = (pauses["total_pause_sec"] / duration_sec) if duration_sec > 0 else 0.0

        pause_score = _pause_score(
            pauses["avg_pause_sec"],
            pauses["long_pause_count"],
            pauses["very_long_pause_count"]
        )
        # Additional reduction when a large fraction of clip is silence/gaps.
        if pause_ratio > 0.18:
            pause_score = max(0.20, pause_score - 0.15)
        if pause_ratio > 0.30:
            pause_score = max(0.20, pause_score - 0.20)
        filler_score = _filler_score(filler_rate)
        rate_score = _speech_rate_score(speech_rate_wpm)
        latency_score = _start_latency_score(start_latency_sec)
        asr_score = _asr_confidence_score(segments)

        # Gap-focused overall weighting.
        confidence_score = (
            0.48 * pause_score +
            0.17 * filler_score +
            0.13 * rate_score +
            0.10 * latency_score +
            0.12 * asr_score
        )

        # Guessing/hesitation risk [0,1] - higher means likely uncertain/guessed.
        guessing_risk_score = (
            0.35 * min(1.0, pause_ratio / 0.35) +
            0.20 * min(1.0, uncertainty_rate / 0.10) +
            0.15 * min(1.0, filler_rate / 0.12) +
            0.15 * min(1.0, repetition_ratio / 0.35) +
            0.15 * (1.0 - asr_score)
        )
        guessing_risk_score = max(0.0, min(1.0, guessing_risk_score))

        if confidence_score >= 0.78:
            label = "high_confidence_behavior"
        elif confidence_score >= 0.58:
            label = "moderate_confidence_behavior"
        else:
            label = "hesitant_behavior"

        if guessing_risk_score >= 0.70:
            guessing_label = "high_guessing_risk"
        elif guessing_risk_score >= 0.45:
            guessing_label = "moderate_guessing_risk"
        else:
            guessing_label = "low_guessing_risk"

        return {
            "transcript": transcript,
            "audio_confidence_score": _safe_round(confidence_score, 3),
            "label": label,
            "guessing_risk_score": _safe_round(guessing_risk_score, 3),
            "guessing_label": guessing_label,
            "diagnostics": {
                "duration_sec": _safe_round(duration_sec, 3),
                "word_count": int(total_words),
                "speech_rate_wpm": _safe_round(speech_rate_wpm, 2),
                "filler_count": int(filler_count),
                "filler_rate": _safe_round(filler_rate, 3),
                "uncertainty_count": int(uncertainty_count),
                "uncertainty_rate": _safe_round(uncertainty_rate, 3),
                "repetition_ratio": _safe_round(repetition_ratio, 3),
                "avg_pause_sec": _safe_round(pauses["avg_pause_sec"], 3),
                "max_pause_sec": _safe_round(pauses["max_pause_sec"], 3),
                "long_pause_count": int(pauses["long_pause_count"]),
                "very_long_pause_count": int(pauses["very_long_pause_count"]),
                "pause_count": int(pauses["pause_count"]),
                "total_pause_sec": _safe_round(pauses["total_pause_sec"], 3),
                "long_pause_ratio": _safe_round(pauses["long_pause_ratio"], 3),
                "pause_ratio_of_clip": _safe_round(pause_ratio, 3),
                "start_latency_sec": _safe_round(start_latency_sec, 3),
                "pause_score": _safe_round(pause_score, 3),
                "filler_score": _safe_round(filler_score, 3),
                "speech_rate_score": _safe_round(rate_score, 3),
                "latency_score": _safe_round(latency_score, 3),
                "asr_confidence_score": _safe_round(asr_score, 3),
                "guessing_risk_score": _safe_round(guessing_risk_score, 3)
            }
        }

    except subprocess.CalledProcessError as e:
        return {
            "transcript": "",
            "audio_confidence_score": 0.0,
            "label": "audio_processing_failed",
            "error": e.stderr.decode(errors="ignore") if e.stderr else str(e),
            "diagnostics": {}
        }
    except Exception as e:
        return {
            "transcript": "",
            "audio_confidence_score": 0.0,
            "label": "audio_processing_failed",
            "error": str(e),
            "diagnostics": {}
        }
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
