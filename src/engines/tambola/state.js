const fs = require('fs');
const path = require('path');

const { gameDir } = require('../../games');
const { CATEGORIES } = require('./lines');

const MAX_NUMBER = 90;

// Roughly matches the client's scroll animation duration — guards against
// the admin (or two admins on different devices) drawing faster than the
// animation/sound can keep up with.
const DRAW_COOLDOWN_MS = 1800;

function stateFile(gameId) {
  return path.join(gameDir(gameId), 'game-state.json');
}

function defaultState() {
  return {
    status: 'setup', // setup | running | ended
    numberOrder: [], // shuffled 1..90, drawn one at a time from the front
    currentIndex: -1,
    lastDrawAt: null,
    winners: Object.fromEntries(CATEGORIES.map((c) => [c, null])), // null | [{playerId, playerName, gridIndex}]
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

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startGame(gameId) {
  const state = defaultState();
  state.status = 'running';
  state.numberOrder = shuffle(Array.from({ length: MAX_NUMBER }, (_, i) => i + 1));
  return save(gameId, state);
}

// Draws the next number and persists it. Throws rather than returning an
// error object, since every call site here is a route handler that already
// wraps this in try/catch and turns it into a 400.
function drawNumber(gameId) {
  const state = load(gameId);
  if (state.status !== 'running') throw new Error('game is not running');
  if (state.currentIndex + 1 >= state.numberOrder.length) {
    throw new Error('all 90 numbers have been drawn');
  }
  if (state.lastDrawAt && Date.now() - new Date(state.lastDrawAt).getTime() < DRAW_COOLDOWN_MS) {
    throw new Error('wait for the current draw to finish');
  }
  state.currentIndex += 1;
  state.lastDrawAt = new Date().toISOString();
  save(gameId, state);
  return { state, number: state.numberOrder[state.currentIndex] };
}

function resetGame(gameId) {
  return save(gameId, defaultState());
}

// Swaps out the most recently drawn number for a different one — for
// correcting a mistaken draw (e.g. it didn't match a physical ball pulled
// alongside it). The round count doesn't change: this replaces the number
// at the current position rather than drawing a new one on top of it, and
// the discarded number goes back into the pool so it can still come up
// later.
function redrawLastNumber(gameId) {
  const state = load(gameId);
  if (state.status !== 'running') throw new Error('game is not running');
  if (state.currentIndex < 0) throw new Error('no number has been drawn yet');
  if (state.lastDrawAt && Date.now() - new Date(state.lastDrawAt).getTime() < DRAW_COOLDOWN_MS) {
    throw new Error('wait for the current draw to finish');
  }

  const previousNumber = state.numberOrder[state.currentIndex];
  const remaining = state.numberOrder.slice(state.currentIndex + 1);
  if (!remaining.length) throw new Error('no other numbers left to redraw');

  const pickIndex = Math.floor(Math.random() * remaining.length);
  const [newNumber] = remaining.splice(pickIndex, 1);
  remaining.push(previousNumber);

  state.numberOrder = [
    ...state.numberOrder.slice(0, state.currentIndex),
    newNumber,
    ...shuffle(remaining),
  ];
  state.lastDrawAt = new Date().toISOString();
  save(gameId, state);
  return { state, number: newNumber, previousNumber };
}

function drawnNumbersOf(state) {
  return state.numberOrder.slice(0, state.currentIndex + 1);
}

module.exports = {
  load,
  save,
  startGame,
  drawNumber,
  redrawLastNumber,
  resetGame,
  drawnNumbersOf,
  MAX_NUMBER,
};
