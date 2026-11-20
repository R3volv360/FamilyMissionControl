"""Run Mission Control as the home server: build the frontend if it's out of date, then serve the app and its
API together on one port (default 5683).

    python serve.py                       # http://mission-control.local:5683 for every device on the home Wi-Fi
    python serve.py --port 8080 --log logs\\server.log
    python serve.py --name kitchen        # announce as http://kitchen.local:5683 instead
    python serve.py --no-name             # don't announce a .local name (use the PC's IP instead)

With --log, output is appended to that file (rolled over at 5 MB), for running from a scheduled task.

Started with the venv's pythonw.exe (Python without a console), nothing ever shows on screen: the server runs
inside this process and the frontend build runs hidden. Use --log then, or the output goes nowhere.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV_PY = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
LOG_LIMIT = 5_000_000
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # Windows: run console programs without a window


def newest_source_mtime() -> float:
    files = [FRONTEND / "index.html", FRONTEND / "package.json", FRONTEND / "vite.config.ts"]
    files += [p for p in (FRONTEND / "src").rglob("*") if p.is_file()]
    return max(p.stat().st_mtime for p in files if p.exists())


def needs_build() -> bool:
    built = FRONTEND / "dist" / "index.html"
    return not built.exists() or newest_source_mtime() > built.stat().st_mtime


def build_frontend(out) -> None:
    npm = shutil.which("npm")
    if not npm:
        sys.exit("npm not found on PATH; it's needed to build the frontend.")
    if not (FRONTEND / "node_modules").exists():
        subprocess.run([npm, "ci"], cwd=FRONTEND, check=True, stdout=out, stderr=subprocess.STDOUT,
                       creationflags=NO_WINDOW)
    subprocess.run([npm, "run", "build"], cwd=FRONTEND, check=True, stdout=out, stderr=subprocess.STDOUT,
                   creationflags=NO_WINDOW)


def open_log(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > LOG_LIMIT:
        path.replace(path.with_suffix(path.suffix + ".1"))
    return open(path, "a", buffering=1, encoding="utf-8")


def in_venv() -> bool:
    """True when this script is run by the backend venv's own Python (python.exe or pythonw.exe)."""
    return Path(sys.prefix).resolve() == (BACKEND / ".venv").resolve()


def serve_here(host: str, port: int) -> None:
    """Run the server inside this process. Under pythonw there's no console, so no child window either, and
    stopping the scheduled task stops the server with it."""
    os.chdir(BACKEND)  # backend/.env and the default ./data are relative to the backend folder
    sys.path.insert(0, str(BACKEND))
    import uvicorn

    uvicorn.run("app.main:app", host=host, port=port, workers=1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Serve Mission Control on the home network")
    ap.add_argument("--host", default="0.0.0.0", help="address to listen on (default: all, for the home network)")
    ap.add_argument("--port", type=int, default=5683)
    ap.add_argument("--build", action="store_true", help="rebuild the frontend even if it looks up to date")
    ap.add_argument("--log", type=Path, help="append output to this file instead of the console")
    ap.add_argument("--name", default="mission-control",
                    help="announce the server as http://<name>.local:<port> (default: mission-control)")
    ap.add_argument("--no-name", action="store_true", help="don't announce a .local name")
    args = ap.parse_args()

    if not VENV_PY.exists():
        sys.exit(f"No backend venv at {VENV_PY}. See README.md (Setup).")
    out = open_log(args.log if args.log.is_absolute() else ROOT / args.log) if args.log else None
    if out:  # everything, including errors and the server's own log lines, goes to the file
        sys.stdout = sys.stderr = out

    if args.build or needs_build():
        print("Building the frontend…", flush=True)
        build_frontend(out)

    where = f"http://{args.host}:{args.port}"
    if not args.no_name:
        os.environ.update(MC_LOCAL_NAME=args.name, MC_LOCAL_PORT=str(args.port))
        where += f", announced as http://{args.name}.local:{args.port}"
    print(f"Serving Mission Control on {where}", flush=True)
    # One worker: SQLite and the in-process background uploads expect a single process.
    try:
        if in_venv():
            serve_here(args.host, args.port)
            return
        cmd = [str(VENV_PY), "-m", "uvicorn", "app.main:app", "--host", args.host, "--port", str(args.port),
               "--workers", "1"]
        sys.exit(subprocess.run(cmd, cwd=BACKEND, stdout=out, stderr=subprocess.STDOUT if out else None,
                                creationflags=NO_WINDOW if out else 0).returncode)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
