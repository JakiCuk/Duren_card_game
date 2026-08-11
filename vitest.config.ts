import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // The engine's invariant suites deliberately run thousands of games.
    testTimeout: 30_000,
  },
});
