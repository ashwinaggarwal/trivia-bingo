const gameId = location.pathname.split('/').filter(Boolean).pop();
const api = (path) => `/api/games/${gameId}${path}`;

const socket = io();

const gameTitle = document.getElementById('game-title');
const joinQr = document.getElementById('join-qr');
const joinUrl = document.getElementById('join-url');
const gameViewUrlEl = document.getElementById('game-view-url');
const statusLine = document.getElementById('status-line');
const btnStart = document.getElementById('btn-start');
const btnEnd = document.getElementById('btn-end');
const btnReset = document.getElementById('btn-reset');
const engineSelect = document.getElementById('engine-select');
const roundOptions = document.getElementById('round-options');
const btnQueueRound = document.getElementById('btn-queue-round');
const btnStartNext = document.getElementById('btn-start-next');
const roundError = document.getElementById('round-error');
const roundCount = document.getElementById('round-count');
const roundsList = document.getElementById('rounds-list');
const leaderboardRows = document.getElementById('leaderboard-rows');
const finalStandingsPanel = document.getElementById('final-standings-panel');
const finalStandingsText = document.getElementById('final-standings-text');
const playerCount = document.getElementById('player-count');
const playersList = document.getElementById('players-list');

let currentState = null;
let engineOptionsField = null; // the selected engine's createOptions.fields[0], if any
let playersById = {};

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

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

// --- choosing a game for the next round ---

async function loadEngineOptions() {
  const res = await fetch('/api/engines');
  const engines = await res.json();
  const playable = engines.filter((e) => e.slug !== 'party-night');
  engineSelect.innerHTML = playable
    .map(
      (e) =>
        `<option value="${escapeAttr(e.slug)}">${escapeHtml(e.emoji)} ${escapeHtml(e.title)}</option>`
    )
    .join('');
  await loadRoundOptionsFor(engineSelect.value);
}

