import os
import sys
import warnings
import uvicorn

# 1. Suppress pkg_resources UserWarnings
warnings.filterwarnings("ignore", category=UserWarning, module="pkg_resources")

# 2. Ensure the script adds the current directory to sys.path
sys.path.append(os.getcwd())

if __name__ == "__main__":
    print("Starting Vision Core Server...")

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    reload = os.environ.get("RELOAD", "false").lower() in ("1", "true", "yes")
    workers = int(os.environ.get("WORKERS", 1))
    log_level = os.environ.get("LOG_LEVEL", "info").lower()

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        workers=workers if not reload else 1,
        log_level=log_level,
    )
