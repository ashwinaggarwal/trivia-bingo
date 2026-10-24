const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const joinHint = document.getElementById('join-hint');
const joinPanel = document.getElementById('join-panel');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const rosterPanel = document.getElementById('roster-panel');
const rosterCount = document.getElementById('roster-count');
const rosterList = document.getElementById('roster-list');
const drawStatus = document.getElementById('draw-status');
const currentDraw = document.getElementById('current-draw');
const winnersPanel = document.getElementById('winners-panel');
const winnersList = document.getElementById('winners-list');
const closingInPanel = document.getElementById('closing-in-panel');
const closingInList = document.getElementById('closing-in-list');
const boardGrid = document.getElementById('board-grid');

const CATEGORY_LABELS = {
  top: 'Top Line',
  middle: 'Middle Line',
  bottom: 'Bottom Line',
  fullhouse: 'Full House',
};

// Physical Tickets mode: no one joins digitally, so the join QR and the
// roster never make sense here — the TV is just the number grid and the
// current draw. Set once from this game's own config (fixed at creation).
let isPhysicalMode = false;

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

  isPhysicalMode = game.config && game.config.mode === 'physical';
  rosterPanel.classList.toggle('hidden', isPhysicalMode);
  if (isPhysicalMode) return;

  joinQr.src = `/api/games/${gameId}/qr.png`;
  joinUrl.textContent = `Join at ${game.joinUrl}`;
}

// Built once — 90 static cells, numbered 1..90 left-to-right, top-to-bottom
// (10 wide). Later updates just toggle classes on the existing cells.
const boardCells = [];
function buildBoard() {
  boardGrid.innerHTML = '';
  for (let n = 1; n <= 90; n += 1) {
    const cell = document.createElement('div');
    cell.className = 'board-cell';
    cell.textContent = n;
    boardGrid.appendChild(cell);
    boardCells[n] = cell;
  }
}
buildBoard();

function renderBoard(drawnNumbers, lastNumber) {
  const drawnSet = new Set(drawnNumbers);
  for (let n = 1; n <= 90; n += 1) {
    boardCells[n].classList.toggle('drawn', drawnSet.has(n));
    boardCells[n].classList.toggle('just-drawn', n === lastNumber);
  }
}

function renderRoster(players) {
  rosterCount.textContent = players.length;
  rosterList.innerHTML = players
    .map(
      (p) =>
        `<li class="row"><span class="status-dot ${p.online ? 'online' : 'offline'}"></span><span class="row-name">${escapeHtml(p.name)}</span></li>`
    )
    .join('');
}

function renderWinners(winners) {
  const entries = Object.entries(winners).filter(([, w]) => w);
  winnersPanel.classList.toggle('hidden', entries.length === 0);
  winnersList.innerHTML = entries
    .map(
      ([category, list]) =>
        `<li>${CATEGORY_LABELS[category]}: ${list.map((w) => escapeHtml(w.playerName)).join(', ')}</li>`
    )
    .join('');
}

// Names how-many-away, never the number itself — see
// src/engines/tambola/routes.js's closenessFor. Shows every player who
// qualifies, not just the closest one.
function renderClosingIn(players) {
  const close = players.filter((p) => p.close).sort((a, b) => a.distance - b.distance);
  closingInPanel.classList.toggle('hidden', close.length === 0);
  closingInList.innerHTML = close
    .map(
      (p) =>
        `<li class="${p.distance === 1 ? 'blinking-name' : ''}">${p.distance === 1 ? '🔥 ' : ''}${escapeHtml(p.name)} — ${p.distance} away (${CATEGORY_LABELS[p.category]})</li>`
    )
    .join('');
}

async function refreshPlayers() {
  if (isPhysicalMode) return;
  const res = await fetch(api('/players'));
  const players = await res.json();
  renderRoster(players);
  renderClosingIn(players);
}

function applyState(state) {
  serverMuted = Boolean(state.soundMuted);
  joinPanel.classList.toggle('hidden', isPhysicalMode || state.status !== 'setup');
  renderWinners(state.winners);

  // While the scroll animation is still running, don't let the board or big
  // number give away the result early — defer the newest draw until
  // runDrawAnimation settles, which applies it itself.
  const animating = Boolean(currentDraw.dataset.animating);
  const boardNumbers = animating ? state.drawnNumbers.slice(0, -1) : state.drawnNumbers;
  renderBoard(boardNumbers, animating ? null : state.lastNumber);

  if (state.status === 'setup') {
    drawStatus.textContent = 'Waiting to start…';
  } else if (state.status === 'ended') {
    drawStatus.textContent = `Game over — ${state.totalDrawn} numbers drawn`;
  } else {
    drawStatus.textContent = `${state.totalDrawn} / 90 drawn`;
  }

  if (state.lastNumber && !animating) {
    currentDraw.textContent = state.lastNumber;
  }
}

// --- draw animation + sound ---
let audioCtx = null;
let serverMuted = false; // admin's "mute sound for everyone" toggle — see applyState

function ensureAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// Sound should just play — no "Enable Sound" button to find on a TV no one
// touches. Browsers still require a real gesture on this exact page before
// audio is allowed, so this tries right away (works if the browser already
// trusts this origin), and falls back to unlocking silently on the very
// first tap/click/key anywhere on the page.
ensureAudioCtx();
function unlockAudioOnce() {
  ensureAudioCtx();
  document.removeEventListener('pointerdown', unlockAudioOnce);
  document.removeEventListener('keydown', unlockAudioOnce);
}
document.addEventListener('pointerdown', unlockAudioOnce);
document.addEventListener('keydown', unlockAudioOnce);

function playDing() {
  if (serverMuted || !audioCtx) return;
  [660, 990].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = audioCtx.currentTime + i * 0.08;
    gain.gain.setValueAtTime(0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  });
}

// A short rising arpeggio for a line win — distinct from the draw tick/ding
// so it reads as its own "someone just won" moment.
function playWinChime() {
  if (serverMuted || !audioCtx) return;
  [523, 659, 784].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = audioCtx.currentTime + i * 0.09;
    gain.gain.setValueAtTime(0.22, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

const cheerAudio = new Audio('/assets/sounds/cheering.mp3');
cheerAudio.preload = 'auto';

const CHEER_FADE_MS = 2000;

// Fades the cheer's volume to 0 over its last CHEER_FADE_MS instead of
// letting it cut off abruptly at the end of the clip.
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
  if (serverMuted) return;
  cheerAudio.currentTime = 0;
  cheerAudio.volume = 1;
  cheerAudio
    .play()
    .then(fadeOutCheer)
    .catch(() => playWinChime());
}

// Numbers spin like a speedometer needle: quick, blurred ticks at the start
// that gradually slow down (eased deceleration) until they screech to a
// stop on the drawn number.
const SCROLL_DURATION_MS = 1800;
const MIN_TICK_MS = 25;
const MAX_TICK_MS = 220;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

const drawSoundAudio = new Audio('/assets/sounds/draw-number.mp3');
drawSoundAudio.preload = 'auto';

// Fades out over the last DRAW_SOUND_FADE_MS of the *roll animation*
// itself, not necessarily the whole clip — the roll always lasts exactly
// SCROLL_DURATION_MS regardless of how long the audio file is, so this
// ties the fade to the number settling rather than to wherever the clip
// happens to end.
const DRAW_SOUND_FADE_MS = 300;

function playDrawSound() {
  if (serverMuted) return;
  drawSoundAudio.currentTime = 0;
  drawSoundAudio.volume = 1;
  drawSoundAudio.play().catch(() => {});

  const fadeStart = Math.max(0, SCROLL_DURATION_MS - DRAW_SOUND_FADE_MS);
  const startedAt = Date.now();
  const interval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    if (drawSoundAudio.paused || drawSoundAudio.ended || elapsed >= SCROLL_DURATION_MS) {
      clearInterval(interval);
      drawSoundAudio.pause();
      return;
    }
    if (elapsed >= fadeStart) {
      const remaining = SCROLL_DURATION_MS - elapsed;
      drawSoundAudio.volume = Math.max(0, Math.min(1, remaining / DRAW_SOUND_FADE_MS));
    }
  }, 40);
}

function runDrawAnimation(finalNumber) {
  currentDraw.dataset.animating = 'true';
  currentDraw.classList.add('rolling');
  const startedAt = Date.now();
  playDrawSound();

  function tick() {
    const progress = Math.min((Date.now() - startedAt) / SCROLL_DURATION_MS, 1);
    const eased = easeOutCubic(progress);

    if (progress >= 1) {
      currentDraw.style.filter = '';
      currentDraw.textContent = finalNumber;
      currentDraw.classList.remove('rolling');
      delete currentDraw.dataset.animating;
      playDing();
      boardCells[finalNumber].classList.add('drawn', 'just-drawn');
      currentDraw.classList.add('settle');
      setTimeout(() => currentDraw.classList.remove('settle'), 320);
      return;
    }

    currentDraw.textContent = 1 + Math.floor(Math.random() * 90);
    currentDraw.style.filter = `blur(${(1 - eased) * 3}px)`;

    const delay = MIN_TICK_MS + (MAX_TICK_MS - MIN_TICK_MS) * eased;
    setTimeout(tick, delay);
  }

  tick();
}

// Confetti + sound when a category closes. Full House gets the big
// treatment — a real crowd cheer plus a bigger confetti burst.
function celebrateWin(category) {
  if (category === 'fullhouse') {
    playCheer();
    window.launchConfetti({ particleCount: 320, duration: 4000 });
  } else {
    playWinChime();
    window.launchConfetti({ particleCount: 140, duration: 2400 });
  }
}

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', refreshPlayers);
socket.on('players-update', refreshPlayers);
socket.on('number-drawn', (payload) => runDrawAnimation(payload.number));
socket.on('category-won', (payload) => celebrateWin(payload.category));
socket.on('game-reset', () => {
  winnersPanel.classList.add('hidden');
  closingInPanel.classList.add('hidden');
  currentDraw.textContent = '';
  renderBoard([], null);
  refreshPlayers();
});

async function resync() {
  const res = await fetch(api('/state'));
  applyState(await res.json());
  await refreshPlayers();
}

socket.on('connect', resync);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resync();
});
setInterval(resync, 5000);

async function init() {
  await loadGameInfo();
  await resync();
}

init();
