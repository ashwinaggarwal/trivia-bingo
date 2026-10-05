const stateModule = require('./state');

const BINGO_LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r += 1) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c += 1) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

// Responses live inside the same game-state.json file as the rest of the
// round's state, rather than one file per response, so every read/write here
// goes through state.js's load/save instead of touching the filesystem itself.
function writeResponse(gameId, record) {
  const state = stateModule.load(gameId);
  state.responses.push(record);
  stateModule.save(gameId, state);
  return record;
}

function getAllResponses(gameId) {
  return stateModule.load(gameId).responses;
}

function clearResponses(gameId) {
  const state = stateModule.load(gameId);
  state.responses = [];
  stateModule.save(gameId, state);
}

function removeResponsesForPlayer(gameId, playerId) {
  const state = stateModule.load(gameId);
  state.responses = state.responses.filter((r) => r.playerId !== playerId);
  stateModule.save(gameId, state);
}

// Only a player's first real (non-auto) attempt at a given question counts
// towards scoring — later retries can still fill in the grid cell for bingo
// purposes, but don't earn or erase points. Relies on `responses` being
// append-only in chronological order, so the first match per (playerId,
// questionId) pair found while scanning forward is the first try.
function firstTriesByPair(gameId) {
  const responses = getAllResponses(gameId).filter((r) => !r.auto);
  const firstByPair = new Map();
  for (const r of responses) {
    const key = `${r.playerId}:${r.questionId}`;
    if (!firstByPair.has(key)) firstByPair.set(key, r);
  }
  return Array.from(firstByPair.values());
}

function computeLeaderboard(gameId, players) {
  const byPlayer = {};
  const ensure = (playerId) => {
    if (!byPlayer[playerId])
      byPlayer[playerId] = { correctCount: 0, totalElapsedMs: 0, incorrectFirstTryCount: 0 };
    return byPlayer[playerId];
  };

  for (const r of firstTriesByPair(gameId)) {
    const agg = ensure(r.playerId);
    if (r.correct && r.beforeReveal) {
      // A point only counts if this first try landed before the full text
      // answer appeared on screen — a correct-but-late first try earns
      // neither a point nor an incorrect mark.
      agg.correctCount += 1;
      agg.totalElapsedMs += r.elapsedMs || 0;
    } else if (!r.correct) {
      agg.incorrectFirstTryCount += 1;
    }
  }

  const rows = Object.entries(byPlayer).map(([playerId, agg]) => ({
    playerId,
    name: players[playerId] ? players[playerId].name : 'Unknown',
    correctCount: agg.correctCount,
    avgElapsedMs: agg.correctCount ? agg.totalElapsedMs / agg.correctCount : null,
    incorrectFirstTryCount: agg.incorrectFirstTryCount,
  }));

  const mostCorrect = rows
    .filter((r) => r.correctCount > 0)
    .sort((a, b) => b.correctCount - a.correctCount)
    .slice(0, 10);

  const fastest = rows
    .filter((r) => r.correctCount > 0)
    .sort((a, b) => a.avgElapsedMs - b.avgElapsedMs)
    .slice(0, 10);

  const mostIncorrect = rows
    .filter((r) => r.incorrectFirstTryCount > 0)
    .sort((a, b) => b.incorrectFirstTryCount - a.incorrectFirstTryCount)
    .slice(0, 10);

  return { mostCorrect, fastest, mostIncorrect };
}

// Per-player answer stats for the admin players panel: how many answers a
// player has submitted, how many were correct, and when they last answered.
// Excludes auto-submitted responses, which exist only to complete the bingo
// grid and shouldn't look like something the player actually did.
function playerStats(gameId) {
  const responses = getAllResponses(gameId).filter((r) => !r.auto);
  const stats = {};
  for (const r of responses) {
    if (!stats[r.playerId]) {
      stats[r.playerId] = { answeredCount: 0, correctCount: 0, lastAnsweredAt: null };
    }
    const s = stats[r.playerId];
    s.answeredCount += 1;
    if (r.correct) s.correctCount += 1;
    if (!s.lastAnsweredAt || r.markedAt > s.lastAnsweredAt) s.lastAnsweredAt = r.markedAt;
  }
  return stats;
}

function markedCellIndices(gameId, playerId) {
  const responses = getAllResponses(gameId);
  const indices = new Set();
  for (const r of responses) {
    if (r.playerId === playerId && r.correct) indices.add(r.cellIndex);
  }
  return indices;
}

function checkBingo(gameId, playerId) {
  const marked = markedCellIndices(gameId, playerId);
  return BINGO_LINES.some((line) => line.every((idx) => marked.has(idx)));
}

module.exports = {
  writeResponse,
  getAllResponses,
  clearResponses,
  removeResponsesForPlayer,
  computeLeaderboard,
  checkBingo,
  playerStats,
};
