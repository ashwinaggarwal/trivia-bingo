// Turns one sub-game's final state into { subPlayerId: points } — the
// only place Party Night's per-engine scoring rules live. Requires each
// sub-engine's routes/state/players modules directly, same reasoning as
// sub-engines.js (no cycle through the central registry).
const triviaBingoRoutes = require('../trivia-bingo/routes');
const fastestFingerRoutes = require('../fastest-finger/routes');
const emojiQuizRoutes = require('../emoji-quiz/routes');
const guessTheNumberRoutes = require('../guess-the-number/routes');
const tambolaState = require('../tambola/state');
const tambolaPlayers = require('../tambola/players');

// 1st through 8th; anyone beyond that still gets the last entry (1 point)
// rather than 0, so simply finishing a round always counts for something
// — except a player who scored literally nothing, see rankByMetric below.
const PLACEMENT_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

// A player who scored zero (no correct answers, no points at all) gets
// only this, regardless of what place that zero would otherwise land
// them in — e.g. being the only other player in the game doesn't make a
// zero score worth 2nd-place points. Matches Tambola's own "won nothing"
// tier (see scoreTambola).
const ATTENDANCE_POINTS = 2;

function pointsForPlace(place) {
  return PLACEMENT_POINTS[place - 1] ?? PLACEMENT_POINTS[PLACEMENT_POINTS.length - 1];
}

// Ranks players by a numeric metric, descending, with standard competition
// ranking: players tied on the metric share the same place, and the next
// distinct value drops to the place *after* everyone the tie covered (two
// players tied for 1st both score the 1st-place points; the next distinct
// score is worth 3rd-place points, not 2nd — nothing is awarded twice).
// Players stuck at zero are pulled out first and flatly given
// ATTENDANCE_POINTS instead of being ranked — scoring literally nothing
// shouldn't ever be worth more than showing up.
function rankByMetric(players, metricFn) {
  const scored = players.filter((p) => metricFn(p) > 0);
  const unscored = players.filter((p) => metricFn(p) <= 0);

  const sorted = scored.slice().sort((a, b) => metricFn(b) - metricFn(a));
  const points = {};
  let place = 0;
  let playersSeen = 0;
  let lastMetric = null;
  for (const player of sorted) {
    playersSeen += 1;
    const metric = metricFn(player);
    if (lastMetric === null || metric !== lastMetric) {
      place = playersSeen;
      lastMetric = metric;
    }
    points[player.id] = pointsForPlace(place);
  }
  for (const player of unscored) points[player.id] = ATTENDANCE_POINTS;
  return points;
}

// Tambola has no single numeric score — players win categories (Top/
// Middle/Bottom Line, Full House), possibly tied, possibly not at all. So
// this is tiered rather than rank-based: Full House winners score highest
// regardless of what else they won, a single-line winner (with no Full
// House) scores the middle tier, and everyone who played but won nothing
// still gets a consolation score for playing. Tiers don't stack — winning
// both a line and Full House only counts the better one.
function scoreTambola(subGameId) {
  const state = tambolaState.load(subGameId);
  const players = Object.values(tambolaPlayers.getAllPlayers(subGameId));
  const fullhouseWinners = new Set((state.winners.fullhouse || []).map((w) => w.playerId));
  const lineWinners = new Set(
    ['top', 'middle', 'bottom'].flatMap((category) =>
      (state.winners[category] || []).map((w) => w.playerId)
    )
  );

  const points = {};
  for (const player of players) {
    if (fullhouseWinners.has(player.id)) points[player.id] = PLACEMENT_POINTS[0];
    else if (lineWinners.has(player.id)) points[player.id] = 6;
    else points[player.id] = ATTENDANCE_POINTS;
  }
  return points;
}

// Returns { subPlayerId: points } for one sub-game, scored on whatever
// state exists at the moment this is called (the admin decides when a
// round is "done" — see routes.js's /round/:roundId/finish).
function scoreRound(engineSlug, subGameId) {
  switch (engineSlug) {
    case 'trivia-bingo':
      return rankByMetric(triviaBingoRoutes.playerSummaries(subGameId), (p) => p.correctCount || 0);
    case 'fastest-finger':
      return rankByMetric(fastestFingerRoutes.playerSummaries(subGameId), (p) => p.points || 0);
    case 'emoji-quiz':
      return rankByMetric(emojiQuizRoutes.playerSummaries(subGameId), (p) => p.points || 0);
    case 'guess-the-number':
      return rankByMetric(guessTheNumberRoutes.playerSummaries(subGameId), (p) => p.points || 0);
    case 'tambola':
      return scoreTambola(subGameId);
    default:
      throw new Error(`cannot score unknown engine "${engineSlug}"`);
  }
}

module.exports = { scoreRound, rankByMetric, PLACEMENT_POINTS, ATTENDANCE_POINTS };
