const express = require('express');
const QRCode = require('qrcode');

const gamesModule = require('./games');
const enginesModule = require('./engines');
const { requestOrigin } = require('./network');

function playerJoinUrl(game, req) {
  return `${requestOrigin(req)}/play/${game.engine}/player/${game.id}`;
}

function gameViewUrl(game, req) {
  return `${requestOrigin(req)}/play/${game.engine}/game/${game.id}`;
}

function createRouter(io) {
  const router = express.Router();

  // Each engine's gameRouter(io) is built once per engine and reused for
  // every request, rather than rebuilt per request — its route handlers all
  // close over this same `io`.
  const gameRoutersBySlug = new Map();
  function gameRouterFor(engine) {
    if (!gameRoutersBySlug.has(engine.slug))
      gameRoutersBySlug.set(engine.slug, engine.gameRouter(io));
    return gameRoutersBySlug.get(engine.slug);
  }

  // --- Lobby-level endpoints: not scoped to any single game or engine ---

  router.get('/engines', (req, res) => {
    res.json(
      enginesModule
        .list()
        .map((e) => ({ slug: e.slug, title: e.title, emoji: e.emoji, tagline: e.tagline }))
    );
  });

  router.get('/engines/:slug', (req, res) => {
    const engine = enginesModule.get(req.params.slug);
    if (!engine) return res.status(404).json({ error: 'engine not found' });
    res.json({
      slug: engine.slug,
      title: engine.title,
      emoji: engine.emoji,
      tagline: engine.tagline,
      createOptions: engine.listCreateOptions ? engine.listCreateOptions() : {},
    });
  });

  router.get('/games', (req, res) => {
    const engine = typeof req.query.engine === 'string' ? req.query.engine : undefined;
    res.json(gamesModule.listGames(engine));
  });

  router.post('/games', (req, res) => {
    const name = (req.body.name || '').trim();
    const engine = enginesModule.get((req.body.engine || '').trim());
    if (!engine) return res.status(400).json({ error: `unknown engine "${req.body.engine}"` });

    const config = engine.createConfig ? engine.createConfig(req.body) : {};
    const game = gamesModule.createGame(name, engine.slug, config);
    res.json(game);
  });

  router.get('/games/:gameId', (req, res) => {
    const game = gamesModule.getGame(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'game not found' });
    res.json({ ...game, joinUrl: playerJoinUrl(game, req), gameViewUrl: gameViewUrl(game, req) });
  });

  router.delete('/games/:gameId', (req, res) => {
    const deleted = gamesModule.deleteGame(req.params.gameId);
    if (!deleted) return res.status(404).json({ error: 'game not found' });
    res.json({ deleted: true });
  });

  router.get('/games/:gameId/qr.png', async (req, res) => {
    const game = gamesModule.getGame(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'game not found' });
    try {
      const buffer = await QRCode.toBuffer(playerJoinUrl(game, req), { width: 320, margin: 1 });
      res.set('Content-Type', 'image/png');
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Per-game gameplay endpoints: delegated to the owning engine's own
  // router, mounted under /api/games/:gameId/... (see each engine's
  // gameRouter, e.g. src/engines/trivia-bingo/routes.js) ---

  router.use('/games/:gameId', (req, res, next) => {
    const game = gamesModule.getGame(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'game not found' });
    const engine = enginesModule.get(game.engine);
    if (!engine || !engine.gameRouter) return res.status(404).json({ error: 'game not found' });
    gameRouterFor(engine)(req, res, next);
  });

  return router;
}

// Independent of any client polling: ticks once a second across every
// engine's instances so each shared game screen's auto-reveal timers fire on
// time even if nobody is actively polling. Each engine's onTick decides what
// "catching up" means for its own state (see e.g.
// src/engines/trivia-bingo/routes.js's `tick`); engines with nothing to
// auto-reveal can simply omit onTick.
function startClock(io) {
  setInterval(() => {
    for (const engine of enginesModule.list()) {
      if (!engine.onTick) continue;
      for (const game of gamesModule.listGames(engine.slug)) {
        engine.onTick(io, game.id);
      }
    }
  }, 1000);
}

// Generic player-summary lookup used by server.js's socket presence
// handlers, delegated to the owning engine.
function playerSummaries(gameId) {
  const game = gamesModule.getGame(gameId);
  const engine = game && enginesModule.get(game.engine);
  if (!engine || !engine.playerSummaries) return [];
  return engine.playerSummaries(gameId);
}

module.exports = { createRouter, playerSummaries, startClock };
