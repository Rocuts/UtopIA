import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Next.js `server-only` sentinel — alias to a no-op module under Vitest
      // (which has no client/server split). Without this, files that transitively
      // import 'server-only' (e.g. signatories.ts → fiscal-opinion → compose.ts
      // in pdf-elite-react) fail to load in the test runner with
      // "Cannot find package 'server-only'".
      'server-only': fileURLToPath(new URL('./src/__mocks__/server-only.ts', import.meta.url)),
    },
  },
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
