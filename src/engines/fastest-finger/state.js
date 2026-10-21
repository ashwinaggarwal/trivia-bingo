const fs = require('fs');
const path = require('path');

const gamesModule = require('../../games');
const { gameDir } = gamesModule;

// First correct answer wins the point; everyone else just waits this out.
const FASTEST_ANSWER_WINDOW_MS = 12000;

function stateFile(gameId) {
  return path.join(gameDir(gameId), 'game-state.json');
}

function defaultState() {
  return {
    status: 'setup', // setup | running | ended
    questionOrder: [], // shuffled question ids for this round
    currentIndex: -1,
    revealStage: 'none', // none | question | answer
    questionShownAt: null,
    revealedAt: null,
    options: {}, // questionId -> { options: [4 strings], correctIndex }, precomputed at startGame
    responses: [], // every answer attempt, win or not, for stats + history
    currentQuestionWinner: null, // playerId of whoever answered the current question correctly first
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

function startGame(gameId, questionIds, optionsByQuestionId) {
  const state = defaultState();
  state.status = 'running';
  state.questionOrder = shuffle(questionIds);
  state.options = optionsByQuestionId;
  return save(gameId, state);
}

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
  state.currentQuestionWinner = null;
  return save(gameId, state);
}

function revealAnswer(gameId) {
  const state = load(gameId);
  if (state.revealStage !== 'question') throw new Error('no question is currently shown');
  state.revealStage = 'answer';
  state.revealedAt = new Date().toISOString();
  return save(gameId, state);
}

// Applies the auto-reveal transition once the answer window elapses (or
// immediately once someone's already won the point, so the room doesn't sit
// waiting out a countdown nobody can still win). Safe to call frequently and
// safe across a server restart, since it's driven by the persisted
// questionShownAt timestamp rather than an in-memory timer handle.
function catchUp(gameId) {
  const state = load(gameId);
  if (state.status !== 'running' || !state.questionShownAt || state.revealStage !== 'question')
    return null;

  const elapsed = Date.now() - new Date(state.questionShownAt).getTime();
  if (elapsed >= FASTEST_ANSWER_WINDOW_MS || state.currentQuestionWinner) {
    state.revealStage = 'answer';
    state.revealedAt = new Date().toISOString();
    return save(gameId, state);
  }
  return null;
}

function resetGame(gameId) {
  return save(gameId, defaultState());
}

module.exports = {
  load,
  save,
  startGame,
  nextQuestion,
  revealAnswer,
  catchUp,
  resetGame,
  FASTEST_ANSWER_WINDOW_MS,
};
