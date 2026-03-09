import json
import logging
import threading
import time
from typing import Any, Dict, Optional

from app.config.settings import settings
from app.core.redis_client import get_healthy_redis_client

logger = logging.getLogger(__name__)

_memory_jobs: Dict[str, Dict[str, Any]] = {}
_memory_lock = threading.Lock()
_redis_fallback_active = False


def _job_key(task_id: str) -> str:
    return f"pre-analysis-job:{task_id}"


def _ttl_seconds() -> int:
    value = int(getattr(settings, "PRE_ANALYSIS_JOB_TTL_S", 900))
    return value if value > 0 else 900


def _now_ms() -> int:
    return int(time.time() * 1000)


def _log_redis_fallback(reason: Optional[str] = None) -> None:
    global _redis_fallback_active
    if _redis_fallback_active:
        return
    _redis_fallback_active = True
    if reason:
        logger.warning(
            "Pre-analysis job store falling back to in-memory storage because Redis is unavailable: %s",
            reason,
        )
    else:
        logger.warning(
            "Pre-analysis job store falling back to in-memory storage because Redis is unavailable."
        )


def _mark_redis_healthy() -> None:
    global _redis_fallback_active
    _redis_fallback_active = False


def _get_usable_redis_client():
    redis_client = get_healthy_redis_client()
    if redis_client is None:
        _log_redis_fallback()
        return None

    _mark_redis_healthy()
    return redis_client


def _save_memory_job(task_id: str, stored: Dict[str, Any], ttl: int) -> Dict[str, Any]:
    expires_at = time.time() + ttl
    with _memory_lock:
        _memory_jobs[task_id] = {
            "payload": stored,
            "expires_at": expires_at,
        }
    return stored


def _get_memory_job(task_id: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    with _memory_lock:
        entry = _memory_jobs.get(task_id)
        if not entry:
            return None
        if entry["expires_at"] <= now:
            _memory_jobs.pop(task_id, None)
            return None
        return entry["payload"]


def save_job(task_id: str, payload: Dict[str, Any], ttl_s: Optional[int] = None) -> Dict[str, Any]:
    ttl = ttl_s or _ttl_seconds()
    stored = {
        **payload,
        "taskId": task_id,
        "updatedAtMs": _now_ms(),
    }

    redis_client = _get_usable_redis_client()
    if redis_client is not None:
        try:
            redis_client.setex(_job_key(task_id), ttl, json.dumps(stored))
            return stored
        except Exception as exc:
            _log_redis_fallback(str(exc))

    return _save_memory_job(task_id, stored, ttl)


def get_job(task_id: str) -> Optional[Dict[str, Any]]:
    redis_client = _get_usable_redis_client()
    if redis_client is not None:
        try:
            raw = redis_client.get(_job_key(task_id))
            return json.loads(raw) if raw else None
        except Exception as exc:
            _log_redis_fallback(str(exc))

    return _get_memory_job(task_id)


def update_job(task_id: str, patch: Dict[str, Any], ttl_s: Optional[int] = None) -> Dict[str, Any]:
    current = get_job(task_id) or {"taskId": task_id}
    current.update(patch)
    return save_job(task_id, current, ttl_s=ttl_s)
