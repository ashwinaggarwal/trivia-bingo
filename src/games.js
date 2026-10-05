const fs = require('fs');
const path = require('path');
const { customAlphabet } = require('nanoid');

const gameTypesModule = require('./gameTypes');

const DATA_DIR = path.join(__dirname, '..', 'data');
const GAMES_DIR = path.join(DATA_DIR, 'games');

// Excludes 0/O/1/I so ids are easy to read aloud or type by hand if someone
// can't scan the QR code.
const generateId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

function gameDir(gameId) {
  return path.join(GAMES_DIR, gameId);
}

function metaFile(gameId) {
  return path.join(gameDir(gameId), 'meta.json');
}

function gameExists(gameId) {
  return fs.existsSync(metaFile(gameId));
}

function getGame(gameId) {
  if (!gameExists(gameId)) return null;
  return JSON.parse(fs.readFileSync(metaFile(gameId), 'utf8'));
}

function createGame(name, gameType) {
  let id = generateId();
  while (gameExists(id)) id = generateId(); // astronomically unlikely, cheap to guard anyway

  const resolvedGameType = gameTypesModule.gameTypeExists(gameType)
    ? gameType
    : gameTypesModule.DEFAULT_GAME_TYPE;

  fs.mkdirSync(gameDir(id), { recursive: true });
  const meta = {
    id,
    name: (name || '').trim() || `Game ${id}`,
    gameType: resolvedGameType,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(metaFile(id), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

function listGames() {
  if (!fs.existsSync(GAMES_DIR)) return [];
  return fs
    .readdirSync(GAMES_DIR)
    .filter((id) => gameExists(id))
    .map((id) => getGame(id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function deleteGame(gameId) {
  if (!gameExists(gameId)) return false;
  fs.rmSync(gameDir(gameId), { recursive: true, force: true });
  return true;
}

module.exports = { gameDir, getGame, createGame, listGames, gameExists, deleteGame };
