import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' }, // JSX runtime do React 19 (testes .tsx sem import React)
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/web/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 30000, // PGlite (Postgres WASM) tem init mais lento na 1ª execução
    hookTimeout: 30000, // beforeAll com PGlite também estoura os 10s default sob carga paralela
  },
});
