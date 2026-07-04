import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@packages/shared/constants': path.resolve(
        packageDir,
        '../shared/constants/index.ts',
      ),
      '@packages/shared/types': path.resolve(
        packageDir,
        '../shared/types/index.ts',
      ),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/bench/**'],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
