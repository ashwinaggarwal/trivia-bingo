const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const joinHint = document.getElementById('join-hint');
const joinPanel = document.getElementById('join-panel');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const rosterCount = document.getElementById('roster-count');
const rosterList = document.getElementById('roster-list');
const questionStatus = document.getElementById('question-status');
const countdownText = document.getElementById('countdown-text');
const emojiText = document.getElementById('emoji-text');
const ffOptions = document.getElementById('ff-options');
const arcadeRows = document.getElementById('arcade-rows');

let currentState = null;

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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

async function refreshRoster() {
  const res = await fetch(api('/players'));
  renderRoster(await res.json());
}

function renderOptions(state) {
  const q = state.currentQuestion;
  if (!q || !q.options || !q.options.length) {
    ffOptions.classList.add('hidden');
    ffOptions.innerHTML = '';
    return;
  }
  const revealed = state.revealStage === 'answer';
  ffOptions.innerHTML = q.options
    .map((text, index) => {
      const correct = revealed && index === q.correctIndex;
      return `<div class="ff-option ${correct ? 'correct' : ''}">
        <span class="option-letter">${'ABCD'[index]}</span><span class="option-text">${escapeHtml(text)}</span>
      </div>`;
    })
    .join('');
  ffOptions.classList.remove('hidden');
}

// Synthesized ticking clock sound, one tick per whole second of the
// countdown — no audio asset needed. Sound should just play, not wait for
// a button to be found on a TV no one touches: try to unlock it
// immediately on load (works if the browser already trusts this origin),
// and fall back to unlocking silently on the very first tap/click/key
// anywhere on the page if the browser blocks it.
let audioCtx = null;
let lastTickSecond = null;

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

function playTick() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}

function renderCountdown() {
  const state = currentState;
  if (!state || !state.questionShownAt || state.revealStage !== 'question') {
    countdownText.classList.add('hidden');
    lastTickSecond = null;
    return;
  }
  const elapsed = Date.now() - new Date(state.questionShownAt).getTime();
  const remaining = Math.max(0, Math.ceil((state.answerWindowMs - elapsed) / 1000));
  countdownText.textContent = `${remaining}s`;
  countdownText.classList.remove('hidden');

  if (remaining !== lastTickSecond) {
    lastTickSecond = remaining;
    if (remaining > 0) playTick();
  }
}

setInterval(renderCountdown, 500);

function applyState(state) {
  currentState = state;
  joinPanel.classList.toggle('hidden', state.status !== 'setup');

  if (state.status === 'setup') {
    questionStatus.textContent = 'Waiting to start…';
    emojiText.textContent = '';
    ffOptions.classList.add('hidden');
    countdownText.classList.add('hidden');
  } else if (state.status === 'ended' && !state.currentQuestion) {
    questionStatus.textContent = 'All questions asked!';
    emojiText.textContent = '';
    ffOptions.classList.add('hidden');
    countdownText.classList.add('hidden');
  } else if (state.currentQuestion) {
    questionStatus.textContent = `Question ${state.questionNumber} / ${state.totalQuestions}`;
    emojiText.textContent = state.currentQuestion.emojis;
    renderOptions(state);
    if (state.currentQuestion.winner) {
      questionStatus.textContent += ` — ${state.currentQuestion.winner.playerName} got the point!`;
    }
    renderCountdown();
  }
}

function renderArcadeLeaderboard(players) {
  const ranked = players.slice().sort((a, b) => b.points - a.points);
  arcadeRows.innerHTML = ranked
    .map((p, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      return `<li class="arcade-row rank-${rank <= 3 ? rank : 'other'}">
        <span class="arcade-rank">${medal}</span>
        <span class="arcade-name">${escapeHtml(p.name)}</span>
        <span class="arcade-points">${p.points}</span>
      </li>`;
    })
    .join('');
}

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const players = await res.json();
  renderRoster(players);
  renderArcadeLeaderboard(players);
}

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', refreshRoster);
socket.on('players-update', refreshPlayers);
socket.on('game-reset', refreshPlayers);

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
