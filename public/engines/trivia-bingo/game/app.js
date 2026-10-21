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
const questionText = document.getElementById('question-text');
const hintImage = document.getElementById('hint-image');
const hintText = document.getElementById('hint-text');
const fastestFingerOptions = document.getElementById('fastest-finger-options');
const answerText = document.getElementById('answer-text');
const countdownText = document.getElementById('countdown-text');
const digitalClock = document.getElementById('digital-clock');
const btnEnableSound = document.getElementById('btn-enable-sound');
const revealedGrid = document.getElementById('revealed-grid');
const leaderboardsEl = document.getElementById('leaderboards');
const mostCorrectList = document.getElementById('most-correct');
const fastestList = document.getElementById('fastest');
const mostIncorrectList = document.getElementById('most-incorrect');
const arcadeLeaderboardEl = document.getElementById('arcade-leaderboard');
const arcadeRows = document.getElementById('arcade-rows');
const flagCredit = document.getElementById('flag-credit');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverWinner = document.getElementById('gameover-winner');

let currentState = null;
let gameMode = 'bingo';

async function loadGameInfo() {
  const res = await fetch(`/api/games/${gameId}`);
  if (!res.ok) {
    joinHint.textContent = `Game "${gameId}" not found.`;
    return;
  }
  const game = await res.json();
  gameMode = game.mode || 'bingo';
  leaderboardsEl.classList.toggle('hidden', gameMode === 'fastest-finger');
  arcadeLeaderboardEl.classList.toggle('hidden', gameMode !== 'fastest-finger');
  flagCredit.classList.toggle('hidden', game.gameType !== 'flags');
  applyTheme(game.gameType);
  joinHint.textContent = game.name;
  joinQr.src = `/api/games/${gameId}/qr.png`;
  joinUrl.textContent = `Join at ${game.joinUrl}`;
}

function renderRoster(players) {
  rosterCount.textContent = players.length;
  rosterList.innerHTML = players
    .map(
      (p) => `<li>
        <span class="player-status ${p.online ? 'online' : 'offline'}" title="${p.online ? 'online' : 'offline'}"></span>
        <span class="player-name">${p.name}</span>
      </li>`
    )
    .join('');
}

async function refreshRoster() {
  const res = await fetch(api('/players'));
  renderRoster(await res.json());
}

// Synthesized ticking clock sound — no audio asset needed, and browsers
// won't allow it to play until the host taps "Enable Tick Sound" at least
// once (autoplay policy), so we lazily create the AudioContext on that click.
let audioCtx = null;
let soundEnabled = false;
let lastTickSecond = null;

btnEnableSound.addEventListener('click', () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  soundEnabled = true;
  btnEnableSound.classList.add('hidden');
});

