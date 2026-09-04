import os
import base64
import logging
from pathlib import Path
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, Field, ConfigDict

from model_loader import TTSModel, SUPPORTED_EXTENSIONS

logging.basicConfig(level=logging.INFO, format="[LocalVoice] %(levelname)s: %(message)s")
logger = logging.getLogger("server")

BASE_DIR = Path(__file__).resolve().parent
VOICES_DIR = BASE_DIR / "voices"
VOICES_DIR.mkdir(exist_ok=True)

tts = TTSModel.get_instance()

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting LocalVoice backend at %s", BASE_DIR)
    logger.info("CUDA available: %s", torch.cuda.is_available())
    if torch.cuda.is_available():
        logger.info("GPU: %s", torch.cuda.get_device_name(0))
    try:
        tts.load()
    except Exception as exc:
        logger.error("Model failed to load at startup: %s", exc)
    yield
    logger.info("Shutting down LocalVoice backend")

app = FastAPI(title="LocalVoice Chrome API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def scan_voices() -> list[dict]:
    voices = []
    for entry in sorted(VOICES_DIR.iterdir()):
        if entry.is_file() and entry.suffix.lower() in SUPPORTED_EXTENSIONS:
            voices.append(
                {
                    "name": entry.stem,
                    "filename": entry.name,
                    "format": entry.suffix.lower().lstrip("."),
                    "size_bytes": entry.stat().st_size,
                }
            )
    return voices

class TTSRequest(BaseModel):
    model_config = ConfigDict(strict=True)
    text: str = Field(..., min_length=1, max_length=10000)
    voice: Optional[str] = None
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    response_format: str = Field(default="wav")

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "server": "LocalVoice Chrome",
        "version": "1.0.0",
        "model_loaded": tts._loaded,
        "engine": tts.engine_name,
        "device": tts.device,
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "vram_allocated_mb": round(torch.cuda.memory_allocated() / 1024 ** 2, 1)
        if torch.cuda.is_available()
        else None,
    }

@app.get("/voices")
async def list_voices() -> JSONResponse:
    return JSONResponse({"voices": scan_voices()})

@app.post("/tts")
async def tts_endpoint(req: TTSRequest):
    try:
        voice_path = None
        if req.voice:
            voice_path = (VOICES_DIR / req.voice).resolve()
            if VOICES_DIR.resolve() not in voice_path.parents and voice_path.parent != VOICES_DIR.resolve():
                raise HTTPException(status_code=400, detail="Invalid voice path.")
            if not voice_path.exists():
                raise HTTPException(status_code=404, detail=f"Voice '{req.voice}' not found.")

        text = " ".join(req.text.split())
        if not text:
            raise HTTPException(status_code=400, detail="Text is empty after sanitization.")

        audio, sr = tts.synthesize(text, str(voice_path) if voice_path else None, req.speed)

        if req.response_format == "base64":
            wav_bytes = TTSModel.audio_to_wav_bytes(audio, sr)
            return JSONResponse(
                {
                    "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
                    "sample_rate": sr,
                    "duration_seconds": round(len(audio) / sr, 3),
                }
            )

        wav_bytes = TTSModel.audio_to_wav_bytes(audio, sr)
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "X-Sample-Rate": str(sr),
                "X-Duration-Seconds": f"{len(audio) / sr:.3f}",
            },
        )

    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("TTS synthesis failed")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {exc}")

@app.post("/voices/rescan")
async def rescan_voices() -> dict:
    voices = scan_voices()
    return {"voices": voices, "count": len(voices)}

@app.post("/memory/free")
async def free_memory() -> dict:
    tts.free_memory()
    return {"status": "cuda cache cleared"}

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        log_level="info",
    )