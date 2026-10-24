const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');

const { gameDir } = require('../../games');
const { MAX_NUMBER } = require('./state');
const { GRID_CELLS, GRIDS_PER_PLAYER } = require('./lines');

function playersFile(gameId) {
  return path.join(gameDir(gameId), 'players.json');
}

function load(gameId) {
  const file = playersFile(gameId);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function save(gameId, players) {
  fs.mkdirSync(gameDir(gameId), { recursive: true });
  fs.writeFileSync(playersFile(gameId), JSON.stringify(players, null, 2), 'utf8');
  return players;
}

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// A player's three 3x5 tickets, each independently dealt 15 unique numbers
// from the full 1-90 pool — unlike real tambola, nothing stops the *same*
// number showing up on two of a player's own tickets (or on another
// player's), and in fact that's deliberate here: marking a number once
// credits every ticket it appears on, which is what keeps a 3-ticket game
// from dragging on — treating all 45 slots as mutually exclusive made for a
// noticeably longer game.
function buildGrid() {
  const pool = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1);
  return shuffle(pool).slice(0, GRID_CELLS);
}

function buildGrids() {
  return Array.from({ length: GRIDS_PER_PLAYER }, () => buildGrid());
}

function isOnTicket(player, number) {
  return player.grids.some((grid) => grid.includes(number));
}

function registerPlayer(gameId, name) {
  const players = load(gameId);
  const player = {
    id: nanoid(10),
    name,
    grids: buildGrids(),
    marked: [], // numbers this player has actively clicked, not just drawn — see routes.js's /mark
    createdAt: new Date().toISOString(),
  };
  players[player.id] = player;
  save(gameId, players);
  return player;
}

// Deals everyone fresh tickets (and clears their marks) — called when the
// admin starts or resets a game.
function regenerateGrids(gameId) {
  const players = load(gameId);
  for (const player of Object.values(players)) {
    player.grids = buildGrids();
    player.marked = [];
  }
  save(gameId, players);
  return players;
}

// Claims one of the player's own drawn numbers. Validated by the caller
// (routes.js) before this is called — this just records it.
function markNumber(gameId, playerId, number) {
  const players = load(gameId);
  const player = players[playerId];
  if (!player) return null;
  if (!player.marked.includes(number)) player.marked.push(number);
  save(gameId, players);
  return player;
}

// Bulk version of markNumber — one load/save round-trip instead of one per
// number. Used only to catch a late joiner up on numbers already drawn
// before they registered; every number drawn *after* they join still needs
// its own deliberate tap through markNumber, same as everyone else.
function markNumbers(gameId, playerId, numbers) {
  if (!numbers.length) return getPlayer(gameId, playerId);
  const players = load(gameId);
  const player = players[playerId];
  if (!player) return null;
  for (const number of numbers) {
    if (!player.marked.includes(number)) player.marked.push(number);
  }
  save(gameId, players);
  return player;
}

// Retracts a mark from every player who had claimed it — used when a draw
// is undone (see state.js's redrawLastNumber), since that number is no
// longer officially drawn and shouldn't keep counting toward anyone's line.
function unmarkNumber(gameId, number) {
  const players = load(gameId);
  for (const player of Object.values(players)) {
    player.marked = player.marked.filter((n) => n !== number);
  }
  save(gameId, players);
  return players;
}

function getPlayer(gameId, id) {
  const players = load(gameId);
  return players[id] || null;
}

function getAllPlayers(gameId) {
  return load(gameId);
}

function removePlayer(gameId, playerId) {
  const players = load(gameId);
  if (!players[playerId]) return false;
  delete players[playerId];
  save(gameId, players);
  return true;
}

module.exports = {
  registerPlayer,
  regenerateGrids,
  markNumber,
  markNumbers,
  unmarkNumber,
  isOnTicket,
  getPlayer,
  getAllPlayers,
  removePlayer,
};