function playTick() {
  if (!soundEnabled || !audioCtx) return;
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

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderCountdown() {
  const state = currentState;
  if (
    !state ||
    !state.questionShownAt ||
    state.revealStage === 'answer' ||
    state.revealStage === 'none'
  ) {
    countdownText.classList.add('hidden');
    digitalClock.classList.add('hidden');
    lastTickSecond = null;
    return;
  }

  const elapsed = Date.now() - new Date(state.questionShownAt).getTime();
  let label = '';
  let remainingMs = null;
  if (state.revealStage === 'question') {
    const toHint = Math.max(0, Math.ceil((state.hintDelayMs - elapsed) / 1000));
    const toAnswer = Math.max(0, Math.ceil((state.answerDelayMs - elapsed) / 1000));
    label = `Hint in ${toHint}s · Answer in ${toAnswer}s`;
    remainingMs = state.hintDelayMs - elapsed;
  } else if (state.revealStage === 'hint') {
    const toAnswer = Math.max(0, Math.ceil((state.answerDelayMs - elapsed) / 1000));
    label = `Answer in ${toAnswer}s`;
    remainingMs = state.answerDelayMs - elapsed;
  }
  countdownText.textContent = label;
  countdownText.classList.remove('hidden');

  if (remainingMs !== null) {
    digitalClock.textContent = formatClock(remainingMs);
    digitalClock.classList.remove('hidden');
    const wholeSecond = Math.max(0, Math.ceil(remainingMs / 1000));
    if (wholeSecond !== lastTickSecond) {
      lastTickSecond = wholeSecond;
      if (wholeSecond > 0) playTick();
    }
  } else {
    digitalClock.classList.add('hidden');
  }
}

setInterval(renderCountdown, 500);

function renderRevealedAnswers(list) {
  revealedGrid.innerHTML = (list || [])
    .map(
      (entry, i) =>
        `<div class="revealed-cell"><span class="revealed-index">${i + 1}</span>${entry.answer}</div>`
    )
    .join('');
}

// Read-only on this shared screen — players pick on their own phones — but
// shows the same 4 options so the room can follow along, and lights up the
// correct one green once revealStage flips to 'answer'.
function renderFastestFingerOptions(state) {
  const q = state.currentQuestion;
  if (!q || !q.options || !q.options.length) {
    fastestFingerOptions.classList.add('hidden');
    fastestFingerOptions.innerHTML = '';
    return;
  }
  const revealed = state.revealStage === 'answer';
  fastestFingerOptions.innerHTML = q.options
    .map((text, index) => {
      const correct = revealed && index === q.correctIndex;
      return `<div class="ff-option ${correct ? 'correct' : ''}">
        <span class="option-letter">${'ABCD'[index]}</span><span class="option-text">${text}</span>
      </div>`;
    })
    .join('');
  fastestFingerOptions.classList.remove('hidden');
}

function applyState(state) {
  currentState = state;

  // The join QR is the whole point of the shared screen before the host
  // starts the game — once play begins, players already have their grids,
  // so switch over to showing the live question/leaderboards instead.
  joinPanel.classList.toggle('hidden', state.status !== 'setup');

  if (state.status === 'setup') {
    questionStatus.textContent = 'Waiting to start…';
    questionText.textContent = '';
    hintImage.classList.add('hidden');
    hintText.classList.add('hidden');
    fastestFingerOptions.classList.add('hidden');
    answerText.classList.add('hidden');
    countdownText.classList.add('hidden');
    digitalClock.classList.add('hidden');
  } else if (state.status === 'ended' && !state.currentQuestion) {
    questionStatus.textContent = 'All questions asked!';
    questionText.textContent = '';
    hintImage.classList.add('hidden');
    hintText.classList.add('hidden');
    fastestFingerOptions.classList.add('hidden');
    answerText.classList.add('hidden');
    countdownText.classList.add('hidden');
    digitalClock.classList.add('hidden');
  } else if (state.currentQuestion) {
    questionStatus.textContent = `Question ${state.questionNumber} / ${state.totalQuestions}`;
    questionText.textContent = state.currentQuestion.question;
    if (state.currentQuestion.image) {
      hintImage.src = state.currentQuestion.image;
      hintImage.classList.remove('hidden');
    } else {
      hintImage.classList.add('hidden');
    }
    if (state.currentQuestion.hint) {
      hintText.textContent = `Hint: ${state.currentQuestion.hint}`;
      hintText.classList.remove('hidden');
    } else {
      hintText.classList.add('hidden');
    }
    if (gameMode === 'fastest-finger') {
      renderFastestFingerOptions(state);
    }
    if (state.currentQuestion.answer) {
      const winner = state.currentQuestion.winner;
      answerText.textContent = winner
        ? `${state.currentQuestion.answer} — ${winner.playerName} got the point!`
        : state.currentQuestion.answer;
      answerText.classList.remove('hidden');
    } else {
      answerText.classList.add('hidden');
    }
    renderCountdown();
  }

  renderRevealedAnswers(state.revealedAnswers);
}

function renderArcadeLeaderboard(rows) {
  arcadeRows.innerHTML = (rows || [])
    .map((row, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      return `<li class="arcade-row rank-${rank <= 3 ? rank : 'other'}">
        <span class="arcade-rank">${medal}</span>
        <span class="arcade-name">${row.name}</span>
        <span class="arcade-points">${row.points}</span>
      </li>`;
    })
    .join('');
}

function renderLeaderboard(data) {
  if (data.mode === 'fastest-finger') {
    renderArcadeLeaderboard(data.rows);
    return;
  }
  mostCorrectList.innerHTML = data.mostCorrect
    .map((row) => `<li>${row.name} — ${row.correctCount} correct</li>`)
    .join('');
  fastestList.innerHTML = data.fastest
    .map((row) => `<li>${row.name} — ${(row.avgElapsedMs / 1000).toFixed(1)}s avg</li>`)
    .join('');
  mostIncorrectList.innerHTML = (data.mostIncorrect || [])
    .map((row) => `<li>${row.name} — ${row.incorrectFirstTryCount} wrong</li>`)
    .join('');
}

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('leaderboard-update', renderLeaderboard);
socket.on('player-registered', refreshRoster);
socket.on('players-update', renderRoster);
socket.on('game-reset', () => {
  gameoverOverlay.classList.add('hidden');
  renderRevealedAnswers([]);
  renderLeaderboard({ mode: gameMode, mostCorrect: [], fastest: [], mostIncorrect: [], rows: [] });
  refreshRoster();
});
socket.on('game-over', (winner) => {
  gameoverWinner.textContent = winner && winner.playerName ? `${winner.playerName} wins!` : '';
  gameoverOverlay.classList.remove('hidden');
});

async function init() {
  await loadGameInfo();
  const [stateRes, leaderboardRes] = await Promise.all([
    fetch(api('/state')),
    fetch(api('/leaderboard')),
  ]);
  applyState(await stateRes.json());
  renderLeaderboard(await leaderboardRes.json());
  await refreshRoster();
}

// Resync on (re)connect, tab refocus, and a slow poll fallback — the shared
// screen must never be stuck on stale state.
socket.on('connect', init);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) init();
});
setInterval(init, 5000);

init();
