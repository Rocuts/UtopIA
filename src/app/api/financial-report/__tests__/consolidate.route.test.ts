/**
 * POST /api/financial-report/consolidate (pipeline-flujo-16).
 *
 * El camino partido que usa la UI no ejecutaba los gates post-render
 * (`validateConsolidatedReport` + `auditReportEmittable` con checks de texto);
 * sólo el orchestrator legacy, sin llamador en la UI. Este paso servidor los
 * aplica sobre el consolidado re-derivando el preprocesado desde rawData.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));

const { POST } = await import('../consolidate/route');

const COMPANY = {
  name: 'Demo SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  niifGroup: 2,
  fiscalPeriod: '2025',
};

// Balance cuadrado de un periodo: A = 1.000.000 = P 400.000 + K 600.000.
const CSV = [
  'codigo,nombre,saldo',
  '11050501,Caja general,150000',
  '11100501,Bancos,250000',
  '13050501,Clientes,100000',
  '15200101,Maquinaria,500000',
  '22050101,Proveedores,150000',
  '23359501,Otros,100000',
  '25050101,Salarios,50000',
  '24080101,IVA,100000',
  '31050501,Capital,400000',
  '33050501,Reserva legal,200000',
  '14350101,Mercancias,0',
].join('\n');

const NIIF_OK = [
  '## Estado de Situación Financiera',
  '| Concepto | 2025 |',
  '|---|---|',
  '| Total Activo | $1.000.000 |',
  '| Total Pasivo | $400.000 |',
  '| Total Patrimonio | $600.000 |',
  '',
  'Comparativos impracticables (NIIF para PYMES §3.14 y §10.21).',
].join('\n');
const STRATEGY_OK = 'Análisis estratégico. TTD (parágrafo 6 del art. 240 E.T.): N/D sin ID/UD verificados.';
const GOVERNANCE_OK = 'Acta de asamblea ordinaria.';

async function consolidate(body: unknown) {
  const res = await POST(
    new Request('http://localhost/api/financial-report/consolidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

type Result = {
  consolidatedReport: string;
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  emittability: { kind: string; blockers: Array<{ code: string; message: string }> };
};

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/financial-report/consolidate', () => {
  it('ensambla las tres partes y ejecuta los gates de texto: sin V8/V10/V15 cuando el texto cumple', async () => {
    const { status, json } = await consolidate({
      rawData: CSV,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: STRATEGY_OK,
      governanceContent: GOVERNANCE_OK,
    });
    expect(status).toBe(200);
    const r = json as unknown as Result;
    expect(r.consolidatedReport).toContain('# PARTE I:');
    expect(r.consolidatedReport).toContain('# PARTE III:');
    expect(r.validation.ok).toBe(true);
    expect(r.emittability.blockers.map((b) => b.code)).not.toContain('V8');
    expect(r.emittability.blockers.map((b) => b.code)).not.toContain('V10');
    // Single-period: comparativos impracticables declarados en el texto (§3.14).
    expect(r.emittability.blockers.map((b) => b.code)).not.toContain('V15');
  });

  it('validateConsolidatedReport corre: placeholders sin reemplazar → validation.ok=false', async () => {
    const { json } = await consolidate({
      rawData: CSV,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: STRATEGY_OK,
      governanceContent: 'Acta firmada el [Fecha] por [Presidente].',
    });
    const r = json as unknown as Result;
    expect(r.validation.ok).toBe(false);
    expect(r.validation.errors.join(' ')).toMatch(/Placeholders/);
  });

  it('auditReportEmittable corre SIN skip: V8 (IFRS 18 en Grupo 2) y V10 (sin TTD/TMT) bloquean', async () => {
    const { json } = await consolidate({
      rawData: CSV,
      company: COMPANY,
      language: 'es',
      niifContent: `${NIIF_OK}\nPresentación conforme a IFRS 18.`,
      strategyContent: 'Análisis estratégico sin mención tributaria.',
      governanceContent: GOVERNANCE_OK,
    });
    const r = json as unknown as Result;
    const codes = r.emittability.blockers.map((b) => b.code);
    expect(r.emittability.kind).toBe('no-emitible');
    expect(codes).toContain('V8');
    expect(codes).toContain('V10');
  });

  it('el preprocesado se re-deriva en servidor: la ecuación interna del texto se cruza con los totales vinculantes', async () => {
    const { json } = await consolidate({
      rawData: CSV,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK.replace('$1.000.000', '$1.500.000'),
      strategyContent: STRATEGY_OK,
      governanceContent: GOVERNANCE_OK,
    });
    const r = json as unknown as Result;
    expect(r.validation.ok).toBe(false);
    expect(r.validation.errors.join(' ')).toMatch(/Ecuacion contable interna/);
    // El cruce contra el Total Activo vinculante (re-derivado del rawData).
    expect(r.validation.warnings.join(' ')).toMatch(/Total Activo.*esperado \$?1\.000\.000/);
  });

  it('sin balance preprocesado (texto no tabular): no emitible con motivo explícito', async () => {
    const { json } = await consolidate({
      rawData: 'Estado de situación financiera escaneado. Activo total 1.000.000.',
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: STRATEGY_OK,
      governanceContent: GOVERNANCE_OK,
    });
    const r = json as unknown as Result;
    expect(r.emittability.kind).toBe('no-emitible');
    expect(r.emittability.blockers[0].code).toBe('SIN_BALANCE_VERIFICADO');
  });

  it('balance descuadrado → 422 igual que /niif', async () => {
    const csv = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__/elite-pulido-diamante.csv'),
      'utf8',
    );
    const { status, json } = await consolidate({
      rawData: csv,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: STRATEGY_OK,
      governanceContent: GOVERNANCE_OK,
    });
    expect(status).toBe(422);
    expect(json.code).toBe('BALANCE_VALIDATION_FAILED');
  });

  it('partes vacías → 400', async () => {
    const { status } = await consolidate({
      rawData: CSV,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: '',
      governanceContent: GOVERNANCE_OK,
    });
    expect(status).toBe(400);
  });
});
