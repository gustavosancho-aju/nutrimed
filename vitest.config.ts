import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000, // PGlite (Postgres WASM) tem init mais lento na 1ª execução
  },
});
