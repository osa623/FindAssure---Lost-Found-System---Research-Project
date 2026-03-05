from __future__ import annotations

from contextlib import contextmanager
import logging
import threading
import time
from typing import Iterator

logger = logging.getLogger(__name__)

# Global, process-wide GPU gate shared by all service threads.
GPU_SEMAPHORE = threading.Semaphore(1)


@contextmanager
def gpu_inference_guard(op_name: str, component: str) -> Iterator[None]:
    comp = str(component or "unknown")
    op = str(op_name or "unknown")
    wait_start = time.perf_counter()
    logger.debug("GPU_SEMAPHORE_WAIT component=%s op=%s", comp, op)
    GPU_SEMAPHORE.acquire()
    hold_start = time.perf_counter()
    queue_ms = (hold_start - wait_start) * 1000.0
    logger.debug(
        "GPU_SEMAPHORE_ACQUIRED component=%s op=%s queue_ms=%.2f",
        comp,
        op,
        queue_ms,
    )
    try:
        yield
    finally:
        hold_ms = (time.perf_counter() - hold_start) * 1000.0
        logger.debug(
            "GPU_SEMAPHORE_RELEASED component=%s op=%s hold_ms=%.2f",
            comp,
            op,
            hold_ms,
        )
        GPU_SEMAPHORE.release()
