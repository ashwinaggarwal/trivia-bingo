const path = require('path');

const engineRoutes = require('./routes');

module.exports = {
  slug: 'guess-the-number',
  title: 'Guess the Number',
  emoji: '🔢',
  tagline: 'Guess closest to the real number to score — first to 20 points wins.',
  // Nothing to configure before creating a game (one fixed question pool),
  // so the shared lobby renders a single "Start Game" card for this engine.
  listCreateOptions: () => ({ fields: [] }),
  createConfig: () => ({}),
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  // No auto-reveal timer — a question reveals once everyone's answered (or
  // the admin forces it), not on a clock, so this engine has nothing to
  // catch up on a tick.
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'guess-the-number'),
};
