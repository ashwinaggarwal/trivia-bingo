const path = require('path');

const engineRoutes = require('./routes');

// The shared lobby (public/shared/engine-lobby.js) renders this as two
// pack-style cards instead of the usual single "Start Game" card — pick
// one to create a game already in that mode; it can't be changed after
// creation (see createConfig).
function listCreateOptions() {
  return {
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        options: [
          {
            value: 'digital',
            label: 'Digital Tickets',
            emoji: '📱',
            description: 'Players join on their phones and get real tickets to mark themselves.',
          },
          {
            value: 'physical',
            label: 'Physical Tickets',
            emoji: '🎫',
            description:
              'Admin just calls numbers on the TV — everyone plays with their own paper tickets, no joining.',
          },
        ],
      },
    ],
  };
}

// Defaults to 'digital' for anything else (missing field, a stale config
// from before this mode existed, a typo) rather than rejecting the
// request outright.
function createConfig(body) {
  return { mode: body.mode === 'physical' ? 'physical' : 'digital' };
}

module.exports = {
  slug: 'tambola',
  title: 'Tambola',
  emoji: '🎟️',
  tagline: '90-number bingo — complete a line to win, three ways to win.',
  listCreateOptions,
  createConfig,
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  // No auto-reveal timer — the admin manually draws each number, so this
  // engine has nothing to catch up on a clock tick.
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'tambola'),
};
