# 🎙️ **LocalVoice Chrome**

**Highlight. Right-click. Listen.** A fully local, private text-to-speech
browser ecosystem — no cloud, no API keys, no telemetry. Your text never
leaves your machine.

Powered by a FastAPI backend running **XTTS v2** (zero-shot voice cloning
from your own `.wav`/`.mp3` samples) or **Kokoro-82M** (ultra-low latency),
and a Manifest V3 Chrome extension.

## **Architecture**

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│   Chrome Extension  │  HTTP   │        FastAPI Backend           │
│  (Manifest V3)      │ ──────► │      http://127.0.0.1:8000       │
│                     │         │                                  │
│ ┌─────────────────┐ │  /tts   │  ┌────────────────────────────┐  │
│ │ background.js   │ │  POST   │  │  model_loader.py           │  │
│ │ service worker  │ │         │  │  ┌──────────┐ ┌─────────┐  │  │
│ └────────┬────────┘ │         │  │  │ XTTS v2  │ │ Kokoro  │  │  │
│          ▼          │         │  │  └──────────┘ └─────────┘  │  │
│ ┌─────────────────┐ │         │  │     PyTorch (CUDA/CPU)     │  │
│ │ offscreen.js    │ │ ◄────── │  └────────────────────────────┘  │
│ │ Web Audio API   │ │ base64  │                                  │
│ └─────────────────┘ │  WAV    │  ┌────────────────────────────┐  │
│                     │         │  │  /voices/*.wav  *.mp3      │  │
│ ┌─────────────────┐ │         │  └────────────────────────────┘  │
│ │ content.js      │ │         │                                  │
│ │ hotkeys +       │ │         │                                  │
│ │ highlight       │ │         │                                  │
│ └─────────────────┘ │         │                                  │
└─────────────────────┘         └──────────────────────────────────┘
```

## **Features**

- 🖱️ **Right-click** any selected text → *Read Aloud with Local Voice*
- ⌨️ **Hotkey** `Ctrl+Shift+S` to read selection, `Esc` to stop
- 🎚️ **Speed control** (0.5×–2.0×) and dynamic voice picker
- 🔊 Playback via Web Audio API in an offscreen document (MV3-safe)
- 🧠 **Zero-shot voice cloning** — drop any 6–30 s clean sample in `/voices`
- 🎨 Dark glassmorphism popup with live backend status
- 🛡️ 100% offline — the server binds to `127.0.0.1` only

## **Requirements**

| Component | Minimum |
|---|---|
| OS | Windows 10/11, Linux, macOS (CPU mode) |
| Python | 3.10 – 3.12 |
| GPU (optional) | NVIDIA RTX with CUDA 12.1, ≥ 4 GB VRAM (XTTS) / 2 GB (Kokoro) |
| Browser | Chrome / Edge / Brave (MV3) |

### **GPU Driver Guidance**

- Install the latest **NVIDIA Game Ready or Studio driver** (≥ 555.xx recommended).
- Verify: `nvidia-smi` should show driver supporting **CUDA 12.1+**.
- The setup scripts install the `cu121` PyTorch wheels automatically.
- No GPU? Everything falls back to CPU transparently (XTTS ~5–15 s/page,
  Kokoro near real-time even on CPU).

## **Installation**

### **1. Backend**

**Windows:**
```bat
cd backend
setup.bat
```

**Linux / macOS:**
```bash
cd backend
chmod +x setup.sh
./setup.sh
```

Then drop voice samples into `backend/voices/` (any `.wav` or `.mp3`,
6–30 seconds of clean speech works best) and restart the server.

Optional engine switch (Kokoro):
```bash
pip install kokoro soundfile
set LOCALVOICE_ENGINE=kokoro      # Windows
export LOCALVOICE_ENGINE=kokoro   # Linux/macOS
```

## ⚠️**Troubleshooting & Bleeding Edge Hardware**

**PyTorch 2.6 Weights-Only Security Block**
If the backend crashes on startup with a `WeightsUnpickler` error regarding `XttsConfig`, PyTorch is blocking the model load due to strict security defaults introduced in version 2.6. To bypass this and force the engine to load, inject these three lines at the absolute top of `server.py`:

```python
import torch
from TTS.tts.configs.xtts_config import XttsConfig
torch.serialization.add_safe_globals([XttsConfig])
```

### **RTX 50-Series (Blackwell) Compatibility**

If you are running an RTX 5060 Ti or newer, standard PyTorch binaries will likely throw kernel mismatch errors. The Blackwell architecture runs on CUDA capability sm_120. You must use PyTorch binaries compiled specifically for CUDA 12.8 or newer to ensure the framework can actually communicate with your silicon.

### **2. Chrome Extension**

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `/extension` folder
4. (Optional) add 16/48/128 px PNG icons and keep the `icons` block in
   `manifest.json`, or remove the block if you skip icons.

## **Usage**

1. Make sure the backend is running (`http://127.0.0.1:8000`).
2. Click the LocalVoice icon — the pill should show **Connected**.
3. Pick a voice, set your speed.
4. Select any text on a webpage → right-click → **Read Aloud with Local Voice**.
   Or press `Ctrl+Shift+S`.
5. Esc or the ⏹ button stops playback.

## **API Reference**

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Server status, GPU info, engine state |
| `/voices` | GET | List available voice files |
| `/voices/rescan` | POST | Re-scan the voices directory |
| `/tts` | POST | `{ "text", "voice", "speed", "response_format" }` → WAV or base64 |
| `/memory/free` | POST | Clear CUDA cache |

## **Project Tree**

```
LocalVoiceChrome/
├── README.md
├── .gitignore
├── backend/
│   ├── server.py
│   ├── model_loader.py
│   ├── requirements.txt
│   ├── setup.sh
│   ├── setup.bat
│   └── voices/            # your .wav / .mp3 samples
└── extension/
    ├── manifest.json
    ├── background.js
    ├── content.js
    ├── offscreen.html
    ├── offscreen.js
    ├── popup.html
    ├── popup.css
    └── popup.js
```

## **Privacy**

All synthesis happens on your hardware. The extension only talks to
`127.0.0.1:8000`. No analytics, no third-party requests, ever.

## **License**

MIT — see [LICENSE](LICENSE).
