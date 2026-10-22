const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const registerScreen = document.getElementById('register-screen');
const gameScreen = document.getElementById('game-screen');
const gameIdBanner = document.getElementById('game-id-banner');
const registerForm = document.getElementById('register-form');
const nameInput = document.getElementById('name-input');
const registerError = document.getElementById('register-error');
const playerNameBanner = document.getElementById('player-name-banner');
const scoreBanner = document.getElementById('score-banner');
const roundBanner = document.getElementById('round-banner');
const roundStatus = document.getElementById('round-status');
const roundEngineName = document.getElementById('round-engine-name');
const roundJoinLink = document.getElementById('round-join-link');
const noRoundBanner = document.getElementById('no-round-banner');
const roundsHistory = document.getElementById('rounds-history');
const celebrationOverlay = document.getElementById('celebration-overlay');
const celebrationWinner = document.getElementById('celebration-winner');
const celebrationRunnersup = document.getElementById('celebration-runnersup');

const ENGINE_LABELS = {
  tambola: '🎟️ Tambola',
  'trivia-bingo': '🎲 Trivia Bingo',
  'fastest-finger': '⚡ Fastest Finger',
  'emoji-quiz': '🍿 Emoji Movie Quiz',
  'guess-the-number': '🔢 Guess the Number',
};

let player = null; // { id, name, createdAt, rounds, total }
let gameValid = true;

function storageKey(suffix) {
  return `partynight_${gameId}_${suffix}`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadGameInfo() {
  const res = await fetch(`/api/games/${gameId}`);
  if (!res.ok) {
    gameValid = false;
    gameIdBanner.textContent = `Game "${gameId}" not found. Ask the host for a fresh QR code.`;
    registerForm.querySelector('button').disabled = true;
    return;
  }
  const game = await res.json();
  gameIdBanner.textContent = `Joining: ${game.name} (Game ID: ${game.id})`;
}

async function tryResumeSession() {
  const id = localStorage.getItem(storageKey('playerId'));
  if (!id) return showRegister();
  try {
    const res = await fetch(api(`/players/${id}`));
    if (!res.ok) throw new Error('not found');
    player = await res.json();
    showGame();
  } catch (err) {
    localStorage.removeItem(storageKey('playerId'));
    showRegister();
  }
}

function showRegister() {
  registerScreen.classList.remove('hidden');
  gameScreen.classList.add('hidden');
}

function renderScore() {
  scoreBanner.textContent = `${player.total} pt${player.total === 1 ? '' : 's'}`;
}

// The whole "join once" trick: writes the exact localStorage key that
// engine's own player app.js reads on load (see each engine's
// storageKey()), so navigating there resumes straight into the game
// instead of showing that engine's own registration form.
function joinRound(round) {
  try {
    localStorage.setItem(`${round.storagePrefix}_${round.id}_playerId`, round.subPlayerId);
  } catch (err) {
    // if storage is blocked, the sub-game's own registration form is a
    // harmless fallback — the player just re-enters their name there.
  }
  window.location.href = round.joinUrl;
}

function renderRoundBanner(rounds) {
  const active = rounds.find((r) => !r.finishedAt);
  roundBanner.classList.toggle('hidden', !active);
  noRoundBanner.classList.toggle('hidden', Boolean(active));
  if (!active) return;

  roundStatus.textContent = 'Round in progress';
  roundEngineName.textContent = ENGINE_LABELS[active.engine] || active.engine;
  roundJoinLink.textContent = '▶ Join This Round';
  roundJoinLink.onclick = (e) => {
    e.preventDefault();
    joinRound(active);
  };
}

function renderRoundsHistory(rounds) {
  const finished = rounds.filter((r) => r.finishedAt);
  roundsHistory.innerHTML = finished
    .slice()
    .reverse()
    .map(
      (r) =>
        `<div class="history-row">${escapeHtml(ENGINE_LABELS[r.engine] || r.engine)} — ${r.points ?? 0} pt${r.points === 1 ? '' : 's'}</div>`
    )
    .join('');
}

function showGame() {
  registerScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  playerNameBanner.textContent = `Playing as ${player.name}`;
  renderScore();
  renderRoundBanner(player.rounds || []);
  renderRoundsHistory(player.rounds || []);
  identify();
}

function identify() {
  if (player) socket.emit('identify-player', { gameId, playerId: player.id });
}

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!gameValid) return;
  const name = nameInput.value.trim();
  if (!name) return;
  registerError.textContent = '';

  // The submit click is a real user gesture — unlock audio here so the
  // night-end cheer isn't blocked by the browser's autoplay policy later.
  ensureAudioCtx();

  try {
    const res = await fetch(api('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'registration failed');
    player = { ...data, rounds: [], total: 0 };
    localStorage.setItem(storageKey('playerId'), player.id);
    showGame();
  } catch (err) {
    registerError.textContent = err.message;
  }
});

