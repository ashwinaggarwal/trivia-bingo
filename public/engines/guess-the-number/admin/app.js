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

const gameTitle = document.getElementById('game-title');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const gameViewUrlEl = document.getElementById('game-view-url');
const statusLine = document.getElementById('status-line');
const currentQuestion = document.getElementById('current-question');
const answeredProgress = document.getElementById('answered-progress');
const gameWinnersPanel = document.getElementById('game-winners-panel');
const gameWinnersText = document.getElementById('game-winners-text');
const btnStart = document.getElementById('btn-start');
const btnNext = document.getElementById('btn-next');
const btnReveal = document.getElementById('btn-reveal');
const btnReset = document.getElementById('btn-reset');
const playerCount = document.getElementById('player-count');
const playersList = document.getElementById('players-list');
const questionCount = document.getElementById('question-count');
const questionsBody = document.getElementById('questions-body');
const btnAddQuestion = document.getElementById('btn-add-question');
const btnSaveQuestions = document.getElementById('btn-save-questions');
const questionsError = document.getElementById('questions-error');

let playerTotal = 0;

async function loadGameInfo() {
  const res = await fetch(`/api/games/${gameId}`);
  if (!res.ok) {
    gameTitle.textContent = 'Game not found';
    return;
  }
  const game = await res.json();
  gameTitle.textContent = `${game.name} (${game.id})`;
  joinQr.src = `/api/games/${gameId}/qr.png`;
  joinUrl.textContent = game.joinUrl;
  gameViewUrlEl.textContent = game.gameViewUrl;
  gameViewUrlEl.href = game.gameViewUrl;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderGameWinners(winners) {
  if (!winners || !winners.length) {
    gameWinnersPanel.classList.add('hidden');
    return;
  }
  gameWinnersPanel.classList.remove('hidden');
  gameWinnersText.textContent = `${winners.map((w) => `${w.playerName} (${w.points} pts)`).join(', ')}`;
}

function applyState(state) {
  let line = `Status: ${state.status} · Question ${state.questionNumber}/${state.totalQuestions}`;
  statusLine.textContent = line;
  currentQuestion.textContent = state.currentQuestion
    ? `${state.currentQuestion.category ? `${categoryEmoji(state.currentQuestion.category)} ` : ''}${state.currentQuestion.question}`
    : '';
  answeredProgress.textContent =
    state.revealStage === 'question' ? `${state.answeredCount} / ${playerTotal} answered` : '';
  renderGameWinners(state.gameWinners);

  btnStart.disabled = state.status === 'running' || state.status === 'ended';
  btnNext.disabled = state.status !== 'running' || state.revealStage === 'question';
  btnReveal.disabled = state.status !== 'running' || state.revealStage !== 'question';
}

async function postAction(path) {
  const res = await fetch(api(path), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'action failed');
  return data;
}

btnStart.addEventListener('click', () => postAction('/game/start'));
btnNext.addEventListener('click', () => postAction('/game/next'));
btnReveal.addEventListener('click', () => postAction('/game/reveal'));
btnReset.addEventListener('click', () => {
  if (confirm('Reset the game? This clears all scores and progress.')) postAction('/game/reset');
});

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const players = await res.json();
  playerTotal = players.length;
  playerCount.textContent = players.length;
  playersList.innerHTML = players
    .map(
      (p) => `<li>
        <span class="player-status ${p.online ? 'online' : 'offline'}"></span>
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="player-stats">${p.points} pt${p.points === 1 ? '' : 's'}</span>
        <button class="btn-kick" data-id="${p.id}" data-name="${escapeAttr(p.name)}">Kick</button>
      </li>`
    )
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
    <td><input class="f-category" value="${escapeAttr(q.category || '')}" /></td>
    <td><input class="f-question" value="${escapeAttr(q.question || '')}" /></td>
    <td><input class="f-answer" type="number" value="${escapeAttr(q.answer ?? '')}" /></td>
    <td><input class="f-is-year" type="checkbox" ${q.isYear ? 'checked' : ''} /></td>
    <td><button class="btn-secondary btn-delete">✕</button></td>
  `;
  tr.querySelector('.btn-delete').addEventListener('click', () => {
    tr.remove();
    questionCount.textContent = questionsBody.children.length;
  });
  return tr;
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
  questionsBody.appendChild(
    questionRow({ id: newId, category: '', question: '', answer: '', isYear: false })
  );
  questionCount.textContent = questionsBody.children.length;
});

btnSaveQuestions.addEventListener('click', async () => {
  questionsError.textContent = '';
  const questions = Array.from(questionsBody.children).map((tr) => ({
    id: tr.dataset.id,
    category: tr.querySelector('.f-category').value.trim() || null,
    question: tr.querySelector('.f-question').value.trim(),
    answer: Number(tr.querySelector('.f-answer').value),
    isYear: tr.querySelector('.f-is-year').checked,
  }));

  const invalid = questions.find((q) => !q.question || !Number.isFinite(q.answer));
  if (invalid) {
    questionsError.textContent = 'Every question needs question text and a numeric answer.';
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
socket.on('game-reset', () => {
  gameWinnersPanel.classList.add('hidden');
  refreshPlayers();
});

// Resync game status/players on (re)connect, tab refocus, and a slow poll
// fallback. Deliberately does NOT reload the questions table here, so it
// never clobbers an in-progress edit the admin hasn't saved yet.
async function resync() {
  await refreshPlayers();
  const res = await fetch(api('/state'));
  applyState(await res.json());
}

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
