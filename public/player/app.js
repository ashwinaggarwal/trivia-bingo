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
const questionBanner = document.getElementById('question-banner');
const questionStatus = document.getElementById('question-status');
const questionText = document.getElementById('question-text');
const hintImage = document.getElementById('hint-image');
const hintText = document.getElementById('hint-text');
const answerText = document.getElementById('answer-text');
const countdownText = document.getElementById('countdown-text');
const statusBanner = document.getElementById('status-banner');
const gridEl = document.getElementById('grid');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverWinner = document.getElementById('gameover-winner');

let player = null; // { id, name, grid }
let markedSet = new Set();
let wrongSet = new Set(); // ephemeral: wrong guesses for the currently active question
let lastQuestionId; // tracks question changes so wrongSet can be cleared
let currentState = null;
let gameValid = true;

function storageKey(suffix) {
  return `bingo_${gameId}_${suffix}`;
}

function loadLocalMarks(playerId) {
  const raw = localStorage.getItem(storageKey(`marks_${playerId}`));
  return raw ? new Set(JSON.parse(raw)) : new Set();
}

function saveLocalMarks(playerId) {
  localStorage.setItem(storageKey(`marks_${playerId}`), JSON.stringify(Array.from(markedSet)));
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
  applyTheme(game.gameType);
  gameIdBanner.textContent = `Joining: ${game.name} (Game ID: ${game.id})`;
}

async function tryResumeSession() {
  const id = localStorage.getItem(storageKey('playerId'));
  if (!id) return showRegister();

  try {
    const res = await fetch(api(`/players/${id}`));
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    player = data;
    markedSet = loadLocalMarks(id);
    showGame();
  } catch (err) {
    localStorage.removeItem(storageKey('playerId'));
    localStorage.removeItem(storageKey('playerName'));
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
  renderGrid();
  identify();
}

// Tells the server which player this socket belongs to, so the admin
// console and shared game screen can show accurate online/offline status.
// Re-sent on every (re)connect since presence is in-memory only and doesn't
// survive the server losing track of a socket.
function identify() {
  if (player) socket.emit('identify-player', { gameId, playerId: player.id });
}

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!gameValid) return;
  const name = nameInput.value.trim();
  if (!name) return;
  registerError.textContent = '';

  try {
    const res = await fetch(api('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'registration failed');

    player = data;
    markedSet = new Set();
    wrongSet = new Set();
    localStorage.setItem(storageKey('playerId'), player.id);
    localStorage.setItem(storageKey('playerName'), player.name);
    saveLocalMarks(player.id);
    showGame();
  } catch (err) {
    registerError.textContent = err.message;
  }
});

// Correct/wrong feedback plays the real sound assets, falling back to a
// synthesized tone (Web Audio) if the file can't play for any reason. Each
// cell tap is itself a user gesture, so the AudioContext is created/resumed
// right at the top of handleCellClick, synchronously, before the (async)
// /mark call — otherwise some browsers' autoplay policy would block it.
let audioCtx = null;
const correctAudio = new Audio('/assets/sounds/success.m4a');
const wrongAudio = new Audio('/assets/sounds/error.m4a');
correctAudio.preload = 'auto';
wrongAudio.preload = 'auto';

function ensureAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, startOffset, duration, type) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const startTime = audioCtx.currentTime + startOffset;
  gain.gain.setValueAtTime(0.2, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playCorrectSound() {
  correctAudio.currentTime = 0;
  correctAudio.play().catch(() => {
    playTone(587.33, 0, 0.12, 'sine'); // D5
    playTone(880, 0.1, 0.18, 'sine'); // A5, rising
  });
}

function playWrongSound() {
  wrongAudio.currentTime = 0;
  wrongAudio.play().catch(() => playTone(180, 0, 0.25, 'square'));
}

function renderGrid() {
  gridEl.innerHTML = '';
  const isActive =
    currentState && currentState.status === 'running' && currentState.revealStage !== 'none';
  // revealedAnswers (not revealedHistory, which isn't sent to clients) tells us
  // which questions have had their answer shown at any point in the game, so a
  // cell's portrait can appear even after the question moves on.
  const revealedIds = new Set(
    (currentState && currentState.revealedAnswers ? currentState.revealedAnswers : []).map(
      (r) => r.id
    )
  );

  player.grid.forEach((cell, index) => {
    const div = document.createElement('div');
    div.className = 'cell';

    const isMarked = markedSet.has(index);
    const isWrong = !isMarked && wrongSet.has(index);
    const isClickable = isActive && !isMarked;

    if (cell.image && revealedIds.has(cell.questionId)) {
      const img = document.createElement('img');
      img.className = 'cell-image';
      img.alt = '';
      img.src = cell.image;
      div.appendChild(img);
    }

    const label = document.createElement('span');
    label.className = 'cell-label';
    label.textContent = cell.answer;
    div.appendChild(label);

    if (isMarked) div.classList.add('marked');
    if (isWrong) div.classList.add('wrong');
    if (isClickable) div.classList.add('unlocked');

    div.addEventListener('click', () => handleCellClick(index, isClickable));
    gridEl.appendChild(div);
  });
}

async function handleCellClick(index, isClickable) {
  if (!isClickable) return;
  wrongSet.delete(index);
  ensureAudioCtx();

  try {
    const res = await fetch(api('/mark'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, cellIndex: index }),
    });
    const data = await res.json();
    if (res.ok && data.correct) {
      markedSet.add(index);
      saveLocalMarks(player.id);
      playCorrectSound();
    } else if (res.ok) {
      wrongSet.add(index);
      playWrongSound();
    }
  } catch (err) {
    // network error — leave the cell clickable so the player can retry.
  }

  renderGrid();
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
    return;
  }

  const elapsed = Date.now() - new Date(state.questionShownAt).getTime();
  let label = '';
  if (state.revealStage === 'question') {
    const toHint = Math.max(0, Math.ceil((state.hintDelayMs - elapsed) / 1000));
    const toAnswer = Math.max(0, Math.ceil((state.answerDelayMs - elapsed) / 1000));
    label = `Hint in ${toHint}s · Answer in ${toAnswer}s`;
  } else if (state.revealStage === 'hint') {
    const toAnswer = Math.max(0, Math.ceil((state.answerDelayMs - elapsed) / 1000));
    label = `Answer in ${toAnswer}s`;
  }
  countdownText.textContent = label;
  countdownText.classList.remove('hidden');
}

