const express = require('express');

const stateModule = require('./state');
const playersModule = require('./players');
const questionsModule = require('./questions');
const responsesModule = require('./responses');
const presenceModule = require('../../presence');
const assetsModule = require('./assets');
const gamesModule = require('../../games');
const packsModule = require('./packs');

function questionsById(questions) {
  return Object.fromEntries(questions.map((q) => [q.id, q]));
}

function packFor(gameId) {
  const meta = gamesModule.getGame(gameId);
  return (meta && meta.config && meta.config.pack) || packsModule.DEFAULT_PACK;
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

  const revealedAnswers = state.revealedHistory
    .map((qid) => byId[qid])
    .filter(Boolean)
    .map((q) => ({ id: q.id, question: q.question, answer: q.answer }));

  let currentQuestion = null;
  if (current && state.revealStage !== 'none') {
    // For most banks the image is a bonus visual hint, withheld until the
    // hint stage. Flags invert that — the flag image IS the question, not an
    // aid to it — so it has to be visible from the moment the question
    // appears.
    const showImageImmediately = packFor(gameId) === 'flags';
    currentQuestion = {
      id: current.id,
      question: current.question,
      hint: state.revealStage === 'hint' || state.revealStage === 'answer' ? current.hint : null,
      image:
        showImageImmediately || state.revealStage === 'hint' || state.revealStage === 'answer'
          ? assetsModule.imageUrlFor(current.image)
          : null,
      answer: state.revealStage === 'answer' ? current.answer : null,
    };
  }

  return {
    status: state.status,
    revealStage: state.revealStage,
    questionNumber: state.currentIndex + 1,
    totalQuestions: state.questionOrder.length,
    questionShownAt: state.questionShownAt,
    hintDelayMs: stateModule.HINT_DELAY_MS,
    answerDelayMs: stateModule.ANSWER_DELAY_MS,
    currentQuestion,
    revealedAnswers,
    winner: state.winner,
  };
}

// Players plus their persisted grid, how many answers they've submitted so
// far, and whether they currently have a live connection, for the admin
// players panel and the shared game-view roster.
function playerSummaries(gameId) {
  const players = playersModule.getAllPlayers(gameId);
  const stats = responsesModule.playerStats(gameId);
  return Object.values(players).map((p) => {
    const s = stats[p.id] || { answeredCount: 0, correctCount: 0, lastAnsweredAt: null };
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      answeredCount: s.answeredCount,
      correctCount: s.correctCount,
      lastAnsweredAt: s.lastAnsweredAt,
      online: presenceModule.isOnline(gameId, p.id),
    };
  });
}

// When the host advances past a question, any player who never landed their
// matching cell gets it filled in now, purely so they don't lose bingo
// progress for being slow to tap — this never counts as a response for
// scoring purposes (writeResponse's `auto: true` keeps it out of the
// leaderboard and admin player stats, see responses.js).
function autoSubmitPreviousQuestion(gameId) {
  const state = stateModule.load(gameId);
  if (state.status !== 'running' || state.currentIndex < 0 || state.revealStage === 'none')
    return [];

  const currentQuestionId = state.questionOrder[state.currentIndex];
  const players = playersModule.getAllPlayers(gameId);
  const existingResponses = responsesModule.getAllResponses(gameId);
  const autoMarks = [];

  for (const player of Object.values(players)) {
    const cellIndex = player.grid.findIndex((c) => c.questionId === currentQuestionId);
    if (cellIndex === -1) continue; // this question isn't on their card

    const alreadyMarked = existingResponses.some(
      (r) => r.playerId === player.id && r.cellIndex === cellIndex && r.correct
    );
    if (alreadyMarked) continue;

    responsesModule.writeResponse(gameId, {
      playerId: player.id,
      playerName: player.name,
      questionId: currentQuestionId,
      cellIndex,
      answer: player.grid[cellIndex].answer,
      correct: true,
      beforeReveal: false,
      auto: true,
      revealedAt: state.revealedAt,
      markedAt: new Date().toISOString(),
      elapsedMs: null,
    });

    autoMarks.push({
      playerId: player.id,
      playerName: player.name,
      cellIndex,
      bingo: responsesModule.checkBingo(gameId, player.id),
    });
  }

  return autoMarks;
}

