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
const questionText = document.getElementById('question-text');
const questionImage = document.getElementById('question-image');
const ffOptions = document.getElementById('ff-options');
const arcadeRows = document.getElementById('arcade-rows');
const flagCredit = document.getElementById('flag-credit');

let currentState = null;

async function loadGameInfo() {
  const res = await fetch(`/api/games/${gameId}`);
  if (!res.ok) {
    joinHint.textContent = `Game "${gameId}" not found.`;
    return;
  }
  const game = await res.json();
  flagCredit.classList.toggle('hidden', game.config.pack !== 'flags');
  applyTheme(game.config.pack);
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
        `<li><span class="player-status ${p.online ? 'online' : 'offline'}"></span>${escapeHtml(p.name)}</li>`
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

function renderCountdown() {
  const state = currentState;
  if (!state || !state.questionShownAt || state.revealStage !== 'question') {
    countdownText.classList.add('hidden');
    return;
  }
  const elapsed = Date.now() - new Date(state.questionShownAt).getTime();
  const remaining = Math.max(0, Math.ceil((state.answerWindowMs - elapsed) / 1000));
  countdownText.textContent = `${remaining}s`;
  countdownText.classList.remove('hidden');
}

setInterval(renderCountdown, 500);

function applyState(state) {
  currentState = state;
  joinPanel.classList.toggle('hidden', state.status !== 'setup');

  if (state.status === 'setup') {
    questionStatus.textContent = 'Waiting to start…';
    questionText.textContent = '';
    questionImage.classList.add('hidden');
    ffOptions.classList.add('hidden');
    countdownText.classList.add('hidden');
  } else if (state.status === 'ended' && !state.currentQuestion) {
    questionStatus.textContent = 'All questions asked!';
    questionText.textContent = '';
    questionImage.classList.add('hidden');
    ffOptions.classList.add('hidden');
    countdownText.classList.add('hidden');
  } else if (state.currentQuestion) {
    questionStatus.textContent = `Question ${state.questionNumber} / ${state.totalQuestions}`;
    questionText.textContent = state.currentQuestion.question;
    if (state.currentQuestion.image) {
      questionImage.src = state.currentQuestion.image;
      questionImage.classList.remove('hidden');
    } else {
      questionImage.classList.add('hidden');
    }
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
