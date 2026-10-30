import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(totalCount|featuresJson|passwordHash)$', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  { ignores: ['node_modules/', 'experiment-results/'] },
];
