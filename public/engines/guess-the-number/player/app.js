const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const CATEGORY_EMOJI = {
  Cricket: '🏏',
  'IPL Cricket': '🏆',
  'FIFA World Cup': '⚽',
  'Formula 1': '🏎️',
  'Olympic Games': '🥇',
  Oscars: '🎬',
  'Hollywood Movies': '🎥',
  'Bollywood Movies': '🎞️',
  'Pop Culture & Music': '🎵',
  'Tennis Grand Slams': '🎾',
};

function categoryEmoji(category) {
  if (!category) return '';
  return CATEGORY_EMOJI[category] || '🏷️';
}

const registerScreen = document.getElementById('register-screen');
const gameScreen = document.getElementById('game-screen');
const gameIdBanner = document.getElementById('game-id-banner');
const registerForm = document.getElementById('register-form');
const nameInput = document.getElementById('name-input');
const registerError = document.getElementById('register-error');
const playerNameBanner = document.getElementById('player-name-banner');
const scoreBanner = document.getElementById('score-banner');
const gameWinnerBanner = document.getElementById('game-winner-banner');
const questionBanner = document.getElementById('question-banner');
const questionStatus = document.getElementById('question-status');
const questionText = document.getElementById('question-text');
const answerForm = document.getElementById('answer-form');
const answerInput = document.getElementById('answer-input');
const answerSubmitted = document.getElementById('answer-submitted');
const revealPanel = document.getElementById('reveal-panel');

const REVEAL_DELAY_MS = 1400;

let player = null; // { id, name, points, answeredCurrentQuestion }
let gameValid = true;
let lastQuestionId;
let hasAppliedState = false; // guards the first applyState call from wiping out a resumed session's answeredCurrentQuestion
let revealAnimating = false;

function storageKey(suffix) {
  return `guessnum_${gameId}_${suffix}`;
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

answerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const guess = Number(answerInput.value);
  if (!Number.isFinite(guess) || !player) return;

  try {
    const res = await fetch(api('/answer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, guess }),
    });
    if (res.ok) {
      player.answeredCurrentQuestion = true;
      answerForm.classList.add('hidden');
      answerSubmitted.classList.remove('hidden');
    }
  } catch (err) {
    // leave the form open so the player can retry
  }
});

function renderGuesses(guesses) {
  revealPanel.innerHTML = `
    <ul class="guesses-list">
      ${guesses
        .map(
          (g) =>
            `<li class="${player && g.playerId === player.id ? 'mine' : ''}">
              <span class="guess-name">${escapeHtml(g.playerName)}</span>: ${g.guess}
            </li>`
        )
        .join('')}
    </ul>
  `;
}

function appendAnswerReveal(answer, roundWinners) {
  const mine = player && roundWinners.some((w) => w.playerId === player.id);
  const verdict = roundWinners.length
    ? mine
      ? '🎉 You were closest!'
      : `Closest: ${roundWinners.map((w) => escapeHtml(w.playerName)).join(', ')}`
    : 'No one within 5 — no point this round.';
  revealPanel.insertAdjacentHTML(
    'beforeend',
    `<div class="answer-line">Real answer: <strong>${answer}</strong></div>
     <div class="verdict-line ${mine ? 'mine' : ''}">${verdict}</div>`
  );
}

async function refreshMyPlayer() {
  if (!player) return;
  const res = await fetch(api(`/players/${player.id}`));
  if (res.ok) {
    player = await res.json();
    renderScore();
  }
}

function renderGameWinner(winners) {
  if (!winners || !winners.length) {
    gameWinnerBanner.classList.add('hidden');
    return;
  }
  const mine = player && winners.some((w) => w.playerId === player.id);
  gameWinnerBanner.classList.remove('hidden');
  gameWinnerBanner.innerHTML = mine
    ? '🏆 You won the game!'
    : `🏆 ${winners.map((w) => escapeHtml(w.playerName)).join(', ')} won the game!`;
}

function applyState(state) {
  renderGameWinner(state.gameWinners);

  const promptId = state.currentQuestion ? state.currentQuestion.id : null;
  // Only treat this as a *change* after the first real call — otherwise a
  // resumed session's correctly-fetched answeredCurrentQuestion would get
  // wiped back to false the instant the page loads, since lastQuestionId
  // starts undefined and looks like a change too.
  const questionChanged = hasAppliedState && promptId !== lastQuestionId;
  lastQuestionId = promptId;
  hasAppliedState = true;

  if (questionChanged) {
    if (player) player.answeredCurrentQuestion = false;
    answerInput.value = '';
    answerForm.classList.add('hidden');
    answerSubmitted.classList.add('hidden');
    revealPanel.innerHTML = '';
    revealPanel.classList.add('hidden');
  }

  if (!state.currentQuestion) {
    questionBanner.classList.add('hidden');
    answerForm.classList.add('hidden');
    answerSubmitted.classList.add('hidden');
    return;
  }

  questionBanner.classList.remove('hidden');
  questionStatus.textContent = `Question ${state.questionNumber} / ${state.totalQuestions}`;
  questionText.textContent = state.currentQuestion.category
    ? `${categoryEmoji(state.currentQuestion.category)} ${state.currentQuestion.question}`
    : state.currentQuestion.question;

  if (!player) return;

  if (state.revealStage === 'question') {
    if (player.answeredCurrentQuestion) {
      answerForm.classList.add('hidden');
      answerSubmitted.classList.remove('hidden');
    } else {
      answerForm.classList.remove('hidden');
      answerSubmitted.classList.add('hidden');
    }
  } else if (state.revealStage === 'answer' && !revealAnimating) {
    answerForm.classList.add('hidden');
    answerSubmitted.classList.add('hidden');
    revealPanel.classList.remove('hidden');
    if (state.reveal) {
      renderGuesses(state.reveal.guesses);
      appendAnswerReveal(state.reveal.answer, state.reveal.roundWinners);
    }
    refreshMyPlayer();
  }
}

// Shows every guess first, then — after a pause — the real answer, same
// staged sequence as the TV view. Only triggers from the live socket event,
// never from a resync, so a late viewer just sees the settled result.
socket.on('question-revealed', async () => {
  answerForm.classList.add('hidden');
  answerSubmitted.classList.add('hidden');
  revealAnimating = true;
  try {
    const res = await fetch(api('/state'));
    const state = await res.json();
    if (!state.reveal) {
      revealAnimating = false;
      return;
    }
    revealPanel.classList.remove('hidden');
    renderGuesses(state.reveal.guesses);
    setTimeout(() => {
      appendAnswerReveal(state.reveal.answer, state.reveal.roundWinners);
      refreshMyPlayer();
      revealAnimating = false;
    }, REVEAL_DELAY_MS);
  } catch (err) {
    revealAnimating = false;
  }
});

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

socket.on('game-reset', async () => {
  gameWinnerBanner.classList.add('hidden');
  revealAnimating = false;
  if (!player) return;
  await refreshMyPlayer();
  answerForm.classList.add('hidden');
  answerSubmitted.classList.add('hidden');
  revealPanel.innerHTML = '';
  revealPanel.classList.add('hidden');
});

socket.on('connect', refreshState);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshState();
});
setInterval(refreshState, 5000);

async function init() {
  await loadGameInfo();
  if (!gameValid) return;
  await tryResumeSession();
  await refreshState();
}

init();
