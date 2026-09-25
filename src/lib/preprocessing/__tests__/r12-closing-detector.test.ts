import { describe, expect, it } from 'vitest';

import fs from 'node:fs';
import path from 'node:path';

import { runR12 } from '../curator-rules/r12-closing-detector';
import { parseUploadedTrialBalanceText } from '../raw-data';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';
import type { PeriodSnapshot } from '../trial-balance';

function buildSnapshotForR12(opts: {
  ingresos: number; // clase 4
  gastos: number; // clase 5
  costos: number; // clase 6
  produccion: number; // clase 7
  grupo36: number;
  grupo37: number;
  period?: string;
  periodoTipo?: 'cerrado' | 'parcial' | 'indeterminado';
}): PeriodSnapshot {
  const cl = (code: number, total: number, accounts: { code: string; balance: number }[] = []) => ({
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: total,
    reportedTotal: total,
    discrepancy: 0,
    accounts: accounts.map((a) => ({
      code: a.code,
      name: `Cuenta ${a.code}`,
      level: 'Auxiliar',
      balance: a.balance,
      isLeaf: true,
    })),
  });

  return {
    period: opts.period ?? '2025',
    periodoTipo: opts.periodoTipo,
    classes: [
      cl(1, 0),
      cl(2, 0),
      cl(3, opts.grupo36 + opts.grupo37, [
        { code: '3605', balance: opts.grupo36 },
        { code: '3710', balance: opts.grupo37 },
      ]),
      cl(4, opts.ingresos),
      cl(5, opts.gastos),
      cl(6, opts.costos),
      cl(7, opts.produccion),
    ],
    controlTotals: {
      activo: 0,
      activoCorriente: 0,
      activoNoCorriente: 0,
      pasivo: 0,
      pasivoCorriente: 0,
      pasivoNoCorriente: 0,
      patrimonio: opts.grupo36 + opts.grupo37,
      ingresos: opts.ingresos,
      gastos: opts.gastos + opts.costos + opts.produccion,
      utilidadNeta: opts.ingresos - opts.gastos - opts.costos - opts.produccion,
      efectivoCuenta11: 0,
      deudoresCuenta13: 0,
      cuentasPorPagar23: 0,
      impuestosCuenta24: 0,
      obligacionesLaborales25: 0,
    },
    equityBreakdown: {},
    summary: {
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: opts.grupo36 + opts.grupo37,
      totalRevenue: opts.ingresos,
      totalExpenses: opts.gastos,
      totalCosts: opts.costos,
      totalProduction: opts.produccion,
      netIncome: opts.ingresos - opts.gastos - opts.costos - opts.produccion,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] },
    discrepancies: [],
    missingExpectedAccounts: [],
    findings: {},
  };
}

