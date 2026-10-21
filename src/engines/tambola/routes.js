const express = require('express');

const stateModule = require('./state');
const playersModule = require('./players');
const linesModule = require('./lines');
const presenceModule = require('../../presence');

// The TV "closing in" panel only shows players within this many clicks of
// winning some still-open category, so it isn't cluttered for the whole
// first half of the game.
const TV_NEAR_WIN_THRESHOLD = 3;

function drawnSetOf(state) {
  return new Set(stateModule.drawnNumbersOf(state));
}

// Winning is driven by what a player has actively *marked* (clicked), not
// merely what's been drawn — an inattentive player who never clicks never
// completes a line, even if every number on it has long since been called.
// For one player: how many numbers they still need to mark to complete the
// nearest still-open line on *any one* of their three tickets (their
// overall "closeness"), which category that line belongs to, and — only
// when that distance is exactly 1 — which already-drawn, not-yet-marked
// number of theirs would finish it, so the player's own view can blink it
// (nothing to blink if that last number hasn't been drawn yet; there's
// nothing to click). A category that already has a winner is skipped
// entirely: nothing left to win there.
function closenessFor(player, state) {
  const markedSet = new Set(player.marked || []);
  const drawnSet = drawnSetOf(state);
  let distance = Infinity;
  let category = null;
  const blinkCells = new Set();

  for (const cat of linesModule.CATEGORIES) {
    if (state.winners[cat]) continue;
    const cells = linesModule.cellsFor(cat);
    for (const grid of player.grids) {
      const missing = cells.map((idx) => grid[idx]).filter((n) => !markedSet.has(n));
      if (missing.length < distance) {
        distance = missing.length;
        category = cat;
      }
      if (missing.length === 1 && drawnSet.has(missing[0])) blinkCells.add(missing[0]);
    }
  }

  return {
    distance: Number.isFinite(distance) ? distance : null,
    category,
    blinkCells: Array.from(blinkCells),
  };
}

function publicState(gameId) {
  const state = stateModule.load(gameId);
  const drawnNumbers = stateModule.drawnNumbersOf(state);
  return {
    status: state.status,
    totalDrawn: drawnNumbers.length,
    drawnNumbers,
    lastNumber: drawnNumbers.length ? drawnNumbers[drawnNumbers.length - 1] : null,
    winners: state.winners,
  };
}

// Players plus how close they are to winning (for the admin/TV panels) and
// whether they currently have a live connection. Deliberately doesn't
// expose *which* number they need, or their tickets — see closenessFor's
// blinkCells (only ever returned to that same player via GET /players/:id)
// and GET /admin/players (grids+marks, for the admin's own eyes only).
function playerSummaries(gameId) {
  const state = stateModule.load(gameId);
  const players = playersModule.getAllPlayers(gameId);
  return Object.values(players).map((p) => {
    const { distance, category } = closenessFor(p, state);
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      online: presenceModule.isOnline(gameId, p.id),
      distance,
      category,
      close: distance !== null && distance <= TV_NEAR_WIN_THRESHOLD,
    };
  });
}

// Checks every still-open category for a line this one player has now
// fully marked on *any one* of their three tickets, closing (and
// broadcasting) any that just completed. Called only from /mark — drawing
// a number never completes a line by itself.
function checkWinsFor(io, gameId, player) {
  const state = stateModule.load(gameId);
  const markedSet = new Set(player.marked);
  const newlyWon = [];

  for (const category of linesModule.CATEGORIES) {
    if (state.winners[category]) continue;
    const cells = linesModule.cellsFor(category);
    const gridIndex = player.grids.findIndex((grid) =>
      cells.every((idx) => markedSet.has(grid[idx]))
    );
    if (gridIndex !== -1) {
      const winners = [{ playerId: player.id, playerName: player.name, gridIndex }];
      state.winners[category] = winners;
      newlyWon.push({ category, winners });
    }
  }

  if (!newlyWon.length) return;
  if (linesModule.CATEGORIES.every((c) => state.winners[c])) state.status = 'ended';
  stateModule.save(gameId, state);
  for (const win of newlyWon) io.to(`game:${gameId}`).emit('category-won', win);
  io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
}

