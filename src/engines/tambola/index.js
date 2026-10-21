const path = require('path');

const engineRoutes = require('./routes');

module.exports = {
  slug: 'tambola',
  title: 'Tambola',
  emoji: '🎟️',
  tagline: '90-number bingo — complete a line to win, three ways to win.',
  // Nothing to configure before creating a game (one fixed 1-90 pool), so
  // the shared lobby renders a single "Start Game" card for this engine.
  listCreateOptions: () => ({ fields: [] }),
  createConfig: () => ({}),
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  // No auto-reveal timer — the admin manually draws each number, so this
  // engine has nothing to catch up on a clock tick.
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'tambola'),
};
