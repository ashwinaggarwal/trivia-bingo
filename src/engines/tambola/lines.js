// Each player gets three separate 3x5 tickets (15 cells each: row * 5 +
// col), not one big grid — matches a real tambola ticket's row structure.
// "Lines" are grouped by category; within a category, completing the
// matching cells on *any one* of a player's three tickets counts — real
// tambola lets you win Top/Middle/Bottom/Full House on any ticket you hold.
const GRID_ROWS = 3;
const GRID_COLS = 5;
const GRID_CELLS = GRID_ROWS * GRID_COLS; // 15
const GRIDS_PER_PLAYER = 3;

const ROW_CELLS = {
  top: [0, 1, 2, 3, 4],
  middle: [5, 6, 7, 8, 9],
  bottom: [10, 11, 12, 13, 14],
};
const FULL_HOUSE_CELLS = Array.from({ length: GRID_CELLS }, (_, i) => i);

const CATEGORIES = ['top', 'middle', 'bottom', 'fullhouse'];

function cellsFor(category) {
  return category === 'fullhouse' ? FULL_HOUSE_CELLS : ROW_CELLS[category];
}

module.exports = { GRID_ROWS, GRID_COLS, GRID_CELLS, GRIDS_PER_PLAYER, CATEGORIES, cellsFor };
