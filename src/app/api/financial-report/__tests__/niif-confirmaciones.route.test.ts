/**
 * POST /api/financial-report/niif — confirmaciones del usuario (P4, pendiente
 * #4 de la auditoría integral 2026-09-24).
 *
 *  - (a) `unitMultiplier`: un balance que declara "en miles de pesos" sigue
 *    respondiendo 422 sin confirmación; con 1000 el servidor reexpresa en
 *    centavos exactos y el prompt recibe los totales en pesos. La directiva que
 *    ya trae `rawData` (upload con confirmación) produce lo mismo; un campo que
 *    la contradice es 422, nunca se elige en silencio.
 *  - (b) `maturityOverrides`: excepciones de vencimiento por cuenta, validadas
 *    (400 si el código no es de activo o pasivo) y reveladas en el bloque
 *    vinculante.
 *
 * Sólo se sustituye el LLM por un centinela que captura el prompt.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const captured: Array<{ agentName: string; system: string; userContent: string }> = [];

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));
vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: async () => {
    throw new Error('sin DB');
  },
  getCurrentWorkspaceId: async () => null,
}));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (args: { agentName: string; system: string; userContent: string }) => {
    captured.push({ agentName: args.agentName, system: args.system, userContent: String(args.userContent) });
    throw new Error('SENTINEL: LLM no invocado en la prueba');
  }),
}));

import { escribirDirectivasIngesta } from '@/lib/upload/ingest-directives';

const { POST: niifPOST } = await import('@/app/api/financial-report/niif/route');

const COMPANY = {
  name: 'Demo SAS',
  nit: '900123456',
  entityType: 'SAS',
  niifGroup: 2,
  fiscalPeriod: '2025',
  comparativePeriod: '',
};

// Libros cerrados en MILES de pesos: A 200.000 = P 80.000 + K 120.000 (miles).
const CSV_MILES = [
  'codigo,nombre,nivel,Saldo 2025 (miles de pesos)',
  '110505,Caja,Auxiliar,50000',
  '130505,Clientes,Auxiliar,40000',
  '143505,Mercancias,Auxiliar,60000',
  '152405,Equipo de oficina,Auxiliar,50000',
  '210505,Crédito bancario a 3 años,Auxiliar,30000',
  '230505,Cxp,Auxiliar,30000',
  '240405,Renta,Auxiliar,20000',
  '311505,Capital,Auxiliar,100000',
  '360505,Utilidad del ejercicio,Auxiliar,20000',
  '410505,Ventas,Auxiliar,200000',
  '417505,Devoluciones,Auxiliar,10000',
  '510505,Sueldos,Auxiliar,20000',
  '530505,Intereses,Auxiliar,10000',
  '613505,CMV,Auxiliar,140000',
].join('\n');

async function callNiif(body: Record<string, unknown>) {
  const res = await niifPOST(
    new Request('http://localhost/api/financial-report/niif', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: COMPANY, language: 'es', instructions: '', ...body }),
    }),
  );
  const text = await res.text();
  let json: { reasons?: string[]; details?: string[] } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function pass1Prompt(): string {
  const p = captured.find((c) => c.agentName === 'niif-analyst-pass1');
  expect(p).toBeDefined();
  return `${p!.system}\n${p!.userContent}`;
}

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
beforeEach(() => {
  captured.length = 0;
});

describe('/niif — unidad confirmada (P4-a)', () => {
  it('sin confirmación: 422 con la unidad detectada, sin llamar al LLM', async () => {
    const r = await callNiif({ rawData: CSV_MILES });
    expect(r.status).toBe(422);
    expect(r.json!.reasons!.join(' ')).toMatch(/declara las cifras en miles de pesos/);
    expect(captured).toHaveLength(0);
  });

  it('unitMultiplier=1000: el gate pasa y el prompt recibe los totales en pesos', async () => {
    await callNiif({ rawData: CSV_MILES, unitMultiplier: 1000 });
    const prompt = pass1Prompt();
    expect(prompt).toContain('TOTALES VINCULANTES');
    expect(prompt).toMatch(/200\.000\.000/);
    // El texto que leen los agentes declara la unidad confirmada.
    expect(prompt).toContain('[unidad-confirmada=miles]');
  });

  it('la directiva de rawData (upload con confirmación) equivale al campo; una contradicción es 422', async () => {
    const rawData = escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles' });
    await callNiif({ rawData });
    expect(pass1Prompt()).toMatch(/200\.000\.000/);

    captured.length = 0;
    const conflicto = await callNiif({ rawData, unitMultiplier: 1000000 });
    expect(conflicto.status).toBe(422);
    expect(conflicto.json!.reasons!.join(' ')).toMatch(/no coinciden/);
    expect(captured).toHaveLength(0);
  });

  it('unitMultiplier inválido: 400', async () => {
    const r = await callNiif({ rawData: CSV_MILES, unitMultiplier: 100 });
    expect(r.status).toBe(400);
    expect(r.json!.details!.join(' ')).toMatch(/unitMultiplier/);
  });
});

describe('/niif — excepciones de vencimiento (P4-b)', () => {
  it('maturityOverrides válido: la excepción llega al bloque vinculante', async () => {
    await callNiif({
      rawData: CSV_MILES,
      unitMultiplier: 1000,
      maturityOverrides: { '2105': 'no_corriente' },
    });
    const prompt = pass1Prompt();
    expect(prompt).toMatch(/Excepciones por vencimiento DECLARADAS por el usuario/);
    expect(prompt).toMatch(/210505 \(pasivo\) → no corriente \$30\.000\.000/);
  });

  it('código fuera de las clases 1 y 2 o plazo desconocido: 400', async () => {
    const r1 = await callNiif({ rawData: CSV_MILES, maturityOverrides: { '4135': 'corriente' } });
    expect(r1.status).toBe(400);
    const r2 = await callNiif({ rawData: CSV_MILES, maturityOverrides: { '2105': 'largo_plazo' } });
    expect(r2.status).toBe(400);
  });
});
