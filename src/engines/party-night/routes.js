const express = require('express');
const { nanoid } = require('nanoid');

const stateModule = require('./state');
const playersModule = require('./players');
const subEnginesModule = require('./sub-engines');
const scoringModule = require('./scoring');
const gamesModule = require('../../games');
const presenceModule = require('../../presence');

const triviaBingoPlayers = require('../trivia-bingo/players');
const triviaBingoQuestions = require('../trivia-bingo/questions');
const fastestFingerPlayers = require('../fastest-finger/players');
const emojiQuizPlayers = require('../emoji-quiz/players');
const guessTheNumberPlayers = require('../guess-the-number/players');
const tambolaPlayers = require('../tambola/players');

// Matches each engine's own player app.js's storageKey() prefix exactly
// (see e.g. public/engines/tambola/player/app.js) — the player view uses
// this to pre-seed that engine's localStorage entry before navigating a
// party player straight into a round, so they never see that engine's own
// registration form. Every engine shares one origin, so localStorage is
// shared across all of them; this is the entire "join once" trick.
const STORAGE_PREFIX = {
  tambola: 'tambola',
  'trivia-bingo': 'bingo',
  'fastest-finger': 'fastestfinger',
  'emoji-quiz': 'emojiquiz',
  'guess-the-number': 'guessnum',
};

// Registers one party player into a freshly-created sub-game, using that
// engine's own players module directly (no HTTP) — trivia-bingo is the
// only one that needs its question bank up front to build a grid.
function registerIntoSubGame(engineSlug, subGameId, name) {
  switch (engineSlug) {
    case 'trivia-bingo': {
      const questions = triviaBingoQuestions.getQuestions(subGameId);
      return triviaBingoPlayers.registerPlayer(subGameId, name, questions);
    }
    case 'fastest-finger':
      return fastestFingerPlayers.registerPlayer(subGameId, name);
    case 'emoji-quiz':
      return emojiQuizPlayers.registerPlayer(subGameId, name);
    case 'guess-the-number':
      return guessTheNumberPlayers.registerPlayer(subGameId, name);
    case 'tambola':
      return tambolaPlayers.registerPlayer(subGameId, name);
    default:
      throw new Error(`cannot auto-register into unknown engine "${engineSlug}"`);
  }
}

// Every other engine builds join/admin/game URLs from an absolute
// requestOrigin() because a QR code must resolve from a phone that isn't
// this server. Nothing here needs that: these links are only ever clicked
// from a browser already on this same origin, so plain relative paths are
// enough — and it means this doesn't need a `req` at all, so it can be
// reused from socket broadcasts the same as from a route handler. A round
// still waiting in the stack (see /round/queue) has no sub-game yet, so
// there's nothing to link to.
function roundUrls(round) {
  if (!round.subGameId) return {};
  return {
    adminUrl: `/play/${round.engine}/admin/${round.subGameId}`,
    gameUrl: `/play/${round.engine}/game/${round.subGameId}`,
    joinUrl: `/play/${round.engine}/player/${round.subGameId}`,
  };
}

// A round is "queued" until an admin activates it (see
// /round/:roundId/activate) — no sub-game exists for it yet, so there's
// nothing to score or link to.
function isQueued(round) {
  return !round.subGameId;
}

// Cumulative totals: a player's score is never stored, only ever summed
// from each finished round's points on demand — removing a round (DELETE
// /round/:roundId) corrects every total automatically because of this.
function leaderboardFor(gameId, state) {
  const players = playersModule.getAllPlayers(gameId);
  const s = state || stateModule.load(gameId);
  const totals = {};
  for (const round of s.rounds) {
    if (!round.points) continue;
    for (const [playerId, pts] of Object.entries(round.points)) {
      totals[playerId] = (totals[playerId] || 0) + pts;
    }
  }
  return Object.values(players)
    .map((p) => ({
      id: p.id,
      name: p.name,
      total: totals[p.id] || 0,
      online: presenceModule.isOnline(gameId, p.id),
    }))
    .sort((a, b) => b.total - a.total);
}

// Full round details for the admin view — points keyed by *party* player
// id (already translated from the sub-game's own ids at finish time), so
// the admin can cross-reference against the roster without this ever
// exposing a sub-game's internal player ids.
function publicState(gameId) {
  const state = stateModule.load(gameId);
  return {
    status: state.status,
    leaderboard: leaderboardFor(gameId, state),
    rounds: state.rounds.map((r) => ({
      id: r.id,
      engine: r.engine,
      subGameId: r.subGameId,
      subGameName: r.subGameName,
      roundStatus: isQueued(r) ? 'queued' : r.finishedAt ? 'finished' : 'active',
      queuedAt: r.queuedAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      points: r.points,
      ...roundUrls(r),
    })),
    finalStandings: state.finalStandings,
  };
}

