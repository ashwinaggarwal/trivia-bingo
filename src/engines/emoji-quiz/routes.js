const express = require('express');

const stateModule = require('./state');
const playersModule = require('./players');
const packsModule = require('./packs');
const presenceModule = require('../../presence');
const gamesModule = require('../../games');

const ROUND_SIZE = 25; // cap per game, picked at random from the pack if it's bigger

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function questionsById(questions) {
  return Object.fromEntries(questions.map((q) => [q.id, q]));
}

function buildOptions(question) {
  const options = shuffle([question.answer, ...question.wrongOptions]);
  return { options, correctIndex: options.indexOf(question.answer) };
}

function packFor(gameId) {
  const meta = gamesModule.getGame(gameId);
  return (meta && meta.config && meta.config.pack) || packsModule.DEFAULT_PACK;
}

// Players plus points/correctCount/average speed and whether they currently
// have a live connection, for the admin players panel and the shared
// game-view roster/leaderboard.
function playerSummaries(gameId) {
  const players = playersModule.getAllPlayers(gameId);
  return Object.values(players).map((p) => ({
    id: p.id,
    name: p.name,
    points: p.points,
    correctCount: p.correctCount,
    avgElapsedMs: p.correctCount ? Math.round(p.totalElapsedMs / p.correctCount) : null,
    createdAt: p.createdAt,
    online: presenceModule.isOnline(gameId, p.id),
  }));
}

function publicState(gameId, pack) {
  const state = stateModule.load(gameId);
  const questions = packsModule.getQuestions(pack);
  const byId = questionsById(questions);
  const currentId =
    state.currentIndex >= 0 && state.currentIndex < state.questionOrder.length
      ? state.questionOrder[state.currentIndex]
      : null;
  const current = currentId ? byId[currentId] : null;

  let currentQuestion = null;
  if (current && state.revealStage !== 'none') {
    const opts = state.options[current.id];
    currentQuestion = {
      id: current.id,
      emojis: current.emojis,
      options: opts ? opts.options : [],
      correctIndex: state.revealStage === 'answer' && opts ? opts.correctIndex : null,
      winner: null,
    };
    if (state.revealStage === 'answer' && state.currentQuestionWinner) {
      const winnerPlayer = playersModule.getPlayer(gameId, state.currentQuestionWinner);
      currentQuestion.winner = winnerPlayer
        ? { playerId: winnerPlayer.id, playerName: winnerPlayer.name }
        : null;
    }
  }

  return {
    status: state.status,
    revealStage: state.revealStage,
    questionNumber: state.currentIndex + 1,
    totalQuestions: state.questionOrder.length,
    questionShownAt: state.questionShownAt,
    answerWindowMs: stateModule.ANSWER_WINDOW_MS,
    currentQuestion,
  };
}

