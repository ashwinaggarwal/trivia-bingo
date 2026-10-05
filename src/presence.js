// In-memory only: who's currently connected, per game. Online/offline status
// doesn't need to survive a server restart the way the rest of the game data
// does, so this deliberately never touches disk.

// gameId -> Map<playerId, Set<socketId>> (a player can have more than one
// socket, e.g. a phone and a stale background tab, so track a set per player
// and only call them offline once every socket is gone).
const byGame = new Map();

function addSocket(gameId, playerId, socketId) {
  if (!byGame.has(gameId)) byGame.set(gameId, new Map());
  const byPlayer = byGame.get(gameId);
  if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Set());
  byPlayer.get(playerId).add(socketId);
}

function removeSocket(gameId, playerId, socketId) {
  const byPlayer = byGame.get(gameId);
  if (!byPlayer) return;
  const sockets = byPlayer.get(playerId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) byPlayer.delete(playerId);
}

function isOnline(gameId, playerId) {
  const byPlayer = byGame.get(gameId);
  return Boolean(byPlayer && byPlayer.has(playerId) && byPlayer.get(playerId).size > 0);
}

module.exports = { addSocket, removeSocket, isOnline };
