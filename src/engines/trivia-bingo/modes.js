const MODES = ['bingo', 'fastest-finger'];
const DEFAULT_MODE = 'bingo';
const MODE_LABELS = { bingo: '🎯 Bingo', 'fastest-finger': '⚡ Fastest Finger' };

function modeExists(mode) {
  return MODES.includes(mode);
}

module.exports = { MODES, DEFAULT_MODE, MODE_LABELS, modeExists };
