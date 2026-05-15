// ============================================================
// Briefly. — Google Meet DOM Scraper (content_script.js)
// Injected into meet.google.com/* tabs
// Watches for active speaker changes and collects participant names
// ============================================================

let speakerTimeline = [];   // [ { name: "Sanjay", timestamp: 1234567890 } ]
let currentSpeaker = null;
let isTracking = false;
let domObserver = null;
let allParticipants = new Set(); // All names seen during the call

// ────────────────────────────────────────────────
// SELECTOR STRATEGIES (ordered by reliability)
// Google Meet obfuscates class names, so we use
// multiple fallbacks in case they update their DOM.
// ────────────────────────────────────────────────
const PARTICIPANT_TILE_SELECTORS = [
  '[data-participant-id]',
  '[jsmodel]',              // Meet wraps tiles in jsmodel elements
];

const NAME_IN_TILE_SELECTORS = [
  '.zWGUib',
  '.KF4T6b',
  '[data-self-name]',
  '.notranslate',
  '[jsname="tgaKEf"]',
  '[jsname="EydYod"]',
];

const ACTIVE_SPEAKER_SELECTORS = [
  '[data-active-speaker="true"]',
  '[data-is-active-speaker="true"]',
  '.Gv1mTb-pbTTYd',         // Active speaker highlight tile
];

// ────────────────────────────────────────────────
// HELPER: Extract a name from a tile element
// ────────────────────────────────────────────────
function getNameFromTile(tile) {
  // Try each known inner selector
  for (const sel of NAME_IN_TILE_SELECTORS) {
    const el = tile.querySelector(sel);
    if (el) {
      const text = el.innerText.trim();
      if (text && text.length > 1 && text.length < 60) return text;
    }
  }
  // Fallback: aria-label on the tile (Meet often sets this)
  const ariaLabel = tile.getAttribute('aria-label') || '';
  const nameMatch = ariaLabel.match(/^(.+?)(?:'s video| \(you\)|$)/i);
  if (nameMatch && nameMatch[1].trim().length > 1) return nameMatch[1].trim();

  return null;
}

// ────────────────────────────────────────────────
// HELPER: Get all visible participant names
// ────────────────────────────────────────────────
function getAllParticipantNames() {
  const names = new Set();

  // Strategy 1: Scan participant tiles
  for (const tileSel of PARTICIPANT_TILE_SELECTORS) {
    document.querySelectorAll(tileSel).forEach(tile => {
      const name = getNameFromTile(tile);
      if (name) names.add(name);
    });
    if (names.size > 0) break;
  }

  // Strategy 2: Scan the participants sidebar (if open)
  document.querySelectorAll('[role="listitem"]').forEach(item => {
    const text = item.innerText.trim().split('\n')[0];
    if (text && text.length > 1 && text.length < 60 && !text.toLowerCase().includes('pin')) {
      names.add(text);
    }
  });

  return [...names];
}

// ────────────────────────────────────────────────
// HELPER: Detect who is currently speaking
// ────────────────────────────────────────────────
function getActiveSpeaker() {
  // Strategy 1: data-active-speaker / known active selectors
  for (const sel of ACTIVE_SPEAKER_SELECTORS) {
    const activeTile = document.querySelector(sel);
    if (activeTile) {
      const name = getNameFromTile(activeTile);
      if (name) return name;
    }
  }

  // Strategy 2: aria-label containing "speaking"
  const speakingEl = document.querySelector('[aria-label*="speaking" i]');
  if (speakingEl) {
    const match = speakingEl.getAttribute('aria-label').match(/^(.+?)\s+is speaking/i);
    if (match) return match[1].trim();
  }

  return null;
}

// ────────────────────────────────────────────────
// START TRACKING — called when user starts recording
// ────────────────────────────────────────────────
function startTracking() {
  if (isTracking) return;
  isTracking = true;
  speakerTimeline = [];
  currentSpeaker = null;
  allParticipants = new Set();

  // Seed initial participants
  getAllParticipantNames().forEach(n => allParticipants.add(n));

  domObserver = new MutationObserver(() => {
    if (!isTracking) return;

    // Collect any new participants who joined
    getAllParticipantNames().forEach(n => allParticipants.add(n));

    // Detect active speaker
    const speaker = getActiveSpeaker();
    if (speaker && speaker !== currentSpeaker) {
      currentSpeaker = speaker;
      allParticipants.add(speaker);
      speakerTimeline.push({ name: speaker, timestamp: Date.now() });
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-active-speaker', 'data-is-active-speaker', 'aria-label', 'class'],
  });

  console.log('[Briefly] Speaker tracking STARTED');
}

// ────────────────────────────────────────────────
// STOP TRACKING — called when user stops recording
// ────────────────────────────────────────────────
function stopTracking() {
  isTracking = false;
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }

  // Final scan for any participants we may have missed
  getAllParticipantNames().forEach(n => allParticipants.add(n));

  const result = {
    participants: [...allParticipants].filter(n => n.length > 1),
    timeline: speakerTimeline,
  };

  console.log('[Briefly] Speaker tracking STOPPED. Data:', result);
  return result;
}

// ────────────────────────────────────────────────
// MESSAGE LISTENER — from sidepanel.js
// ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BRIEFLY_START_TRACKING') {
    startTracking();
    sendResponse({ status: 'ok', participants: [...allParticipants] });

  } else if (msg.type === 'BRIEFLY_STOP_TRACKING') {
    const data = stopTracking();
    sendResponse({ status: 'ok', data });

  } else if (msg.type === 'BRIEFLY_GET_PARTICIPANTS') {
    sendResponse({ status: 'ok', participants: getAllParticipantNames() });
  }
  return true; // Keep message channel open for async sendResponse
});

console.log('[Briefly] Content script loaded on:', window.location.href);
