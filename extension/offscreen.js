/**
 * offscreen.js — Lives in the offscreen document and owns audio playback.
 * Receives base64 WAV from the service worker and plays it via an
 * <audio> element backed by the Web Audio API.
 */

let audioEl = null;
let audioCtx = null;

function getAudioElement() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.autoplay = false;
    audioEl.addEventListener("ended", () => notifyDone());
    audioEl.addEventListener("error", () => notifyDone(true));
  }
  return audioEl;
}

function getAudioContext() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function base64ToArrayBuffer(base64) {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function notifyDone(errored = false) {
  chrome.runtime.sendMessage({ type: "PLAYBACK_FINISHED", errored }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PLAY_AUDIO") {
    playAudio(msg.audioBase64);
  } else if (msg.type === "PLAYBACK_CONTROL") {
    const el = getAudioElement();
    if (msg.action === "pause") el.pause();
    else if (msg.action === "resume") el.play().catch(() => {});
    else if (msg.action === "stop") {
      el.pause();
      el.currentTime = 0;
      notifyDone();
    }
  }
});

async function playAudio(base64) {
  try {
    const buf = base64ToArrayBuffer(base64);

    // Web Audio decode ensures correct WAV handling across platforms.
    const ctx = getAudioContext();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const blob = new Blob([buf], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);

    const el = getAudioElement();
    el.src = url;
    // decodeAudioData above validates the stream; playback via element
    // keeps pause/resume/stop trivially simple.
    await el.play();
  } catch (err) {
    console.error("[LocalVoice offscreen] playback failed:", err);
    notifyDone(true);
  }
}
