import os
import re
import uuid
import tempfile
import subprocess
import threading
from typing import Dict, List, Any

import whisper
from scipy.io import wavfile
from scipy.signal import lfilter
import numpy as np

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

QUESTIONING_PATTERNS = [
    "is it", "is this", "could it be", "can it be", "am i right", "right",
    "maybe it is", "i guess it is", "perhaps"
]

# Gap-focused tuning
LONG_PAUSE_SEC = 0.60
VERY_LONG_PAUSE_SEC = 1.00
ABNORMAL_WORD_GAP_SEC = 0.45
VERY_ABNORMAL_WORD_GAP_SEC = 0.90


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


def _count_questioning_phrases(text: str) -> int:
    if not text:
        return 0
    normalized = re.sub(r"[^a-zA-Z0-9\s'?!]", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    count = 0
    for p in QUESTIONING_PATTERNS:
        pattern = r"\b" + re.escape(p) + r"\b"
        count += len(re.findall(pattern, normalized))
    count += normalized.count("?")
    return count


def _repetition_ratio(text: str) -> float:
    if not text:
        return 0.0
    tokens = re.findall(r"\b[a-zA-Z0-9']+\b", text.lower())
    if len(tokens) < 3:
        return 0.0
    unique_tokens = len(set(tokens))
    return max(0.0, 1.0 - (unique_tokens / len(tokens)))


def _load_wav_mono(audio_path: str):
    sr, data = wavfile.read(audio_path)
    if data is None:
        return sr, np.array([], dtype=np.float32)

    if data.ndim > 1:
        data = np.mean(data, axis=1)

    data = data.astype(np.float32)
    if data.size == 0:
        return sr, data

    # Normalize to [-1, 1]
    max_abs = np.max(np.abs(data))
    if max_abs > 0:
        data = data / max_abs
    return sr, data


def _estimate_pitch_autocorr(frame: np.ndarray, sr: int) -> float:
    frame = frame - np.mean(frame)
    if frame.size == 0:
        return 0.0

    # Light pre-emphasis improves voiced peak visibility.
    frame = lfilter([1.0, -0.97], [1.0], frame)
    energy = np.mean(frame ** 2)
    if energy < 1e-6:
        return 0.0

    ac = np.correlate(frame, frame, mode="full")
    ac = ac[len(ac)//2:]
    if ac.size < 3 or ac[0] <= 0:
        return 0.0

    fmin, fmax = 70.0, 350.0
    min_lag = max(1, int(sr / fmax))
    max_lag = min(len(ac) - 1, int(sr / fmin))
    if max_lag <= min_lag:
        return 0.0

    seg = ac[min_lag:max_lag + 1]
    peak_rel = int(np.argmax(seg))
    peak_val = seg[peak_rel]
    # Voiced threshold against zero-lag energy.
    if peak_val < 0.20 * ac[0]:
        return 0.0

    lag = min_lag + peak_rel
    if lag <= 0:
        return 0.0
    return float(sr / lag)


def _acoustic_instability_metrics(audio_path: str) -> Dict[str, float]:
    try:
        sr, sig = _load_wav_mono(audio_path)
        if sig.size < max(400, int(0.2 * sr)):
            return {
                "energy_cv": 0.0,
                "pitch_jitter": 0.0,
                "voiced_ratio": 0.0,
                "acoustic_risk": 0.0,
                "acoustic_score": 1.0,
            }

        frame_len = int(0.03 * sr)
        hop = int(0.01 * sr)
        if frame_len <= 0 or hop <= 0:
            return {
                "energy_cv": 0.0,
                "pitch_jitter": 0.0,
                "voiced_ratio": 0.0,
                "acoustic_risk": 0.0,
                "acoustic_score": 1.0,
            }

        energies = []
        pitches = []
        frame_count = 0

        for i in range(0, len(sig) - frame_len + 1, hop):
            frame = sig[i:i + frame_len]
            frame_count += 1
            energies.append(float(np.sqrt(np.mean(frame ** 2) + 1e-12)))
            p = _estimate_pitch_autocorr(frame, sr)
            if p > 0:
                pitches.append(p)

        if not energies:
            return {
                "energy_cv": 0.0,
                "pitch_jitter": 0.0,
                "voiced_ratio": 0.0,
                "acoustic_risk": 0.0,
                "acoustic_score": 1.0,
            }

        e = np.array(energies, dtype=np.float32)
        energy_cv = float(np.std(e) / (np.mean(e) + 1e-8))

        if len(pitches) >= 3:
            p = np.array(pitches, dtype=np.float32)
            pitch_jitter = float(np.mean(np.abs(np.diff(p)) / (p[:-1] + 1e-6)))
        else:
            pitch_jitter = 0.0

        voiced_ratio = float(len(pitches) / max(1, frame_count))

        # Convert acoustic instability to risk score.
        energy_risk = min(1.0, energy_cv / 0.8)
        jitter_risk = min(1.0, pitch_jitter / 0.20)
        unvoiced_risk = 1.0 - min(1.0, voiced_ratio)
        acoustic_risk = (0.45 * energy_risk) + (0.40 * jitter_risk) + (0.15 * unvoiced_risk)
        acoustic_risk = max(0.0, min(1.0, acoustic_risk))

        return {
            "energy_cv": _safe_round(energy_cv, 4),
            "pitch_jitter": _safe_round(pitch_jitter, 4),
            "voiced_ratio": _safe_round(voiced_ratio, 4),
            "acoustic_risk": _safe_round(acoustic_risk, 4),
            "acoustic_score": _safe_round(1.0 - acoustic_risk, 4),
        }
    except Exception:
        return {
            "energy_cv": 0.0,
            "pitch_jitter": 0.0,
            "voiced_ratio": 0.0,
            "acoustic_risk": 0.0,
            "acoustic_score": 1.0,
        }
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
            "pause_count": 0,
            "total_pause_sec": 0.0,
            "long_pause_ratio": 0.0,
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


def _word_gap_metrics(segments: List[Dict[str, Any]]) -> Dict[str, float]:
    words = []
    for seg in segments or []:
        for w in seg.get("words") or []:
            start = w.get("start")
            end = w.get("end")
            if start is None or end is None:
                continue
            try:
                words.append((float(start), float(end)))
            except Exception:
                continue

    if len(words) < 2:
        return {
            "avg_word_gap_sec": 0.0,
            "max_word_gap_sec": 0.0,
            "abnormal_word_gap_count": 0,
            "very_abnormal_word_gap_count": 0,
            "abnormal_word_gap_ratio": 0.0,
        }

    words.sort(key=lambda x: x[0])
    gaps = []
    for i in range(len(words) - 1):
        cur_end = words[i][1]
        nxt_start = words[i + 1][0]
        gaps.append(max(0.0, nxt_start - cur_end))

    abnormal_count = sum(1 for g in gaps if g >= ABNORMAL_WORD_GAP_SEC)
    very_abnormal_count = sum(1 for g in gaps if g >= VERY_ABNORMAL_WORD_GAP_SEC)

    return {
        "avg_word_gap_sec": float(sum(gaps) / len(gaps)) if gaps else 0.0,
        "max_word_gap_sec": float(max(gaps)) if gaps else 0.0,
        "abnormal_word_gap_count": int(abnormal_count),
        "very_abnormal_word_gap_count": int(very_abnormal_count),
        "abnormal_word_gap_ratio": float(abnormal_count / len(gaps)) if gaps else 0.0,
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
                word_timestamps=True,
            )
        transcript = (result.get("text") or "").strip()
        segments = result.get("segments") or []

        total_words = _count_words(transcript)
        filler_count = _count_fillers(transcript)
        filler_rate = (filler_count / total_words) if total_words > 0 else 0.0
        uncertainty_count = _count_uncertainty_phrases(transcript)
        uncertainty_rate = (uncertainty_count / max(1, total_words)) if total_words > 0 else 0.0
        questioning_count = _count_questioning_phrases(transcript)
        questioning_rate = (questioning_count / max(1, total_words)) if total_words > 0 else 0.0
        repetition_ratio = _repetition_ratio(transcript)

        duration_sec = float(segments[-1].get("end", 0.0)) if segments else 0.0
        speech_rate_wpm = ((total_words / duration_sec) * 60.0) if duration_sec > 0 and total_words > 0 else 0.0
        start_latency_sec = float(segments[0].get("start", 0.0)) if segments else 0.0

        pauses = _pause_metrics(segments)
        word_gaps = _word_gap_metrics(segments)
        pause_ratio = (pauses.get("total_pause_sec", 0.0) / duration_sec) if duration_sec > 0 else 0.0

        pause_score = _pause_score(
            pauses["avg_pause_sec"],
            pauses["long_pause_count"],
            pauses["very_long_pause_count"]
        )
        acoustic = _acoustic_instability_metrics(audio_path)
        acoustic_score = float(acoustic.get("acoustic_score", 1.0))
        acoustic_risk = float(acoustic.get("acoustic_risk", 0.0))
        # Additional reduction when a large fraction of clip is silence/gaps.
        if pause_ratio > 0.18:
            pause_score = max(0.20, pause_score - 0.15)
        if pause_ratio > 0.30:
            pause_score = max(0.20, pause_score - 0.20)
        if word_gaps["abnormal_word_gap_ratio"] > 0.10:
            pause_score = max(0.20, pause_score - 0.18)
        if word_gaps["abnormal_word_gap_ratio"] > 0.20:
            pause_score = max(0.20, pause_score - 0.20)
        if word_gaps["very_abnormal_word_gap_count"] >= 2:
            pause_score = max(0.20, pause_score - 0.12)
        filler_score = _filler_score(filler_rate)
        rate_score = _speech_rate_score(speech_rate_wpm)
        latency_score = _start_latency_score(start_latency_sec)
        asr_score = _asr_confidence_score(segments)

        # Gap-focused overall weighting.
        confidence_score = (
            0.40 * pause_score +
            0.14 * filler_score +
            0.10 * rate_score +
            0.08 * latency_score +
            0.10 * asr_score +
            0.18 * acoustic_score
        )
        if questioning_rate > 0.04:
            confidence_score = max(0.0, confidence_score - 0.12)
        if questioning_rate > 0.08:
            confidence_score = max(0.0, confidence_score - 0.10)

        # Guessing/hesitation risk [0,1] - higher means likely uncertain/guessed.
        guessing_risk_score = (
            0.30 * min(1.0, pause_ratio / 0.20) +
            0.24 * min(1.0, uncertainty_rate / 0.05) +
            0.12 * min(1.0, filler_rate / 0.08) +
            0.10 * min(1.0, repetition_ratio / 0.35) +
            0.20 * min(1.0, word_gaps["abnormal_word_gap_ratio"] / 0.08) +
            0.14 * min(1.0, questioning_rate / 0.04) +
            0.04 * (1.0 - asr_score) +
            0.16 * acoustic_risk
        )
        if uncertainty_count > 0:
            guessing_risk_score += 0.14
        if questioning_count > 0:
            guessing_risk_score += 0.18
        if filler_count >= 2:
            guessing_risk_score += 0.05
        if pause_ratio > 0.08:
            guessing_risk_score += 0.12
        if pauses.get("avg_pause_sec", 0.0) > 0.45:
            guessing_risk_score += 0.10
        if word_gaps["abnormal_word_gap_count"] >= 2:
            guessing_risk_score += 0.12
        if confidence_score < 0.70:
            guessing_risk_score += 0.10
        elif confidence_score < 0.82:
            guessing_risk_score += 0.08

        # Floors to avoid unrealistically low risk on clearly hesitant/questioning clips.
        if uncertainty_count > 0 or questioning_count > 0:
            guessing_risk_score = max(guessing_risk_score, 0.30)
        if pause_ratio > 0.10 or word_gaps["abnormal_word_gap_ratio"] > 0.10:
            guessing_risk_score = max(guessing_risk_score, 0.28)
        if confidence_score < 0.82:
            guessing_risk_score = max(guessing_risk_score, 0.25)
        if confidence_score < 0.70:
            guessing_risk_score = max(guessing_risk_score, 0.35)
        guessing_risk_score = max(0.0, min(1.0, guessing_risk_score))

        if confidence_score >= 0.82:
            label = "high_confidence_behavior"
        elif confidence_score >= 0.62:
            label = "moderate_confidence_behavior"
        else:
            label = "hesitant_behavior"

        if guessing_risk_score >= 0.45:
            guessing_label = "high_guessing_risk"
        elif guessing_risk_score >= 0.18:
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
                "questioning_count": int(questioning_count),
                "questioning_rate": _safe_round(questioning_rate, 3),
                "repetition_ratio": _safe_round(repetition_ratio, 3),
                "avg_pause_sec": _safe_round(pauses["avg_pause_sec"], 3),
                "max_pause_sec": _safe_round(pauses["max_pause_sec"], 3),
                "long_pause_count": int(pauses.get("long_pause_count", 0)),
                "very_long_pause_count": int(pauses.get("very_long_pause_count", 0)),
                "pause_count": int(pauses.get("pause_count", 0)),
                "total_pause_sec": _safe_round(pauses.get("total_pause_sec", 0.0), 3),
                "long_pause_ratio": _safe_round(pauses.get("long_pause_ratio", 0.0), 3),
                "avg_word_gap_sec": _safe_round(word_gaps["avg_word_gap_sec"], 3),
                "max_word_gap_sec": _safe_round(word_gaps["max_word_gap_sec"], 3),
                "abnormal_word_gap_count": int(word_gaps["abnormal_word_gap_count"]),
                "very_abnormal_word_gap_count": int(word_gaps["very_abnormal_word_gap_count"]),
                "abnormal_word_gap_ratio": _safe_round(word_gaps["abnormal_word_gap_ratio"], 3),
                "pause_ratio_of_clip": _safe_round(pause_ratio, 3),
                "start_latency_sec": _safe_round(start_latency_sec, 3),
                "pause_score": _safe_round(pause_score, 3),
                "filler_score": _safe_round(filler_score, 3),
                "speech_rate_score": _safe_round(rate_score, 3),
                "latency_score": _safe_round(latency_score, 3),
                "asr_confidence_score": _safe_round(asr_score, 3),
                "acoustic_score": _safe_round(acoustic_score, 3),
                "acoustic_risk": _safe_round(acoustic_risk, 3),
                "energy_cv": _safe_round(acoustic.get("energy_cv", 0.0), 4),
                "pitch_jitter": _safe_round(acoustic.get("pitch_jitter", 0.0), 4),
                "voiced_ratio": _safe_round(acoustic.get("voiced_ratio", 0.0), 4),
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