// Mounted at /api/games/:gameId/* for every tambola instance — see
// src/engines/tambola/index.js and src/routes.js.
function gameRouter(io) {
  const game = express.Router({ mergeParams: true });

  const broadcastState = (gameId) =>
    io.to(`game:${gameId}`).emit('state-update', publicState(gameId));
  const broadcastPlayers = (gameId) =>
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));
  // /game/start and /game/reset both deal everyone a fresh ticket — this
  // tells every connected player's own client to refetch its (now
  // different) grids immediately, rather than leaving it to drift out of
  // sync with the server's actual tickets until the next poll
  // (playerSummaries, which 'players-update' carries, never includes them
  // at all).
  const broadcastTicketsDealt = (gameId) => io.to(`game:${gameId}`).emit('tickets-dealt', {});

  game.get('/state', (req, res) => res.json(publicState(req.params.gameId)));

  game.get('/players', (req, res) => res.json(playerSummaries(req.params.gameId)));

  // Admin-only view of every player's actual tickets and marks — "since
  // players can lie" about having won, the host needs to be able to check
  // a claim against what's really been clicked. Never used by the game/
  // player views, which only ever see playerSummaries.
  game.get('/admin/players', (req, res) => {
    const { gameId } = req.params;
    const players = playersModule.getAllPlayers(gameId);
    res.json(
      Object.values(players).map((p) => ({
        id: p.id,
        name: p.name,
        online: presenceModule.isOnline(gameId, p.id),
        grids: p.grids,
        marked: p.marked,
      }))
    );
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

  // Includes blinkCells, unlike playerSummaries — safe here because this
  // response only ever goes back to the player who asked for their own
  // record (see each view's app.js, which only ever fetches its own id).
  game.get('/players/:id', (req, res) => {
    const { gameId, id } = req.params;
    const player = playersModule.getPlayer(gameId, id);
    if (!player) return res.status(404).json({ error: 'player not found' });
    const state = stateModule.load(gameId);
    const { blinkCells } = closenessFor(player, state);
    res.json({ ...player, blinkCells });
  });

  game.post('/players/:id/kick', (req, res) => {
    const { gameId } = req.params;
    const removed = playersModule.removePlayer(gameId, req.params.id);
    if (!removed) return res.status(404).json({ error: 'player not found' });
    io.to(`game:${gameId}`).emit('player-kicked', { playerId: req.params.id });
    broadcastPlayers(gameId);
    res.json({ ok: true });
  });

  // A player claiming one of their own drawn numbers. Rejected if the
  // number isn't on any of their three tickets or hasn't been drawn yet —
  // marking never happens automatically, which is the whole point: an
  // attentive player who clicks promptly can complete (and win) a line
  // before a player who has the same numbers but never clicks.
  game.post('/players/:id/mark', (req, res) => {
    const { gameId, id } = req.params;
    const number = Number(req.body.number);
    const player = playersModule.getPlayer(gameId, id);
    if (!player) return res.status(404).json({ error: 'player not found' });
    if (!playersModule.isOnTicket(player, number)) {
      return res.status(400).json({ error: 'that number is not on your tickets' });
    }
    const state = stateModule.load(gameId);
    if (!drawnSetOf(state).has(number)) {
      return res.status(400).json({ error: 'that number has not been drawn yet' });
    }
    if (player.marked.includes(number)) {
      return res.json({ ...player, alreadyMarked: true });
    }

    const updated = playersModule.markNumber(gameId, id, number);
    checkWinsFor(io, gameId, updated);
    broadcastPlayers(gameId);
    res.json(updated);
  });

  game.post('/game/start', (req, res) => {
    const { gameId } = req.params;
    stateModule.startGame(gameId);
    playersModule.regenerateGrids(gameId);
    broadcastState(gameId);
    broadcastPlayers(gameId);
    broadcastTicketsDealt(gameId);
    res.json(publicState(gameId));
  });

  game.post('/game/draw', (req, res) => {
    const { gameId } = req.params;
    let drawResult;
    try {
      drawResult = stateModule.drawNumber(gameId);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const { state, number } = drawResult;

    // Marking (not drawing) is what completes a line now, so the only
    // thing left to check here is whether the pool itself is exhausted.
    if (state.currentIndex + 1 >= stateModule.MAX_NUMBER) {
      state.status = 'ended';
      stateModule.save(gameId, state);
    }

    io.to(`game:${gameId}`).emit('number-drawn', { number, totalDrawn: state.currentIndex + 1 });
    broadcastState(gameId);
    broadcastPlayers(gameId); // drawing can change who's "close" (blink availability)
    res.json(publicState(gameId));
  });

  game.post('/game/reset', (req, res) => {
    const { gameId } = req.params;
    stateModule.resetGame(gameId);
    playersModule.regenerateGrids(gameId);
    io.to(`game:${gameId}`).emit('game-reset', {});
    broadcastState(gameId);
    broadcastPlayers(gameId);
    broadcastTicketsDealt(gameId);
    res.json(publicState(gameId));
  });

  return game;
}

module.exports = { gameRouter, publicState, playerSummaries };
