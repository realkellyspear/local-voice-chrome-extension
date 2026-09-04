#!/usr/bin/env bash
# LocalVoice Chrome — Linux/macOS setup script
set -e

cd "$(dirname "$0")"

echo "=== LocalVoice Chrome :: Backend Setup ==="

if [ ! -d ".venv" ]; then
    echo "[*] Creating virtual environment..."
    python3 -m venv .venv
fi

# shellcheck disable=1091
source .venv/bin/activate

echo "[*] Upgrading pip..."
pip install --upgrade pip

echo "[*] Installing PyTorch with CUDA 12.1 support (latest compatible)..."
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

echo "[*] Installing remaining dependencies..."
pip install -r requirements.txt

mkdir -p voices

echo "[*] Done. Starting server on http://127.0.0.1:8000 ..."
python server.py