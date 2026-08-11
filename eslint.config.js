import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The engine must stay pure: no I/O, no ambient clock, no ambient randomness,
 * no DOM. That property is what lets the same code act as server authority,
 * as browser-side prediction and as the inner loop of bot search. It is not a
 * style preference, so it is enforced here rather than in review.
 */
const purity = {
  'no-restricted-globals': [
    'error',
    { name: 'Math', message: 'Engine must not use Math.random(); take randomness from GameState.rng.' },
    { name: 'Date', message: 'Engine must be timeless; the server owns clocks.' },
    { name: 'process', message: 'Engine must not touch the environment.' },
    { name: 'console', message: 'Engine must not perform I/O.' },
    { name: 'window', message: 'Engine must be isomorphic.' },
    { name: 'document', message: 'Engine must be isomorphic.' },
    { name: 'crypto', message: 'Engine must be deterministic; use GameState.rng.' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use nextU32(state.rng) instead.' },
    { object: 'Date', property: 'now', message: 'Engine must be timeless.' },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // --- Layer boundaries -----------------------------------------------------
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      ...purity,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/server/**', '**/client/**', '**/bots/**'], message: 'The engine depends on nothing but itself and shared types.' },
            { group: ['node:*', 'fastify*', 'react*'], message: 'The engine must stay dependency-free and isomorphic.' },
          ],
        },
      ],
    },
  },
  {
    // Bots see redacted PlayerViews only. Reaching into the server (which holds
    // the full GameState) would make cheating possible, so it is a lint error.
    files: ['src/bots/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/server/**', '**/client/**'], message: 'Bots must not see server state; they receive a PlayerView.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/server/**'], message: 'Client must talk to the server over the protocol, not by import.' }] },
      ],
    },
  },

  // --- Relaxations ----------------------------------------------------------
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.{ts,js}'],
    rules: { 'no-console': 'off' },
  },
  {
    // Plain-JS config files are outside the TS program, so the type-aware rules
    // have nothing to work from.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
