const fs = require('fs');
const path = require('path');

const { gameDir } = require('./games');

// Per-question auto-reveal timers, both measured from the moment the
// question is shown (not chained off each other).
const HINT_DELAY_MS = 15000;
const ANSWER_DELAY_MS = 30000;

function stateFile(gameId) {
  return path.join(gameDir(gameId), 'game-state.json');
}

function defaultState() {
  return {
    status: 'setup', // setup | running | ended
    questionOrder: [], // shuffled question ids for this round
    currentIndex: -1,
    revealStage: 'none', // none | question | hint | answer
    questionShownAt: null,
    hintRevealedAt: null,
    revealedAt: null,
    revealedHistory: [], // question ids whose answer has actually been shown, in reveal order
    winner: null, // { playerId, playerName, at }
    responses: [], // every mark attempt a player has made, kept in this same file instead of per-response files
  };
}

function load(gameId) {
  const file = stateFile(gameId);
  if (!fs.existsSync(file)) {
    const state = defaultState();
    save(gameId, state);
    return state;
  }
  // Merge onto defaults so a state file written by an older version of this
  // file (missing newer fields) still loads with sane values after an update.
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
  state.hintRevealedAt = null;
  state.revealedAt = null;
  return save(gameId, state);
}

function applyAnswerReveal(state) {
  state.revealStage = 'answer';
  state.revealedAt = new Date().toISOString();
  const qid = state.questionOrder[state.currentIndex];
  if (qid && !state.revealedHistory.includes(qid)) state.revealedHistory.push(qid);
}

function revealHint(gameId) {
  const state = load(gameId);
  if (state.revealStage !== 'question')
    throw new Error('hint can only be shown while a question is pending');
  state.revealStage = 'hint';
  state.hintRevealedAt = new Date().toISOString();
  return save(gameId, state);
}

function revealAnswer(gameId) {
  const state = load(gameId);
  if (state.revealStage !== 'question' && state.revealStage !== 'hint') {
    throw new Error('no question is currently shown');
  }
  applyAnswerReveal(state);
  return save(gameId, state);
}

// Applies any auto-reveal transitions that are due based on elapsed wall-clock
// time since questionShownAt. Safe to call frequently (GET /api/state, a
// server-side clock tick) and safe across a server restart, since it's driven
// entirely by the persisted timestamp rather than an in-memory timer handle.
function catchUp(gameId) {
  const state = load(gameId);
  if (state.status !== 'running' || !state.questionShownAt || state.revealStage === 'answer')
    return null;

  const elapsed = Date.now() - new Date(state.questionShownAt).getTime();
  let changed = false;

  if (state.revealStage === 'question' && elapsed >= HINT_DELAY_MS) {
    state.revealStage = 'hint';
    state.hintRevealedAt = new Date().toISOString();
    changed = true;
  }
  if (elapsed >= ANSWER_DELAY_MS && state.revealStage !== 'answer') {
    applyAnswerReveal(state);
    changed = true;
  }

  return changed ? save(gameId, state) : null;
}

function resetGame(gameId) {
  return save(gameId, defaultState());
}

function setWinner(gameId, winner) {
  const state = load(gameId);
  if (!state.winner) {
    state.winner = winner;
    save(gameId, state);
  }
  return state;
}

module.exports = {
  load,
  save,
  startGame,
  nextQuestion,
  revealHint,
  revealAnswer,
  catchUp,
  resetGame,
  setWinner,
  HINT_DELAY_MS,
  ANSWER_DELAY_MS,
};
