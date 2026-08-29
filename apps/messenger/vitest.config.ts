import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['@extractor/capture-core/testing/setup'],
    // Playwright owns tests/e2e, so vitest must not collect it.
    include: ['src/**/*.test.ts'],
  },
});
