const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const rosterCount = document.getElementById('roster-count');
const rosterList = document.getElementById('roster-list');
const promptStatus = document.getElementById('prompt-status');
const promptText = document.getElementById('prompt-text');
const revealGroups = document.getElementById('reveal-groups');
const leaderboardRows = document.getElementById('leaderboard-rows');

let playersById = {};

async function loadGameInfo() {
  const res = await fetch(`/api/games/${gameId}`);
  if (!res.ok) return;
  const game = await res.json();
  joinQr.src = `/api/games/${gameId}/qr.png`;
  joinUrl.textContent = game.joinUrl;
}

function nameFor(playerId) {
  return (playersById[playerId] && playersById[playerId].name) || 'Someone';
}

function applyState(state) {
  if (state.status === 'setup') {
    promptStatus.textContent = 'Waiting to start…';
    promptText.textContent = '';
    revealGroups.innerHTML = '';
    return;
  }
  if (state.status === 'ended') {
    promptStatus.textContent = 'Game over!';
    promptText.textContent = '';
    revealGroups.innerHTML = '';
    return;
  }

  promptStatus.textContent = `Prompt ${state.promptNumber}/${state.totalPrompts}`;
  promptText.textContent = state.currentPrompt ? state.currentPrompt.text : '';

  if (state.revealStage === 'prompt') {
    revealGroups.innerHTML = `<p class="waiting">${state.answeredPlayerIds.length} answered — waiting on the rest…</p>`;
  } else if (state.revealStage === 'reveal' && state.reveal) {
    const maxSize = state.reveal.groups.length ? state.reveal.groups[0].playerIds.length : 0;
    revealGroups.innerHTML = state.reveal.groups
      .map((g) => {
        const won = g.playerIds.length === maxSize && maxSize > 1;
        const names = g.playerIds.map(nameFor).join(', ');
        return `<div class="group ${won ? 'won' : ''}">
          <span class="group-answer">${escapeHtml(g.answer)}</span>
          <span class="group-count">${g.playerIds.length}</span>
          <span class="group-names">${escapeHtml(names)}</span>
        </div>`;
      })
      .join('');
  } else {
    revealGroups.innerHTML = '';
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyPlayers(players) {
  playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  rosterCount.textContent = players.length;
  rosterList.innerHTML = players
    .map(
      (p) =>
        `<li><span class="player-status ${p.online ? 'online' : 'offline'}"></span>${escapeHtml(p.name)}</li>`
    )
    .join('');

  const ranked = players.slice().sort((a, b) => b.score - a.score);
  leaderboardRows.innerHTML = ranked
    .map((p) => `<li>${escapeHtml(p.name)} — ${p.score} pt${p.score === 1 ? '' : 's'}</li>`)
    .join('');
}

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('players-update', applyPlayers);
socket.on('player-registered', refreshPlayers);
socket.on('player-kicked', refreshPlayers);
socket.on('game-reset', resync);

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  applyPlayers(await res.json());
}

async function resync() {
  const [stateRes, playersRes] = await Promise.all([fetch(api('/state')), fetch(api('/players'))]);
  applyPlayers(await playersRes.json());
  applyState(await stateRes.json());
}

socket.on('connect', resync);
setInterval(resync, 5000);

async function init() {
  await loadGameInfo();
  await resync();
}

init();
