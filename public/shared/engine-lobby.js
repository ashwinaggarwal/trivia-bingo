const slug = location.pathname.split('/').filter(Boolean).pop();

const engineTitle = document.getElementById('engine-title');
const engineTagline = document.getElementById('engine-tagline');
const packsGrid = document.getElementById('packs-grid');
const gamesList = document.getElementById('games-list');
const emptyNote = document.getElementById('empty-note');

// The first (and so far only) field an engine's createOptions describes —
// see each engine's listCreateOptions(), e.g. src/engines/trivia-bingo/index.js.
// No current engine needs a second configurable field, so this only drives
// one level of cards; a future engine with two fields would need a follow-up
// step this doesn't implement.
let packField = null;

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function createGame(extra) {
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine: slug, ...extra }),
  });
  const game = await res.json();
  if (res.ok) {
    window.location.href = `/play/${slug}/admin/${game.id}`;
  } else {
    alert(game.error || 'failed to create game');
  }
}

// One card per option of the engine's pack field — click straight into a
// fresh game, no name or form. An engine with nothing to configure (no
// fields at all) gets a single "Start Game" card instead. Markup matches
// the home shelf's cards (public/shelf/app.js) so both look identical.
function renderPackCards(fields) {
  packField = (fields && fields[0]) || null;
  packsGrid.innerHTML = '';

  if (!packField) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shelf-card';
    card.innerHTML = `
      <span class="shelf-card-emoji">▶️</span>
      <span class="shelf-card-title h-display">Start Game</span>
    `;
    card.addEventListener('click', () => createGame({}));
    packsGrid.appendChild(card);
    return;
  }

  packField.options.forEach((opt) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shelf-card';
    card.innerHTML = `
      <span class="shelf-card-emoji">${escapeHtml(opt.emoji || '🎯')}</span>
      <span class="shelf-card-title h-display">${escapeHtml(opt.label)}</span>
      <span class="shelf-card-tagline">${escapeHtml(opt.description || '')}</span>
    `;
    card.addEventListener('click', () => createGame({ [packField.key]: opt.value }));
    packsGrid.appendChild(card);
  });
}

// Existing instances show their pack's label (looked up from packField)
// instead of a free-text name, since games are no longer named at creation.
function labelFor(game) {
  if (!packField) return game.name;
  const value = game.config && game.config[packField.key];
  const opt = packField.options.find((o) => o.value === value);
  return opt ? opt.label : game.name;
}

function gameRow(game) {
  const li = document.createElement('li');
  li.innerHTML = `
    <a class="game-link" href="/play/${slug}/admin/${game.id}">
      <span class="game-name">${escapeHtml(labelFor(game))}</span>
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
  renderPackCards(engine.createOptions && engine.createOptions.fields);
}

async function init() {
  // Sequenced, not parallel: loadGames() reads packField to label existing
  // instances by pack, which loadEngine() is what sets.
  await loadEngine();
  await loadGames();
}

init();
