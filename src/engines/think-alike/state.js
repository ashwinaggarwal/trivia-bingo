const fs = require('fs');
const path = require('path');

const gamesModule = require('../../games');
const { gameDir } = gamesModule;

function stateFile(gameId) {
  return path.join(gameDir(gameId), 'game-state.json');
}

function defaultState() {
  return {
    status: 'setup', // setup | running | ended
    promptOrder: [], // shuffled prompt ids for this round
    currentIndex: -1,
    revealStage: 'none', // none | prompt | reveal
    promptShownAt: null,
    answers: {}, // playerId -> submitted text, for the current prompt only
    history: [], // [{ promptId, promptText, groups: [{answer, playerIds}], scoredPlayerIds }]
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

function startGame(gameId, promptIds) {
  const state = defaultState();
  state.status = 'running';
  state.promptOrder = shuffle(promptIds);
  return save(gameId, state);
}

function nextPrompt(gameId) {
  const state = load(gameId);
  if (state.status !== 'running') throw new Error('game is not running');
  if (state.currentIndex + 1 >= state.promptOrder.length) {
    state.status = 'ended';
    state.revealStage = 'none';
    return save(gameId, state);
  }
  state.currentIndex += 1;
  state.revealStage = 'prompt';
  state.promptShownAt = new Date().toISOString();
  state.answers = {};
  return save(gameId, state);
}

function submitAnswer(gameId, playerId, text) {
  const state = load(gameId);
  if (state.revealStage !== 'prompt') throw new Error('not accepting answers right now');
  state.answers[playerId] = text;
  return save(gameId, state);
}

function normalize(str) {
  return String(str || '')
    .trim()
    .toLowerCase();
}

// Groups this round's answers by normalized text, then awards a point to
// every player in the largest group(s) — ties for largest all score, since
// "everyone who matched the most popular answer" is the whole point of the
// game. A round where every answer is unique (no group bigger than 1)
// awards nothing.
function revealPrompt(gameId, players) {
  const state = load(gameId);
  if (state.revealStage !== 'prompt') throw new Error('no prompt is currently open');

  const byNormalized = new Map();
  for (const [playerId, text] of Object.entries(state.answers)) {
    const key = normalize(text);
    if (!key) continue;
    if (!byNormalized.has(key)) byNormalized.set(key, { answer: text, playerIds: [] });
    byNormalized.get(key).playerIds.push(playerId);
  }

  const groups = Array.from(byNormalized.values()).sort(
    (a, b) => b.playerIds.length - a.playerIds.length
  );
  const largestSize = groups.length ? groups[0].playerIds.length : 0;
  const scoredPlayerIds =
    largestSize > 1
      ? groups.filter((g) => g.playerIds.length === largestSize).flatMap((g) => g.playerIds)
      : [];

  for (const playerId of scoredPlayerIds) {
    if (players[playerId]) players[playerId].score += 1;
  }

  const promptId = state.promptOrder[state.currentIndex];
  state.revealStage = 'reveal';
  state.history.push({ promptId, groups, scoredPlayerIds });
  save(gameId, state);
  return { groups, scoredPlayerIds };
}

function resetGame(gameId) {
  return save(gameId, defaultState());
}

module.exports = { load, save, startGame, nextPrompt, submitAnswer, revealPrompt, resetGame };
