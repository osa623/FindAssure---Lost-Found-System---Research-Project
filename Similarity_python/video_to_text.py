import os
import subprocess
import threading
import whisper

# Load model once
model = whisper.load_model("base")

# Whisper model is not reliably thread-safe across concurrent calls
whisper_lock = threading.Lock()


def extract_text(file_path: str) -> str:
    """
    Convert a video file to mono 16kHz WAV and transcribe with Whisper.
    Returns empty string if extraction/transcription fails.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    base_path, _ = os.path.splitext(file_path)
    audio_path = f"{base_path}_audio.wav"

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", file_path, "-ar", "16000", "-ac", "1", audio_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        print("FFmpeg audio extraction timed out")
        return ""
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg failed to extract audio: {e}")
        return ""

    if not os.path.exists(audio_path) or os.path.getsize(audio_path) == 0:
        print("Audio extraction failed - no audio file created")
        return ""

    text = ""
    with whisper_lock:
        try:
            # Pass 1: stable defaults
            result = model.transcribe(audio_path, fp16=False)
            text = result.get("text", "").strip()

            # Pass 2: more permissive decode when empty
            if not text:
                result = model.transcribe(
                    audio_path,
                    fp16=False,
                    temperature=0.4,
                    no_speech_threshold=0.3,
                )
                text = result.get("text", "").strip()
        except Exception as e:
            print(f"Whisper transcription failed: {e}")
            text = ""

    print("Transcription:", text)

    if os.path.exists(audio_path):
        os.remove(audio_path)

    return text
