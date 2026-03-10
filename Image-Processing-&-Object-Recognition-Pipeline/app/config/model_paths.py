import os
from dotenv import load_dotenv
from app.config.settings import settings

load_dotenv()

# Base directory for models (adjust as needed relative to your project structure)
# Assuming models are stored in backend/app/models
BASE_MODELS_DIR = os.getenv("BASE_MODELS_DIR")
if not BASE_MODELS_DIR:
    BASE_MODELS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../models"))

# --- DINOv2 Configuration ---
# If using a local clone of the DINOv2 repository
DINOV2_REPO_PATH = settings.DINO_MODEL_PATH or os.path.join(BASE_MODELS_DIR, "DINOv2")
# Path to local weights if not downloading automatically
DINOV2_WEIGHTS_PATH = os.path.join(DINOV2_REPO_PATH, "model.safetensors")

# --- SwinIR Configuration ---
# If using a local clone of the SwinIR repository
SWINIR_REPO_PATH = os.path.join(BASE_MODELS_DIR, "SwinIR")
# Path to the specific SwinIR checkpoint
SWINIR_WEIGHTS_PATH = os.path.join(SWINIR_REPO_PATH, "model.safetensors")

# --- Florence-2 Configuration ---
FLORENCE2_MODEL_PATH = os.path.join(BASE_MODELS_DIR, "florence2-large-ft")

# --- YOLO Configuration ---
FINAL_MASTER_MODEL_PATH = os.path.join(BASE_MODELS_DIR, "final_master_model.pt")

# --- FAISS Configuration ---
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data"))
FAISS_INDEX_PATH = settings.FAISS_INDEX_PATH
FAISS_MAPPING_PATH = settings.FAISS_MAPPING_PATH

