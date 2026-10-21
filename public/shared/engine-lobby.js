const slug = location.pathname.split('/').filter(Boolean).pop();

const engineTitle = document.getElementById('engine-title');
const engineTagline = document.getElementById('engine-tagline');
const createForm = document.getElementById('create-form');
const nameInput = document.getElementById('name-input');
const dynamicFields = document.getElementById('dynamic-fields');
const gamesList = document.getElementById('games-list');
const emptyNote = document.getElementById('empty-note');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Renders one <select> per field the engine's createOptions describes — see
// each engine's listCreateOptions() (e.g. src/engines/trivia-bingo/index.js).
// An engine with no fields (nothing to configure before creating a game)
// just renders nothing here.
function renderFields(fields) {
  dynamicFields.innerHTML = (fields || [])
    .map(
      (field) => `
        <select name="${escapeHtml(field.key)}" aria-label="${escapeHtml(field.label)}">
          ${field.options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
        </select>
      `
    )
    .join('');
}

function gameRow(game) {
  const li = document.createElement('li');
  li.innerHTML = `
    <a class="game-link" href="/play/${slug}/admin/${game.id}">
      <span class="game-name">${escapeHtml(game.name)}</span>
      <span class="game-id pill">${game.id}</span>
    </a>
    <button class="btn-delete btn-danger" type="button" data-game-id="${game.id}" title="Delete game">Delete</button>
  `;
  li.querySelector('.btn-delete').addEventListener('click', () => deleteGame(game.id, game.name));
  return li;
}

async function deleteGame(gameId, gameName) {
  if (!window.confirm(`Delete "${gameName}" (${gameId})? This cannot be undone.`)) return;
  const res = await fetch(`/api/games/${gameId}`, { method: 'DELETE' });
  if (res.ok) loadGames();
}

async function loadGames() {
  const res = await fetch(`/api/games?engine=${encodeURIComponent(slug)}`);
  const games = await res.json();
  gamesList.innerHTML = '';
  games.forEach((g) => gamesList.appendChild(gameRow(g)));
  emptyNote.classList.toggle('hidden', games.length > 0);
}

async function loadEngine() {
  const res = await fetch(`/api/engines/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    engineTitle.textContent = 'Unknown game';
    return;
  }
  const engine = await res.json();
  engineTitle.textContent = `${engine.emoji} ${engine.title}`;
  engineTagline.textContent = engine.tagline || '';
  renderFields(engine.createOptions && engine.createOptions.fields);
}

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: nameInput.value.trim(), engine: slug };
  new FormData(createForm).forEach((value, key) => {
    body[key] = value;
  });
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const game = await res.json();
  if (res.ok) window.location.href = `/play/${slug}/admin/${game.id}`;
});

loadEngine();
loadGames();
