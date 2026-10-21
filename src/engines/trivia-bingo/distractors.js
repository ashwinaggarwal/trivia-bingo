const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'trivia-bingo');

// Bank-static files (distractor-pool.json / answer-types.json) never change
// while the server is running, so they're read once per pack and cached.
const poolCache = new Map();
const answerTypesCache = new Map();

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadPool(pack) {
  if (!poolCache.has(pack)) {
    poolCache.set(pack, readJsonIfExists(path.join(PACKS_DIR, pack, 'distractor-pool.json')) || {});
  }
  return poolCache.get(pack);
}

function loadAnswerTypes(pack) {
  if (!answerTypesCache.has(pack)) {
    answerTypesCache.set(
      pack,
      readJsonIfExists(path.join(PACKS_DIR, pack, 'answer-types.json')) || {}
    );
  }
  return answerTypesCache.get(pack);
}

function normalize(str) {
  return String(str || '')
    .trim()
    .toLowerCase();
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const n = normalize(item);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(item);
  }
  return out;
}

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Which distractor-pool bucket a question draws from. Diwali's and flags'
// `category` fields already group answers by shape (person/place/object/...,
// or just "Country" for every flag question), so they're used directly.
// Bollywood and geography needed a separate per-question classification
// (answer-types.json) because their `category` describes the question's
// theme, not the answer's shape — e.g. bollywood's "Chartbuster Tracks"
// category mixes movie titles, person names, and full phrases.
// Returns null for a question that can't support multiple choice (no bucket,
// or explicitly classified as a free-form "phrase" answer).
function bucketFor(pack, question, answerTypes) {
  if (pack === 'diwali' || pack === 'flags') return question.category || null;
  const type = answerTypes[question.id];
  if (!type || type === 'phrase') return null;
  return type;
}

function isEligibleForFastestFinger(pack, question) {
  return bucketFor(pack, question, loadAnswerTypes(pack)) !== null;
}

// Builds 4 shuffled options (the correct answer + 3 distractors) for one
// question. Distractors come from a theme-specific, web-researched pool
// (data/trivia-bingo/<pack>/distractor-pool.json) rather than other
// questions' answers in this bank — a pool sourced only from the bank thins
// out fast and becomes guessable by elimination after a few questions.
// Every candidate is still filtered against every answer actually in play
// in this game, so a "wrong" option can never turn out to be a different
// question's real answer.
function buildOptionsForQuestion(pack, question, allQuestionsInGame) {
  const answerTypes = loadAnswerTypes(pack);
  const bucket = bucketFor(pack, question, answerTypes);
  if (!bucket) throw new Error(`question ${question.id} has no distractor bucket`);

  const pool = loadPool(pack);
  const bankAnswers = new Set(allQuestionsInGame.map((q) => normalize(q.answer)));
  const correctNormalized = normalize(question.answer);

  const filterCandidates = (list) =>
    (list || []).filter((c) => {
      const n = normalize(c);
      return n && n !== correctNormalized && !bankAnswers.has(n);
    });

  let candidates = dedupe(filterCandidates(pool[bucket]));

  if (candidates.length < 3) {
    // Widen to every bucket in this theme's pool rather than leaving the
    // round short a question — should be rare given each bucket was
    // researched to a few dozen entries.
    candidates = dedupe([...candidates, ...filterCandidates(Object.values(pool).flat())]);
  }

  if (candidates.length < 3) {
    // Last-resort fallback: other in-bank answers of the same bucket.
    const sameBucketBankAnswers = allQuestionsInGame
      .filter((q) => q.id !== question.id && bucketFor(pack, q, answerTypes) === bucket)
      .map((q) => q.answer);
    candidates = dedupe([...candidates, ...filterCandidates(sameBucketBankAnswers)]);
  }

  if (candidates.length < 3) {
    throw new Error(`not enough distractors available for question ${question.id}`);
  }

  const distractors = shuffle(candidates).slice(0, 3);
  const options = shuffle([question.answer, ...distractors]);
  return { options, correctIndex: options.indexOf(question.answer) };
}

module.exports = { isEligibleForFastestFinger, buildOptionsForQuestion };
