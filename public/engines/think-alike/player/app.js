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
const promptBanner = document.getElementById('prompt-banner');
const promptStatus = document.getElementById('prompt-status');
const promptText = document.getElementById('prompt-text');
const answerForm = document.getElementById('answer-form');
const answerInput = document.getElementById('answer-input');
const answerSubmitted = document.getElementById('answer-submitted');
const revealPanel = document.getElementById('reveal-panel');

let player = null; // { id, name, score }
let gameValid = true;
let lastPromptId;

function storageKey(suffix) {
  return `thinkalike_${gameId}_${suffix}`;
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

function showGame() {
  registerScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  playerNameBanner.textContent = `Playing as ${player.name}`;
  scoreBanner.textContent = `${player.score} pt${player.score === 1 ? '' : 's'}`;
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
  const text = answerInput.value.trim();
  if (!text || !player) return;

  try {
    const res = await fetch(api('/answer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, text }),
    });
    if (res.ok) {
      answerForm.classList.add('hidden');
      answerSubmitted.classList.remove('hidden');
    }
  } catch (err) {
    // leave the form open so the player can retry
  }
});

async function refreshMyPlayer() {
  if (!player) return;
  const res = await fetch(api(`/players/${player.id}`));
  if (res.ok) {
    player = await res.json();
    scoreBanner.textContent = `${player.score} pt${player.score === 1 ? '' : 's'}`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyState(state) {
  if (!player) return;

  const promptId = state.currentPrompt ? state.currentPrompt.id : null;
  if (promptId !== lastPromptId) {
    lastPromptId = promptId;
    answerInput.value = '';
    answerForm.classList.add('hidden');
    answerSubmitted.classList.add('hidden');
    revealPanel.classList.add('hidden');
  }

  if (state.status === 'setup') {
    promptBanner.classList.add('hidden');
    answerForm.classList.add('hidden');
    answerSubmitted.classList.add('hidden');
    revealPanel.classList.add('hidden');
    return;
  }

  if (!state.currentPrompt) {
    promptBanner.classList.add('hidden');
    return;
  }

  promptBanner.classList.remove('hidden');
  promptStatus.textContent = `Prompt ${state.promptNumber} / ${state.totalPrompts}`;
  promptText.textContent = state.currentPrompt.text;

  const alreadyAnswered = state.answeredPlayerIds.includes(player.id);

  if (state.revealStage === 'prompt') {
    revealPanel.classList.add('hidden');
    if (alreadyAnswered) {
      answerForm.classList.add('hidden');
      answerSubmitted.classList.remove('hidden');
    } else {
      answerForm.classList.remove('hidden');
      answerSubmitted.classList.add('hidden');
    }
  } else if (state.revealStage === 'reveal' && state.reveal) {
    answerForm.classList.add('hidden');
    answerSubmitted.classList.add('hidden');
    const scored = state.reveal.scoredPlayerIds.includes(player.id);
    const myGroup = state.reveal.groups.find((g) => g.playerIds.includes(player.id));
    revealPanel.innerHTML = `
      <p class="reveal-verdict ${scored ? 'scored' : ''}">${scored ? '✅ You matched the group!' : myGroup ? '❌ No match this round.' : '— You didn’t answer in time.'}</p>
      <ul class="reveal-groups">
        ${state.reveal.groups
          .map((g) => `<li>${escapeHtml(g.answer)} — ${g.playerIds.length}</li>`)
          .join('')}
      </ul>
    `;
    revealPanel.classList.remove('hidden');
    refreshMyPlayer();
  }
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
  if (!player) return;
  await refreshMyPlayer();
  answerForm.classList.add('hidden');
  answerSubmitted.classList.add('hidden');
  revealPanel.classList.add('hidden');
});

async function refreshState() {
  if (!gameValid) return;
  const res = await fetch(api('/state'));
  if (!res.ok) return;
  applyState(await res.json());
}

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
