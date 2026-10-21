const express = require('express');

const stateModule = require('./state');
const playersModule = require('./players');
const questionsModule = require('./questions');
const responsesModule = require('./responses');
const gamesModule = require('../../games');
const modesModule = require('./modes');
const distractorsModule = require('./distractors');
const presenceModule = require('../../presence');
const assetsModule = require('./assets');

const FASTEST_FINGER_ROUND_SIZE = 25;

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
  const game = gamesModule.getGame(gameId);
  const mode = (game && game.config && game.config.mode) || modesModule.DEFAULT_MODE;
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
    if (mode === 'fastest-finger') {
      const opts = state.options[current.id];
      currentQuestion = {
        id: current.id,
        question: current.question,
        image: assetsModule.imageUrlFor(current.image),
        options: opts ? opts.options : [],
        answer: state.revealStage === 'answer' ? current.answer : null,
        // Withheld until the reveal, same as the answer text, so a player
        // can't peek at the network response to see which option is correct
        // before the window closes.
        correctIndex: state.revealStage === 'answer' && opts ? opts.correctIndex : null,
        winner: null,
      };
      if (state.revealStage === 'answer' && state.currentQuestionWinner) {
        const winnerPlayer = playersModule.getPlayer(gameId, state.currentQuestionWinner);
        currentQuestion.winner = winnerPlayer
          ? { playerId: winnerPlayer.id, playerName: winnerPlayer.name }
          : null;
      }
    } else {
      // For most bingo-mode banks the image is a bonus visual hint, withheld
      // until the hint stage. Flags invert that — the flag image IS the
      // question, not an aid to it — so it has to be visible from the moment
      // the question appears.
      const showImageImmediately = game && game.config && game.config.gameType === 'flags';
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
  }

  return {
    mode,
    status: state.status,
    revealStage: state.revealStage,
    questionNumber: state.currentIndex + 1,
    totalQuestions: state.questionOrder.length,
    questionShownAt: state.questionShownAt,
    hintDelayMs: stateModule.HINT_DELAY_MS,
    answerDelayMs: stateModule.ANSWER_DELAY_MS,
    fastestAnswerWindowMs: stateModule.FASTEST_ANSWER_WINDOW_MS,
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
    const gameMeta = gamesModule.getGame(gameId);
    const mode = (gameMeta && gameMeta.config && gameMeta.config.mode) || modesModule.DEFAULT_MODE;
    const players = playersModule.getAllPlayers(gameId);
    return mode === 'fastest-finger'
      ? { mode, rows: responsesModule.computeFastestFingerLeaderboard(gameId, players) }
      : { mode, ...responsesModule.computeLeaderboard(gameId, players) };
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
    const gameMeta = gamesModule.getGame(gameId);
    const mode = (gameMeta && gameMeta.config && gameMeta.config.mode) || modesModule.DEFAULT_MODE;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const questions = questionsModule.getQuestions(gameId);
    // Fastest-finger players have no bingo card, so there's no grid-size
    // floor to enforce at registration time.
    if (mode !== 'fastest-finger' && questions.length < playersModule.GRID_SIZE) {
      return res.status(400).json({
        error: `need at least ${playersModule.GRID_SIZE} questions configured, have ${questions.length}`,
      });
    }

    try {
      const player = playersModule.registerPlayer(gameId, name, questions, mode);
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
    const gameMeta = gamesModule.getGame(gameId);
    if (gameMeta && gameMeta.config && gameMeta.config.mode === 'fastest-finger') {
      return res.status(400).json({ error: 'this game uses /answer, not /mark' });
    }
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

  // Fastest-finger mode's equivalent of /mark: a player picks one of the 4
  // live options. Only the first correct answer for this question earns the
  // point (`pointAwarded`) — everyone else's response is still recorded (for
  // playerStats/history) but doesn't move their score. One attempt per
  // question: a player who already has a response for the current question
  // is rejected rather than allowed to retry.
  //
  // This handler is deliberately synchronous end-to-end (no `await` between
  // the state load and save), the same way /mark is, so Node's event loop
  // can't interleave two players' requests mid-handler — that's what makes
  // "first correct wins" race-safe without a database transaction.
  game.post('/answer', (req, res) => {
    const { gameId } = req.params;
    const gameMeta = gamesModule.getGame(gameId);
    if (!gameMeta || !gameMeta.config || gameMeta.config.mode !== 'fastest-finger') {
      return res.status(400).json({ error: 'this game does not use /answer' });
    }
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
      playerName: player.name,
      questionId: currentQuestionId,
      optionIndex,
      correct,
      pointAwarded,
      auto: false,
      markedAt: new Date().toISOString(),
      elapsedMs,
    });
    if (pointAwarded) state.currentQuestionWinner = playerId;
    stateModule.save(gameId, state);

    broadcastLeaderboard(gameId);
    broadcastPlayers(gameId);
    // The point-winning answer also closes the question for everyone else —
    // broadcast the reveal immediately rather than waiting for the next
    // clock tick or /state poll.
    if (pointAwarded) broadcastState(gameId);

    res.json({ correct, pointAwarded });
  });

  game.post('/game/start', (req, res) => {
    const { gameId } = req.params;
    const gameMeta = gamesModule.getGame(gameId);
    const mode = (gameMeta && gameMeta.config && gameMeta.config.mode) || modesModule.DEFAULT_MODE;
    const questions = questionsModule.getQuestions(gameId);

    if (mode === 'fastest-finger') {
      const eligible = questions.filter((q) =>
        distractorsModule.isEligibleForFastestFinger(gameMeta.config.gameType, q)
      );
      if (eligible.length < 4) {
        return res.status(400).json({
          error: `need at least 4 multiple-choice-ready questions, have ${eligible.length} (some questions' answers are too free-form for a 4-option quiz — edit or add questions in the Questions panel)`,
        });
      }
      // Cap each round at FASTEST_FINGER_ROUND_SIZE questions, picked at
      // random from the eligible pool, rather than always running through
      // every eligible question — keeps a round a reasonable length even
      // when a bank has 60+ qualifying questions.
      const roundQuestions =
        eligible.length > FASTEST_FINGER_ROUND_SIZE
          ? shuffle(eligible).slice(0, FASTEST_FINGER_ROUND_SIZE)
          : eligible;
      let optionsByQuestionId;
      try {
        // Collisions are checked against this round's own questions, not the
        // whole bank — a distractor only needs to avoid matching an answer
        // that will actually be revealed in *this* game. Scoping it to the
        // full bank was too strict for a bank like flags, whose distractor
        // pool deliberately reuses its own 254 answers: with every pool
        // entry also being "a bank answer", a full-bank collision check left
        // nothing uncollided to pick from.
        optionsByQuestionId = Object.fromEntries(
          roundQuestions.map((q) => [
            q.id,
            distractorsModule.buildOptionsForQuestion(gameMeta.config.gameType, q, roundQuestions),
          ])
        );
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      stateModule.startGame(
        gameId,
        roundQuestions.map((q) => q.id),
        optionsByQuestionId
      );
    } else {
      if (questions.length < playersModule.GRID_SIZE) {
        return res.status(400).json({
          error: `need at least ${playersModule.GRID_SIZE} questions configured, have ${questions.length}`,
        });
      }
      stateModule.startGame(
        gameId,
        questions.map((q) => q.id)
      );
    }

    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  game.post('/game/next', (req, res) => {
    const { gameId } = req.params;
    const gameMeta = gamesModule.getGame(gameId);
    const mode = (gameMeta && gameMeta.config && gameMeta.config.mode) || modesModule.DEFAULT_MODE;
    try {
      // Fastest-finger has no bingo grid to auto-fill — the question just
      // simply closes (everyone who didn't answer scores nothing for it).
      if (mode !== 'fastest-finger') {
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
    const gameMeta = gamesModule.getGame(gameId);
    if (gameMeta && gameMeta.config && gameMeta.config.mode === 'fastest-finger') {
      return res.status(400).json({ error: 'fastest-finger has no hint stage' });
    }
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
    const gameMeta = gamesModule.getGame(gameId);
    const mode = (gameMeta && gameMeta.config && gameMeta.config.mode) || modesModule.DEFAULT_MODE;
    const questions = questionsModule.getQuestions(gameId);
    stateModule.resetGame(gameId); // also clears responses, which now live inside the same state file
    if (mode !== 'fastest-finger' && questions.length >= playersModule.GRID_SIZE) {
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
