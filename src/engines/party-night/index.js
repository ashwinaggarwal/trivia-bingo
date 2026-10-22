const path = require('path');

const engineRoutes = require('./routes');

module.exports = {
  slug: 'party-night',
  title: 'Party Night',
  emoji: '🎉',
  tagline: 'A whole night of games, one scoreboard — admin picks what’s next.',
  // Nothing to configure before creating a night — the admin picks games
  // (and each one's own options) from inside the night itself, not here.
  listCreateOptions: () => ({ fields: [] }),
  createConfig: () => ({}),
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'party-night'),
};
