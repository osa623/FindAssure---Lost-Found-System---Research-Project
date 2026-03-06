import sys
import threading
import time
import unittest
import importlib
from contextlib import contextmanager
from unittest.mock import MagicMock, patch


# Patch ultralytics before importing yolo_service so tests do not require the real dependency.
mock_ultralytics_module = MagicMock()
mock_ultralytics_module.YOLO = MagicMock()
original_ultralytics_module = sys.modules.get("ultralytics")
sys.modules["ultralytics"] = mock_ultralytics_module

# test_pp2_api.py injects a mocked app.services.yolo_service into sys.modules.
# Remove it so this file always imports the real module implementation.
original_yolo_service_module = sys.modules.get("app.services.yolo_service")
if original_yolo_service_module is not None:
    del sys.modules["app.services.yolo_service"]

yolo_service_module = importlib.import_module("app.services.yolo_service")
YoloService = yolo_service_module.YoloService

if original_ultralytics_module is None:
    del sys.modules["ultralytics"]
else:
    sys.modules["ultralytics"] = original_ultralytics_module


class _FakeBox:
    def __init__(self, cls_id, conf, xyxy):
        self.cls = [cls_id]
        self.conf = [conf]
        self.xyxy = [xyxy]


class _FakeResult:
    def __init__(self, boxes):
        self.boxes = boxes


class _FakeModel:
    def __init__(self, results):
        self.names = {0: "Wallet", 1: "Key", 2: "Backpack"}
        self._results = results
        self.call_count = 0

    def __call__(self, image_path_or_array, conf=0.25, verbose=False):
        self.call_count += 1
        return self._results


class TestYoloServiceDetections(unittest.TestCase):
    def setUp(self):
        with patch.object(YoloService, "_load_model", return_value=None):
            self.service = YoloService()
        # Keep default detection tests focused on parsing/sorting logic.
        self.service._warmup_done = True

    def test_detect_objects_sorted_and_truncated(self):
        self.service.model = _FakeModel(
            [
                _FakeResult(
                    [
                        _FakeBox(1, 0.41, [1, 1, 10, 10]),
                        _FakeBox(0, 0.93, [2, 2, 20, 20]),
                        _FakeBox(2, 0.70, [3, 3, 30, 30]),
                    ]
                )
            ]
        )

        detections = self.service.detect_objects("dummy.jpg", max_detections=2)

        self.assertEqual(len(detections), 2)
        self.assertEqual([round(d.confidence, 2) for d in detections], [0.93, 0.70])
        self.assertEqual(detections[0].bbox, (2, 2, 20, 20))

    def test_detect_objects_default_returns_all_sorted(self):
        self.service.model = _FakeModel(
            [
                _FakeResult(
                    [
                        _FakeBox(2, 0.50, [0, 0, 10, 10]),
                        _FakeBox(0, 0.99, [1, 1, 11, 11]),
                        _FakeBox(1, 0.60, [2, 2, 12, 12]),
                    ]
                )
            ]
        )

        detections = self.service.detect_objects("dummy.jpg")

        self.assertEqual(len(detections), 3)
        self.assertEqual([round(d.confidence, 2) for d in detections], [0.99, 0.60, 0.50])

    def test_warmup_idempotent_and_single_predict(self):
        self.service.model = _FakeModel([_FakeResult([])])
        self.service._warmup_done = False

        @contextmanager
        def _guard(_op_name, _component):
            yield

        with patch.object(yolo_service_module, "gpu_inference_guard", new=_guard):
            self.service.warmup()
            self.service.warmup()

        self.assertTrue(self.service._warmup_done)
        self.assertEqual(self.service.model.call_count, 1)

    def test_detect_objects_uses_gpu_guard(self):
        self.service.model = _FakeModel([_FakeResult([_FakeBox(0, 0.9, [1, 1, 10, 10])])])
        self.service._warmup_done = True
        guard_calls = []

        @contextmanager
        def _guard(op_name, component):
            guard_calls.append((op_name, component))
            yield

        with patch.object(yolo_service_module, "gpu_inference_guard", new=_guard):
            detections = self.service.detect_objects("dummy.jpg")

        self.assertEqual(len(detections), 1)
        self.assertEqual(guard_calls, [("predict", "yolo")])

    def test_detect_objects_serializes_predict_calls(self):
        class _ConcurrentModel:
            def __init__(self):
                self.names = {0: "Wallet"}
                self._gate = threading.Lock()
                self.active = 0
                self.max_active = 0
                self.call_count = 0

            def __call__(self, image_path_or_array, conf=0.25, verbose=False):
                with self._gate:
                    self.active += 1
                    self.call_count += 1
                    if self.active > self.max_active:
                        self.max_active = self.active
                time.sleep(0.05)
                with self._gate:
                    self.active -= 1
                return [_FakeResult([_FakeBox(0, 0.9, [1, 1, 10, 10])])]

        self.service.model = _ConcurrentModel()
        self.service._warmup_done = True

        @contextmanager
        def _guard(_op_name, _component):
            yield

        with patch.object(yolo_service_module, "gpu_inference_guard", new=_guard):
            threads = [
                threading.Thread(target=self.service.detect_objects, args=("dummy.jpg",))
                for _ in range(3)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

        self.assertEqual(self.service.model.call_count, 3)
        self.assertEqual(self.service.model.max_active, 1)


if __name__ == "__main__":
    unittest.main()
