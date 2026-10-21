const fs = require('fs');
const path = require('path');

const gamesModule = require('../../games');
const poolModule = require('./pool');

function questionsFile(gameId) {
  return path.join(gamesModule.gameDir(gameId), 'questions.json');
}

// A game's question bank is a snapshot copied from the shared pool at
// creation time (see data/guess-the-number/questions.json), so admins can
// freely edit a single game's questions without touching the shared pool.
function seedFromPoolIfMissing(gameId) {
  const file = questionsFile(gameId);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(gamesModule.gameDir(gameId), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(poolModule.listQuestions(), null, 2), 'utf8');
}

function getQuestions(gameId) {
  seedFromPoolIfMissing(gameId);
  return JSON.parse(fs.readFileSync(questionsFile(gameId), 'utf8'));
}

function saveQuestions(gameId, questions) {
  if (!Array.isArray(questions)) throw new Error('questions must be an array');
  for (const q of questions) {
    if (!q.id || !q.question || !Number.isFinite(Number(q.answer))) {
      throw new Error('each question needs an id, question text, and a numeric answer');
    }
  }
  const normalized = questions.map((q) => ({ ...q, isYear: Boolean(q.isYear) }));
  fs.writeFileSync(questionsFile(gameId), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

module.exports = { getQuestions, saveQuestions };
