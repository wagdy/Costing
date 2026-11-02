import { defineConfig } from 'vitest/config';

// The costing screens' specs render whole forms (the day's purchase batch, a recipe card) in jsdom:
// on a busy machine one can take longer than vitest's 5 seconds.
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});
