const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const gameTitle = document.getElementById('game-title');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const gameViewUrlEl = document.getElementById('game-view-url');
const statusLine = document.getElementById('status-line');
const winnerBanner = document.getElementById('winner-banner');
const btnStart = document.getElementById('btn-start');
const btnNext = document.getElementById('btn-next');
const btnRevealHint = document.getElementById('btn-reveal-hint');
const btnReveal = document.getElementById('btn-reveal');
const btnGameover = document.getElementById('btn-gameover');
const btnReset = document.getElementById('btn-reset');
const playerCount = document.getElementById('player-count');
const playersList = document.getElementById('players-list');
const questionCount = document.getElementById('question-count');
const questionsBody = document.getElementById('questions-body');
const btnAddQuestion = document.getElementById('btn-add-question');
const btnSaveQuestions = document.getElementById('btn-save-questions');
const questionsError = document.getElementById('questions-error');

let currentState = null;

async function loadGameInfo() {
  const res = await fetch(`/api/games/${gameId}`);
  if (!res.ok) {
    gameTitle.textContent = 'Game not found';
    return;
  }
  const game = await res.json();
  applyTheme(game.config.pack);
  gameTitle.textContent = `${game.name} (${game.id})`;
  joinQr.src = `/api/games/${gameId}/qr.png`;
  joinUrl.textContent = game.joinUrl;
  gameViewUrlEl.textContent = game.gameViewUrl;
  gameViewUrlEl.href = game.gameViewUrl;
}

function applyState(state) {
  currentState = state;

  let line = `Status: ${state.status} · Reveal: ${state.revealStage}`;
  if (state.currentQuestion) {
    line += ` · Q${state.questionNumber}/${state.totalQuestions}: ${state.currentQuestion.question}`;
  }
  if (state.questionShownAt && (state.revealStage === 'question' || state.revealStage === 'hint')) {
    const elapsed = Date.now() - new Date(state.questionShownAt).getTime();
    if (state.revealStage === 'question') {
      line += ` · hint in ${Math.max(0, Math.ceil((state.hintDelayMs - elapsed) / 1000))}s`;
    }
    line += ` · answer in ${Math.max(0, Math.ceil((state.answerDelayMs - elapsed) / 1000))}s`;
  }
  statusLine.textContent = line;

  if (state.winner) {
    winnerBanner.textContent = `🏆 ${state.winner.playerName} got BINGO!`;
    winnerBanner.classList.remove('hidden');
  } else {
    winnerBanner.classList.add('hidden');
  }

  btnStart.disabled = state.status === 'running';
  btnNext.disabled = state.status !== 'running';
  btnRevealHint.disabled = state.revealStage !== 'question';
  btnReveal.disabled = !(state.revealStage === 'question' || state.revealStage === 'hint');
  btnGameover.disabled = !state.winner;
}

setInterval(() => {
  if (currentState) applyState(currentState);
}, 1000);

async function postAction(path) {
  const res = await fetch(api(path), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'action failed');
}

btnStart.addEventListener('click', () => postAction('/game/start'));
btnNext.addEventListener('click', () => postAction('/game/next'));
btnRevealHint.addEventListener('click', () => postAction('/game/reveal-hint'));
btnReveal.addEventListener('click', () => postAction('/game/reveal'));
btnGameover.addEventListener('click', () => postAction('/game/flash-gameover'));
btnReset.addEventListener('click', () => {
  if (confirm('Reset the game? This clears all scores and progress.')) {
    postAction('/game/reset');
  }
});

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString() : null;
}

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const players = await res.json();
  playerCount.textContent = players.length;
  playersList.innerHTML = players
    .map((p) => {
      const lastAnswered = formatTime(p.lastAnsweredAt);
      const detail = `${p.correctCount} correct${p.answeredCount ? ` / ${p.answeredCount} answered` : ''}${
        lastAnswered ? ` · last ${lastAnswered}` : ''
      }`;
      return `<li>
        <span class="player-status ${p.online ? 'online' : 'offline'}" title="${p.online ? 'online' : 'offline'}"></span>
        <span class="player-name">${p.name}</span>
        <span class="player-stats">${detail}</span>
        <button class="btn-kick" data-id="${p.id}" data-name="${escapeAttr(p.name)}">Kick</button>
      </li>`;
    })
    .join('');
  playersList.querySelectorAll('.btn-kick').forEach((btn) => {
    btn.addEventListener('click', () => kickPlayer(btn.dataset.id, btn.dataset.name));
  });
}

async function kickPlayer(playerId, playerName) {
  if (!confirm(`Kick ${playerName}? They'll need to rejoin.`)) return;
  const res = await fetch(api(`/players/${playerId}/kick`), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'kick failed');
}

function questionRow(q) {
  const tr = document.createElement('tr');
  tr.dataset.id = q.id;
  tr.innerHTML = `
    <td>${q.id}</td>
    <td><input class="f-question" value="${escapeAttr(q.question || '')}" /></td>
    <td><input class="f-hint" value="${escapeAttr(q.hint || '')}" /></td>
    <td><input class="f-answer" value="${escapeAttr(q.answer || '')}" /></td>
    <td><button class="secondary btn-delete">✕</button></td>
  `;
  tr.querySelector('.btn-delete').addEventListener('click', () => {
    tr.remove();
    questionCount.textContent = questionsBody.children.length;
  });
  return tr;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function loadQuestions() {
  const res = await fetch(api('/questions'));
  const questions = await res.json();
  questionsBody.innerHTML = '';
  questions.forEach((q) => questionsBody.appendChild(questionRow(q)));
  questionCount.textContent = questions.length;
}

btnAddQuestion.addEventListener('click', () => {
  const newId = `qnew-${Date.now()}`;
  questionsBody.appendChild(questionRow({ id: newId, question: '', hint: '', answer: '' }));
  questionCount.textContent = questionsBody.children.length;
});

btnSaveQuestions.addEventListener('click', async () => {
  questionsError.textContent = '';
  const questions = Array.from(questionsBody.children).map((tr) => ({
    id: tr.dataset.id,
    question: tr.querySelector('.f-question').value.trim(),
    hint: tr.querySelector('.f-hint').value.trim() || null,
    answer: tr.querySelector('.f-answer').value.trim(),
  }));

  const invalid = questions.find((q) => !q.question || !q.answer);
  if (invalid) {
    questionsError.textContent = 'Every question needs both question text and an answer.';
    return;
  }

  const res = await fetch(api('/questions'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions }),
  });
  const data = await res.json();
  if (!res.ok) {
    questionsError.textContent = data.error || 'save failed';
    return;
  }
  await loadQuestions();
});

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', refreshPlayers);
socket.on('players-update', refreshPlayers);
socket.on('bingo-detected', (winner) => {
  winnerBanner.textContent = `🏆 ${winner.playerName} got BINGO!`;
  winnerBanner.classList.remove('hidden');
  btnGameover.disabled = false;
});
socket.on('game-reset', () => {
  winnerBanner.classList.add('hidden');
  refreshPlayers();
});

async function resync() {
  const res = await fetch(api('/state'));
  applyState(await res.json());
  await refreshPlayers();
}

// Resync game status/players on (re)connect, tab refocus, and a slow poll
// fallback. Deliberately does NOT reload the questions table here, so it
// never clobbers an in-progress edit the admin hasn't saved yet.
socket.on('connect', resync);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resync();
});
setInterval(resync, 5000);

async function init() {
  await loadGameInfo();
  await resync();
  await loadQuestions();
}

init();
