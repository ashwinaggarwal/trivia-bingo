const fs = require('fs');
const path = require('path');

const POOL_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'data',
  'guess-the-number',
  'questions.json'
);

function listQuestions() {
  if (!fs.existsSync(POOL_FILE)) return [];
  return JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
}

module.exports = { listQuestions };