// Used by server.js's generic socket presence hook.
function playerSummaries(gameId) {
  return leaderboardFor(gameId);
}

// Mounted at /api/games/:gameId/* — see src/engines/index.js and
// src/routes.js.
function gameRouter(io) {
  const game = express.Router({ mergeParams: true });

  const broadcastState = (gameId) =>
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  const broadcastPlayers = (gameId) =>
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));

  game.get('/state', (req, res) => res.json(publicState(req.params.gameId)));

  game.get('/players', (req, res) => res.json(leaderboardFor(req.params.gameId)));

  // Includes this player's own round-by-round join links and sub-player
  // ids, unlike /players (the roster/leaderboard) — safe here because this
  // only ever goes back to the player who asked for their own record (see
  // each view's app.js, which only ever fetches its own id).
  game.get('/players/:id', (req, res) => {
    const { gameId, id } = req.params;
    const player = playersModule.getPlayer(gameId, id);
    if (!player) return res.status(404).json({ error: 'player not found' });

    const state = stateModule.load(gameId);
    const rounds = state.rounds
      .filter((r) => r.playerMap[id])
      .map((r) => ({
        id: r.id,
        engine: r.engine,
        subGameName: r.subGameName,
        subPlayerId: r.playerMap[id],
        storagePrefix: STORAGE_PREFIX[r.engine],
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        points: r.points ? (r.points[id] ?? 0) : null,
        ...roundUrls(r),
      }));
    const total = rounds.reduce((sum, r) => sum + (r.points || 0), 0);
    res.json({ ...player, rounds, total });
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

  game.post('/players/:id/kick', (req, res) => {
    const { gameId } = req.params;
    const removed = playersModule.removePlayer(gameId, req.params.id);
    if (!removed) return res.status(404).json({ error: 'player not found' });
    io.to(`game:${gameId}`).emit('player-kicked', { playerId: req.params.id });
    broadcastPlayers(gameId);
    res.json({ ok: true });
  });

  game.post('/game/start', (req, res) => {
    const { gameId } = req.params;
    const state = stateModule.load(gameId);
    state.status = 'running';
    stateModule.save(gameId, state);
    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  game.post('/game/reset', (req, res) => {
    const { gameId } = req.params;
    stateModule.save(gameId, stateModule.defaultState());
    io.to(`game:${gameId}`).emit('game-reset', {});
    broadcastState(gameId);
    broadcastPlayers(gameId);
    res.json(publicState(gameId));
  });

  // Adds a round to the stack without creating anything yet — build the
  // whole night's lineup ahead of time (à la Herd Mentality's party mode),
  // then activate each one when you're actually ready to play it.
  game.post('/round/queue', (req, res) => {
    const { gameId } = req.params;
    const engineSlug = (req.body.engine || '').trim();
    const subEngine = subEnginesModule.get(engineSlug);
    if (!subEngine) return res.status(400).json({ error: `unknown engine "${engineSlug}"` });

    const config = subEngine.createConfig ? subEngine.createConfig(req.body) : {};
    const state = stateModule.load(gameId);
    const round = {
      id: nanoid(10),
      engine: engineSlug,
      subGameId: null,
      subGameName: `Party Night — ${subEngine.title}`,
      config,
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      playerMap: {},
      points: null,
    };
    state.rounds.push(round);
    stateModule.save(gameId, state);

    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  // Reorders a still-queued round relative to its queued neighbors
  // (active/finished rounds are history and don't move) — swaps it with
  // whichever queued round sits before/after it in the stack, wherever
  // that actually is in the full rounds array.
  game.post('/round/:roundId/move', (req, res) => {
    const { gameId, roundId } = req.params;
    const direction = req.body.direction === 'up' ? 'up' : 'down';
    const state = stateModule.load(gameId);

    const queuedIndices = state.rounds
      .map((r, i) => (isQueued(r) ? i : null))
      .filter((i) => i !== null);
    const ownIndex = state.rounds.findIndex((r) => r.id === roundId);
    const posInQueue = queuedIndices.indexOf(ownIndex);
    if (posInQueue === -1) return res.status(400).json({ error: 'round is not queued' });

    const swapWithPos = direction === 'up' ? posInQueue - 1 : posInQueue + 1;
    if (swapWithPos < 0 || swapWithPos >= queuedIndices.length) {
      return res.json(publicState(gameId)); // already at that end — no-op, not an error
    }

    const i1 = queuedIndices[posInQueue];
    const i2 = queuedIndices[swapWithPos];
    [state.rounds[i1], state.rounds[i2]] = [state.rounds[i2], state.rounds[i1]];
    stateModule.save(gameId, state);

    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  // Promotes a queued round to active: creates the real sub-game now and
  // silently registers every *current* party player into it (see
  // registerIntoSubGame) — not whoever had joined back when it was
  // queued, since more players may have joined since. The sub-game itself
  // is run entirely through that engine's own, unmodified admin/game
  // views; this only tracks it for scoring. Broadcasts 'round-started' so
  // every player's view auto-navigates into it.
  game.post('/round/:roundId/activate', (req, res) => {
    const { gameId, roundId } = req.params;
    const state = stateModule.load(gameId);
    const round = state.rounds.find((r) => r.id === roundId);
    if (!round) return res.status(404).json({ error: 'round not found' });
    if (!isQueued(round))
      return res.status(400).json({ error: 'round is already active or finished' });
    const alreadyActive = state.rounds.find((r) => !isQueued(r) && !r.finishedAt);
    if (alreadyActive) {
      return res
        .status(400)
        .json({ error: `${alreadyActive.subGameName} is still active — finish it first` });
    }

    const subGame = gamesModule.createGame(round.subGameName, round.engine, round.config);
    const partyPlayers = Object.values(playersModule.getAllPlayers(gameId));
    const playerMap = {};
    for (const player of partyPlayers) {
      try {
        const subPlayer = registerIntoSubGame(round.engine, subGame.id, player.name);
        playerMap[player.id] = subPlayer.id;
      } catch (err) {
        // One player's registration failing shouldn't sink the whole
        // round — they just won't have a join link for it.
        console.error(`party-night: failed to register "${player.name}" into ${round.engine}`, err);
      }
    }

    round.subGameId = subGame.id;
    round.subGameName = subGame.name;
    round.playerMap = playerMap;
    round.startedAt = new Date().toISOString();
    stateModule.save(gameId, state);

    io.to(`game:${gameId}`).emit('round-started', { roundId: round.id, engine: round.engine });
    broadcastState(gameId);
    res.json({ ...round, ...roundUrls(round) });
  });

  game.post('/round/:roundId/finish', (req, res) => {
    const { gameId, roundId } = req.params;
    const state = stateModule.load(gameId);
    const round = state.rounds.find((r) => r.id === roundId);
    if (!round) return res.status(404).json({ error: 'round not found' });
    if (isQueued(round)) return res.status(400).json({ error: 'round has not been started yet' });
    if (round.finishedAt) return res.status(400).json({ error: 'round already finished' });

    let subPoints;
    try {
      subPoints = scoringModule.scoreRound(round.engine, round.subGameId);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const partyPoints = {};
    for (const [partyPlayerId, subPlayerId] of Object.entries(round.playerMap)) {
      partyPoints[partyPlayerId] = subPoints[subPlayerId] || 0;
    }
    round.points = partyPoints;
    round.finishedAt = new Date().toISOString();
    stateModule.save(gameId, state);

    broadcastState(gameId);
    broadcastPlayers(gameId);
    res.json(publicState(gameId));
  });

  // Drops a round from the night's history without touching the
  // underlying sub-game — removing it here just corrects the cumulative
  // leaderboard, since totals are always summed fresh (see leaderboardFor).
  game.delete('/round/:roundId', (req, res) => {
    const { gameId, roundId } = req.params;
    const state = stateModule.load(gameId);
    const index = state.rounds.findIndex((r) => r.id === roundId);
    if (index === -1) return res.status(404).json({ error: 'round not found' });
    state.rounds.splice(index, 1);
    stateModule.save(gameId, state);
    broadcastState(gameId);
    broadcastPlayers(gameId);
    res.json(publicState(gameId));
  });

  // Crowns the night: final cumulative standings with ties sharing a
  // place (same competition-ranking rule as scoring.js), broadcast so the
  // TV/player views can run the confetti + cheer celebration.
  game.post('/game/end', (req, res) => {
    const { gameId } = req.params;
    const state = stateModule.load(gameId);
    if (state.status !== 'running') {
      return res.status(400).json({ error: 'party night is not running' });
    }

    const leaderboard = leaderboardFor(gameId, state);
    if (!leaderboard.length) return res.status(400).json({ error: 'no players to crown' });

    const standings = [];
    let place = 0;
    let playersSeen = 0;
    let lastTotal = null;
    for (const row of leaderboard) {
      playersSeen += 1;
      if (lastTotal === null || row.total !== lastTotal) {
        place = playersSeen;
        lastTotal = row.total;
      }
      standings.push({ playerId: row.id, name: row.name, total: row.total, place });
    }

    state.status = 'ended';
    state.finalStandings = standings;
    stateModule.save(gameId, state);

    const winners = standings.filter((s) => s.place === 1);
    const runnersUp = standings.filter((s) => s.place === 2);
    io.to(`game:${gameId}`).emit('night-ended', { standings, winners, runnersUp });
    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  return game;
}

module.exports = { gameRouter, publicState, playerSummaries };
