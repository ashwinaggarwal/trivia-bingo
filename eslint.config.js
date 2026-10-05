const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['node_modules/', 'data/**/*.json', 'assets/images/'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        io: 'readonly',
        applyTheme: 'readonly',
        themeFor: 'readonly',
      },
    },
  },
  {
    files: ['public/shared/theme.js'],
    languageOptions: {
      globals: {
        applyTheme: 'off',
        themeFor: 'off',
      },
    },
  },
];
