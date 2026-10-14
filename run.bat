@echo off
title DuoCinema - Movie Watch Party
echo ===================================================
echo     DuoCinema - Watch Movies Together & Video Call
echo ===================================================
echo.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [!] Virtual environment not found. Setting up...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

echo Starting DuoCinema Server...
start "" http://localhost:8000
python app.py

pause
