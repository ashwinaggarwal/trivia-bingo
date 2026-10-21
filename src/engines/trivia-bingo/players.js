const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');

const { gameDir } = require('../../games');
const assetsModule = require('./assets');

const GRID_SIZE = 25; // 5x5

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

function sample(array, count) {
  return shuffle(array).slice(0, count);
}

function gridSignature(grid) {
  return grid
    .map((cell) => cell.questionId)
    .slice()
    .sort()
    .join(',');
}

function buildUniqueGrid(questions, existingPlayers) {
  if (questions.length < GRID_SIZE) {
    throw new Error(
      `need at least ${GRID_SIZE} questions to build a grid, have ${questions.length}`
    );
  }
  const existingSignatures = new Set(
    Object.values(existingPlayers).map((p) => gridSignature(p.grid))
  );

  const MAX_ATTEMPTS = 500;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const picked = sample(questions, GRID_SIZE);
    const grid = shuffle(picked).map((q) => ({
      questionId: q.id,
      answer: q.answer,
      image: assetsModule.imageUrlFor(q.image),
    }));
    const signature = gridSignature(grid);
    if (!existingSignatures.has(signature)) return grid;
  }
  // Astronomically unlikely with a real-sized question bank, but fall back
  // to a fresh random grid rather than failing registration outright.
  const picked = sample(questions, GRID_SIZE);
  return shuffle(picked).map((q) => ({
    questionId: q.id,
    answer: q.answer,
    image: assetsModule.imageUrlFor(q.image),
  }));
}

function registerPlayer(gameId, name, questions, mode) {
  const players = load(gameId);
  // Fastest-finger players don't have a bingo card — they just answer
  // whatever question is currently live, so there's nothing to pre-build.
  const grid = mode === 'fastest-finger' ? null : buildUniqueGrid(questions, players);
  const player = {
    id: nanoid(10),
    name,
    grid,
    createdAt: new Date().toISOString(),
  };
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

function regenerateGrids(gameId, questions) {
  const players = load(gameId);
  const regenerated = {};
  for (const player of Object.values(players)) {
    const grid = buildUniqueGrid(questions, regenerated);
    regenerated[player.id] = { ...player, grid };
  }
  save(gameId, regenerated);
  return regenerated;
}

// Lets the admin kick a player (e.g. a mis-typed name or a device swap) so
// they can rejoin fresh with a new registration and a new grid.
function removePlayer(gameId, playerId) {
  const players = load(gameId);
  if (!players[playerId]) return false;
  delete players[playerId];
  save(gameId, players);
  return true;
}

module.exports = {
  registerPlayer,
  getPlayer,
  getAllPlayers,
  regenerateGrids,
  removePlayer,
  GRID_SIZE,
};
