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

function registerPlayer(gameId, name) {
  const players = load(gameId);
  const player = { id: nanoid(10), name, score: 0, createdAt: new Date().toISOString() };
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

// Lets the admin kick a player (e.g. a mis-typed name or a device swap) so
// they can rejoin fresh with a new registration and a reset score.
function removePlayer(gameId, playerId) {
  const players = load(gameId);
  if (!players[playerId]) return false;
  delete players[playerId];
  save(gameId, players);
  return true;
}

module.exports = { load, save, registerPlayer, getPlayer, getAllPlayers, removePlayer };