// Mounted at /api/games/:gameId/* for every trivia-bingo instance — see
// src/engines/trivia-bingo/index.js and src/routes.js.
function gameRouter(io) {
  const game = express.Router({ mergeParams: true });

  const broadcastState = (gameId) =>
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  const leaderboardPayload = (gameId) => {
    const players = playersModule.getAllPlayers(gameId);
    return responsesModule.computeLeaderboard(gameId, players);
  };
  const broadcastLeaderboard = (gameId) =>
    io.to(`game:${gameId}`).emit('leaderboard-update', leaderboardPayload(gameId));
  const broadcastPlayers = (gameId) =>
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));

  game.get('/state', (req, res) => {
    const { gameId } = req.params;
    // Lazily apply any due hint/answer auto-reveals before responding, so a
    // client polling /api/games/:gameId/state always sees up-to-date timing
    // even between server clock ticks (and immediately after a restart).
    if (stateModule.catchUp(gameId)) broadcastState(gameId);
    res.json(publicState(gameId));
  });

  game.get('/questions', (req, res) => res.json(questionsModule.getQuestions(req.params.gameId)));

  game.put('/questions', (req, res) => {
    try {
      const questions = questionsModule.saveQuestions(req.params.gameId, req.body.questions);
      res.json(questions);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.get('/players', (req, res) => res.json(playerSummaries(req.params.gameId)));

  game.get('/leaderboard', (req, res) => res.json(leaderboardPayload(req.params.gameId)));

  game.post('/register', (req, res) => {
    const { gameId } = req.params;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const questions = questionsModule.getQuestions(gameId);
    if (questions.length < playersModule.GRID_SIZE) {
      return res.status(400).json({
        error: `need at least ${playersModule.GRID_SIZE} questions configured, have ${questions.length}`,
      });
    }

    try {
      const player = playersModule.registerPlayer(gameId, name, questions);
      io.to(`game:${gameId}`).emit('player-registered', { id: player.id, name: player.name });
      res.json(player);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.get('/players/:id', (req, res) => {
    const player = playersModule.getPlayer(req.params.gameId, req.params.id);
    if (!player) return res.status(404).json({ error: 'player not found' });
    res.json(player);
  });

  // Kicks a player so they can rejoin fresh (new registration, new grid) if
  // something went wrong on their end. Their client is told via socket so it
  // can drop back to the registration screen on its own.
  game.post('/players/:id/kick', (req, res) => {
    const { gameId } = req.params;
    const playerId = req.params.id;
    const removed = playersModule.removePlayer(gameId, playerId);
    if (!removed) return res.status(404).json({ error: 'player not found' });
    responsesModule.removeResponsesForPlayer(gameId, playerId);
    io.to(`game:${gameId}`).emit('player-kicked', { playerId });
    broadcastPlayers(gameId);
    broadcastLeaderboard(gameId);
    res.json({ ok: true });
  });

  game.post('/mark', (req, res) => {
    const { gameId } = req.params;
    const { playerId, cellIndex } = req.body;
    const player = playersModule.getPlayer(gameId, playerId);
    if (!player) return res.status(404).json({ error: 'player not found' });
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= player.grid.length) {
      return res.status(400).json({ error: 'invalid cellIndex' });
    }

    const state = stateModule.load(gameId);
    // Players can gamble as soon as a question appears — no longer gated on
    // the full text answer being shown, since the whole point now is to
    // reward a correct guess made before that happens.
    if (state.revealStage === 'none') {
      return res.status(400).json({ error: 'no question is currently active' });
    }

    const questions = questionsModule.getQuestions(gameId);
    const byId = questionsById(questions);
    const currentQuestionId = state.questionOrder[state.currentIndex];
    const currentQuestion = byId[currentQuestionId];
    const cell = player.grid[cellIndex];

    const alreadyMarked = responsesModule
      .getAllResponses(gameId)
      .some((r) => r.playerId === playerId && r.cellIndex === cellIndex && r.correct);
    if (alreadyMarked) {
      return res.json({ correct: true, alreadyMarked: true });
    }

    const correct = cell.questionId === currentQuestionId;
    // Measured from when the question first appeared, not from the answer
    // reveal, since a scoring attempt can now happen before either exists.
    const elapsedMs = state.questionShownAt
      ? Date.now() - new Date(state.questionShownAt).getTime()
      : null;

    responsesModule.writeResponse(gameId, {
      playerId,
      playerName: player.name,
      questionId: currentQuestionId,
      cellIndex,
      answer: currentQuestion ? currentQuestion.answer : null,
      correct,
      beforeReveal: state.revealStage !== 'answer',
      auto: false,
      revealedAt: state.revealedAt,
      markedAt: new Date().toISOString(),
      elapsedMs,
    });

    broadcastLeaderboard(gameId);
    broadcastPlayers(gameId);

    let bingo = false;
    if (correct) {
      bingo = responsesModule.checkBingo(gameId, playerId);
      if (bingo) {
        const updated = stateModule.setWinner(gameId, {
          playerId,
          playerName: player.name,
          at: new Date().toISOString(),
        });
        if (updated.winner && updated.winner.playerId === playerId) {
          io.to(`game:${gameId}`).emit('bingo-detected', updated.winner);
        }
        broadcastState(gameId);
      }
    }

    res.json({ correct, bingo });
  });

  game.post('/game/start', (req, res) => {
    const { gameId } = req.params;
    const questions = questionsModule.getQuestions(gameId);
    if (questions.length < playersModule.GRID_SIZE) {
      return res.status(400).json({
        error: `need at least ${playersModule.GRID_SIZE} questions configured, have ${questions.length}`,
      });
    }
    stateModule.startGame(
      gameId,
      questions.map((q) => q.id)
    );
    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  game.post('/game/next', (req, res) => {
    const { gameId } = req.params;
    try {
      const autoMarks = autoSubmitPreviousQuestion(gameId);
      for (const mark of autoMarks) {
        io.to(`game:${gameId}`).emit('cell-auto-marked', {
          playerId: mark.playerId,
          cellIndex: mark.cellIndex,
        });
        if (mark.bingo) {
          const updated = stateModule.setWinner(gameId, {
            playerId: mark.playerId,
            playerName: mark.playerName,
            at: new Date().toISOString(),
          });
          if (updated.winner && updated.winner.playerId === mark.playerId) {
            io.to(`game:${gameId}`).emit('bingo-detected', updated.winner);
          }
        }
      }
      stateModule.nextQuestion(gameId);
      broadcastState(gameId);
      res.json(publicState(gameId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/reveal-hint', (req, res) => {
    const { gameId } = req.params;
    try {
      stateModule.revealHint(gameId);
      broadcastState(gameId);
      res.json(publicState(gameId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/reveal', (req, res) => {
    const { gameId } = req.params;
    try {
      stateModule.revealAnswer(gameId);
      broadcastState(gameId);
      res.json(publicState(gameId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/reset', (req, res) => {
    const { gameId } = req.params;
    const questions = questionsModule.getQuestions(gameId);
    stateModule.resetGame(gameId); // also clears responses, which now live inside the same state file
    if (questions.length >= playersModule.GRID_SIZE) {
      playersModule.regenerateGrids(gameId, questions);
    }
    io.to(`game:${gameId}`).emit('game-reset', {});
    broadcastState(gameId);
    broadcastLeaderboard(gameId);
    broadcastPlayers(gameId);
    res.json(publicState(gameId));
  });

  game.post('/game/flash-gameover', (req, res) => {
    const { gameId } = req.params;
    const state = stateModule.load(gameId);
    if (!state.winner) return res.status(400).json({ error: 'no winner recorded yet' });
    io.to(`game:${gameId}`).emit('game-over', state.winner);
    res.json({ ok: true, winner: state.winner });
  });

  return game;
}

// Called once a second across every trivia-bingo instance (see
// src/engines/index.js's tick loop) so each shared game screen's hint/answer
// auto-reveal happens on time even if nobody is actively hitting /state.
// Driven by stateModule.catchUp(), which is itself based on the persisted
// questionShownAt timestamp, so a server restart mid-question just resumes
// the correct countdown.
function tick(io, gameId) {
  if (stateModule.catchUp(gameId)) {
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  }
}

module.exports = { gameRouter, publicState, playerSummaries, tick };
