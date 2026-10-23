const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const gameTitle = document.getElementById('game-title');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const gameViewUrlEl = document.getElementById('game-view-url');
const statusLine = document.getElementById('status-line');
const currentDraw = document.getElementById('current-draw');
const winnersPanel = document.getElementById('winners-panel');
const winnersList = document.getElementById('winners-list');
const btnStart = document.getElementById('btn-start');
const btnDraw = document.getElementById('btn-draw');
const btnRedraw = document.getElementById('btn-redraw');
const btnMute = document.getElementById('btn-mute');
const btnReset = document.getElementById('btn-reset');
const playerCount = document.getElementById('player-count');
const playersList = document.getElementById('players-list');
const ticketsList = document.getElementById('tickets-list');

const CATEGORY_LABELS = {
  top: 'Top Line',
  middle: 'Middle Line',
  bottom: 'Bottom Line',
  fullhouse: 'Full House',
};

let currentState = null;
let drawInFlight = false; // client-side throttle, mirrors the server's own cooldown

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

function renderWinners(winners) {
  const entries = Object.entries(winners).filter(([, w]) => w);
  winnersPanel.classList.toggle('hidden', entries.length === 0);
  winnersList.innerHTML = entries
    .map(
      ([category, list]) =>
        `<li>${CATEGORY_LABELS[category]}: ${list.map((w) => w.playerName).join(', ')}</li>`
    )
    .join('');
}

function applyState(state) {
  currentState = state;
  statusLine.textContent = `Status: ${state.status} · Drawn: ${state.totalDrawn}/90`;
  if (state.lastNumber && !currentDraw.dataset.animating) {
    currentDraw.textContent = state.lastNumber;
  }
  renderWinners(state.winners);
  btnStart.disabled = state.status === 'running';
  btnDraw.disabled = state.status !== 'running' || drawInFlight;
  btnRedraw.disabled = state.status !== 'running' || state.totalDrawn === 0 || drawInFlight;
  btnMute.textContent = state.soundMuted
    ? '🔊 Unmute Sound For Everyone'
    : '🔇 Mute Sound For Everyone';
}

async function postAction(path) {
  const res = await fetch(api(path), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'action failed');
  return data;
}

btnStart.addEventListener('click', () => postAction('/game/start'));
btnDraw.addEventListener('click', () => {
  drawInFlight = true;
  if (currentState) applyState(currentState);
  postAction('/game/draw');
  setTimeout(() => {
    drawInFlight = false;
    if (currentState) applyState(currentState);
  }, SCROLL_DURATION_MS);
});
btnRedraw.addEventListener('click', () => {
  if (!currentState || !currentState.lastNumber) return;
  if (
    !confirm(
      `Redraw ${currentState.lastNumber}? It goes back in the pool and a new number is drawn in its place.`
    )
  )
    return;
  drawInFlight = true;
  applyState(currentState);
  postAction('/game/redraw');
  setTimeout(() => {
    drawInFlight = false;
    if (currentState) applyState(currentState);
  }, SCROLL_DURATION_MS);
});
btnMute.addEventListener('click', async () => {
  const muted = !(currentState && currentState.soundMuted);
  const res = await fetch(api('/game/sound'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted }),
  });
  const data = await res.json();
  if (res.ok) applyState(data);
});
btnReset.addEventListener('click', () => {
  if (confirm('Reset the game? This clears the draw and deals new tickets.'))
    postAction('/game/reset');
});

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const players = await res.json();
  playerCount.textContent = players.length;
  playersList.innerHTML = players
    .map((p) => {
      let note = '';
      if (p.distance === 1) note = ' · 🔥 1 away!';
      else if (p.close) note = ` · ${p.distance} away`;
      return `<li class="row">
        <span class="status-dot ${p.online ? 'online' : 'offline'}"></span>
        <span class="row-name">${p.name}</span>
        <span class="row-stat">${note}</span>
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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Shows every player's real tickets and marks, for checking a shouted-out
// win against what they've actually clicked — a player can lie about
// having won; this can't.
async function refreshTickets() {
  const res = await fetch(api('/admin/players'));
  const players = await res.json();
  ticketsList.innerHTML = players
    .map((p) => {
      const markedSet = new Set(p.marked);
      const tickets = p.grids
        .map(
          (grid) =>
            `<div class="mini-ticket">${grid
              .map((n) => `<div class="mini-cell ${markedSet.has(n) ? 'marked' : ''}">${n}</div>`)
              .join('')}</div>`
        )
        .join('');
      return `<div class="ticket-row">
        <div class="ticket-row-name">
          <span class="status-dot ${p.online ? 'online' : 'offline'}"></span>
          ${escapeHtml(p.name)}
        </div>
        <div class="mini-tickets">${tickets}</div>
      </div>`;
    })
    .join('');
}

// --- draw animation, visual only — admin never plays draw/win sound, only
// the TV view does (see public/engines/tambola/game/app.js) ---
const SCROLL_DURATION_MS = 1600;
const SCROLL_TICK_MS = 70;

function runDrawAnimation(finalNumber) {
  currentDraw.dataset.animating = 'true';
  const startedAt = Date.now();
  const interval = setInterval(() => {
    currentDraw.textContent = 1 + Math.floor(Math.random() * 90);
    if (Date.now() - startedAt >= SCROLL_DURATION_MS) {
      clearInterval(interval);
      currentDraw.textContent = finalNumber;
      delete currentDraw.dataset.animating;
    }
  }, SCROLL_TICK_MS);
}

socket.on('connect', () => socket.emit('join-game', gameId));
socket.on('state-update', applyState);
socket.on('player-registered', () => {
  refreshPlayers();
  refreshTickets();
});
socket.on('players-update', () => {
  refreshPlayers();
  refreshTickets();
});
socket.on('number-drawn', (payload) => runDrawAnimation(payload.number));
socket.on('game-reset', () => {
  winnersPanel.classList.add('hidden');
  currentDraw.textContent = '';
  refreshPlayers();
  refreshTickets();
});
// Marking happens on the player's own view, which this admin console has no
// other visibility into — resync on a timer so the tickets panel reflects
// clicks reasonably promptly without needing its own socket event.
setInterval(refreshTickets, 5000);

async function resync() {
  const res = await fetch(api('/state'));
  applyState(await res.json());
  await refreshPlayers();
  await refreshTickets();
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