async function refreshMyPlayer() {
  if (!player) return;
  const res = await fetch(api(`/players/${player.id}`));
  if (!res.ok) return;
  player = await res.json();
  renderScore();
  renderRoundBanner(player.rounds || []);
  renderRoundsHistory(player.rounds || []);
}

// No QR code to scan for each new game, no "join" step to repeat — the
// moment the host starts a round, every player's view here jumps them
// straight into it (already enrolled, see routes.js's /round/:id/activate).
// A short "Starting…" beat first so the jump doesn't feel instant/jarring.
const AUTO_JOIN_DELAY_MS = 1200;

async function onRoundStarted() {
  await refreshMyPlayer();
  const active = (player.rounds || []).find((r) => !r.finishedAt);
  if (!active) return;

  roundBanner.classList.remove('hidden');
  noRoundBanner.classList.add('hidden');
  roundStatus.textContent = 'Starting…';
  roundEngineName.textContent = ENGINE_LABELS[active.engine] || active.engine;
  roundJoinLink.textContent = 'Taking you there now…';

  setTimeout(() => joinRound(active), AUTO_JOIN_DELAY_MS);
}

// --- sound: only the final night-end cheer, same fade-out treatment as
// Tambola's Full House — no draw ticker here, there's nothing to tick. ---
let audioCtx = null;
function ensureAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

const cheerAudio = new Audio('/assets/sounds/cheering.mp3');
cheerAudio.preload = 'auto';
const CHEER_FADE_MS = 2000;

function fadeOutCheer() {
  const duration = cheerAudio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const fadeStart = Math.max(0, duration - CHEER_FADE_MS / 1000);
  const interval = setInterval(() => {
    if (cheerAudio.paused || cheerAudio.ended) {
      clearInterval(interval);
      return;
    }
    if (cheerAudio.currentTime >= fadeStart) {
      const remaining = duration - cheerAudio.currentTime;
      cheerAudio.volume = Math.max(0, Math.min(1, remaining / (CHEER_FADE_MS / 1000)));
    }
  }, 50);
}

function playCheer() {
  cheerAudio.currentTime = 0;
  cheerAudio.volume = 1;
  cheerAudio
    .play()
    .then(fadeOutCheer)
    .catch(() => {});
}

function medalFor(place) {
  return { 1: '🥇', 2: '🥈', 3: '🥉' }[place] || `#${place}`;
}

function celebrate({ winners, runnersUp }) {
  celebrationWinner.innerHTML = (winners || [])
    .map((w) => `${medalFor(1)} ${escapeHtml(w.name)} — ${w.total} pts`)
    .join('<br>');
  celebrationRunnersup.innerHTML = (runnersUp || [])
    .map((r) => `${medalFor(2)} ${escapeHtml(r.name)} — ${r.total} pts`)
    .join('<br>');
  celebrationOverlay.classList.remove('hidden');
  playCheer();
  window.launchConfetti({ particleCount: 220, duration: 4000 });
}

socket.on('connect', () => {
  socket.emit('join-game', gameId);
  identify();
});
socket.on('round-started', onRoundStarted);
socket.on('night-ended', (payload) => {
  refreshMyPlayer();
  celebrate(payload);
});
socket.on('player-kicked', ({ playerId } = {}) => {
  if (!player || playerId !== player.id) return;
  localStorage.removeItem(storageKey('playerId'));
  player = null;
  registerError.textContent = 'You were removed by the host — please rejoin.';
  showRegister();
});
socket.on('game-reset', () => {
  celebrationOverlay.classList.add('hidden');
  refreshMyPlayer();
});

setInterval(refreshMyPlayer, 5000);

async function init() {
  await loadGameInfo();
  await tryResumeSession();
}

init();
