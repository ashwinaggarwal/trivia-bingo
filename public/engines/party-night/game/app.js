const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const joinHint = document.getElementById('join-hint');
const joinPanel = document.getElementById('join-panel');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const nowPlayingPanel = document.getElementById('now-playing-panel');
const nowPlayingEngine = document.getElementById('now-playing-engine');
const leaderboardRows = document.getElementById('leaderboard-rows');
const rosterCount = document.getElementById('roster-count');
const rosterList = document.getElementById('roster-list');
const upNextPanel = document.getElementById('up-next-panel');
const upNextList = document.getElementById('up-next-list');
const roundCount = document.getElementById('round-count');
const roundsList = document.getElementById('rounds-list');
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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadGameInfo() {
  const res = await fetch(`/api/games/${gameId}`);
  if (!res.ok) {
    joinHint.textContent = `Game "${gameId}" not found.`;
    return;
  }
  const game = await res.json();
  joinHint.textContent = game.name;
  joinQr.src = `/api/games/${gameId}/qr.png`;
  joinUrl.textContent = `Join at ${game.joinUrl}`;
}

// Tie-aware places (two players tied for 1st both show "1st") — same
// rule the server uses for final standings, computed client-side here
// since this board keeps changing as rounds finish.
function placesFor(sortedDesc) {
  const places = [];
  let place = 0;
  let seen = 0;
  let last = null;
  for (const row of sortedDesc) {
    seen += 1;
    if (last === null || row.total !== last) {
      place = seen;
      last = row.total;
    }
    places.push(place);
  }
  return places;
}

function f1Row(place, name, points, online) {
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' }[place];
  const placeClass = place <= 3 ? `place-${place}` : '';
  return `<li class="f1-row ${placeClass}">
    <span class="f1-pos">${medal || place}</span>
    <span class="f1-name"><span class="status-dot ${online ? 'online' : 'offline'}"></span>${escapeHtml(name)}</span>
    <span class="f1-points">${points} pt${points === 1 ? '' : 's'}</span>
  </li>`;
}

function renderLeaderboard(leaderboard) {
  const rows = leaderboard || [];
  const places = placesFor(rows);
  leaderboardRows.innerHTML = rows
    .map((p, i) => f1Row(places[i], p.name, p.total, p.online))
    .join('');
}

function renderRoster(leaderboard) {
  rosterCount.textContent = (leaderboard || []).length;
  rosterList.innerHTML = (leaderboard || [])
    .map(
      (p) =>
        `<li><span class="player-status ${p.online ? 'online' : 'offline'}"></span>${escapeHtml(p.name)}</li>`
    )
    .join('');
}

function renderRounds(rounds) {
  const finished = rounds.filter((r) => r.roundStatus !== 'queued');
  roundCount.textContent = finished.length;
  roundsList.innerHTML = finished
    .slice()
    .reverse()
    .map(
      (r) =>
        `<li>${escapeHtml(ENGINE_LABELS[r.engine] || r.engine)} — ${r.roundStatus === 'finished' ? 'finished' : 'in progress'}</li>`
    )
    .join('');

  const queued = rounds.filter((r) => r.roundStatus === 'queued');
  upNextPanel.classList.toggle('hidden', queued.length === 0);
  upNextList.innerHTML = queued
    .map((r) => `<li>${escapeHtml(ENGINE_LABELS[r.engine] || r.engine)}</li>`)
    .join('');
}

function applyState(state) {
  renderLeaderboard(state.leaderboard);
  renderRoster(state.leaderboard);
  renderRounds(state.rounds);

  const activeRound = state.rounds.find((r) => r.roundStatus === 'active');
  nowPlayingPanel.classList.toggle('hidden', !activeRound);
  if (activeRound) {
    nowPlayingEngine.textContent = ENGINE_LABELS[activeRound.engine] || activeRound.engine;
  }

  joinPanel.classList.toggle('hidden', state.status !== 'setup');
}

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const leaderboard = await res.json();
  renderLeaderboard(leaderboard);
  renderRoster(leaderboard);
}

// --- sound: just the final night-end cheer, same treatment as Tambola's
// Full House (real crowd cheer, faded out over its last 2s instead of
// cutting off abruptly) — no draw ticker here, there's nothing to tick. ---
let audioCtx = null;
function ensureAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
ensureAudioCtx();
function unlockAudioOnce() {
  ensureAudioCtx();
  document.removeEventListener('pointerdown', unlockAudioOnce);
  document.removeEventListener('keydown', unlockAudioOnce);
}
document.addEventListener('pointerdown', unlockAudioOnce);
document.addEventListener('keydown', unlockAudioOnce);

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
  window.launchConfetti({ particleCount: 320, duration: 4500 });
}

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', refreshPlayers);
socket.on('players-update', refreshPlayers);
socket.on('round-started', resync);
socket.on('night-ended', (payload) => {
  resync();
  celebrate(payload);
});
socket.on('game-reset', () => {
  celebrationOverlay.classList.add('hidden');
  resync();
});

async function resync() {
  const res = await fetch(api('/state'));
  applyState(await res.json());
}

socket.on('connect', resync);
setInterval(resync, 5000);

async function init() {
  await loadGameInfo();
  await resync();
}

init();
