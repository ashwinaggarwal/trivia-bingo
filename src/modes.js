const MODES = ['bingo', 'fastest-finger'];
const DEFAULT_MODE = 'bingo';

function modeExists(mode) {
  return MODES.includes(mode);
}

module.exports = { MODES, DEFAULT_MODE, modeExists };
