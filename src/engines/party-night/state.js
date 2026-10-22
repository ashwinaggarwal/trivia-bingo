const fs = require('fs');
const path = require('path');

const { gameDir } = require('../../games');

function stateFile(gameId) {
  return path.join(gameDir(gameId), 'game-state.json');
}

// A round's `points`/`placements` are null until the admin finishes it
// (see routes.js's /round/:roundId/finish) — a player's running total is
// always computed by summing finished rounds' points, never stored
// redundantly, so removing a round (routes.js's DELETE /round/:roundId)
// automatically corrects every total.
function defaultState() {
  return {
    status: 'setup', // setup | running | ended
    rounds: [], // { id, engine, subGameId, subGameName, config, startedAt, finishedAt, playerMap, points, placements }
    finalStandings: null, // set by /game/end: [{ playerId, name, total, place }]
  };
}

function load(gameId) {
  const file = stateFile(gameId);
  if (!fs.existsSync(file)) {
    const state = defaultState();
    save(gameId, state);
    return state;
  }
  return { ...defaultState(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function save(gameId, state) {
  fs.mkdirSync(gameDir(gameId), { recursive: true });
  fs.writeFileSync(stateFile(gameId), JSON.stringify(state, null, 2), 'utf8');
  return state;
}

module.exports = { load, save, defaultState };