describe('R12 — Detector de cierre de libros', () => {
  it('libros NO cerrados: utilidad transitoria $2.228M, grupo 36+37 ≈ $42K (Grupo Empresarial 2 Tres SAS)', () => {
    const snap = buildSnapshotForR12({
      ingresos: 8_500_000_000,
      gastos: 4_271_503_211,
      costos: 2_000_000_000,
      produccion: 0,
      grupo36: 0,
      grupo37: 42_720, // sólo Convergencia, casi 0
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(true);
    expect(result.abortVirtualClose).toBe(true);
    expect(snap.findings?.librosNoCerrados).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].code).toBe('CUR-R12');
    expect(result.findings[0].severity).toBe('critico');
    expect(result.audit.suggestedClosingEntries.length).toBeGreaterThanOrEqual(3);
  });

  it('cierre normal: utilidad trasladada a 3605 → librosNoCerrados=false, R8 ejecuta', () => {
    const snap = buildSnapshotForR12({
      ingresos: 8_500_000_000,
      gastos: 4_271_503_211,
      costos: 2_000_000_000,
      produccion: 0,
      grupo36: 2_228_496_789, // utilidad ya trasladada
      grupo37: 0,
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(false);
    expect(result.abortVirtualClose).toBe(false);
    expect(snap.findings?.librosNoCerrados).toBe(false);
    expect(result.findings.length).toBe(0);
  });

  it('utilidad transitoria inmaterial (< $1M) NO dispara R12 aunque grupos 36/37 estén en 0', () => {
    const snap = buildSnapshotForR12({
      ingresos: 500_000,
      gastos: 100_000,
      costos: 0,
      produccion: 0,
      grupo36: 0,
      grupo37: 0,
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(false);
    expect(result.abortVirtualClose).toBe(false);
  });

  it('grupo 36 dentro de tolerancia 5% absorbe la utilidad (no dispara)', () => {
    const snap = buildSnapshotForR12({
      ingresos: 1_000_000_000,
      gastos: 500_000_000,
      costos: 0,
      produccion: 0,
      // utilidad transitoria = 500M; tolerancia = max(500M*5%, 1M) = 25M; 480M absorbe
      grupo36: 480_000_000,
      grupo37: 0,
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(false);
  });

  // -------------------------------------------------------------------------
  // niif-preproceso-26 — periodoTipo y detección por grupo 36
  // -------------------------------------------------------------------------
  it('corte PARCIAL sin traslado: nota explicativa, sin bandera de gate (no se sella no emitible)', () => {
    const snap = buildSnapshotForR12({
      ingresos: 500_000_000,
      gastos: 400_000_000,
      costos: 0,
      produccion: 0,
      grupo36: 0,
      grupo37: 0,
      period: '2025-06',
      periodoTipo: 'parcial',
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(false);
    expect(snap.findings?.librosNoCerrados).toBe(false);
    expect(result.abortVirtualClose).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('medio');
    expect(result.findings[0].description).toMatch(/corte parcial/i);
  });

  it('año CERRADO sin traslado a 36 pero con 3705 previo: SÍ detecta libros no cerrados', () => {
    const snap = buildSnapshotForR12({
      ingresos: 500_000_000,
      gastos: 400_000_000,
      costos: 0,
      produccion: 0,
      grupo36: 0,
      grupo37: 500_000_000, // utilidades de años anteriores, no el resultado del año
      period: '2025-12',
      periodoTipo: 'cerrado',
    });
    const result = runR12(snap);

    expect(result.audit.librosNoCerrados).toBe(true);
    expect(snap.findings?.librosNoCerrados).toBe(true);
    expect(result.findings[0].severity).toBe('critico');
  });

  it('grupo 36 con el resultado de OTRO ejercicio (≠ utilidad del periodo) no cuenta como traslado', () => {
    const snap = buildSnapshotForR12({
      ingresos: 1_000_000_000,
      gastos: 800_000_000,
      costos: 0,
      produccion: 0,
      grupo36: 150_000_000, // utilidad 2024 sin trasladar a 37
      grupo37: 0,
      periodoTipo: 'cerrado',
    });
    expect(runR12(snap).audit.librosNoCerrados).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recalculo-final-05 — asientos de cierre sugeridos que cuadran con 4175
// ---------------------------------------------------------------------------
// Con 4175 en la convención natural (saldo positivo, como el ingreso) la Σ
// firmada de la clase 4 valía 550M y R12 sugería 'Cr. 5905 por $550.000.000',
// 'Dr. 5905 por $260.000.000' y 'traslado por $190.000.000' (550 − 260 ≠ 190).
// ---------------------------------------------------------------------------
describe('R12 — asientos de cierre con devoluciones 4175 (recalculo-final-05)', () => {
  const fixture = (name: string) =>
    fs
      .readFileSync(path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__/devoluciones-4175', name), 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('360505')) // libros abiertos: sin traslado a 3605
      .join('\n');

  it.each(['natural.csv', 'algebraica.csv'])('%s: Cr. 5905 450M, Dr. 5905 260M, traslado 190M', (name) => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(fixture(name)));
    expect(pp.primary.controlTotals.utilidadNeta).toBe(190_000_000);
    const entries = pp.primary.closingDetectorAudit?.suggestedClosingEntries ?? [];
    expect(entries).toEqual([
      expect.stringMatching(/Cr\. 5905 .* por \$450\.000\.000\.$/),
      expect.stringMatching(/Dr\. 5905 por \$260\.000\.000\.$/),
      expect.stringMatching(/Cr\. 3605 .* por \$190\.000\.000\.$/),
    ]);
    const hallazgo = (pp.primary.curator?.findings ?? []).find((f) => f.code === 'CUR-R12');
    expect(hallazgo?.description).toContain('ingresos netos clase 4 450.000.000');
    expect(hallazgo?.description).toContain('clases 5/6/7 260.000.000');
  });

  it('con pérdida el traslado es un débito a 3610 por el valor absoluto', () => {
    const snap = buildSnapshotForR12({
      ingresos: 100_000_000, gastos: 150_000_000, costos: 0, produccion: 0,
      grupo36: 0, grupo37: 0, periodoTipo: 'cerrado',
    });
    expect(runR12(snap).audit.suggestedClosingEntries).toEqual([
      expect.stringMatching(/Cr\. 5905 .* por \$100\.000\.000\.$/),
      expect.stringMatching(/Dr\. 5905 por \$150\.000\.000\.$/),
      expect.stringMatching(/Dr\. 3610 .* por \$50\.000\.000\.$/),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Cross-dep W3-A (ingesta-09 / recalculo-03) y recalculo-final2-01: una
// columna de SALDOS DE APERTURA intermedia (saldo inicial del mes) trae el P&G
// acumulado del año a esa fecha, que no está en el patrimonio y no es "un
// periodo anterior sin cerrar". Pero la apertura del EJERCICIO (1 de enero:
// columna 'Saldo inicial 2025' de un balance anual) debe traer las clases 4-7
// en cero: si trae resultado y ese resultado no entró al patrimonio, el saldo
// final lo incluye por identidad (final = inicial + movimientos) y el P&G del
// periodo es ACUMULADO, igual que con 'Saldo 2024 | Saldo 2025'.
// ---------------------------------------------------------------------------
describe('R12 — P&G acumulado y comparativo de saldos de apertura', () => {
  // Misma forma que el caso acumulado de recalculo-03 (2024 sin cerrar).
  const CSV = [
    'codigo,nombre,Saldo 2024,Saldo 2025',
    '110505,Caja,1000000000,1500000000',
    '220505,Proveedores,400000000,500000000',
    '310505,Capital,100000000,100000000',
    '413505,Ventas,800000000,1500000000',
    '513505,Gastos,300000000,600000000',
  ].join('\n');
  const r12Blocker = (pp: ReturnType<typeof preprocessTrialBalance>) =>
    (pp.primary.validation.curatorBlockingReasons ?? []).find((r) => r.startsWith('[CUR-R12]'));

  it('control: con comparativo de cierre sí se marca P&G acumulado', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    expect(pp.primary.closingDetectorAudit?.pygAcumulado).toBeDefined();
  });

  it('apertura del ejercicio (primario anual) con P&G sin cerrar: se marca y bloquea como el comparativo de cierre', () => {
    // Antes (c82ec708) la apertura se omitía y el P&G acumulado ($900M) salía
    // como resultado del ejercicio; el del ejercicio 2025 es $900M − $500M.
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV), { openingPeriods: ['2024'] });
    expect(pp.comparative?.saldosDeApertura).toBe(true);
    const pyg = pp.primary.closingDetectorAudit?.pygAcumulado;
    expect(pyg?.utilidadMovimientoRaw).toBe('400000000.00');
    expect(pp.primary.findings?.librosNoCerrados).toBe(true);
    expect(r12Blocker(pp)).toContain('$400.000.000,00');
    expect(r12Blocker(pp)).toContain('saldo inicial');
  });

  it("recalculo-final2-01: 'Saldo inicial 2025 | Saldo final 2025' con 3605 dinámico → CUR-R12 con el resultado del ejercicio", () => {
    const raw = [
      'Razón social: DEMO TRES CORTES SAS',
      'NIT: 900.765.432-6',
      'codigo,nombre,nivel,Saldo inicial 2025,Saldo final 2025',
      '110505,Caja general,Auxiliar,100000000,150000000',
      '310505,Capital suscrito y pagado,Auxiliar,60000000,60000000',
      '360505,Utilidad del ejercicio,Auxiliar,40000000,90000000',
      '413505,Venta de mercancias,Auxiliar,50000000,120000000',
      '510506,Sueldos,Auxiliar,10000000,30000000',
    ].join('\n');
    const parsed = parseUploadedTrialBalanceText(raw);
    expect(parsed.openingPeriods).toEqual(['2024']);
    const pp = preprocessTrialBalance(parsed.rows, { openingPeriods: parsed.openingPeriods });
    expect(pp.primary.period).toBe('2025');
    // Resultado del ejercicio 2025 = (120 − 50) − (30 − 10) = $50.000.000.
    expect(pp.primary.closingDetectorAudit?.pygAcumulado?.utilidadMovimientoRaw).toBe('50000000.00');
    expect(pp.primary.findings?.librosNoCerrados).toBe(true);
    expect(r12Blocker(pp)).toContain('$50.000.000,00');
    // Mismo balance rotulado 'Saldo 2024 | Saldo 2025': mismo motivo y misma cifra.
    const cierre = parseUploadedTrialBalanceText(raw.replace('Saldo inicial 2025,Saldo final 2025', 'Saldo 2024,Saldo 2025'));
    const ppCierre = preprocessTrialBalance(cierre.rows, { openingPeriods: cierre.openingPeriods });
    expect(ppCierre.primary.closingDetectorAudit?.pygAcumulado?.utilidadMovimientoRaw).toBe('50000000.00');
  });

  it('apertura del ejercicio con P&G en cero (año anterior cerrado): sin hallazgo', () => {
    const raw = [
      'codigo,nombre,nivel,Saldo inicial 2025,Saldo final 2025',
      '110505,Caja general,Auxiliar,100000000,150000000',
      '310505,Capital suscrito y pagado,Auxiliar,60000000,60000000',
      '370505,Utilidades acumuladas,Auxiliar,40000000,40000000',
      '360505,Utilidad del ejercicio,Auxiliar,0,50000000',
      '413505,Venta de mercancias,Auxiliar,0,70000000',
      '510506,Sueldos,Auxiliar,0,20000000',
    ].join('\n');
    const parsed = parseUploadedTrialBalanceText(raw);
    const pp = preprocessTrialBalance(parsed.rows, { openingPeriods: parsed.openingPeriods });
    expect(pp.primary.closingDetectorAudit?.pygAcumulado).toBeUndefined();
    expect(r12Blocker(pp)).toBeUndefined();
  });

  it('saldo inicial de un MES (corte parcial 2025-06): el P&G acumulado del año es el del corte, no se bloquea', () => {
    // Saldo inicial de junio = P&G enero-mayo; saldo final = enero-junio (NIC 34, año corrido).
    const csv = [
      'codigo,nombre,saldo [2025-05],saldo [2025-06]',
      '110505,Caja,1000000000,1100000000',
      '220505,Proveedores,400000000,400000000',
      '310505,Capital,100000000,100000000',
      '413505,Ventas,800000000,950000000',
      '513505,Gastos,300000000,350000000',
    ].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv), { openingPeriods: ['2025-05'] });
    expect(pp.primary.period).toBe('2025-06');
    expect(pp.primary.periodoTipo).toBe('parcial');
    expect(pp.primary.closingDetectorAudit?.pygAcumulado).toBeUndefined();
    expect(r12Blocker(pp)).toBeUndefined();
  });
});
