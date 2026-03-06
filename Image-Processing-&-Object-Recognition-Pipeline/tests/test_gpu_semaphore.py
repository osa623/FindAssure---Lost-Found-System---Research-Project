import threading
import time
import unittest

from app.services.gpu_semaphore import GPU_SEMAPHORE, gpu_inference_guard


class TestGpuSemaphore(unittest.TestCase):
    def test_guard_serializes_concurrent_sections(self):
        intervals = {}
        barrier = threading.Barrier(2)
        errors = []

        def _worker(name: str):
            try:
                barrier.wait(timeout=2.0)
                with gpu_inference_guard("forward", name):
                    start = time.perf_counter()
                    time.sleep(0.06)
                    end = time.perf_counter()
                intervals[name] = (start, end)
            except Exception as exc:  # pragma: no cover - defensive test path
                errors.append(exc)

        t1 = threading.Thread(target=_worker, args=("florence",), daemon=True)
        t2 = threading.Thread(target=_worker, args=("dino",), daemon=True)
        t1.start()
        t2.start()
        t1.join(timeout=3.0)
        t2.join(timeout=3.0)

        self.assertFalse(errors, f"worker errors: {errors}")
        self.assertEqual(len(intervals), 2)
        self.assertTrue(hasattr(GPU_SEMAPHORE, "acquire"))
        self.assertTrue(hasattr(GPU_SEMAPHORE, "release"))

        (a_start, a_end) = intervals["florence"]
        (b_start, b_end) = intervals["dino"]
        overlaps = (a_start < b_end) and (b_start < a_end)
        self.assertFalse(overlaps, f"critical sections overlapped: {intervals}")


if __name__ == "__main__":
    unittest.main()
