@echo off
setlocal

REM Windows wrapper that forwards to the cross-platform Python launcher.

where python >nul 2>&1
if errorlevel 1 (
    echo [start.bat] Python 3 is required. Install from https://www.python.org/downloads/.
    exit /b 1
)

python start.py %*

