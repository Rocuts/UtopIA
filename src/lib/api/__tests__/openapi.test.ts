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

// niif-preproceso-07 (IW2): el esquema publicado cubre los campos que el API
// ya serializa (summarize / serializeTrialBalanceDetail en trial-balances.ts).
describe('TrialBalance — contrato de respuesta alineado con la serialización', () => {
  type Schema = {
    properties: Record<string, { description?: string; properties?: Record<string, unknown>; enum?: unknown[] }>;
    description?: string;
  };
  const schemas = (doc as unknown as { components: { schemas: Record<string, Schema & { allOf?: Schema[] }> } })
    .components.schemas;
  const tb = schemas.TrialBalance;

  it('declara sign_convention (natural | algebraica | null)', () => {
    expect(tb.properties.sign_convention.enum).toEqual(['natural', 'algebraica', null]);
  });

  it('control_totals declara los ajustes del curador y documenta equation_delta', () => {
    const ct = tb.properties.control_totals.properties as Record<string, { description?: string }>;
    for (const k of ['virtual_close_adjustment', 'reclassified_from_3605', 'equity_anchor_adjustment']) {
      expect(ct, k).toHaveProperty(k);
    }
    expect(ct.equation_delta.description).toMatch(/archivo de origen/);
    expect(ct.equation_delta.description).toMatch(/Cierre Virtual/);
  });

  it('status=unbalanced cubre también los motivos de integridad', () => {
    expect(tb.properties.status.description).toMatch(/integridad/);
  });

  it('el detalle (GET /v1/trial-balances/{id}) declara validation_reasons', () => {
    const detail = schemas.TrialBalanceDetail;
    const extra = detail.allOf?.find((s) => s.properties?.validation_reasons);
    expect(extra?.properties.validation_reasons).toMatchObject({ type: 'array', items: { type: 'string' } });
    const get = (doc.paths['/v1/trial-balances/{id}'] as { get: { responses: { '200': { content: Record<string, { schema: { $ref: string } }> } } } }).get;
    expect(get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/TrialBalanceDetail');
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

// P4 (auditoría integral 2026-09-24, pendiente #4): parámetros opcionales de la
// remisión y campos nuevos del recurso, documentados desde los mismos schemas.
describe('TrialBalance — unit y maturity_overrides (tb-2026-09-24.3)', () => {
  type Json = Record<string, unknown> & { properties?: Record<string, Json>; description?: string; enum?: unknown[] };
  const schemas = (doc as unknown as { components: { schemas: Record<string, Json & { allOf?: Json[] }> } }).components
    .schemas;

  it('el request documenta `unit` (pesos | miles | millones) y `maturity_overrides`', () => {
    const create = schemas.TrialBalanceCreate;
    expect(create.properties!.unit.enum).toEqual(['pesos', 'miles', 'millones']);
    expect(create.properties!.unit.description).toMatch(/centavos exactos/);
    expect(create.properties!.maturity_overrides.description).toMatch(/corriente/);
  });

  it('el recurso declara `unit` y el detalle validation_notes y classification_note', () => {
    expect(schemas.TrialBalance.properties!.unit.properties).toHaveProperty('requires_confirmation');
    const extra = schemas.TrialBalanceDetail.allOf!.find((s) => s.properties?.validation_notes);
    expect(extra?.properties).toHaveProperty('classification_note');
  });
});
