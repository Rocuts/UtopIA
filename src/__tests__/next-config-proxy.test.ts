// ---------------------------------------------------------------------------
// Guard: next.config.ts no puede citar `src/middleware.ts`
// ---------------------------------------------------------------------------
// POR QUE ESTE TEST EXISTE (modo de fallo real, PR #7):
// Next 16.2 renombro `middleware.ts` -> `proxy.ts`. Tener AMBOS archivos en el
// repo tumba el build de produccion (`next build` aborta). `src/middleware.ts`
// fue ELIMINADO y el CSP con nonce vive ahora en `src/proxy.ts`.
//
// El riesgo no es teorico: `next.config.ts` seguia documentando que "CSP is set
// per-request with nonces in src/middleware.ts". Un dev que lee ese comentario y
// va a buscar el archivo no lo encuentra, y el siguiente paso natural —
// recrearlo— rompe produccion. El comentario muerto ES la trampa.
//
// Este guard falla si vuelve a aparecer la referencia, o si alguien recrea el
// archivo.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('next.config.ts / proxy contract (Next 16)', () => {
  it('no cita src/middleware.ts (archivo eliminado; recrearlo tumba el build)', () => {
    const src = readFileSync(`${REPO_ROOT}next.config.ts`, 'utf8');
    expect(src).not.toContain('src/middleware.ts');
    expect(src).not.toMatch(/\bmiddleware\.ts\b/);
  });

  it('src/middleware.ts NO existe — el interceptor de request es src/proxy.ts', () => {
    expect(existsSync(`${REPO_ROOT}src/middleware.ts`)).toBe(false);
    expect(existsSync(`${REPO_ROOT}src/proxy.ts`)).toBe(true);
  });

  it('el CSP con nonce sigue viviendo en src/proxy.ts', () => {
    const proxy = readFileSync(`${REPO_ROOT}src/proxy.ts`, 'utf8');
    expect(proxy).toMatch(/Content-Security-Policy/i);
    expect(proxy).toMatch(/nonce/i);
  });
});
