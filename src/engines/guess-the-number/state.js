const fs = require('fs');
const path = require('path');

const { gameDir } = require('../../games');

function stateFile(gameId) {
  return path.join(gameDir(gameId), 'game-state.json');
}

function defaultState() {
  return {
    status: 'setup', // setup | running | ended
    questionOrder: [], // up to MAX_QUESTIONS question ids, shuffled, picked at /game/start
    currentIndex: -1,
    revealStage: 'none', // none | question | answer
    questionShownAt: null,
    revealedAt: null,
    answers: {}, // playerId -> guess (number), current question only
    lastReveal: null, // { guesses, answer, roundWinners } for the most recently revealed question
    gameWinners: null, // [{ playerId, playerName, points }] once the game ends
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

function startGame(gameId, questionIds) {
  const state = defaultState();
  state.status = 'running';
  state.questionOrder = shuffle(questionIds);
  return save(gameId, state);
}

// Advances to the next question, or ends the game (gracefully, not by
// throwing) once the pool of picked questions runs out — the caller
// (routes.js) is the one that decides who, if anyone, that makes a winner.
function nextQuestion(gameId) {
  const state = load(gameId);
  if (state.status !== 'running') throw new Error('game is not running');
  if (state.currentIndex + 1 >= state.questionOrder.length) {
    state.status = 'ended';
    state.revealStage = 'none';
    return save(gameId, state);
  }
  state.currentIndex += 1;
  state.revealStage = 'question';
  state.questionShownAt = new Date().toISOString();
  state.revealedAt = null;
  state.answers = {};
  state.lastReveal = null;
  return save(gameId, state);
}

function recordAnswer(gameId, playerId, guess) {
  const state = load(gameId);
  if (state.revealStage !== 'question') throw new Error('not accepting answers right now');
  state.answers[playerId] = guess;
  return save(gameId, state);
}

function applyReveal(gameId, reveal) {
  const state = load(gameId);
  state.revealStage = 'answer';
  state.revealedAt = new Date().toISOString();
  state.lastReveal = reveal;
  return save(gameId, state);
}

function endGame(gameId, gameWinners) {
  const state = load(gameId);
  state.status = 'ended';
  state.gameWinners = gameWinners;
  return save(gameId, state);
}

function resetGame(gameId) {
  return save(gameId, defaultState());
}

module.exports = {
  load,
  save,
  startGame,
  nextQuestion,
  recordAnswer,
  applyReveal,
  endGame,
  resetGame,
};
