#!/usr/bin/env python3
"""
Ultra-fast launcher for the Chess Move Tree application.

Defaults favour responsiveness:
- Installs the binary on demand (unless told otherwise).
- Seeds the database at depth 0 for an instant first load.
- Streams server logs live and opens the browser once the server announces itself.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from shutil import which
from typing import Dict, Iterable, Optional, Tuple


CARGO_BIN_DIR = Path.home() / ".cargo" / "bin"
EXECUTABLE_NAME = "chess-move-tree.exe" if os.name == "nt" else "chess-move-tree"
SERVER_URL = "http://localhost:8080"
DATABASE_PATH = Path("chess_tree.db")
SERVER_READY_TOKEN = "Tree visualization server running on"


def log_step(label: str, started_at: float) -> None:
    elapsed = time.perf_counter() - started_at
    print(f"[start.py] {label} completed in {elapsed:.2f}s.")


def ensure_cargo_bin() -> Path:
    if not CARGO_BIN_DIR.exists():
        raise FileNotFoundError(
            f"Cargo bin directory not found at '{CARGO_BIN_DIR}'. "
            "Install Rust via rustup (https://rustup.rs/) before running this script."
        )
    return CARGO_BIN_DIR


def build_env() -> Dict[str, str]:
    env = os.environ.copy()
    try:
        cargo_bin = str(ensure_cargo_bin())
    except FileNotFoundError:
        # If cargo bin directory is missing, rely on existing PATH and re-raise if cargo is also missing.
        cargo_bin = None

    existing_path = env.get("PATH", "")
    path_entries = existing_path.split(os.pathsep) if existing_path else []

    if cargo_bin and cargo_bin not in path_entries:
        env["PATH"] = os.pathsep.join([cargo_bin, existing_path])

    if which("cargo", path=env["PATH"]) is None:
        raise FileNotFoundError(
            "Cargo executable not found. Install Rust via rustup (https://rustup.rs/) before running this script."
        )

    return env


def stream_process_output(process: subprocess.Popen[str], prefix: str) -> None:
    assert process.stdout is not None

    def _pump() -> None:
        for raw_line in process.stdout:
            if not raw_line:
                continue
            print(f"{prefix}{raw_line}", end="")

    threading.Thread(target=_pump, name=f"{prefix}-pump", daemon=True).start()


def spawn_with_stream(
    cmd: Iterable[str],
    env: Dict[str, str],
    *,
    prefix: str,
    background: bool = False,
    check: bool = True,
) -> Tuple[subprocess.Popen[str], Optional[int]]:
    printable = " ".join(cmd)
    print(f"[start.py] Spawning: {printable}")
    process = subprocess.Popen(
        list(cmd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    stream_process_output(process, prefix)

    if background:
        return process, None

    return_code = process.wait()
    if check and return_code != 0:
        raise subprocess.CalledProcessError(return_code, process.args)
    return process, return_code


def locate_binary(env: Dict[str, str], binary_path: Path) -> Optional[Path]:
    if binary_path.exists():
        return binary_path
    binary_in_path = which(EXECUTABLE_NAME, path=env.get("PATH"))
    if binary_in_path:
        return Path(binary_in_path)
    return None


def ensure_binary(env: Dict[str, str], binary_path: Path, *, skip_install: bool, force_install: bool) -> Path:
    resolved = locate_binary(env, binary_path)

    if skip_install:
        if resolved:
            print(f"[start.py] Skipping installation (requested). Using '{resolved}'.")
            return resolved
        raise FileNotFoundError(
            f"[start.py] --skip-install provided but '{EXECUTABLE_NAME}' not found in {binary_path} or PATH."
        )

    if force_install or not resolved:
        action = "Reinstalling" if force_install else "Installing"
        print(f"[start.py] {action} chess-move-tree from local path...")
        process, _ = spawn_with_stream(
            ["cargo", "install", "--path", "."],
            env,
            prefix="[cargo] ",
        )
        process.wait()
        resolved = locate_binary(env, binary_path)
        if not resolved:
            raise FileNotFoundError(
                f"[start.py] Installation completed but '{EXECUTABLE_NAME}' still missing. "
                "Check cargo install logs above."
            )
    else:
        print(f"[start.py] Found existing binary ({resolved})")

    return resolved


def wait_for_root(path: Path, timeout: float = 15.0) -> None:
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if not path.exists():
            time.sleep(0.2)
            continue
        try:
            with sqlite3.connect(path) as conn:
                cursor = conn.execute("SELECT 1 FROM positions WHERE depth = 0 LIMIT 1")
                if cursor.fetchone():
                    return
        except sqlite3.Error:
            pass
        time.sleep(0.2)
    raise TimeoutError(
        f"Timed out waiting for root position to appear in '{path}'. "
        "Check generator logs for potential errors."
    )


def ensure_database(
    env: Dict[str, str],
    binary_path: Path,
    *,
    depth: int,
    regenerate: bool,
) -> Optional[subprocess.Popen[str]]:
    start_time = time.perf_counter()
    if regenerate and DATABASE_PATH.exists():
        print(f"[start.py] Removing existing database '{DATABASE_PATH}' (regenerate requested).")
        DATABASE_PATH.unlink()

    if DATABASE_PATH.exists():
        print(f"[start.py] Using existing database '{DATABASE_PATH}'")
        print(
            f"[start.py] Database check finished in {time.perf_counter() - start_time:.2f}s (no regeneration needed)."
        )
        return None

    depth = max(0, depth)
    print(f"[start.py] '{DATABASE_PATH}' not found; generating starter tree (depth {depth})...")
    cmd = [str(binary_path), "--depth", str(depth)]

    # Run generator with streaming output. For depth > 0 keep it running in background to finish remaining work
    background = depth > 0
    process, _ = spawn_with_stream(cmd, env, prefix="[generator] ", background=background)

    try:
        wait_for_root(DATABASE_PATH)
        print(
            f"[start.py] Root position available after {time.perf_counter() - start_time:.2f}s."
        )
    except TimeoutError:
        if background:
            process.terminate()
        raise

    if background:
        print("[start.py] Root position ready. Continuing generation in background while server starts...")
        return process

    # depth == 0 -> wait for completion
    return_code = process.wait()
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, process.args)
    return None


def launch_server(
    env: Dict[str, str],
    binary_path: Path,
    *,
    open_browser: bool,
    background_tasks: Optional[list[subprocess.Popen[str]]] = None,
) -> None:
    server_start = time.perf_counter()
    print("[start.py] Starting visualization server (Ctrl+C to stop)...")
    process = subprocess.Popen(
        [str(binary_path), "--serve-only"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    background_tasks = background_tasks or []
    browser_opened = not open_browser

    try:
        assert process.stdout is not None  # For type checkers
        for line in process.stdout:
            if not line:
                continue
            print(f"[server] {line}", end="")

            if not browser_opened and SERVER_READY_TOKEN in line:
                print(f"[start.py] Opening browser at {SERVER_URL}")
                webbrowser.open(SERVER_URL, new=1, autoraise=True)
                browser_opened = True
                print(
                    f"[start.py] Server reported ready in {time.perf_counter() - server_start:.2f}s."
                )

            alive_background = []
            for task in background_tasks:
                return_code = task.poll()
                if return_code is None:
                    alive_background.append(task)
                    continue
                if return_code == 0:
                    print(
                        f"[start.py] Background task '{task.args}' completed successfully "
                        f"after {time.perf_counter() - server_start:.2f}s."
                    )
                    continue
                if return_code != 0:
                    print(
                        f"[start.py] WARNING: Background task '{task.args}' exited with code {return_code}",
                        file=sys.stderr,
                    )
            background_tasks = alive_background

        return_code = process.wait()
        if return_code != 0:
            raise subprocess.CalledProcessError(return_code, process.args)
    except KeyboardInterrupt:
        print("\n[start.py] Ctrl+C received, stopping server...")
        process.terminate()
    finally:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        for task in background_tasks:
            if task.poll() is None:
                try:
                    task.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    task.kill()
        print("[start.py] Server stopped.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Responsive launcher for the chess-move-tree visualization.")
    parser.add_argument(
        "--depth",
        type=int,
        default=0,
        help="Initial generation depth when seeding a new database (default: 0 for instant startup).",
    )
    parser.add_argument(
        "--regenerate",
        action="store_true",
        help="Discard any existing database and regenerate it at the chosen depth.",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the browser automatically when the server becomes ready.",
    )
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="Assume the binary is already installed (error if it cannot be found).",
    )
    parser.add_argument(
        "--force-install",
        action="store_true",
        help="Force reinstallation of the binary even if one already exists.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    overall_started = time.perf_counter()
    env_started = time.perf_counter()
    env = build_env()
    log_step("Environment preparation", env_started)
    binary_path = CARGO_BIN_DIR / EXECUTABLE_NAME

    try:
        binary_started = time.perf_counter()
        resolved_binary = ensure_binary(
            env,
            binary_path,
            skip_install=args.skip_install,
            force_install=args.force_install,
        )
        log_step("Binary bootstrap", binary_started)
        background_jobs = []
        database_started = time.perf_counter()
        generator_job = ensure_database(
            env,
            resolved_binary,
            depth=args.depth,
            regenerate=args.regenerate,
        )
        log_step("Database warm-up dispatch", database_started)
        if generator_job:
            background_jobs.append(generator_job)
        launch_server(
            env,
            resolved_binary,
            open_browser=not args.no_browser,
            background_tasks=background_jobs,
        )
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[start.py] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        log_step("Launcher lifecycle", overall_started)


if __name__ == "__main__":
    main()


