const path = require('path');
const http = require('http');

const express = require('express');
const { Server } = require('socket.io');

const { createRouter, startClock, playerSummaries } = require('./src/routes');
const { publicOrigin } = require('./src/network');
const presence = require('./src/presence');

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

// Character portraits, shown alongside hints and in player grids once an
// answer is revealed. Optional — not every answer has a matching image.
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// JS shared across the lobby/admin/game/player views (currently: per-game-type theming).
app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));

// Lobby: list/create games.
app.use('/admin', express.static(path.join(__dirname, 'public', 'lobby')));

// Per-game admin console. Mounted before the :gameId route below so static
// assets (app.js, style.css) resolve first; a request for the bare gameId
// path falls through to the explicit route, which always serves the same
// index.html regardless of which game is being administered.
app.use('/admin/game', express.static(path.join(__dirname, 'public', 'admin')));
app.get('/admin/game/:gameId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.use('/player', express.static(path.join(__dirname, 'public', 'player')));
app.get('/player/:gameId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'index.html'));
});

app.use('/game', express.static(path.join(__dirname, 'public', 'game')));
app.get('/game/:gameId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game', 'index.html'));
});

app.get('/', (req, res) => res.redirect('/admin'));

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
  console.log('Trivia Bingo is running:');
  console.log(`  Lobby (create/manage games): ${publicOrigin(PORT)}/admin`);
  console.log('');
  console.log('Each game has its own admin console, shared game screen, and player join QR code.');
  console.log('Create a game from the lobby to get its links and QR code.');
  console.log('');
});
