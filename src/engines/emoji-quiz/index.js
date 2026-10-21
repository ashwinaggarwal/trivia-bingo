const path = require('path');

const packsModule = require('./packs');
const engineRoutes = require('./routes');

function listCreateOptions() {
  return {
    fields: [
      {
        key: 'pack',
        label: 'Pack',
        options: packsModule.listPacks().map((p) => ({ value: p.pack, label: p.name })),
      },
    ],
  };
}

function createConfig(body) {
  const pack = (body.pack || '').trim();
  return { pack: packsModule.packExists(pack) ? pack : packsModule.DEFAULT_PACK };
}

module.exports = {
  slug: 'emoji-quiz',
  title: 'Emoji Movie Quiz',
  emoji: '🍿',
  tagline: 'Guess the movie from the emojis — fastest correct answer wins the point.',
  listCreateOptions,
  createConfig,
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  onTick: (io, gameId) => engineRoutes.tick(io, gameId),
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'emoji-quiz'),
};
