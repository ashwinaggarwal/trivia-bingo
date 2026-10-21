const fs = require('fs');
const path = require('path');
const { customAlphabet } = require('nanoid');

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

// Games created before the engine registry existed have a flat
// `gameType`/`mode` instead of `engine`/`config` — they were all trivia-bingo
// instances (the only engine that existed at the time), so a meta file with
// no `engine` is treated as that, with its old fields folded into `config`
// (its legacy `gameType` becomes `config.pack`, trivia-bingo's current name
// for the same concept — see src/engines/trivia-bingo/packs.js).
function withEngineShim(meta) {
  if (meta.engine) return meta;
  return {
    ...meta,
    engine: 'trivia-bingo',
    config: { pack: meta.gameType || 'diwali', mode: meta.mode || 'bingo' },
  };
}

function getGame(gameId) {
  if (!gameExists(gameId)) return null;
  const meta = JSON.parse(fs.readFileSync(metaFile(gameId), 'utf8'));
  return withEngineShim(meta);
}

// `engine` and `config` are opaque to this module — each engine validates
// and shapes its own `config` before calling this (see each engine's
// `createConfig`).
function createGame(name, engine, config) {
  let id = generateId();
  while (gameExists(id)) id = generateId(); // astronomically unlikely, cheap to guard anyway

  fs.mkdirSync(gameDir(id), { recursive: true });
  const meta = {
    id,
    name: (name || '').trim() || `Game ${id}`,
    engine,
    config: config || {},
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(metaFile(id), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

function listGames(engine) {
  if (!fs.existsSync(GAMES_DIR)) return [];
  const all = fs
    .readdirSync(GAMES_DIR)
    .filter((id) => gameExists(id))
    .map((id) => getGame(id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return engine ? all.filter((g) => g.engine === engine) : all;
}

function deleteGame(gameId) {
  if (!gameExists(gameId)) return false;
  fs.rmSync(gameDir(gameId), { recursive: true, force: true });
  return true;
}

module.exports = { gameDir, getGame, createGame, listGames, gameExists, deleteGame };