setInterval(renderCountdown, 500);

function applyState(state) {
  currentState = state;

  const newQuestionId = state.currentQuestion ? state.currentQuestion.id : null;
  if (newQuestionId !== lastQuestionId) {
    wrongSet.clear();
    lastQuestionId = newQuestionId;
  }

  if (state.status === 'setup') {
    questionBanner.classList.add('hidden');
    statusBanner.classList.remove('hidden');
    statusBanner.textContent = 'Waiting for the host to start the game…';
    hintImage.classList.add('hidden');
  } else if (state.status === 'ended' && !state.currentQuestion) {
    questionBanner.classList.add('hidden');
    statusBanner.classList.remove('hidden');
    statusBanner.textContent = 'All questions asked! Waiting for the host…';
    hintImage.classList.add('hidden');
  } else if (state.currentQuestion) {
    statusBanner.classList.add('hidden');
    questionBanner.classList.remove('hidden');
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
    if (state.currentQuestion.answer) {
      answerText.textContent = `Answer: ${state.currentQuestion.answer}`;
      answerText.classList.remove('hidden');
    } else {
      answerText.classList.add('hidden');
    }
    renderCountdown();
  } else {
    questionBanner.classList.add('hidden');
    statusBanner.classList.remove('hidden');
    statusBanner.textContent = 'Get ready…';
  }

  if (player) renderGrid();
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

socket.on('player-kicked', ({ playerId } = {}) => {
  if (!player || playerId !== player.id) return;
  localStorage.removeItem(storageKey('playerId'));
  localStorage.removeItem(storageKey('playerName'));
  localStorage.removeItem(storageKey(`marks_${player.id}`));
  player = null;
  markedSet = new Set();
  wrongSet = new Set();
  registerError.textContent = 'You were removed by the host — please rejoin.';
  showRegister();
});

// The host's "next question" action auto-fills a missed cell for any player
// who has the answer on their card but didn't click it in time — this keeps
// the bingo grid moving without affecting the leaderboard (see /game/next).
socket.on('cell-auto-marked', ({ playerId, cellIndex } = {}) => {
  if (!player || playerId !== player.id || typeof cellIndex !== 'number') return;
  markedSet.add(cellIndex);
  wrongSet.delete(cellIndex);
  saveLocalMarks(player.id);
  renderGrid();
});

// Phones routinely background the tab (screen lock, app switch) and miss
// socket pushes while asleep. Resync on every (re)connect, whenever the tab
// becomes visible again, and on a slow poll as a belt-and-suspenders fallback
// — otherwise a player can be stuck looking at a stale "locked" grid forever.
socket.on('connect', refreshState);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshState();
});

setInterval(refreshState, 5000);

socket.on('game-reset', async () => {
  gameoverOverlay.classList.add('hidden');
  if (!player) return;
  markedSet = new Set();
  wrongSet = new Set();
  saveLocalMarks(player.id);
  try {
    const res = await fetch(api(`/players/${player.id}`));
    if (res.ok) player = await res.json();
  } catch (err) {
    // keep existing grid if refetch fails; next reload will resync
  }
  renderGrid();
});

socket.on('game-over', (winner) => {
  gameoverWinner.textContent = winner && winner.playerName ? `${winner.playerName} wins!` : '';
  gameoverOverlay.classList.remove('hidden');
});

async function init() {
  await loadGameInfo();
  if (!gameValid) return;
  await refreshState();
  await tryResumeSession();
}

init();
