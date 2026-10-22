const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');

const { gameDir } = require('../../games');

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

// No score field here — a party player's points live only in each round
// record (state.js), summed on demand, so there's one source of truth.
function registerPlayer(gameId, name) {
  const players = load(gameId);
  const player = { id: nanoid(10), name, createdAt: new Date().toISOString() };
  players[player.id] = player;
  save(gameId, players);
  return player;
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

module.exports = { registerPlayer, getPlayer, getAllPlayers, removePlayer };