// Mounted at /api/games/:gameId/* for every emoji-quiz instance — see
// src/engines/emoji-quiz/index.js and src/routes.js.
function gameRouter(io) {
  const game = express.Router({ mergeParams: true });

  const broadcastState = (gameId) =>
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId, packFor(gameId)));
  const broadcastPlayers = (gameId) =>
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));

  game.get('/state', (req, res) => {
    const { gameId } = req.params;
    if (stateModule.catchUp(gameId)) broadcastState(gameId);
    res.json(publicState(gameId, packFor(gameId)));
  });

  game.get('/players', (req, res) => res.json(playerSummaries(req.params.gameId)));

  game.post('/register', (req, res) => {
    const { gameId } = req.params;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const player = playersModule.registerPlayer(gameId, name);
    io.to(`game:${gameId}`).emit('player-registered', { id: player.id, name: player.name });
    broadcastPlayers(gameId);
    res.json(player);
  });

  game.get('/players/:id', (req, res) => {
    const player = playersModule.getPlayer(req.params.gameId, req.params.id);
    if (!player) return res.status(404).json({ error: 'player not found' });
    res.json(player);
  });

  game.post('/players/:id/kick', (req, res) => {
    const { gameId } = req.params;
    const removed = playersModule.removePlayer(gameId, req.params.id);
    if (!removed) return res.status(404).json({ error: 'player not found' });
    io.to(`game:${gameId}`).emit('player-kicked', { playerId: req.params.id });
    broadcastPlayers(gameId);
    res.json({ ok: true });
  });

  // First correct answer for this question wins the point (`pointAwarded`);
  // everyone else's response is still recorded (for stats) but doesn't move
  // their score. One attempt per question — a player who already has a
  // response for the current question is rejected rather than allowed to
  // retry. Deliberately synchronous end-to-end (no `await` between the
  // state load and save), so Node's event loop can't interleave two
  // players' requests mid-handler — that's what makes "first correct wins"
  // race-safe without a database transaction.
  game.post('/answer', (req, res) => {
    const { gameId } = req.params;
    const { playerId, optionIndex } = req.body;
    const player = playersModule.getPlayer(gameId, playerId);
    if (!player) return res.status(404).json({ error: 'player not found' });
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
      return res.status(400).json({ error: 'invalid optionIndex' });
    }

    const state = stateModule.load(gameId);
    if (state.status !== 'running' || state.revealStage !== 'question') {
      return res.status(400).json({ error: 'answers are not being accepted right now' });
    }

    const currentQuestionId = state.questionOrder[state.currentIndex];
    const alreadyAnswered = state.responses.some(
      (r) => r.playerId === playerId && r.questionId === currentQuestionId
    );
    if (alreadyAnswered) {
      return res.status(400).json({ error: 'you already answered this question' });
    }

    const questionOptions = state.options[currentQuestionId];
    const correct = Boolean(questionOptions) && optionIndex === questionOptions.correctIndex;
    const elapsedMs = state.questionShownAt
      ? Date.now() - new Date(state.questionShownAt).getTime()
      : null;
    const pointAwarded = correct && !state.currentQuestionWinner;

    state.responses.push({
      playerId,
      questionId: currentQuestionId,
      optionIndex,
      correct,
      pointAwarded,
      markedAt: new Date().toISOString(),
      elapsedMs,
    });
    if (pointAwarded) state.currentQuestionWinner = playerId;
    stateModule.save(gameId, state);

    const players = playersModule.getAllPlayers(gameId);
    if (players[playerId] && correct) {
      players[playerId].correctCount += 1;
      players[playerId].totalElapsedMs += elapsedMs || 0;
      if (pointAwarded) players[playerId].points += 1;
      playersModule.save(gameId, players);
    }

    broadcastPlayers(gameId);
    // The point-winning answer also closes the question for everyone else —
    // broadcast the reveal immediately rather than waiting for the next
    // clock tick or /state poll.
    if (pointAwarded) broadcastState(gameId);

    res.json({ correct, pointAwarded });
  });

  game.post('/game/start', (req, res) => {
    const { gameId } = req.params;
    const pack = packFor(gameId);
    const questions = packsModule.getQuestions(pack);
    if (questions.length < 4) {
      return res.status(400).json({ error: `pack "${pack}" needs at least 4 questions` });
    }
    const roundQuestions =
      questions.length > ROUND_SIZE ? shuffle(questions).slice(0, ROUND_SIZE) : questions;
    const optionsByQuestionId = Object.fromEntries(
      roundQuestions.map((q) => [q.id, buildOptions(q)])
    );
    stateModule.startGame(
      gameId,
      roundQuestions.map((q) => q.id),
      optionsByQuestionId
    );
    broadcastState(gameId);
    res.json(publicState(gameId, pack));
  });

  game.post('/game/next', (req, res) => {
    const { gameId } = req.params;
    try {
      stateModule.nextQuestion(gameId);
      broadcastState(gameId);
      res.json(publicState(gameId, packFor(gameId)));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Lets the admin force the reveal early (e.g. everyone's already
  // answered) instead of waiting out the full answer window.
  game.post('/game/reveal', (req, res) => {
    const { gameId } = req.params;
    try {
      stateModule.revealAnswer(gameId);
      broadcastState(gameId);
      res.json(publicState(gameId, packFor(gameId)));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/reset', (req, res) => {
    const { gameId } = req.params;
    stateModule.resetGame(gameId);
    const players = playersModule.getAllPlayers(gameId);
    for (const player of Object.values(players)) {
      player.points = 0;
      player.correctCount = 0;
      player.totalElapsedMs = 0;
    }
    playersModule.save(gameId, players);
    io.to(`game:${gameId}`).emit('game-reset', {});
    broadcastState(gameId);
    broadcastPlayers(gameId);
    res.json(publicState(gameId, packFor(gameId)));
  });

  return game;
}

// Called once a second across every emoji-quiz instance (see
// src/engines/index.js's tick loop) so the answer-window timeout fires on
// time even if nobody is actively polling /state.
function tick(io, gameId) {
  if (stateModule.catchUp(gameId)) {
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId, packFor(gameId)));
  }
}

module.exports = { gameRouter, publicState, playerSummaries, tick };
