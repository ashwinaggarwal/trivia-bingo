const createForm = document.getElementById('create-form');
const nameInput = document.getElementById('name-input');
const gameTypeSelect = document.getElementById('game-type-select');
const gamesList = document.getElementById('games-list');
const emptyNote = document.getElementById('empty-note');

function gameRow(game) {
  const li = document.createElement('li');
  const emoji = themeFor(game.gameType).emoji;
  li.innerHTML = `
    <a class="game-link" href="/admin/game/${game.id}">
      <span class="game-name">${emoji} ${escapeHtml(game.name)}</span>
      <span class="game-id">${game.id}</span>
    </a>
    <button class="btn-delete danger" type="button" data-game-id="${game.id}" title="Delete game">Delete</button>
  `;
  li.querySelector('.btn-delete').addEventListener('click', () => deleteGame(game.id, game.name));
  return li;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function deleteGame(gameId, gameName) {
  if (!window.confirm(`Delete "${gameName}" (${gameId})? This cannot be undone.`)) return;
  const res = await fetch(`/api/games/${gameId}`, { method: 'DELETE' });
  if (res.ok) loadGames();
}

async function loadGames() {
  const res = await fetch('/api/games');
  const games = await res.json();
  gamesList.innerHTML = '';
  games.forEach((g) => gamesList.appendChild(gameRow(g)));
  emptyNote.classList.toggle('hidden', games.length > 0);
}

async function loadGameTypes() {
  const res = await fetch('/api/game-types');
  const gameTypes = await res.json();
  gameTypeSelect.innerHTML = '';
  gameTypes.forEach((gt) => {
    const option = document.createElement('option');
    option.value = gt.gameType;
    option.textContent = `${themeFor(gt.gameType).emoji} ${gt.name}`;
    gameTypeSelect.appendChild(option);
  });
}

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const gameType = gameTypeSelect.value;
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, gameType }),
  });
  const game = await res.json();
  if (res.ok) {
    window.location.href = `/admin/game/${game.id}`;
  }
});

loadGameTypes();
loadGames();
