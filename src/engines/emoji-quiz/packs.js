const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'emoji-quiz');
const DEFAULT_PACK = 'hollywood';

function bankFile(pack) {
  return path.join(PACKS_DIR, pack, 'questions.json');
}

function packExists(pack) {
  return typeof pack === 'string' && pack && fs.existsSync(bankFile(pack));
}

function getQuestions(pack) {
  if (!packExists(pack)) return [];
  return JSON.parse(fs.readFileSync(bankFile(pack), 'utf8'));
}

// All available packs, for presenting a choice when creating a game. Each
// pack directory just needs a questions.json and an optional meta.json
// ({ name, description }) — see data/emoji-quiz/hollywood/.
function listPacks() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs
    .readdirSync(PACKS_DIR)
    .filter((slug) => packExists(slug))
    .map((slug) => {
      const metaFile = path.join(PACKS_DIR, slug, 'meta.json');
      const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
      return { pack: slug, name: meta.name || slug, description: meta.description || '' };
    });
}

module.exports = { listPacks, getQuestions, packExists, DEFAULT_PACK };
