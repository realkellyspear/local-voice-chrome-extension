@echo off
REM LocalVoice Chrome - Windows setup script
cd /d "%~dp0"

echo === LocalVoice Chrome :: Backend Setup ===

if not exist ".venv" (
    echo [*] Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

echo [*] Upgrading pip...
python -m pip install --upgrade pip

echo [*] Installing PyTorch with CUDA 12.1 support (latest compatible)...
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

echo [*] Installing remaining dependencies...
pip install -r requirements.txt

if not exist voices mkdir voices

echo [*] Done. Starting server on http://127.0.0.1:8000 ...
python server.py
pause