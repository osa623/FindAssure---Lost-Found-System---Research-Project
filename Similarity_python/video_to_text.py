import whisper
import os
import threading
import subprocess

# Load model once
model = whisper.load_model("base")

# Thread lock for Whisper model (model is not thread-safe)
whisper_lock = threading.Lock()

def extract_text(file_path: str) -> str:
    """
    Convert video to audio and transcribe using Whisper
    Thread-safe implementation with lock
    """

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    # Convert video to audio (works with mp4, mov, etc.)
    # Create a unique output filename to avoid FFmpeg in-place editing error
    base_path, ext = os.path.splitext(file_path)
    audio = base_path + "_audio.wav"

    # Extract audio from video using FFmpeg (suppress verbose output)
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-i', file_path, '-ar', '16000', '-ac', '1', audio],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30
        )
    except subprocess.TimeoutExpired:
        raise Exception("FFmpeg audio extraction timed out")
    except subprocess.CalledProcessError as e:
        raise Exception(f"FFmpeg failed to extract audio: {e}")
    
    # Check if audio file was created
    if not os.path.exists(audio) or os.path.getsize(audio) == 0:
        raise Exception("Audio extraction failed - no audio file created")

    # Transcribe audio using Whisper with thread lock
    # Lock ensures only one thread uses the model at a time
    # Force English language for better accuracy and faster processing
    with whisper_lock:
        try:
            result = model.transcribe(
                audio,
                language="en",  # Force English language
                task="transcribe",  # Transcription task (not translation)
                fp16=False,  # Use FP32 for better accuracy on CPU
                temperature=0.0,  # Deterministic output (no randomness)
                best_of=5,  # Try 5 candidates, pick best one
                beam_size=5,  # Beam search for better accuracy
                patience=1.0,  # Patience for beam search
                condition_on_previous_text=True,  # Use context from previous segments
                initial_prompt="This is a clear English response to a question about a lost item.",  # Guide the model
                compression_ratio_threshold=2.4,  # Default compression check
                logprob_threshold=-1.0,  # Default log probability threshold
                no_speech_threshold=0.6  # Higher threshold to avoid false positives
            )
            text = result["text"].strip()
        except Exception as e:
            raise Exception(f"Whisper transcription failed: {e}")

    print("Transcription:", text)

    # Cleanup temporary audio file
    if os.path.exists(audio):
        os.remove(audio)
    
    # Cleanup temporary video file
    if os.path.exists(file_path):
        os.remove(file_path)

    return text
