const express = require('express');

const stateModule = require('./state');
const playersModule = require('./players');
const promptsModule = require('./prompts');
const presenceModule = require('../../presence');

function promptsById() {
  return Object.fromEntries(promptsModule.listPrompts().map((p) => [p.id, p]));
}

// Players plus their score and whether they currently have a live
// connection, for the admin players panel and the shared game-view roster.
function playerSummaries(gameId) {
  const players = playersModule.getAllPlayers(gameId);
  return Object.values(players).map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    createdAt: p.createdAt,
    online: presenceModule.isOnline(gameId, p.id),
  }));
}

function publicState(gameId) {
  const state = stateModule.load(gameId);
  const byId = promptsById();
  const currentId =
    state.currentIndex >= 0 && state.currentIndex < state.promptOrder.length
      ? state.promptOrder[state.currentIndex]
      : null;
  const current = currentId ? byId[currentId] : null;

  const lastReveal = state.history.length ? state.history[state.history.length - 1] : null;

  return {
    status: state.status,
    revealStage: state.revealStage,
    promptNumber: state.currentIndex + 1,
    totalPrompts: state.promptOrder.length,
    promptShownAt: state.promptShownAt,
    currentPrompt: current ? { id: current.id, text: current.text } : null,
    // Who has answered so far, without leaking the text itself before the
    // reveal — the player view uses this to show "waiting on 3 more…".
    answeredPlayerIds: Object.keys(state.answers),
    reveal:
      state.revealStage === 'reveal' && lastReveal && lastReveal.promptId === currentId
        ? { groups: lastReveal.groups, scoredPlayerIds: lastReveal.scoredPlayerIds }
        : null,
  };
}

// Mounted at /api/games/:gameId/* for every think-alike instance — see
// src/engines/think-alike/index.js and src/routes.js.
function gameRouter(io) {
  const game = express.Router({ mergeParams: true });

  const broadcastState = (gameId) =>
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  const broadcastPlayers = (gameId) =>
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));

  game.get('/state', (req, res) => res.json(publicState(req.params.gameId)));

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

  game.post('/answer', (req, res) => {
    const { gameId } = req.params;
    const { playerId, text } = req.body;
    const player = playersModule.getPlayer(gameId, playerId);
    if (!player) return res.status(404).json({ error: 'player not found' });
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'answer text is required' });
    }
    try {
      stateModule.submitAnswer(gameId, playerId, text.trim());
      io.to(`game:${gameId}`).emit('player-answered', { playerId });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/start', (req, res) => {
    const { gameId } = req.params;
    const promptIds = promptsModule.listPrompts().map((p) => p.id);
    stateModule.startGame(gameId, promptIds);
    broadcastState(gameId);
    res.json(publicState(gameId));
  });

  game.post('/game/next', (req, res) => {
    const { gameId } = req.params;
    try {
      stateModule.nextPrompt(gameId);
      broadcastState(gameId);
      res.json(publicState(gameId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/reveal', (req, res) => {
    const { gameId } = req.params;
    try {
      const players = playersModule.getAllPlayers(gameId);
      const result = stateModule.revealPrompt(gameId, players);
      playersModule.save(gameId, players); // persists the score bump revealPrompt applied in place
      io.to(`game:${gameId}`).emit('prompt-revealed', result);
      broadcastState(gameId);
      broadcastPlayers(gameId);
      res.json(publicState(gameId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  game.post('/game/reset', (req, res) => {
    const { gameId } = req.params;
    stateModule.resetGame(gameId);
    const players = playersModule.getAllPlayers(gameId);
    for (const player of Object.values(players)) player.score = 0;
    playersModule.save(gameId, players);
    io.to(`game:${gameId}`).emit('game-reset', {});
    broadcastState(gameId);
    broadcastPlayers(gameId);
    res.json(publicState(gameId));
  });

  return game;
}

module.exports = { gameRouter, publicState, playerSummaries };
