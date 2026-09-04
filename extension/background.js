/**
 * background.js — MV3 service worker for LocalVoice Chrome.
 * Handles context menu creation, TTS fetch, and audio playback routing
 * through an offscreen document (required because service workers
 * cannot play audio or use the Web Audio API).
 */

const API_BASE = "http://127.0.0.1:8000";
const OFFSCREEN_URL = "offscreen.html";

let creatingOffscreen = null;

/* ------------------------------------------------------------------ */
/* Context menu                                                        */
/* ------------------------------------------------------------------ */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "localvoice-read",
    title: 'Read Aloud with Local Voice: "%s"',
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "localvoice-stop",
    title: "Stop LocalVoice Playback",
    contexts: ["all"],
  });
});

/* ------------------------------------------------------------------ */
/* Message router (popup + content script)                             */
/* ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "READ_TEXT":
      handleReadText(msg.text, msg.source || "hotkey")
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true; // async

    case "PLAYBACK_CONTROL":
      routeToOffscreen(msg)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case "SETTINGS_UPDATED":
      broadcastToTabs(msg);
      sendResponse({ ok: true });
      return false;

    case "FETCH":
  fetch(msg.url, msg.options || {})
    .then(res => res.json())
    .then(data => sendResponse({ data }))
    .catch(err => sendResponse({ error: err.message }));
  return true; // keep channel open for async response

    default:
      return false;
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "localvoice-read" && info.selectionText) {
    await handleReadText(info.selectionText, "contextmenu");
  } else if (info.menuItemId === "localvoice-stop") {
    await stopPlayback();
    await clearHighlights();
  }
});

/* ------------------------------------------------------------------ */
/* Core: read selected text                                            */
/* ------------------------------------------------------------------ */
async function handleReadText(rawText, source) {
  const text = (rawText || "").trim().slice(0, 10000);
  if (!text) return { ok: false, error: "No text selected." };

  const settings = await chrome.storage.local.get(["voice", "speed"]);
  const voice = settings.voice || "";
  const speed = Number(settings.speed) || 1.0;

  try {
    const res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, speed, response_format: "base64" }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Backend ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!data.audio_base64) throw new Error("Backend returned no audio.");

    await ensureOffscreen();
    await chrome.runtime.sendMessage({
      type: "PLAY_AUDIO",
      audioBase64: data.audio_base64,
      duration: data.duration_seconds || 0,
    });

    // Highlight the selection on the active tab while audio plays.
    if (source === "contextmenu" || source === "hotkey") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "HIGHLIGHT_PLAYING", duration: data.duration_seconds });
      }
    }

    return { ok: true, duration: data.duration_seconds };
  } catch (err) {
    console.error("[LocalVoice] TTS error:", err);
    await notifyError(err.message);
    return { ok: false, error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/* Playback control (play/pause/stop from popup)                       */
/* ------------------------------------------------------------------ */
async function stopPlayback() {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: "STOP" });
}

async function routeToOffscreen(msg) {
  await ensureOffscreen();
  await chrome.runtime.sendMessage(msg);
}

async function clearHighlights() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "CLEAR_HIGHLIGHT" }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Offscreen document management                                       */
/* ------------------------------------------------------------------ */
async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Plays locally synthesized TTS audio for read-aloud.",
    });
  }
  try {
    await creatingOffscreen;
  } catch (e) {
    if (!e.message.includes("Only a single offscreen")) throw e;
  } finally {
    creatingOffscreen = null;
  }
}

/* ------------------------------------------------------------------ */
/* Error badge                                                         */
/* ------------------------------------------------------------------ */
async function notifyError(message) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
    await chrome.action.setBadgeText({ text: "!" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  } catch (_) { /* ignore */ }
  console.warn("[LocalVoice]", message);
}
