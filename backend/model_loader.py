"""
model_loader.py — Encapsulates TTS model initialization, VRAM management,
audio preprocessing and inference for LocalVoice Chrome.

Engines:
  - "xtts"   : Coqui XTTS v2 (zero-shot voice cloning from a reference wav/mp3). Default.
  - "kokoro" : Kokoro-82M (ultra-low latency, built-in premium voices).

The engine is selected with the LOCALVOICE_ENGINE environment variable.
"""

import io
import os
import logging
import threading
from typing import Optional

import numpy as np
import soundfile as sf
import torch

logging.basicConfig(level=logging.INFO, format="[LocalVoice] %(levelname)s: %(message)s")
logger = logging.getLogger("model_loader")

SUPPORTED_EXTENSIONS = (".wav", ".mp3")

# XTTS v2 outputs 24 kHz audio.
XTTS_SAMPLE_RATE = 24000
# Kokoro outputs 24 kHz audio.
KOKORO_SAMPLE_RATE = 24000


class TTSModel:
    """
    Thread-safe singleton-style wrapper around the active TTS engine.
    Loads weights once, manages device placement (CUDA if available),
    and exposes synthesize() -> (np.ndarray, sample_rate).
    """

    _instance: Optional["TTSModel"] = None
    _lock = threading.Lock()

    def __init__(self, engine: Optional[str] = None):
        self.engine_name = (engine or os.environ.get("LOCALVOICE_ENGINE", "xtts")).lower()
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.sample_rate = XTTS_SAMPLE_RATE
        self._model = None
        self._kokoro_state = None
        self._infer_lock = threading.Lock()
        self._loaded = False

    # ------------------------------------------------------------------ #
    @classmethod
    def get_instance(cls) -> "TTSModel":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ------------------------------------------------------------------ #
    def load(self) -> None:
        if self._loaded:
            return
        logger.info("Loading engine '%s' on device '%s'...", self.engine_name, self.device)
        if self.engine_name == "kokoro":
            self._load_kokoro()
        else:
            self.engine_name = "xtts"
            self._load_xtts()
        self._loaded = True
        self.log_vram()

    # ------------------------------------------------------------------ #
    def _load_xtts(self) -> None:
        from TTS.api import TTS

        os.environ.setdefault("COQUI_TOS_AGREED", "1")
        self._model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        self._model.to(self.device)   # modern way; works with TTS >=0.27
        logger.info("XTTS v2 loaded.")

    def _load_kokoro(self) -> None:
        try:
            from kokoro import KPipeline
        except ImportError as exc:
            raise RuntimeError(
                "Kokoro engine selected but the 'kokoro' package is not installed. "
                "Run: pip install kokoro soundfile"
            ) from exc
        lang = os.environ.get("LOCALVOICE_KOKORO_LANG", "a")  # 'a' = American English
        self._kokoro_state = KPipeline(lang_code=lang)
        logger.info("Kokoro-82M loaded.")

    # ------------------------------------------------------------------ #
    def log_vram(self) -> None:
        if self.device == "cuda":
            allocated = torch.cuda.memory_allocated() / 1024 ** 2
            reserved = torch.cuda.memory_reserved() / 1024 ** 2
            logger.info("VRAM allocated: %.1f MB | reserved: %.1f MB", allocated, reserved)
        else:
            logger.info("Running on CPU — expect slower synthesis.")

    # ------------------------------------------------------------------ #
    @staticmethod
    def load_reference_audio(path: str) -> str:
        """
        XTTS accepts wav/mp3 paths directly, but mp3s are normalized by
        converting through pydub -> wav in a temp cache dir when needed.
        Returns a path XTTS can consume.
        """
        if path.lower().endswith(".wav"):
            return path
        from pydub import AudioSegment

        cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio_cache")
        os.makedirs(cache_dir, exist_ok=True)
        cached = os.path.join(cache_dir, os.path.basename(path) + ".wav")
        if not os.path.exists(cached):
            logger.info("Converting reference audio to wav: %s", path)
            AudioSegment.from_file(path).export(cached, format="wav")
        return cached

    # ------------------------------------------------------------------ #
    def synthesize(self, text: str, voice_path: Optional[str], speed: float = 1.0) -> tuple[np.ndarray, int]:
        """
        Returns (audio_float32_mono, sample_rate).
        """
        if not self._loaded:
            self.load()
        with self._infer_lock:
            if self.engine_name == "kokoro":
                return self._synthesize_kokoro(text, speed)
            return self._synthesize_xtts(text, voice_path, speed)

    # ------------------------------------------------------------------ #
    def _synthesize_xtts(self, text: str, voice_path: Optional[str], speed: float) -> tuple[np.ndarray, int]:
        if not voice_path or not os.path.exists(voice_path):
            raise FileNotFoundError(f"Voice file not found: {voice_path}")
        ref = self.load_reference_audio(voice_path)
        wav = self._model.tts(
            text=text,
            speaker_wav=ref,
            language=self._detect_language(text),
            speed=float(speed),
        )
        audio = np.asarray(wav, dtype=np.float32)
        # Gentle peak normalization to avoid clipping.
        peak = np.max(np.abs(audio)) or 1.0
        if peak > 1.0:
            audio = audio / peak
        return audio, XTTS_SAMPLE_RATE

    def _synthesize_kokoro(self, text: str, speed: float) -> tuple[np.ndarray, int]:
        voice = os.environ.get("LOCALVOICE_KOKORO_VOICE", "af_heart")
        chunks = []
        for result in self._kokoro_state(text, voice=voice, speed=float(speed)):
            chunks.append(np.asarray(result.audio, dtype=np.float32))
        if not chunks:
            raise RuntimeError("Kokoro produced no audio for the given text.")
        audio = np.concatenate(chunks)
        peak = np.max(np.abs(audio)) or 1.0
        if peak > 1.0:
            audio = audio / peak
        return audio, KOKORO_SAMPLE_RATE

    # ------------------------------------------------------------------ #
    @staticmethod
    def _detect_language(text: str) -> str:
        """XTTS supports: en, es, fr, de, it, pt, pl, tr, ru, nl, cs, ar, zh-cn, ja, hu, ko, hi."""
        try:
            from langdetect import detect  # optional dependency
            lang = detect(text)
            mapping = {
                "en": "en", "es": "es", "fr": "fr", "de": "de", "it": "it",
                "pt": "pt", "pl": "pl", "tr": "tr", "ru": "ru", "nl": "nl",
                "cs": "cs", "ar": "ar", "zh-cn": "zh-cn", "zh": "zh-cn",
                "ja": "ja", "hu": "hu", "ko": "ko", "hi": "hi",
            }
            return mapping.get(lang, "en")
        except Exception:
            return "en"

    # ------------------------------------------------------------------ #
    @staticmethod
    def audio_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
        buffer = io.BytesIO()
        sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_16")
        return buffer.getvalue()

    # ------------------------------------------------------------------ #
    def free_memory(self) -> None:
        import gc
        gc.collect()
        if self.device == "cuda":
            torch.cuda.empty_cache()
            logger.info("CUDA cache cleared.")