import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// NOTE: @workflow/vitest does not yet exist as a published package (as of 2026-05).
// The @workflow suite publishes @workflow/vite (hot-update plugin for dev server)
// but has no separate vitest plugin. When Vercel Workflow ships one, import it here:
//   import { workflow } from '@workflow/vitest';
//   plugins: [tsconfigPaths(), workflow()],
//
// For now the integration config is wired with tsconfigPaths only, so the team
// can drop `.integration.test.ts` files and run them with:
//   npm run test:integration

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/__tests__/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
