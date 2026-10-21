const fs = require('fs');
const path = require('path');

const GAME_TYPES_DIR = path.join(__dirname, '..', '..', '..', 'data', 'game-type');
const DEFAULT_GAME_TYPE = 'diwali';

function bankFile(gameType) {
  return path.join(GAME_TYPES_DIR, gameType, 'questions.json');
}

function gameTypeExists(gameType) {
  return typeof gameType === 'string' && gameType && fs.existsSync(bankFile(gameType));
}

// Full bank for a game type: { gameType, name, description, questions }.
function getBank(gameType) {
  if (!gameTypeExists(gameType)) return null;
  return JSON.parse(fs.readFileSync(bankFile(gameType), 'utf8'));
}

// All available game types, for presenting a choice when creating a game.
function listGameTypes() {
  if (!fs.existsSync(GAME_TYPES_DIR)) return [];
  return fs
    .readdirSync(GAME_TYPES_DIR)
    .filter((slug) => gameTypeExists(slug))
    .map((slug) => {
      const bank = getBank(slug);
      return {
        gameType: bank.gameType || slug,
        name: bank.name || slug,
        description: bank.description || '',
      };
    });
}

module.exports = { listGameTypes, getBank, gameTypeExists, DEFAULT_GAME_TYPE };
