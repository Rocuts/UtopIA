import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

afterEach(() => vi.unstubAllEnvs());
describe('proxy uses the same authentication configuration as route handlers', () => {
  it.each(['BETTER_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRETS'])(
    '%s protects financial exports without a session', async name => {
      for (const key of ['BETTER_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRETS']) {
        vi.stubEnv(key, '');
      }
      vi.stubEnv(name, 'test-only-secret');
      const response = await proxy(new NextRequest('https://example.com/api/financial-report/export'));
      expect(response.status).toBe(401);
    },
  );
});
