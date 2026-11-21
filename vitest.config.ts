import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
    setupFiles: ['server/test/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000
  }
});
