const triviaBingo = require('./trivia-bingo');
const fastestFinger = require('./fastest-finger');
const emojiQuiz = require('./emoji-quiz');
const tambola = require('./tambola');
const guessTheNumber = require('./guess-the-number');

// Add a new engine here once it has an index.js exporting the shape below —
// nothing else in src/ or server.js needs to change to pick it up.
const ENGINES = [triviaBingo, fastestFinger, emojiQuiz, tambola, guessTheNumber];

const BY_SLUG = new Map(ENGINES.map((e) => [e.slug, e]));

function list() {
  return ENGINES;
}

function get(slug) {
  return BY_SLUG.get(slug) || null;
}

function exists(slug) {
  return BY_SLUG.has(slug);
}

module.exports = { list, get, exists };
