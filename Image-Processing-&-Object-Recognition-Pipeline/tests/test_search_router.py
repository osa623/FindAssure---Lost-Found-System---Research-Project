import io
import sys
from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image


# Patch heavy modules before importing app.main
mock_yolo_module = MagicMock()
mock_florence_module = MagicMock()
mock_dino_module = MagicMock()

mock_yolo_module.YoloService = MagicMock()
mock_florence_module.FlorenceService = MagicMock()
mock_dino_module.DINOEmbedder = MagicMock()

sys.modules["app.services.yolo_service"] = mock_yolo_module
sys.modules["app.services.florence_service"] = mock_florence_module
sys.modules["app.services.dino_embedder"] = mock_dino_module

from app.main import app


class _DummyDet:
    def __init__(self):
        self.confidence = 0.9
        self.bbox = (0, 0, 10, 10)


class _DummyYolo:
    def detect_objects(self, _image):
        return [_DummyDet()]


class _DummyDino:
    def embed_128(self, _image):
        return np.ones(128, dtype=np.float32)


class _DummyFaiss:
    def __init__(self):
        self.saved = False

    def add(self, _vector, _metadata):
        return 7

    def save(self):
        self.saved = True

    def search(self, _vector, top_k=5):
        hits = [
            {
                "score": 0.92,
                "faiss_id": 7,
                "item_id": "item-123",
                "category": "Wallet",
                "vector_type": "fused",
            },
            {
                "score": 0.81,
                "faiss_id": 8,
                "item_id": "item-123",
                "category": "Wallet",
                "vector_type": "view",
                "view_index": 1,
            },
            {
                "score": 0.89,
                "faiss_id": 10,
                "item_id": "item-xyz",
                "category": "Bag",
                "vector_type": "fused",
            },
        ]
        return hits[:top_k]


@asynccontextmanager
async def mock_lifespan(app_obj):
    pipeline_mock = MagicMock()
    pipeline_mock.yolo = _DummyYolo()
    pipeline_mock.dino = _DummyDino()
    pipeline_mock.faiss = _DummyFaiss()

    app_obj.state.multiview_pipeline = pipeline_mock
    yield
    app_obj.state.multiview_pipeline = None


app.router.lifespan_context = mock_lifespan


def _image_bytes() -> bytes:
    image = Image.new("RGB", (32, 32), color=(255, 0, 0))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_index_vector_returns_faiss_id():
    with TestClient(app) as client:
        payload = {
            "vector_128d": [0.1] * 128,
            "metadata": {"item_id": "item-123"},
        }
        response = client.post("/search/index_vector", json=payload)
        assert response.status_code == 200
        assert response.json()["faiss_id"] == 7


def test_search_by_image_returns_matches():
    with TestClient(app) as client:
        files = {"file": ("query.png", _image_bytes(), "image/png")}
        data = {"top_k": "2", "min_score": "0.7"}

        response = client.post("/search/by-image", files=files, data=data)

        assert response.status_code == 200
        payload = response.json()
        assert payload["top_k"] == 2
        assert payload["min_score"] == 0.7
        assert len(payload["matches"]) == 2
        assert payload["matches"][0]["item_id"] == "item-123"
        assert payload["matches"][0]["score"] == 0.92
        assert payload["matches"][0]["vector_hits_count"] == 2
        assert payload["matches"][1]["item_id"] == "item-xyz"


def test_search_by_image_defaults_to_top1_item():
    with TestClient(app) as client:
        files = {"file": ("query.png", _image_bytes(), "image/png")}
        response = client.post("/search/by-image", files=files)

        assert response.status_code == 200
        payload = response.json()
        assert payload["top_k"] == 1
        assert len(payload["matches"]) == 1
        assert payload["matches"][0]["item_id"] == "item-123"