async function loadRoundOptionsFor(slug) {
  roundOptions.innerHTML = '';
  roundOptions.classList.add('hidden');
  engineOptionsField = null;
  if (!slug) return;
  const res = await fetch(`/api/engines/${encodeURIComponent(slug)}`);
  if (!res.ok) return;
  const engine = await res.json();
  const field =
    engine.createOptions && engine.createOptions.fields && engine.createOptions.fields[0];
  if (!field) return;
  engineOptionsField = field;
  roundOptions.classList.remove('hidden');
  roundOptions.innerHTML = `
    <label for="round-option-select">${escapeHtml(field.label)}</label>
    <select id="round-option-select">
      ${field.options.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.emoji || '')} ${escapeHtml(o.label)}</option>`).join('')}
    </select>
  `;
}

engineSelect.addEventListener('change', () => loadRoundOptionsFor(engineSelect.value));

function currentRoundBody() {
  const body = { engine: engineSelect.value };
  if (engineOptionsField) {
    const picked = document.getElementById('round-option-select');
    if (picked) body[engineOptionsField.key] = picked.value;
  }
  return body;
}

btnQueueRound.addEventListener('click', async () => {
  roundError.textContent = '';
  const res = await fetch(api('/round/queue'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentRoundBody()),
  });
  const data = await res.json();
  if (!res.ok) roundError.textContent = data.error || 'failed to queue round';
});

btnStartNext.addEventListener('click', async () => {
  roundError.textContent = '';
  const queued = currentState && currentState.rounds.find((r) => r.roundStatus === 'queued');
  let roundId = queued && queued.id;

  // Nothing queued yet — queue exactly what's selected and start it
  // immediately, so "Start Next" also works as a one-shot "start now".
  if (!roundId) {
    const queueRes = await fetch(api('/round/queue'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentRoundBody()),
    });
    const queueData = await queueRes.json();
    if (!queueRes.ok) {
      roundError.textContent = queueData.error || 'failed to queue round';
      return;
    }
    const newlyQueued = queueData.rounds.find((r) => r.roundStatus === 'queued');
    roundId = newlyQueued && newlyQueued.id;
  }
  if (!roundId) return;

  const res = await fetch(api(`/round/${roundId}/activate`), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    roundError.textContent = data.error || 'failed to start round';
    return;
  }
  window.open(data.adminUrl, '_blank');
});

// --- rounds history ---

function queuedRoundRow(round) {
  const li = document.createElement('li');
  li.className = 'round-row queued';
  li.innerHTML = `
    <div class="round-row-main">
      <span class="round-engine">${escapeHtml(round.subGameName)}</span>
      <span class="round-status queued">Queued</span>
    </div>
    <div class="round-row-actions">
      <button class="btn-secondary btn-move-up" title="Move up">↑</button>
      <button class="btn-secondary btn-move-down" title="Move down">↓</button>
      <button class="btn-primary btn-activate">▶ Activate Now</button>
      <button class="btn-secondary btn-remove">🗑 Remove</button>
    </div>
  `;
  li.querySelector('.btn-move-up').addEventListener('click', () => moveRound(round.id, 'up'));
  li.querySelector('.btn-move-down').addEventListener('click', () => moveRound(round.id, 'down'));
  li.querySelector('.btn-activate').addEventListener('click', () => activateRound(round.id));
  li.querySelector('.btn-remove').addEventListener('click', () =>
    removeRound(round.id, round.subGameName)
  );
  return li;
}

function roundRow(round) {
  if (round.roundStatus === 'queued') return queuedRoundRow(round);

  const li = document.createElement('li');
  li.className = `round-row ${round.roundStatus}`;
  const pointsBreakdown = round.points
    ? Object.entries(round.points)
        .map(([playerId, pts]) => `${escapeHtml(playersById[playerId]?.name || '?')}: ${pts}`)
        .join(', ')
    : 'not scored yet';

  li.innerHTML = `
    <div class="round-row-main">
      <span class="round-engine">${escapeHtml(round.subGameName)}</span>
      <span class="round-status ${round.roundStatus}">
        ${round.roundStatus === 'finished' ? 'Finished' : 'Active'}
      </span>
    </div>
    <div class="round-row-links">
      <a href="${round.adminUrl}" target="_blank" rel="noopener">🛠 Admin</a>
      <a href="${round.gameUrl}" target="_blank" rel="noopener">📺 TV</a>
    </div>
    <div class="round-row-points">${pointsBreakdown}</div>
    <div class="round-row-actions">
      ${round.roundStatus === 'active' ? '<button class="btn-finish">✅ Finish &amp; Score</button>' : ''}
      <button class="btn-secondary btn-remove">🗑 Remove</button>
    </div>
  `;
  if (round.roundStatus === 'active') {
    li.querySelector('.btn-finish').addEventListener('click', () => finishRound(round.id));
  }
  li.querySelector('.btn-remove').addEventListener('click', () =>
    removeRound(round.id, round.subGameName)
  );
  return li;
}

async function moveRound(roundId, direction) {
  const res = await fetch(api(`/round/${roundId}/move`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'failed to reorder round');
}

async function activateRound(roundId) {
  const res = await fetch(api(`/round/${roundId}/activate`), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'failed to start round');
    return;
  }
  window.open(data.adminUrl, '_blank');
}

async function finishRound(roundId) {
  if (
    !confirm(
      "Finish and score this round now? It's fine to do this before all of its rounds/questions have run — scoring just uses whatever progress exists right now."
    )
  )
    return;
  const res = await fetch(api(`/round/${roundId}/finish`), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'failed to finish round');
}

async function removeRound(roundId, name) {
  if (
    !confirm(
      `Remove "${name}" from the night? This doesn't delete the game itself, just its points.`
    )
  )
    return;
  const res = await fetch(api(`/round/${roundId}`), { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'failed to remove round');
}

// Tie-aware places (two players tied for 1st both show "1st" — the next
// distinct total is 3rd, not 2nd) — same rule the server uses for final
// standings, just computed client-side for the live, still-changing board.
function placesFor(sortedDesc) {
  const places = [];
  let place = 0;
  let seen = 0;
  let last = null;
  for (const row of sortedDesc) {
    seen += 1;
    if (last === null || row.total !== last) {
      place = seen;
      last = row.total;
    }
    places.push(place);
  }
  return places;
}

