# Vision Core Backend Overview (Phase 1)

FastAPI service that wraps a multi-model computer-vision pipeline for object analysis and re-identification. This system employs a **hybrid architecture** using **YOLOv8m** for detection and **Florence-2** for detailed visual analysis, captioning, and grounding. It leverages **Gemini 3 Flash** for high-level reasoning and **DINOv2** for feature extraction.

## Key Components

- **`app/main.py`**  
  FastAPI application entry point. Handles service initialization and dependency injection.
  **Endpoints:**
  - `GET /`: Health check.
  - `POST /pp1/analyze`: **Primary Endpoint**. Single-image analysis pipeline (YOLO -> Florence -> Gemini -> DINOv2).
  - `POST /analyze`: **Deprecated**. Returns 400 Bad Request directing users to `/pp1/analyze`.

- **`app/services/unified_pipeline.py`**  
  The core orchestrator. Manages the PP1 pipeline flow:
  1.  **Detection**: YOLOv8m (Local). Minimum area gate (0.5%) filters tiny detections.
  2.  **Analysis**: Florence-2 (Caption, OCR, VQA, Grounding). Guided VQA skipped when caption ≥ 12 words. Description enrichment VQA when < 6 words. All subtasks retry once on timeout.
  3.  **Cross-Validation**: Florence OD (confidence-gated: skipped when YOLO conf ≥ 0.92 + area ≥ 5%). Expanded label rerank keywords with brand names/aliases.
  4.  **Reasoning**: Gemini 3 Flash (Evidence-Locked). Fatal errors → Florence-only fallback (`accepted_degraded`). Transient errors → `accepted_degraded` with `degradation_reason`.
  5.  **Embedding**: DINOv2 (768d + 128d projection). Validated for NaN/Inf/zeros.
  6.  **Storage**: Accepted/degraded items persisted to PostgreSQL + Redis.

- **`app/services/yolo_service.py`**
  Wraps the local YOLOv8m model (`final_master_model.pt`) for fast and accurate object detection. Enforces strict label mapping to the canonical set.

- **`app/services/florence_service.py`**  
  Wraps the Microsoft Florence-2 VLM.
  - **Analysis**: Performs Captioning, OCR, and VQA (Color, Key Count).
  - **Grounding**: Uses `<CAPTION_TO_PHRASE_GROUNDING>` to localize specific defects and features defined in `category_specs.py`.
  - **Local Loading**: Strictly loads from `app/models/florence2-base-ft/`.

- **`app/services/gemini_reasoner.py`**  
  Interface for Google's Gemini 3 Flash Preview model.
  - **Strict Extraction**: Uses a rigid prompt to extract JSON data solely from the provided evidence.
  - **Validation**: Enforces allowed labels and category-specific defects.

- **`app/services/dino_embedder.py`**  
  Wraps the DINOv2 Vision Transformer for generating high-quality semantic embeddings (768d) and a projected 128d vector for efficient storage.

- **`app/domain/category_specs.py`**  
  **Single Source of Truth (SSOT)**. Defines:
  - `ALLOWED_LABELS`: The list of valid object categories.
  - `CATEGORY_SPECS`: Dictionary mapping labels to allowed `features`, `defects`, and `attachments` for grounding and validation.
  - `canonicalize_label()`: LRU-cached (256 entries) label normalization.

## Canonical Label Set
The system normalizes all detected objects to one of the following labels:
- `Wallet`
- `Handbag`
- `Backpack`
- `Laptop`
- `Smart Phone`
- `Helmet`
- `Key`
- `Power Bank`
- `Laptop/Mobile chargers & cables`
- `Earbuds - Earbuds case`
- `Headphone`
- `Student ID`

## Request Flow (`POST /pp1/analyze`)
1.  **Validation**: Checks input file count (must be 1).
2.  **Detection**: **YOLOv8m** detects objects in the full image.
3.  **Selection**: Picks the highest-confidence object matching the canonical label set.
4.  **Processing**:
    - **Crop**: Extract object image.
    - **Analyze**: Florence-2 extracts caption, OCR, and VQA features.
    - **Grounding**: Florence-2 grounds specific defects/features based on `CATEGORY_SPECS`.
5.  **Reasoning**: Gemini 3 Flash synthesizes the result using evidence-locked prompting.
6.  **Embedding**: DINOv2 generates embeddings for the crop.
7.  **Response**: Returns a standardized JSON object with `item_id`, `image`, `label`, `category_details`, `embeddings`, and `raw` data.

## Setup & Running

1.  **Prerequisites**: Python 3.10+, CUDA-capable GPU recommended.
2.  **Environment**:
    - Set `GOOGLE_API_KEY` environment variable for Gemini.
3.  **Installation**:
    ```bash
    pip install -r requirements.txt
    ```
4.  **Model Weights**:
    Ensure weights are placed in `app/models/` as defined in `app/config/model_paths.py`:
    - `app/models/florence2-base-ft/`
    - `app/models/final_master_model.pt` (YOLO)
5.  **Run Server**:
    ```bash
    python run_server.py
    ```
    Server runs on `http://0.0.0.0:8000`.
