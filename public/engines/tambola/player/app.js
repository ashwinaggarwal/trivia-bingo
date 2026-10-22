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
const drawStatus = document.getElementById('draw-status');
const currentDraw = document.getElementById('current-draw');
const winnersBanner = document.getElementById('winners-banner');
const gridsEl = document.getElementById('grids');

const CATEGORY_LABELS = {
  top: 'Top Line',
  middle: 'Middle Line',
  bottom: 'Bottom Line',
  fullhouse: 'Full House',
};

let player = null; // { id, name, grids, marked, blinkCells }
let gameValid = true;

function storageKey(suffix) {
  return `tambola_${gameId}_${suffix}`;
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

async function fetchPlayer(id) {
  const res = await fetch(api(`/players/${id}`));
  if (!res.ok) throw new Error('not found');
  return res.json();
}

async function tryResumeSession() {
  const id = localStorage.getItem(storageKey('playerId'));
  if (!id) return showRegister();
  try {
    player = await fetchPlayer(id);
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

function showGame() {
  registerScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  playerNameBanner.textContent = `Playing as ${player.name}`;
  renderGrids();
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
  ensureAudioCtx(); // the submit click is a real user gesture — unlock audio here

  try {
    const res = await fetch(api('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'registration failed');
    player = data;
    localStorage.setItem(storageKey('playerId'), player.id);
    showGame();
  } catch (err) {
    registerError.textContent = err.message;
  }
});

// Re-pulls this player's own record wholesale — not just marked/blinkCells,
// but grid too. Needed because a fresh ticket (dealt at /game/start or
// /game/reset) only ever reaches this client through this fetch; the
// 'players-update' socket event (playerSummaries) never carries the grid.
async function refreshPlayer() {
  if (!player) return;
  try {
    player = await fetchPlayer(player.id);
    renderGrids();
  } catch (err) {
    // keep whatever we last had; next tick will retry
  }
}

// Marking is the only thing that counts toward a win — a drawn number just
// sits there, clickable, until the player actually taps it (see
// src/engines/tambola/routes.js's /mark). There's deliberately no "this one
// is drawn" styling (see renderGrids) — the player has to notice it was
// called themselves, same as a real tambola card — so every unmarked cell
// is always clickable here; the server is the one that actually knows
// whether a given number has been drawn yet, and silently rejects a click
// that's too early. An already-marked cell just does nothing.
async function handleCellClick(number, alreadyMarked) {
  if (alreadyMarked || !player) return;
  try {
    const res = await fetch(api(`/players/${player.id}/mark`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number }),
    });
    const data = await res.json();
    if (!res.ok) return; // too early (not drawn yet) — no feedback, nothing to see
    player.marked = data.marked;
    if (!data.alreadyMarked) {
      flashFire(number);
      playClaimSound();
    }
    renderGrids();
  } catch (err) {
    // leave the cell clickable so the player can retry
  }
}

function flashFire(number) {
  const cell = gridsEl.querySelector(`[data-number="${number}"]`);
  if (cell) {
    cell.classList.add('just-marked');
    setTimeout(() => cell.classList.remove('just-marked'), 500);
  }
}

// Deliberately gives no visual hint about which numbers have been drawn —
// only a still-open, one-away line's last number blinks (see blinkCells in
// src/engines/tambola/routes.js's closenessFor). Every other cell looks
// identical whether it's been called or not, and stays clickable (the
// server decides what's valid) for as long as the game runs, not just on
// the round it was drawn. Renders all three of the player's tickets, each
// its own 3x5 block.
function renderGrids() {
  if (!player) return;
  const markedSet = new Set(player.marked || []);
  const blinkSet = new Set(player.blinkCells || []);
  gridsEl.innerHTML = '';
  player.grids.forEach((grid) => {
    const ticket = document.createElement('div');
    ticket.className = 'ticket';
    grid.forEach((number) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.number = number;
      const marked = markedSet.has(number);
      cell.innerHTML = marked
        ? `<span class="cell-fire">🔥</span><span class="cell-number">${number}</span>`
        : `<span class="cell-number">${number}</span>`;
      if (marked) cell.classList.add('marked');
      else if (blinkSet.has(number)) cell.classList.add('blinking');
      cell.addEventListener('click', () => handleCellClick(number, marked));
      ticket.appendChild(cell);
    });
    gridsEl.appendChild(ticket);
  });
}

function renderWinners(winners) {
  const entries = Object.entries(winners).filter(([, w]) => w);
  if (!entries.length) {
    winnersBanner.classList.add('hidden');
    return;
  }
  winnersBanner.classList.remove('hidden');
  winnersBanner.innerHTML = entries
    .map(([category, list]) => {
      const mine = player && list.some((w) => w.playerId === player.id);
      const names = list.map((w) => escapeHtml(w.playerName)).join(', ');
      return `<div class="winner-line ${mine ? 'mine' : ''}">${CATEGORY_LABELS[category]}: ${mine ? 'You won! 🎉' : `${names} won!`}</div>`;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyState(state) {
  renderWinners(state.winners);

  if (state.status === 'setup') {
    drawStatus.textContent = 'Waiting for the host to start the game…';
  } else if (state.status === 'ended') {
    drawStatus.textContent = `Game over — ${state.totalDrawn} numbers drawn`;
  } else {
    drawStatus.textContent = `${state.totalDrawn} / 90 drawn`;
  }

  if (state.lastNumber && !currentDraw.dataset.animating) {
    currentDraw.textContent = state.lastNumber;
  }
  if (player) renderGrids();
}

// --- draw animation + sound ---
let audioCtx = null;
function ensureAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTick(frequency = 900) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.04);
}

function playDing() {
  if (!audioCtx) return;
  [660, 990].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = audioCtx.currentTime + i * 0.08;
    gain.gain.setValueAtTime(0.18, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  });
}

// A short, punchy "claimed it" pop — distinct from the draw tick/ding, so
// tapping a number feels like its own satisfying action.
function playClaimSound() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(520, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1040, audioCtx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.22, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
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

function runDrawAnimation(finalNumber) {
  currentDraw.dataset.animating = 'true';
  currentDraw.classList.add('rolling');
  const startedAt = Date.now();

  function tick() {
    const progress = Math.min((Date.now() - startedAt) / SCROLL_DURATION_MS, 1);
    const eased = easeOutCubic(progress);

    if (progress >= 1) {
      currentDraw.style.filter = '';
      currentDraw.textContent = finalNumber;
      currentDraw.classList.remove('rolling');
      delete currentDraw.dataset.animating;
      playDing();
      refreshPlayer();
      currentDraw.classList.add('settle');
      setTimeout(() => currentDraw.classList.remove('settle'), 320);
      return;
    }

    currentDraw.textContent = 1 + Math.floor(Math.random() * 90);
    currentDraw.style.filter = `blur(${(1 - eased) * 3}px)`;
    playTick(900 - eased * 400);

    const delay = MIN_TICK_MS + (MAX_TICK_MS - MIN_TICK_MS) * eased;
    setTimeout(tick, delay);
  }

  tick();
}

async function refreshState() {
  if (!gameValid) return;
  const res = await fetch(api('/state'));
  if (!res.ok) return;
  applyState(await res.json());
}

socket.on('connect', () => {
  socket.emit('join-game', gameId);
  identify();
});
socket.on('state-update', applyState);
socket.on('number-drawn', (payload) => runDrawAnimation(payload.number));

socket.on('player-kicked', ({ playerId } = {}) => {
  if (!player || playerId !== player.id) return;
  localStorage.removeItem(storageKey('playerId'));
  player = null;
  registerError.textContent = 'You were removed by the host — please rejoin.';
  showRegister();
});

socket.on('game-reset', () => {
  winnersBanner.classList.add('hidden');
  currentDraw.textContent = '';
});

// Fired by both /game/start and /game/reset the moment everyone's dealt a
// fresh ticket — refetch immediately rather than waiting out the 5s poll,
// otherwise a click on a number that's no longer even on this player's new
// grid would be silently (and confusingly) rejected by the server.
socket.on('tickets-dealt', refreshPlayer);

socket.on('connect', refreshState);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshState();
});
setInterval(refreshState, 5000);
setInterval(refreshPlayer, 5000);

async function init() {
  await loadGameInfo();
  if (!gameValid) return;
  await tryResumeSession();
  await refreshState();
}

init();
