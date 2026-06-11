import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.*',
      '.aiox-core/**',
      '.claude/**',
      '.github/**',
      'docs/**',
      '**/*.cjs',
    ],
  },
  {
    // Lint só o código do produto (monorepo TypeScript).
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
);
