const path = require('path');

const packsModule = require('./packs');
const engineRoutes = require('./routes');

// Keep in sync with public/shared/theme.js's THEMES — this is just for the
// create-game form's dropdown labels, the actual in-game theming lives there.
const PACK_EMOJI = { diwali: '🪔', bollywood: '🎬', geography: '🌍', flags: '🎌' };

// Generic shape the shared lobby renderer (public/shared/engine-lobby.js)
// turns into one pack card per option.
function listCreateOptions() {
  return {
    fields: [
      {
        key: 'pack',
        label: 'Pack',
        options: packsModule.listPacks().map((p) => ({
          value: p.pack,
          label: p.name,
          emoji: PACK_EMOJI[p.pack] || '🎯',
          description: p.description,
        })),
      },
    ],
  };
}

// Normalizes a create-game request body into this engine's `config` shape,
// falling back to the default pack if missing or invalid rather than
// rejecting the request outright.
function createConfig(body) {
  const pack = (body.pack || '').trim();
  return { pack: packsModule.packExists(pack) ? pack : packsModule.DEFAULT_PACK };
}

module.exports = {
  slug: 'fastest-finger',
  title: 'Fastest Finger',
  emoji: '⚡',
  tagline: 'Race to answer first — fastest correct guess wins the point.',
  listCreateOptions,
  createConfig,
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  onTick: (io, gameId) => engineRoutes.tick(io, gameId),
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'fastest-finger'),
};
