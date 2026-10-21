const path = require('path');
const http = require('http');

const express = require('express');
const { Server } = require('socket.io');

const { createRouter, startClock, playerSummaries } = require('./src/routes');
const { publicOrigin } = require('./src/network');
const presence = require('./src/presence');
const engines = require('./src/engines');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Needed so req.protocol/req.get('host') reflect the client-facing
// host/scheme (via X-Forwarded-Proto/Host) when deployed behind a PaaS's
// reverse proxy, instead of this container's internal view of the request.
// Safe here because the only place this app ever runs is behind a trusted
// single-hop proxy (the PaaS platform) or with no proxy at all (local/docker);
// it would be a spoofing risk if this server were ever exposed directly to
// untrusted traffic without a proxy in front translating those headers.
app.set('trust proxy', true);

app.use(express.json());
app.use('/api', createRouter(io));
startClock(io);

// Character portraits, flags, etc. shown by any engine. Optional — not every
// answer has a matching image.
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// JS shared across every engine's views (currently: per-pack theming).
app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));

// The shelf: pick a game, create or join an instance of it. Every engine's
// own admin/game/player views are mounted below, generically, from the
// engine registry — adding a new engine needs no changes here.
app.use('/', express.static(path.join(__dirname, 'public', 'shelf')));
app.get('/admin', (req, res) => res.redirect('/')); // old lobby URL

// One generic per-engine lobby page (create an instance, list/delete
// existing ones) shared by every engine — see public/shared/engine-lobby.js,
// which renders its create-form from GET /api/engines/:slug's `createOptions`.
app.get('/play/:slug', (req, res) => {
  if (!engines.exists(req.params.slug)) return res.status(404).send('Unknown game');
  res.sendFile(path.join(__dirname, 'public', 'shared', 'engine-lobby.html'));
});

for (const engine of engines.list()) {
  const base = `/play/${engine.slug}`;

  // Mounted before the :gameId route below so static assets (app.js,
  // style.css) resolve first; a request for the bare gameId path falls
  // through to the explicit route, which always serves the same index.html
  // regardless of which game instance is being administered/played/watched.
  app.use(`${base}/admin`, express.static(path.join(engine.staticDir, 'admin')));
  app.get(`${base}/admin/:gameId`, (req, res) =>
    res.sendFile(path.join(engine.staticDir, 'admin', 'index.html'))
  );

  app.use(`${base}/player`, express.static(path.join(engine.staticDir, 'player')));
  app.get(`${base}/player/:gameId`, (req, res) =>
    res.sendFile(path.join(engine.staticDir, 'player', 'index.html'))
  );

  app.use(`${base}/game`, express.static(path.join(engine.staticDir, 'game')));
  app.get(`${base}/game/:gameId`, (req, res) =>
    res.sendFile(path.join(engine.staticDir, 'game', 'index.html'))
  );
}

io.on('connection', (socket) => {
  // socket.identity, once set, is { gameId, playerId } — tracked per-socket so
  // disconnect can clean up presence without the client having to say who it was.
  socket.on('join-game', (gameId) => {
    if (typeof gameId === 'string' && gameId) socket.join(`game:${gameId}`);
  });

  socket.on('identify-player', ({ gameId, playerId } = {}) => {
    if (typeof gameId !== 'string' || !gameId || typeof playerId !== 'string' || !playerId) return;
    socket.identity = { gameId, playerId };
    presence.addSocket(gameId, playerId, socket.id);
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));
  });

  socket.on('disconnect', () => {
    if (!socket.identity) return;
    const { gameId, playerId } = socket.identity;
    presence.removeSocket(gameId, playerId, socket.id);
    io.to(`game:${gameId}`).emit('players-update', playerSummaries(gameId));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('Game Shelf is running:');
  console.log(`  ${publicOrigin(PORT)}/`);
  console.log('');
  console.log('Pick a game from the shelf to create or manage an instance of it.');
  console.log('');
});
