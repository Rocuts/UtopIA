import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    exclude: [
      '**/*.integration.test.ts',
      '**/node_modules/**',
      '**/.next/**',
    ],
    environment: 'node',
    testTimeout: 10_000,
    globals: false,
  },
});
