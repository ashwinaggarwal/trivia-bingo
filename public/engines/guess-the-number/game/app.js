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

const joinHint = document.getElementById('join-hint');
const joinPanel = document.getElementById('join-panel');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const rosterCount = document.getElementById('roster-count');
const rosterList = document.getElementById('roster-list');
const questionStatus = document.getElementById('question-status');
const questionText = document.getElementById('question-text');
const answeredProgress = document.getElementById('answered-progress');
const guessesPanel = document.getElementById('guesses-panel');
const guessesList = document.getElementById('guesses-list');
const answerReveal = document.getElementById('answer-reveal');
const answerValue = document.getElementById('answer-value');
const roundWinner = document.getElementById('round-winner');
const gameWinnerPanel = document.getElementById('game-winner-panel');
const gameWinnerText = document.getElementById('game-winner-text');
const leaderboardRows = document.getElementById('leaderboard-rows');

const REVEAL_DELAY_MS = 1400; // pause between showing guesses and revealing the real answer

let playerTotal = 0;
let revealAnimating = false; // true while the live staged reveal is mid-sequence

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

function renderRoster(players) {
  playerTotal = players.length;
  rosterCount.textContent = players.length;
  rosterList.innerHTML = players
    .map(
      (p) =>
        `<li><span class="player-status ${p.online ? 'online' : 'offline'}"></span>${escapeHtml(p.name)}</li>`
    )
    .join('');
}

function renderLeaderboard(players) {
  const ranked = players.slice().sort((a, b) => b.points - a.points);
  leaderboardRows.innerHTML = ranked
    .map((p, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      return `<li>${medal} ${escapeHtml(p.name)} — ${p.points} pt${p.points === 1 ? '' : 's'}</li>`;
    })
    .join('');
}

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const players = await res.json();
  renderRoster(players);
  renderLeaderboard(players);
}

function renderGuesses(guesses) {
  guessesList.innerHTML = guesses
    .map((g) => `<li><span class="guess-name">${escapeHtml(g.playerName)}</span>: ${g.guess}</li>`)
    .join('');
}

function renderRoundWinner(roundWinners) {
  if (!roundWinners || !roundWinners.length) {
    roundWinner.textContent = 'No one within 5 — no point this round.';
    roundWinner.classList.remove('hidden');
    return;
  }
  roundWinner.textContent = `🎉 Closest: ${roundWinners.map((w) => escapeHtml(w.playerName)).join(', ')}`;
  roundWinner.classList.remove('hidden');
}

// Settled render, no animation — used for initial load/resync so a late
// viewer sees the correct state immediately instead of replaying a reveal
// that already happened.
function renderRevealSettled(state) {
  if (!state.reveal) {
    guessesPanel.classList.add('hidden');
    answerReveal.classList.add('hidden');
    roundWinner.classList.add('hidden');
    return;
  }
  renderGuesses(state.reveal.guesses);
  guessesPanel.classList.remove('hidden');
  answerValue.textContent = state.reveal.answer;
  answerReveal.classList.remove('hidden');
  renderRoundWinner(state.reveal.roundWinners);
}

function renderGameWinner(winners) {
  if (!winners || !winners.length) {
    gameWinnerPanel.classList.add('hidden');
    return;
  }
  gameWinnerPanel.classList.remove('hidden');
  gameWinnerText.textContent = winners.map((w) => `${w.playerName} (${w.points} pts)`).join(', ');
}

function applyState(state) {
  joinPanel.classList.toggle('hidden', state.status !== 'setup');
  renderGameWinner(state.gameWinners);

  if (state.status === 'setup') {
    questionStatus.textContent = 'Waiting to start…';
    questionText.textContent = '';
    answeredProgress.classList.add('hidden');
  } else if (state.status === 'ended' && !state.currentQuestion) {
    questionStatus.textContent = 'Game over!';
    questionText.textContent = '';
    answeredProgress.classList.add('hidden');
  } else if (state.currentQuestion) {
    questionStatus.textContent = `Question ${state.questionNumber} / ${state.totalQuestions}`;
    questionText.textContent = state.currentQuestion.category
      ? `${categoryEmoji(state.currentQuestion.category)} ${state.currentQuestion.question}`
      : state.currentQuestion.question;

    if (state.revealStage === 'question') {
      answeredProgress.textContent = `${state.answeredCount} / ${playerTotal} answered`;
      answeredProgress.classList.remove('hidden');
    } else {
      answeredProgress.classList.add('hidden');
    }
  }

  // The live 'question-revealed' handler owns the staged guesses-then-answer
  // sequence below — don't stomp on it mid-animation with the settled view.
  if (!revealAnimating) {
    if (state.revealStage === 'answer') renderRevealSettled(state);
    else {
      guessesPanel.classList.add('hidden');
      answerReveal.classList.add('hidden');
      roundWinner.classList.add('hidden');
    }
  }
}

// Shows every guess first, then — after a pause — the real answer and who
// (if anyone) was close enough to score. Only fires from the live socket
// event, never from a resync, so a late viewer doesn't replay it.
socket.on('question-revealed', async () => {
  revealAnimating = true;
  try {
    const res = await fetch(api('/state'));
    const state = await res.json();
    if (!state.reveal) {
      revealAnimating = false;
      return;
    }
    renderGuesses(state.reveal.guesses);
    guessesPanel.classList.remove('hidden');
    answerReveal.classList.add('hidden');
    roundWinner.classList.add('hidden');
    setTimeout(() => {
      answerValue.textContent = state.reveal.answer;
      answerReveal.classList.remove('hidden');
      renderRoundWinner(state.reveal.roundWinners);
      revealAnimating = false;
    }, REVEAL_DELAY_MS);
  } catch (err) {
    revealAnimating = false;
  }
});

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', refreshPlayers);
socket.on('players-update', refreshPlayers);
socket.on('game-reset', () => {
  gameWinnerPanel.classList.add('hidden');
  revealAnimating = false;
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
