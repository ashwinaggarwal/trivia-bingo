const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const joinHint = document.getElementById('join-hint');
const joinPanel = document.getElementById('join-panel');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const rosterCount = document.getElementById('roster-count');
const rosterList = document.getElementById('roster-list');
const drawStatus = document.getElementById('draw-status');
const currentDraw = document.getElementById('current-draw');
const winnersPanel = document.getElementById('winners-panel');
const winnersList = document.getElementById('winners-list');
const closingInPanel = document.getElementById('closing-in-panel');
const closingInList = document.getElementById('closing-in-list');
const boardGrid = document.getElementById('board-grid');
const btnEnableSound = document.getElementById('btn-enable-sound');

const CATEGORY_LABELS = {
  top: 'Top Line',
  middle: 'Middle Line',
  bottom: 'Bottom Line',
  fullhouse: 'Full House',
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
        `<li><span class="player-status ${p.online ? 'online' : 'offline'}"></span>${escapeHtml(p.name)}</li>`
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
// src/engines/tambola/routes.js's closenessFor.
function renderClosingIn(players) {
  const close = players
    .filter((p) => p.close)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
  closingInPanel.classList.toggle('hidden', close.length === 0);
  closingInList.innerHTML = close
    .map(
      (p) =>
        `<li>${p.distance === 1 ? '🔥 ' : ''}${escapeHtml(p.name)} — ${p.distance} away (${CATEGORY_LABELS[p.category]})</li>`
    )
    .join('');
}

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const players = await res.json();
  renderRoster(players);
  renderClosingIn(players);
}

function applyState(state) {
  joinPanel.classList.toggle('hidden', state.status !== 'setup');
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
let soundEnabled = false;

btnEnableSound.addEventListener('click', () => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx && !audioCtx) audioCtx = new Ctx();
  soundEnabled = true;
  btnEnableSound.classList.add('hidden');
});

function playTick() {
  if (!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 900;
  gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.04);
}

function playDing() {
  if (!soundEnabled || !audioCtx) return;
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

const SCROLL_DURATION_MS = 1600;
const SCROLL_TICK_MS = 70;

function runDrawAnimation(finalNumber) {
  currentDraw.dataset.animating = 'true';
  const startedAt = Date.now();
  const interval = setInterval(() => {
    currentDraw.textContent = 1 + Math.floor(Math.random() * 90);
    playTick();
    if (Date.now() - startedAt >= SCROLL_DURATION_MS) {
      clearInterval(interval);
      currentDraw.textContent = finalNumber;
      delete currentDraw.dataset.animating;
      playDing();
      boardCells[finalNumber].classList.add('drawn', 'just-drawn');
    }
  }, SCROLL_TICK_MS);
}

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', refreshPlayers);
socket.on('players-update', refreshPlayers);
socket.on('number-drawn', (payload) => runDrawAnimation(payload.number));
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
