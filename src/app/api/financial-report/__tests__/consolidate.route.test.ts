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

  // e2e-niif-03: "### 4.2 Saldo Inicial Depurado (PUC 11)" (encabezado que el
  // adaptador de la Parte II imprime siempre que AC ≥ PC) se leía como $4,20
  // y "Caja inflada" tumbaba el informe honesto.
  it('informe honesto con AC ≥ PC y el saldo inicial = PUC 11: validation.ok=true', async () => {
    const { json } = await consolidate({
      rawData: CSV,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: [
        STRATEGY_OK,
        '## 4. PROYECCIONES',
        '### 4.1 Gate de Liquidez',
        'AC ≥ PC: proyección habilitada.',
        '',
        '### 4.2 Saldo Inicial Depurado (PUC 11)',
        '- Saldo Inicial Caja: $400.000,00',
        '- DSO usado: 30 días',
      ].join('\n'),
      governanceContent: GOVERNANCE_OK,
    });
    const r = json as unknown as Result;
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.ok).toBe(true);
  });

  // e2e-niif-04: patrimonio negativo "($X)" con comparativo en la misma fila.
  it('informe honesto con patrimonio negativo: validation.ok=true y avisos sin cifras falsas', async () => {
    const csv = [
      'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
      '110505,Caja general,Auxiliar,1,30000000,5000000',
      '130505,Clientes nacionales,Auxiliar,1,20000000,15000000',
      '152405,Equipo de oficina,Auxiliar,1,50000000,50000000',
      '159205,Depreciacion acumulada equipo,Auxiliar,1,-10000000,-20000000',
      '210505,Bancos nacionales,Auxiliar,1,40000000,45000000',
      '220505,Proveedores nacionales,Auxiliar,1,30000000,25000000',
      '311505,Capital suscrito y pagado,Auxiliar,1,50000000,50000000',
      '360505,Perdida del ejercicio,Auxiliar,1,-30000000,-40000000',
      '370505,Perdidas acumuladas,Auxiliar,1,0,-30000000',
      '410505,Ventas,Auxiliar,1,100000000,80000000',
      '510506,Sueldos,Auxiliar,1,40000000,30000000',
      '516015,Depreciacion equipo,Auxiliar,1,0,10000000',
      '530505,Intereses bancarios,Auxiliar,1,10000000,10000000',
      '613505,Costo de ventas,Auxiliar,1,80000000,70000000',
    ].join('\n');
    const niif = [
      '## Estado de Situación Financiera',
      '| Rubro | 2025 | 2024 |',
      '| :--- | ---: | ---: |',
      '| **TOTAL ACTIVOS** | **$50.000.000,00** | **$90.000.000,00** |',
      '| **TOTAL PASIVOS** | **$70.000.000,00** | **$70.000.000,00** |',
      '| **Total patrimonio** | **($20.000.000,00)** | **$20.000.000,00** |',
      '| **✅ TOTAL PASIVO + PATRIMONIO** | **$50.000.000,00** | **$90.000.000,00** |',
      '| **PÉRDIDA NETA DEL PERÍODO** | **($40.000.000,00)** | **($30.000.000,00)** |',
    ].join('\n');
    const strategy = [
      STRATEGY_OK,
      '| Total Activo | $50 M | $90 M | $-40 M | — | Cierre. |',
      '| Utilidad Neta | $-40 M | $-30 M | $-10 M | — | Pérdida. |',
      '| profitability | ROE | Utilidad neta / patrimonio promedio | ND | -150,0% | > 15% | — | x |',
    ].join('\n');
    const { status, json } = await consolidate({
      rawData: csv,
      company: COMPANY,
      language: 'es',
      niifContent: niif,
      strategyContent: strategy,
      governanceContent: GOVERNANCE_OK,
    });
    expect(status).toBe(200);
    const r = json as unknown as Result;
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.ok).toBe(true);
    expect(
      r.validation.warnings.filter((w) => /^(Total Activo|Total Pasivo|Total Patrimonio|Utilidad Neta)/.test(w)),
    ).toEqual([]);
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

  // pipeline-flujo-16 (paridad con el legacy): los ajustes confirmados del
  // Doctor de Datos quedan documentados al final del consolidado, con la MISMA
  // sección que arma `orchestrateFinancialReport`.
  it('con ajustes aplicados del Doctor de Datos el consolidado incluye su traza auditable', async () => {
    const csvConDuplicado = `${CSV}\n11050502,Caja duplicada,50000`;
    const ledger = {
      adjustments: [
        {
          id: 'adj-caja-dup-0001', accountCode: '11050502', accountName: 'Caja duplicada', amount: -50000,
          rationale: 'Registro duplicado de caja confirmado por el contador', status: 'applied',
          proposedAt: '2026-09-01T00:00:00Z', appliedAt: '2026-09-01T00:00:00Z',
        },
      ],
    };
    const { status, json } = await consolidate({
      rawData: csvConDuplicado,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: STRATEGY_OK,
      governanceContent: GOVERNANCE_OK,
      adjustmentLedger: ledger,
    });
    expect(status).toBe(200);
    const r = json as unknown as Result;
    expect(r.consolidatedReport).toContain('## Ajustes contables aplicados durante el proceso de revision');
    expect(r.consolidatedReport).toContain('`adj-caja`');
    expect(r.consolidatedReport).toContain('Registro duplicado de caja confirmado por el contador');
  });

  it('sin ajustes no se agrega la sección', async () => {
    const { json } = await consolidate({
      rawData: CSV,
      company: COMPANY,
      language: 'es',
      niifContent: NIIF_OK,
      strategyContent: STRATEGY_OK,
      governanceContent: GOVERNANCE_OK,
    });
    expect((json as unknown as Result).consolidatedReport).not.toContain('Ajustes contables aplicados');
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