function f1Row(place, name, points, online) {
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' }[place];
  const placeClass = place <= 3 ? `place-${place}` : '';
  return `<li class="f1-row ${placeClass}">
    <span class="f1-pos">${medal || place}</span>
    <span class="f1-name"><span class="status-dot ${online ? 'online' : 'offline'}"></span>${escapeHtml(name)}</span>
    <span class="f1-points">${points} pt${points === 1 ? '' : 's'}</span>
  </li>`;
}

function renderLeaderboard(leaderboard) {
  const places = placesFor(leaderboard);
  leaderboardRows.innerHTML = leaderboard
    .map((p, i) => f1Row(places[i], p.name, p.total, p.online))
    .join('');
}

function renderFinalStandings(standings) {
  if (!standings) {
    finalStandingsPanel.classList.add('hidden');
    return;
  }
  finalStandingsPanel.classList.remove('hidden');
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' };
  finalStandingsText.innerHTML = standings
    .map(
      (s) => `<div>${medal[s.place] || `#${s.place}`} ${escapeHtml(s.name)} — ${s.total} pts</div>`
    )
    .join('');
}

function applyState(state) {
  currentState = state;
  const queuedCount = state.rounds.filter((r) => r.roundStatus === 'queued').length;
  statusLine.textContent = `Status: ${state.status} · ${state.rounds.length} round${state.rounds.length === 1 ? '' : 's'} · ${queuedCount} queued`;
  btnStart.disabled = state.status !== 'setup';
  btnEnd.disabled = state.status !== 'running';
  btnQueueRound.disabled = state.status === 'ended';
  btnStartNext.disabled = state.status === 'ended';

  roundCount.textContent = state.rounds.length;
  roundsList.innerHTML = '';
  // Queued rounds show in their actual stack order (first-queued on top,
  // matching activation order) above the history, which stays newest-first.
  const queued = state.rounds.filter((r) => r.roundStatus === 'queued');
  const history = state.rounds
    .filter((r) => r.roundStatus !== 'queued')
    .slice()
    .reverse();
  queued.forEach((round) => roundsList.appendChild(roundRow(round)));
  history.forEach((round) => roundsList.appendChild(roundRow(round)));

  renderLeaderboard(state.leaderboard);
  renderFinalStandings(state.finalStandings);
}

async function postAction(path) {
  const res = await fetch(api(path), { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'action failed');
  return data;
}

btnStart.addEventListener('click', () => postAction('/game/start'));
btnEnd.addEventListener('click', () => {
  if (confirm('End Party Night? This crowns the winner(s) and locks in final standings.'))
    postAction('/game/end');
});
btnReset.addEventListener('click', () => {
  if (
    confirm(
      'Reset the whole night? This clears every round and score (but not the sub-games themselves).'
    )
  )
    postAction('/game/reset');
});

async function refreshPlayers() {
  const res = await fetch(api('/players'));
  const players = await res.json();
  playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  playerCount.textContent = players.length;
  playersList.innerHTML = players
    .map(
      (p) => `<li>
        <span class="player-status ${p.online ? 'online' : 'offline'}"></span>
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="player-stats">${p.total} pt${p.total === 1 ? '' : 's'}</span>
        <button class="btn-kick" data-id="${p.id}" data-name="${escapeAttr(p.name)}">Kick</button>
      </li>`
    )
    .join('');
  playersList.querySelectorAll('.btn-kick').forEach((btn) => {
    btn.addEventListener('click', () => kickPlayer(btn.dataset.id, btn.dataset.name));
  });
  if (currentState) renderLeaderboard(currentState.leaderboard);
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
socket.on('round-started', async () => {
  const res = await fetch(api('/state'));
  applyState(await res.json());
});
socket.on('night-ended', async () => {
  const res = await fetch(api('/state'));
  applyState(await res.json());
});
socket.on('game-reset', () => {
  finalStandingsPanel.classList.add('hidden');
  refreshPlayers();
});

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
  await loadEngineOptions();
  await resync();
}

init();
