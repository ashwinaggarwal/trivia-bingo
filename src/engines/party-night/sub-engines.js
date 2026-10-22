// A small, local mirror of src/engines/index.js's registry, listing only
// the "playable" engines a Party Night round can launch (every real engine
// except party-night itself — it can't contain itself). This exists
// separately from the real registry because src/engines/index.js requires
// this engine (party-night) to build its own ENGINES array; if this file
// required that registry back, Node's circular-require handling would
// hand back an incomplete, still-being-built module. Requiring each
// sub-engine's own index.js directly (as the real registry does) has no
// such cycle.
const triviaBingo = require('../trivia-bingo');
const fastestFinger = require('../fastest-finger');
const emojiQuiz = require('../emoji-quiz');
const tambola = require('../tambola');
const guessTheNumber = require('../guess-the-number');

const SUB_ENGINES = [triviaBingo, fastestFinger, emojiQuiz, tambola, guessTheNumber];
const BY_SLUG = new Map(SUB_ENGINES.map((e) => [e.slug, e]));

function list() {
  return SUB_ENGINES;
}

function get(slug) {
  return BY_SLUG.get(slug) || null;
}

module.exports = { list, get };
