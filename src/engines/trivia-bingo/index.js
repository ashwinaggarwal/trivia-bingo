const path = require('path');

const packsModule = require('./packs');
const modesModule = require('./modes');
const engineRoutes = require('./routes');

// Keep in sync with public/shared/theme.js's THEMES — this is just for the
// create-game form's dropdown labels, the actual in-game theming lives there.
const PACK_EMOJI = { diwali: '🪔', bollywood: '🎬', geography: '🌍', flags: '🎌' };

// Generic shape the shared lobby renderer (public/shared/engine-lobby.js)
// turns into a dropdown per field.
function listCreateOptions() {
  return {
    fields: [
      {
        key: 'pack',
        label: 'Pack',
        options: packsModule.listPacks().map((p) => ({
          value: p.pack,
          label: `${PACK_EMOJI[p.pack] || '🎯'} ${p.name}`,
        })),
      },
      {
        key: 'mode',
        label: 'Mode',
        options: modesModule.MODES.map((m) => ({
          value: m,
          label: modesModule.MODE_LABELS[m] || m,
        })),
      },
    ],
  };
}

// Normalizes a create-game request body into this engine's `config` shape,
// falling back to defaults for anything missing or invalid rather than
// rejecting the request outright.
function createConfig(body) {
  const pack = (body.pack || '').trim();
  const mode = (body.mode || '').trim();
  return {
    pack: packsModule.packExists(pack) ? pack : packsModule.DEFAULT_PACK,
    mode: modesModule.modeExists(mode) ? mode : modesModule.DEFAULT_MODE,
  };
}

module.exports = {
  slug: 'trivia-bingo',
  title: 'Trivia Bingo',
  emoji: '🎲',
  tagline: 'Answer trivia to fill your bingo card, or race for the fastest finger.',
  listCreateOptions,
  createConfig,
  gameRouter: engineRoutes.gameRouter,
  playerSummaries: engineRoutes.playerSummaries,
  onTick: (io, gameId) => engineRoutes.tick(io, gameId),
  staticDir: path.join(__dirname, '..', '..', '..', 'public', 'engines', 'trivia-bingo'),
};
