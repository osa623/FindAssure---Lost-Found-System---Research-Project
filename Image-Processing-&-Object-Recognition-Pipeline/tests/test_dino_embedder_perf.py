import unittest
from contextlib import contextmanager
import os
import tempfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

import app.services.dino_embedder as dino_embedder_module
from app.services.dino_embedder import DINOEmbedder


class _FakeInputTensor:
    def to(self, _device):
        return self


class _FakeTensor:
    def __init__(self, arr):
        self.arr = arr

    def __getitem__(self, idx):
        return _FakeTensor(self.arr[idx])

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.arr


class TestDinoEmbedderPerf(unittest.TestCase):
    def test_validate_local_model_path_accepts_complete_local_dir(self):
        embedder = DINOEmbedder.__new__(DINOEmbedder)

        with tempfile.TemporaryDirectory() as tmpdir:
            for filename in ("config.json", "preprocessor_config.json", "model.safetensors"):
                with open(os.path.join(tmpdir, filename), "w", encoding="utf-8") as handle:
                    handle.write("{}")

            embedder.model_name = tmpdir
            resolved = embedder._validate_local_model_path()

            self.assertEqual(resolved, os.path.abspath(tmpdir))

    def test_validate_local_model_path_fails_when_required_files_missing(self):
        embedder = DINOEmbedder.__new__(DINOEmbedder)

        with tempfile.TemporaryDirectory() as tmpdir:
            embedder.model_name = tmpdir
            with self.assertRaises(RuntimeError) as ctx:
                embedder._validate_local_model_path()

        self.assertIn("Missing required files", str(ctx.exception))

    def test_load_model_uses_local_files_only(self):
        embedder = DINOEmbedder.__new__(DINOEmbedder)
        embedder.model_name = "C:/mock/DINOv2"
        embedder.device = "cpu"
        embedder.use_fp16 = False
        embedder._model = None
        embedder._processor = None
        embedder._using_fp16 = False
        embedder._model_load_lock = None

        fake_model = MagicMock()
        fake_model.eval = MagicMock()

        with patch.object(DINOEmbedder, "_validate_local_model_path", return_value="C:/mock/DINOv2"), patch(
            "transformers.AutoImageProcessor.from_pretrained",
            return_value=MagicMock(),
        ) as processor_mock, patch(
            "transformers.AutoModel.from_pretrained",
            return_value=fake_model,
        ) as model_mock:
            embedder.load_model()

        processor_mock.assert_called_once_with("C:/mock/DINOv2", local_files_only=True)
        model_mock.assert_called_once_with("C:/mock/DINOv2", local_files_only=True)

    def test_prepare_embedding_image_outputs_fixed_target_size(self):
        embedder = DINOEmbedder.__new__(DINOEmbedder)
        embedder.input_size = 224
        image = Image.new("RGB", (640, 360), "white")

        prepared = DINOEmbedder._prepare_embedding_image(embedder, image)

        self.assertEqual(prepared.size, (224, 224))

    def test_embed_both_runs_single_forward_pass(self):
        embedder = DINOEmbedder.__new__(DINOEmbedder)
        embedder.model_name = "mock"
        embedder.device = "cpu"
        embedder.projection_dim = 2
        embedder.projection_seed = 42
        embedder._proj = None
        embedder._model_load_lock = None
        embedder.load_model = lambda: None
        embedder._processor = MagicMock(return_value={"pixel_values": _FakeInputTensor()})

        fake_last_hidden_state = _FakeTensor(np.array([[[1.0, 2.0, 3.0]]], dtype=np.float32))
        embedder._model = MagicMock(return_value=SimpleNamespace(last_hidden_state=fake_last_hidden_state))
        guard_calls = []

        @contextmanager
        def _guard(op_name, component):
            guard_calls.append((op_name, component))
            yield

        with patch.object(dino_embedder_module, "gpu_inference_guard", new=_guard):
            vec_768, vec_128 = embedder.embed_both(image=MagicMock())

        self.assertEqual(embedder._model.call_count, 1)
        self.assertEqual(guard_calls, [("forward", "dino")])
        self.assertEqual(vec_768.shape[0], 3)
        self.assertEqual(vec_128.shape[0], 2)

    def test_embed_768_enables_autocast_on_cuda(self):
        embedder = DINOEmbedder.__new__(DINOEmbedder)
        embedder.device = "cuda"
        embedder.enable_amp = True
        embedder.input_size = 224
        embedder.load_model = lambda: None
        embedder._processor = MagicMock(return_value={"pixel_values": _FakeInputTensor()})
        fake_last_hidden_state = _FakeTensor(np.array([[[1.0, 2.0, 3.0]]], dtype=np.float32))
        embedder._model = MagicMock(return_value=SimpleNamespace(last_hidden_state=fake_last_hidden_state))

        autocast_enabled_flags = []

        @contextmanager
        def _autocast(device_type=None, dtype=None, enabled=False):
            autocast_enabled_flags.append(bool(enabled))
            yield

        with patch("torch.cuda.is_available", return_value=True), patch("torch.autocast", side_effect=_autocast):
            vec = embedder.embed_768(Image.new("RGB", (320, 160), "white"))

        self.assertEqual(vec.shape[0], 3)
        self.assertTrue(autocast_enabled_flags)
        self.assertTrue(autocast_enabled_flags[-1])


if __name__ == "__main__":
    unittest.main()
