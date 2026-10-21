const express = require('express');

const stateModule = require('./state');
const playersModule = require('./players');
const questionsModule = require('./questions');
const presenceModule = require('../../presence');

const MAX_QUESTIONS = 50; // cap per game, picked at random from the pool
const WIN_SCORE = 20; // fastest to this many points wins the whole game
const YEAR_MAX_DIFF = 3; // year questions use a flat threshold, not the relative one
const RELATIVE_MAX_DIFF = 0.1; // everything else: within 10% of the real answer

// Year answers (e.g. 1995) are close together on an absolute scale, so a
// flat threshold makes more sense than a relative one — 10% of 1995 would
// be ~200 years, which is meaningless. Everything else uses the relative
// threshold since a flat "within 5" is too strict for a big number (e.g.
// career wickets in the hundreds) and too generous for a small one.
function thresholdFor(question) {
  if (question.isYear) return YEAR_MAX_DIFF;
  return Math.abs(question.answer) * RELATIVE_MAX_DIFF;
}

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

function publicState(gameId) {
  const state = stateModule.load(gameId);
  const questions = questionsModule.getQuestions(gameId);
  const byId = questionsById(questions);
  const currentId =
    state.currentIndex >= 0 && state.currentIndex < state.questionOrder.length
      ? state.questionOrder[state.currentIndex]
      : null;
  const current = currentId ? byId[currentId] : null;

  return {
    status: state.status,
    revealStage: state.revealStage,
    questionNumber: state.currentIndex + 1,
    totalQuestions: state.questionOrder.length,
    // The answer is only ever in `reveal`, never on the live question — see
    // performReveal, which is the only place a guess gets compared to it.
    currentQuestion: current
      ? { id: current.id, question: current.question, category: current.category }
      : null,
    answeredCount: Object.keys(state.answers).length,
    reveal: state.revealStage === 'answer' ? state.lastReveal : null,
    gameWinners: state.gameWinners,
  };
}

function playerSummaries(gameId) {
  const players = playersModule.getAllPlayers(gameId);
  return Object.values(players).map((p) => ({
    id: p.id,
    name: p.name,
    points: p.points,
    createdAt: p.createdAt,
    online: presenceModule.isOnline(gameId, p.id),
  }));
}

// Shared by the auto-reveal (every registered player has answered) and the
// admin's manual "Reveal Now" override — scores the round, closes it out,
// and checks whether anyone's just reached WIN_SCORE.
function performReveal(io, gameId) {
  const state = stateModule.load(gameId);
  if (state.revealStage !== 'question') throw new Error('no question is currently open');

  const questions = questionsModule.getQuestions(gameId);
  const byId = questionsById(questions);
  const question = byId[state.questionOrder[state.currentIndex]];
  const players = playersModule.getAllPlayers(gameId);

  // Sorted ascending — the UI shows every guess first, then the real answer
  // revealed on top of them, in that order.
  const guesses = Object.entries(state.answers)
    .map(([playerId, guess]) => ({
      playerId,
      playerName: players[playerId] ? players[playerId].name : 'Unknown',
      guess,
    }))
    .sort((a, b) => a.guess - b.guess);

  let roundWinners = [];
  if (guesses.length) {
    const withDiff = guesses.map((g) => ({ ...g, diff: Math.abs(g.guess - question.answer) }));
    const minDiff = Math.min(...withDiff.map((g) => g.diff));
    if (minDiff <= thresholdFor(question)) {
      roundWinners = withDiff.filter((g) => g.diff === minDiff);
      for (const winner of roundWinners) {
        if (players[winner.playerId]) players[winner.playerId].points += 1;
      }
      playersModule.save(gameId, players);
    }
  }

  stateModule.applyReveal(gameId, {
    guesses,
    answer: question.answer,
    roundWinners: roundWinners.map(({ playerId, playerName }) => ({ playerId, playerName })),
  });

  io.to(`game:${gameId}`).emit('question-revealed', {});
  io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));

  const refreshedPlayers = Object.values(playersModule.getAllPlayers(gameId));
  const maxPoints = refreshedPlayers.reduce((max, p) => Math.max(max, p.points), 0);
  if (maxPoints >= WIN_SCORE) {
    const gameWinners = refreshedPlayers
      .filter((p) => p.points === maxPoints)
      .map((p) => ({ playerId: p.id, playerName: p.name, points: p.points }));
    stateModule.endGame(gameId, gameWinners);
    io.to(`game:${gameId}`).emit('game-over', { winners: gameWinners });
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  }
}

// Called when the question pool runs out before anyone reaches WIN_SCORE —
// standard trivia convention, whoever has the most points wins; a tie means
// multiple winners, and nobody scoring at all means no winner declared.
function declareWinnerByHighScore(io, gameId) {
  const players = Object.values(playersModule.getAllPlayers(gameId));
  const maxPoints = players.reduce((max, p) => Math.max(max, p.points), 0);
  const gameWinners =
    maxPoints > 0
      ? players
          .filter((p) => p.points === maxPoints)
          .map((p) => ({ playerId: p.id, playerName: p.name, points: p.points }))
      : [];
  stateModule.endGame(gameId, gameWinners);
  io.to(`game:${gameId}`).emit('game-over', { winners: gameWinners });
}

