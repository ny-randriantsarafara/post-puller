import { defineConfig } from 'vitest/config';

// Kept out of vite.config.ts so running the unit tests does not instantiate the
// crxjs plugin, which exists to build an extension and has nothing to offer here.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
