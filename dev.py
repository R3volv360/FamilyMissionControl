"""Run the backend (FastAPI, auto-reload) and frontend (Vite) together for development.

    python dev.py

Open http://localhost:5173 on this PC, or http://<this-pc-ip>:5173 from a phone on the home Wi-Fi.
Vite proxies /api to the backend on 127.0.0.1:5683. Ctrl+C stops both.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV_PY = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def main() -> None:
    if not VENV_PY.exists():
        sys.exit(f"No backend venv at {VENV_PY}. See README.md (Setup).")
    npm = shutil.which("npm")
    if not npm:
        sys.exit("npm not found on PATH.")
    if not (FRONTEND / "node_modules").exists():
        subprocess.run([npm, "install"], cwd=FRONTEND, check=True)

    procs = [
        subprocess.Popen([str(VENV_PY), "-m", "uvicorn", "app.main:app", "--reload", "--port", "5683"], cwd=BACKEND),
        subprocess.Popen([npm, "run", "dev"], cwd=FRONTEND),
    ]
    try:
        while all(p.poll() is None for p in procs):
            try:
                procs[0].wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    main()
