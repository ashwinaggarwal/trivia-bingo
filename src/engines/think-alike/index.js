const path = require('path');

const engineRoutes = require('./routes');

module.exports = {
  slug: 'think-alike',
  title: 'Think Alike',
  emoji: '🧠',
  tagline: 'Name something for each prompt — match the group to score.',
  // Nothing to configure before creating a game (no pack/mode choice),
  // so the shared lobby renders no dropdowns for this engine.
  listCreateOptions: () => ({ fields: [] }),
  createConfig: () => ({}),
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  // No auto-reveal timer — the admin manually advances/reveals each round,
  // so this engine has nothing to catch up on a clock tick.
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'think-alike'),
};
