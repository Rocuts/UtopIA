// ---------------------------------------------------------------------------
// openapi.ts — documento OpenAPI 3.1.2 generado desde los schemas Zod +
// guard anti-drift: cada route.ts de /api/v1 debe estar declarado en paths.
// (Lección del repo: "duplicación sin sincronizar" es la causa raíz #1.)
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument, OPENAPI_PATHS } from '../openapi';

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  webhooks: Record<string, unknown>;
  components: { securitySchemes: Record<string, unknown> };
};

const doc = buildOpenApiDocument() as OpenApiDoc;

describe('buildOpenApiDocument', () => {
  it('declara OpenAPI 3.1.2 con info y seguridad bearer', () => {
    expect(doc.openapi).toBe('3.1.2');
    expect(doc.info.title).toBeTruthy();
    expect(doc.components.securitySchemes).toHaveProperty('apiKey');
  });

  it('contiene todos los paths del catálogo', () => {
    for (const p of OPENAPI_PATHS) {
      expect(doc.paths, `falta ${p} en paths`).toHaveProperty([p]);
    }
  });

  it('documenta los webhooks salientes (bloque webhooks de 3.1)', () => {
    expect(Object.keys(doc.webhooks)).toEqual(
      expect.arrayContaining(['ping', 'trial_balance.processed']),
    );
  });

  it('serializa a JSON sin throw (sin bigint ni ciclos)', () => {
    expect(() => JSON.stringify(doc)).not.toThrow();
  });
});

describe('anti-drift rutas ↔ contrato', () => {
  const V1_DIR = join(process.cwd(), 'src/app/api/v1');

  function routeDirs(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...routeDirs(full, `${prefix}/${entry}`));
      } else if (entry === 'route.ts') {
        out.push(prefix);
      }
    }
    return out;
  }

  it('cada route.ts de /api/v1 está declarado en OPENAPI_PATHS', () => {
    if (!existsSync(V1_DIR)) return; // Task 14 crea las rutas; hasta entonces no aplica
    const EXCLUDED = new Set(['/docs', '/openapi.json']); // meta-rutas del propio contrato
    const declared = new Set<string>(OPENAPI_PATHS);
    for (const route of routeDirs(V1_DIR)) {
      if (EXCLUDED.has(route)) continue;
      const asOpenApi = `/v1${route.replace(/\[([^\]]+)\]/g, '{$1}')}`;
      expect(declared.has(asOpenApi), `ruta ${route} sin entrada OpenAPI (${asOpenApi})`).toBe(
        true,
      );
    }
  });
});
