const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'trivia-bingo');
const DEFAULT_PACK = 'diwali';

function bankFile(pack) {
  return path.join(PACKS_DIR, pack, 'questions.json');
}

function packExists(pack) {
  return typeof pack === 'string' && pack && fs.existsSync(bankFile(pack));
}

// Full bank for a pack: { pack, name, description, questions }.
function getBank(pack) {
  if (!packExists(pack)) return null;
  return JSON.parse(fs.readFileSync(bankFile(pack), 'utf8'));
}

// All available packs, for presenting a choice when creating a game.
function listPacks() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs
    .readdirSync(PACKS_DIR)
    .filter((slug) => packExists(slug))
    .map((slug) => {
      const bank = getBank(slug);
      return {
        pack: bank.pack || slug,
        name: bank.name || slug,
        description: bank.description || '',
      };
    });
}

module.exports = { listPacks, getBank, packExists, DEFAULT_PACK };