// Mounted at /api/games/:gameId/* for every guess-the-number instance — see
// src/engines/guess-the-number/index.js and src/routes.js.
function gameRouter(io) {
  const game = express.Router({ mergeParams: true });

  const broadcastState = (gameId) =>
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  const broadcastPlayers = (gameId) =>
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));

  game.get('/state', (req, res) => res.json(publicState(req.params.gameId)));

  game.get('/players', (req, res) => res.json(playerSummaries(req.params.gameId)));

  game.get('/questions', (req, res) => res.json(questionsModule.getQuestions(req.params.gameId)));

  game.put('/questions', (req, res) => {
    try {
      const questions = questionsModule.saveQuestions(req.params.gameId, req.body.questions);
      res.json(questions);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/register', (req, res) => {
    const { gameId } = req.params;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const player = playersModule.registerPlayer(gameId, name);
    io.to(`game:${gameId}`).emit('player-registered', { id: player.id, name: player.name });
    broadcastPlayers(gameId);
    res.json(player);
  });

  // Includes whether this player has already answered the current
  // question — not exposed via playerSummaries, but safe here since this
  // only ever goes back to the player asking about their own record.
  game.get('/players/:id', (req, res) => {
    const { gameId, id } = req.params;
    const player = playersModule.getPlayer(gameId, id);
    if (!player) return res.status(404).json({ error: 'player not found' });
    const state = stateModule.load(gameId);
    const answeredCurrentQuestion = Object.prototype.hasOwnProperty.call(state.answers, id);
    res.json({ ...player, answeredCurrentQuestion });
  });

  game.post('/players/:id/kick', (req, res) => {
    const { gameId } = req.params;
    const removed = playersModule.removePlayer(gameId, req.params.id);
    if (!removed) return res.status(404).json({ error: 'player not found' });
    io.to(`game:${gameId}`).emit('player-kicked', { playerId: req.params.id });
    broadcastPlayers(gameId);
    res.json({ ok: true });
  });

  // One guess per player per question — answering doesn't reveal anything
  // back to the player beyond "it was recorded"; everyone sees every guess
  // together at reveal time.
  game.post('/answer', (req, res) => {
    const { gameId } = req.params;
    const { playerId } = req.body;
    const guess = Number(req.body.guess);
    const player = playersModule.getPlayer(gameId, playerId);
    if (!player) return res.status(404).json({ error: 'player not found' });
    if (!Number.isFinite(guess)) return res.status(400).json({ error: 'guess must be a number' });

    const state = stateModule.load(gameId);
    if (state.status !== 'running' || state.revealStage !== 'question') {
      return res.status(400).json({ error: 'not accepting answers right now' });
    }
    if (Object.prototype.hasOwnProperty.call(state.answers, playerId)) {
      return res.status(400).json({ error: 'you already answered this question' });
    }

    stateModule.recordAnswer(gameId, playerId, guess);
    io.to(`game:${gameId}`).emit('player-answered', { playerId });
    broadcastState(gameId); // so the admin/TV "X / Y answered" progress updates live

    // Auto-reveal the moment every currently-registered player has
    // answered — the admin's "Reveal Now" button is only needed if someone
    // never answers (AFK, left mid-question, etc).
    const freshState = stateModule.load(gameId);
    const totalPlayers = Object.keys(playersModule.getAllPlayers(gameId)).length;
    const answeredCount = Object.keys(freshState.answers).length;
    if (totalPlayers > 0 && answeredCount >= totalPlayers) {
      performReveal(io, gameId);
    }

    res.json({ ok: true });
  });

  game.post('/game/start', (req, res) => {
    const { gameId } = req.params;
    const questions = questionsModule.getQuestions(gameId);
    if (!questions.length) return res.status(400).json({ error: 'no questions configured' });
    const roundQuestions = shuffle(questions).slice(0, MAX_QUESTIONS);
    stateModule.startGame(
      gameId,
      roundQuestions.map((q) => q.id)
    );
    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  game.post('/game/next', (req, res) => {
    const { gameId } = req.params;
    try {
      stateModule.nextQuestion(gameId);
      const state = stateModule.load(gameId);
      if (state.status === 'ended' && !state.gameWinners) {
        declareWinnerByHighScore(io, gameId);
      }
      broadcastState(gameId);
      res.json(publicState(gameId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Lets the admin force the reveal early (e.g. someone's gone AFK and
  // everyone else is waiting) instead of being stuck until they answer.
  game.post('/game/reveal', (req, res) => {
    const { gameId } = req.params;
    try {
      performReveal(io, gameId);
      res.json(publicState(gameId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/reset', (req, res) => {
    const { gameId } = req.params;
    stateModule.resetGame(gameId);
    const players = playersModule.getAllPlayers(gameId);
    for (const player of Object.values(players)) player.points = 0;
    playersModule.save(gameId, players);
    io.to(`game:${gameId}`).emit('game-reset', {});
    broadcastState(gameId);
    broadcastPlayers(gameId);
    res.json(publicState(gameId));
  });

  return game;
}

module.exports = { gameRouter, publicState, playerSummaries };
