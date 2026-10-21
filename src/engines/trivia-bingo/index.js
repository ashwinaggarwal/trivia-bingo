const path = require('path');

const gameTypesModule = require('./gameTypes');
const modesModule = require('./modes');
const engineRoutes = require('./routes');

// Keep in sync with public/shared/theme.js's THEMES — this is just for the
// create-game form's dropdown labels, the actual in-game theming lives there.
const GAME_TYPE_EMOJI = { diwali: '🪔', bollywood: '🎬', geography: '🌍', flags: '🎌' };

// Generic shape the shared lobby renderer (public/shared/engine-lobby.js)
// turns into a dropdown per field.
function listCreateOptions() {
  return {
    fields: [
      {
        key: 'gameType',
        label: 'Game type',
        options: gameTypesModule.listGameTypes().map((gt) => ({
          value: gt.gameType,
          label: `${GAME_TYPE_EMOJI[gt.gameType] || '🎯'} ${gt.name}`,
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
  const gameType = (body.gameType || '').trim();
  const mode = (body.mode || '').trim();
  return {
    gameType: gameTypesModule.gameTypeExists(gameType)
      ? gameType
      : gameTypesModule.DEFAULT_GAME_TYPE,
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
