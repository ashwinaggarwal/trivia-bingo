// Per-game-type theming shared by the admin, game, and player views. Each
// view's own style.css defines the actual color overrides, keyed off the
// `data-theme` attribute this sets on <html> — see the `:root[data-theme="..."]`
// blocks there. applyTheme() also swaps the hardcoded header/gameover text on
// any page that has #header-title / #gameover-title elements.
/* exported applyTheme, themeFor */
const THEMES = {
  diwali: { emoji: '🪔', label: 'Diwali Trivia Bingo' },
  geography: { emoji: '🌍', label: 'Geography Trivia Bingo' },
  flags: { emoji: '🎌', label: 'Guess the Flag' },
};
const DEFAULT_THEME = 'diwali';

function themeFor(gameType) {
  return THEMES[gameType] || THEMES[DEFAULT_THEME];
}

function applyTheme(gameType) {
  const theme = themeFor(gameType);
  document.documentElement.dataset.theme = THEMES[gameType] ? gameType : DEFAULT_THEME;

  const headerTitle = document.getElementById('header-title');
  if (headerTitle) {
    const suffix = headerTitle.dataset.suffix ? ` ${headerTitle.dataset.suffix}` : '';
    const trailingEmoji = headerTitle.dataset.wrap === 'true' ? ` ${theme.emoji}` : '';
    headerTitle.textContent = `${theme.emoji} ${theme.label}${suffix}${trailingEmoji}`;
  }

  const gameoverTitle = document.getElementById('gameover-title');
  if (gameoverTitle) gameoverTitle.textContent = `${theme.emoji} GAME OVER ${theme.emoji}`;

  return theme;
}
