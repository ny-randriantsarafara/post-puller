import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['@extractor/capture-core/testing/setup'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
