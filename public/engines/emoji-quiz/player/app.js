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
const questionBanner = document.getElementById('question-banner');
const questionStatus = document.getElementById('question-status');
const countdownText = document.getElementById('countdown-text');
const emojiText = document.getElementById('emoji-text');
const optionsEl = document.getElementById('options');

let player = null; // { id, name, points }
let currentState = null;
let gameValid = true;
let lastQuestionId;
let answeredThisQuestion = false;
let myAnswerIndex = null;
let myAnswerCorrect = null;

function storageKey(suffix) {
  return `emojiquiz_${gameId}_${suffix}`;
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
  scoreBanner.textContent = `${player.points} pt${player.points === 1 ? '' : 's'}`;
}

function showGame() {
  registerScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  playerNameBanner.textContent = `Playing as ${player.name}`;
  renderScore();
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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Own pick is colored as soon as the server responds (correct or wrong) —
// the player immediately learns their own result, same as a real quiz
// buzzer — while the correct option only lights up for everyone once
// `revealStage` flips to 'answer'.
function renderOptions() {
  optionsEl.innerHTML = '';
  const state = currentState;
  const q = state && state.currentQuestion;
  if (!q || !q.options || !q.options.length) return;

  const revealed = state.revealStage === 'answer';
  const canAnswer = state.revealStage === 'question' && !answeredThisQuestion;

  q.options.forEach((text, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn';
    btn.innerHTML = `<span class="option-letter">${'ABCD'[index]}</span><span class="option-text">${escapeHtml(text)}</span>`;

    if (answeredThisQuestion && index === myAnswerIndex) {
      btn.classList.add(myAnswerCorrect ? 'correct' : 'wrong');
    } else if (revealed && index === q.correctIndex) {
      btn.classList.add('correct');
    }

    btn.disabled = !canAnswer;
    btn.addEventListener('click', () => handleOptionClick(index));
    optionsEl.appendChild(btn);
  });
}

async function handleOptionClick(index) {
  if (answeredThisQuestion) return;
  answeredThisQuestion = true;
  myAnswerIndex = index;
  renderOptions(); // lock all 4 immediately — one attempt only

  try {
    const res = await fetch(api('/answer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, optionIndex: index }),
    });
    const data = await res.json();
    if (res.ok) {
      myAnswerCorrect = Boolean(data.correct);
      if (data.pointAwarded) {
        player.points += 1;
        renderScore();
      }
    } else {
      answeredThisQuestion = false;
      myAnswerIndex = null;
    }
  } catch (err) {
    answeredThisQuestion = false;
    myAnswerIndex = null;
  }

  renderOptions();
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

  const newQuestionId = state.currentQuestion ? state.currentQuestion.id : null;
  if (newQuestionId !== lastQuestionId) {
    answeredThisQuestion = false;
    myAnswerIndex = null;
    myAnswerCorrect = null;
    lastQuestionId = newQuestionId;
  }

  if (state.status === 'setup') {
    questionBanner.classList.add('hidden');
    optionsEl.classList.add('hidden');
  } else if (state.status === 'ended' && !state.currentQuestion) {
    questionBanner.classList.remove('hidden');
    questionStatus.textContent = 'All questions asked!';
    emojiText.textContent = '';
    optionsEl.classList.add('hidden');
    countdownText.classList.add('hidden');
  } else if (state.currentQuestion) {
    questionBanner.classList.remove('hidden');
    questionStatus.textContent = `Question ${state.questionNumber} / ${state.totalQuestions}`;
    emojiText.textContent = state.currentQuestion.emojis;
    optionsEl.classList.remove('hidden');
    renderOptions();
    renderCountdown();
  }
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
  player = null;
  registerError.textContent = 'You were removed by the host — please rejoin.';
  showRegister();
});

socket.on('connect', refreshState);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshState();
});
setInterval(refreshState, 5000);

socket.on('game-reset', async () => {
  if (!player) return;
  answeredThisQuestion = false;
  myAnswerIndex = null;
  myAnswerCorrect = null;
  try {
    const res = await fetch(api(`/players/${player.id}`));
    if (res.ok) {
      player = await res.json();
      renderScore();
    }
  } catch (err) {
    // keep existing score if refetch fails; next reload will resync
  }
  renderOptions();
});

async function init() {
  await loadGameInfo();
  if (!gameValid) return;
  await tryResumeSession();
  await refreshState();
}

init();
