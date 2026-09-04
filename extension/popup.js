// popup.js — uses background service worker to fetch from backend

const API_BASE = "http://127.0.0.1:8000";

let currentVoice = null;
let currentSpeed = 1.0;

// UI elements
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const voiceSelect = document.getElementById("voice-select");
const refreshBtn = document.getElementById("refresh-btn");
const speedSlider = document.getElementById("speed-slider");
const speedValue = document.getElementById("speed-value");
const playBtn = document.getElementById("play-btn");
const pauseBtn = document.getElementById("pause-btn");
const stopBtn = document.getElementById("stop-btn");
const textArea = document.getElementById("text-area");
const engineInfo = document.getElementById("engine-info");
const deviceInfo = document.getElementById("device-info");

// Load settings from storage
async function loadSettings() {
  const { voice, speed } = await chrome.storage.local.get(["voice", "speed"]);
  currentVoice = voice || "";
  currentSpeed = speed || 1.0;
  speedSlider.value = currentSpeed;
  speedValue.textContent = currentSpeed.toFixed(1) + "×";
  if (voiceSelect) voiceSelect.value = currentVoice;
}

// Save settings
async function saveSettings() {
  await chrome.storage.local.set({
    voice: currentVoice,
    speed: currentSpeed,
  });
}

// Fetch via background (bypasses popup CORS/permissions)
async function fetchViaBackground(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "FETCH",
        url: API_BASE + endpoint,
        options: options,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.data);
        }
      }
    );
  });
}

// Update status
async function updateStatus() {
  try {
    const data = await fetchViaBackground("/health");
    statusPill.className = "status-pill connected";
    statusText.textContent = "Connected";
    engineInfo.textContent = "engine: " + (data.engine || "—");
    deviceInfo.textContent = "device: " + (data.device || "—");
    return true;
  } catch (e) {
    statusPill.className = "status-pill disconnected";
    statusText.textContent = "Disconnected";
    engineInfo.textContent = "engine: —";
    deviceInfo.textContent = "device: —";
    return false;
  }
}

// Load voice list
async function loadVoices() {
  try {
    const data = await fetchViaBackground("/voices");
    const voices = data.voices || [];
    voiceSelect.innerHTML = "";
    if (voices.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No voice files found";
      voiceSelect.appendChild(opt);
      voiceSelect.disabled = true;
      return;
    }
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.filename;
      opt.textContent = v.name + " (" + v.format + ")";
      voiceSelect.appendChild(opt);
    });
    voiceSelect.disabled = false;

    // If no voice is stored, default to the first one
    if (!currentVoice) {
      currentVoice = voices[0].filename;
      await saveSettings();
    }
    voiceSelect.value = currentVoice;
  } catch (e) {
    voiceSelect.innerHTML = '<option value="">Failed to load voices</option>';
    voiceSelect.disabled = true;
  }
}

// Refresh voices
refreshBtn.addEventListener("click", async () => {
  await loadVoices();
});

// Speed slider
speedSlider.addEventListener("input", () => {
  currentSpeed = parseFloat(speedSlider.value);
  speedValue.textContent = currentSpeed.toFixed(1) + "×";
  saveSettings();
});

// Voice selection
voiceSelect.addEventListener("change", () => {
  currentVoice = voiceSelect.value;
  saveSettings();
});

// Play button – send text to background
playBtn.addEventListener("click", async () => {
  const text = textArea.value.trim() || "Hello, this is a test.";
  if (!text) return;
  playBtn.disabled = true;
  try {
    const response = await fetchViaBackground("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        voice: currentVoice || "",
        speed: currentSpeed,
        response_format: "base64",
      }),
    });
    // response contains audio_base64
    if (response.audio_base64) {
      // Send to background to play
      await chrome.runtime.sendMessage({
        type: "PLAY_AUDIO",
        audioBase64: response.audio_base64,
        duration: response.duration_seconds || 0,
      });
    }
  } catch (e) {
    console.error("Play error:", e);
  } finally {
    playBtn.disabled = false;
  }
});

// Pause / Stop – send control to background
pauseBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "PLAYBACK_CONTROL", action: "pause" });
});
stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "PLAYBACK_CONTROL", action: "stop" });
});

// Initialise
(async function init() {
  await loadSettings();
  await updateStatus();
  await loadVoices();
})();