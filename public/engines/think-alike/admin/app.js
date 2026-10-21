const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const gameTitle = document.getElementById('game-title');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const gameViewUrlEl = document.getElementById('game-view-url');
const statusLine = document.getElementById('status-line');
const currentPrompt = document.getElementById('current-prompt');
const btnStart = document.getElementById('btn-start');
const btnNext = document.getElementById('btn-next');
const btnReveal = document.getElementById('btn-reveal');
const btnReset = document.getElementById('btn-reset');
const playerCount = document.getElementById('player-count');
const playersList = document.getElementById('players-list');

let currentState = null;

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

function applyState(state) {
  currentState = state;

  let line = `Status: ${state.status} · Reveal: ${state.revealStage}`;
  if (state.totalPrompts) line += ` · Prompt ${state.promptNumber}/${state.totalPrompts}`;
  statusLine.textContent = line;

  currentPrompt.textContent = state.currentPrompt
    ? `"${state.currentPrompt.text}" — ${state.answeredPlayerIds.length} answered`
    : '';

  btnStart.disabled = state.status === 'running';
  btnNext.disabled = state.status !== 'running';
  btnReveal.disabled = state.revealStage !== 'prompt';
}

async function postAction(path) {
  const res = await fetch(api(path), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'action failed');
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
  playerCount.textContent = players.length;
  playersList.innerHTML = players
    .map(
      (p) => `<li>
        <span class="player-status ${p.online ? 'online' : 'offline'}" title="${p.online ? 'online' : 'offline'}"></span>
        <span class="player-name">${p.name}</span>
        <span class="player-stats">${p.score} pt${p.score === 1 ? '' : 's'}</span>
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

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', refreshPlayers);
socket.on('players-update', refreshPlayers);
socket.on('player-answered', () => {
  if (currentState) {
    fetch(api('/state'))
      .then((r) => r.json())
      .then(applyState);
  }
});
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
