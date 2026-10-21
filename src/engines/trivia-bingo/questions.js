const fs = require('fs');
const path = require('path');

const gamesModule = require('../../games');
const gameTypesModule = require('./gameTypes');

function questionsFile(gameId) {
  return path.join(gamesModule.gameDir(gameId), 'questions.json');
}

// A game's question bank is a snapshot copied from its game type at creation
// time (see data/game-type/<slug>/questions.json), so admins can freely edit
// a single game's questions without touching the shared template. Games
// created before game types existed have no `gameType` in their meta — treat
// those as the original Diwali bank.
function seedFromGameTypeIfMissing(gameId) {
  const file = questionsFile(gameId);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(gamesModule.gameDir(gameId), { recursive: true });

  const game = gamesModule.getGame(gameId);
  const gameType = (game && game.gameType) || gameTypesModule.DEFAULT_GAME_TYPE;
  const bank =
    gameTypesModule.getBank(gameType) || gameTypesModule.getBank(gameTypesModule.DEFAULT_GAME_TYPE);
  const questions = bank ? bank.questions : [];
  fs.writeFileSync(file, JSON.stringify(questions, null, 2), 'utf8');
}

function getQuestions(gameId) {
  seedFromGameTypeIfMissing(gameId);
  return JSON.parse(fs.readFileSync(questionsFile(gameId), 'utf8'));
}

function saveQuestions(gameId, questions) {
  if (!Array.isArray(questions)) throw new Error('questions must be an array');
  for (const q of questions) {
    if (!q.id || !q.question || !q.answer) {
      throw new Error('each question needs id, question, and answer');
    }
  }
  fs.writeFileSync(questionsFile(gameId), JSON.stringify(questions, null, 2), 'utf8');
  return questions;
}

module.exports = { getQuestions, saveQuestions };
