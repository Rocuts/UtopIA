// ---------------------------------------------------------------------------
// I5-niif 9 — el Doctor de Datos y /niif leen el MISMO balance
// ---------------------------------------------------------------------------
// Verificación (I3 residual): desde I2-tributario el Doctor reconstruye el
// balance de `rawCsv` (el `rawData` del pipeline) con
// `preprocessUploadedTrialBalanceText`, y Stage 0 de /niif
// (`prepareFinancialContext`) con `parseUploadedTrialBalanceText` +
// `preprocessTrialBalance(…, { openingPeriods })`: la misma regla común de
// ingesta. Esta prueba compartida fija que ambos caminos producen las mismas
// etiquetas de periodo, la misma marca de saldos de apertura y los mismos
// totales (misma unidad) para las variantes de ingesta del producto, y que un
// ajuste que el Doctor ancla a uno de SUS periodos no es un periodo
// desconocido para /niif (sin 422 de `unknownAdjustmentPeriodReasons`).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));

import { prepareFinancialContext } from '@/lib/agents/financial/orchestrator';
import { VALIDATION_REPORT_HEADING } from '@/lib/preprocessing/raw-data';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { unknownAdjustmentPeriodReasons } from '@/lib/reports/adjustment-ledger';
import { escribirDirectivasIngesta } from '@/lib/upload/ingest-directives';
import { rebuildRepairBalance } from '../agent';

const COMPANY = { name: 'Demo SAS', nit: '900123456', entityType: 'SAS', niifGroup: 2 as const, fiscalPeriod: '2025' };

// Corte parcial (junio de 2025) en miles de pesos, con la unidad confirmada y
// un vencimiento declarado, como lo deja el intake en `rawData`.
const CSV_MILES_JUNIO = escribirDirectivasIngesta(
  [
    'Balance de prueba a junio 30 de 2025',
    'Cifras expresadas en miles de pesos',
    'codigo,nombre,nivel,saldo 2025',
    '110505,Caja,Auxiliar,50000',
    '130505,Clientes,Auxiliar,40000',
    '152405,Equipo de oficina,Auxiliar,50000',
    '210505,Crédito bancario a 3 años,Auxiliar,30000',
    '230505,Cxp,Auxiliar,30000',
    '311505,Capital,Auxiliar,60000',
    '360505,Utilidad del ejercicio,Auxiliar,20000',
    '410505,Ventas,Auxiliar,200000',
    '510505,Sueldos,Auxiliar,40000',
    '613505,CMV,Auxiliar,140000',
  ].join('\n'),
  { unidadConfirmada: 'miles', vencimientos: { '210505': 'no_corriente' } },
);

const hoja = (anio: string, caja: number) =>
  [`[period=${anio}]`, 'codigo,nombre,nivel,Saldo', `110505,Caja,Auxiliar,${caja}`, `310505,Capital,Auxiliar,${caja}`, '[/period]'].join('\n');

const XLSX_HOJAS = `${hoja('2025', 100_000_000)}\n${hoja('2024', 80_000_000)}`;

// Columna de saldo inicial: el comparativo es de apertura (ingesta-09).
const APERTURA = [
  'codigo,nombre,nivel,transaccional,saldo inicial 2025,saldo final 2025',
  '110505,Caja,Auxiliar,1,50000000,80000000',
  '130505,Clientes,Auxiliar,1,40000000,60000000',
  '220505,Proveedores,Auxiliar,1,30000000,40000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,0,40000000',
  '370505,Utilidades acumuladas,Auxiliar,1,20000000,20000000',
  '410505,Ventas,Auxiliar,1,0,150000000',
  '510505,Sueldos,Auxiliar,1,0,110000000',
].join('\n');

// Dos cortes en columnas, con el informe de validación de /api/upload antepuesto.
const DOS_CORTES = [
  'codigo,nombre,nivel,Saldo 2024,Saldo 2025',
  '110505,Caja,Auxiliar,100000,140000',
  '220505,Proveedores,Auxiliar,25000,70000',
  '310505,Capital,Auxiliar,75000,70000',
].join('\n');
const CON_INFORME = `${VALIDATION_REPORT_HEADING}\n\nResumen del preprocesador.\n\n---\nDATOS ORIGINALES:\n${DOS_CORTES}`;

/** Lo que ambos caminos deben compartir: etiquetas, apertura y totales. */
function huella(pp: PreprocessedBalance) {
  return pp.periods.map((s) => ({
    period: s.period,
    apertura: s.saldosDeApertura === true,
    activo: s.controlTotals.activo,
    pasivo: s.controlTotals.pasivo,
    patrimonio: s.controlTotals.patrimonio,
    activoCorriente: s.controlTotals.activoCorriente,
    pasivoCorriente: s.controlTotals.pasivoCorriente,
  }));
}

describe('Doctor de Datos y /niif — mismas etiquetas de periodo, apertura y unidad', () => {
  it.each([
    ['corte parcial en miles con unidad confirmada y vencimiento', CSV_MILES_JUNIO],
    ['XLSX por hojas', XLSX_HOJAS],
    ['columna de saldo inicial (comparativo de apertura)', APERTURA],
    ['dos cortes con el informe de validación antepuesto', CON_INFORME],
  ])('%s', async (_nombre, rawData) => {
    const doctor = rebuildRepairBalance(rawData);
    expect(doctor.ingestReasons).toEqual([]);
    expect(doctor.preprocessed).not.toBeNull();
    const ctx = await prepareFinancialContext({ rawData, company: COMPANY, language: 'es' });
    const niif = ctx.preprocessed as PreprocessedBalance;
    expect(huella(doctor.preprocessed!)).toEqual(huella(niif));

    // Un ajuste anclado a cada periodo del Doctor existe para /niif.
    const ajustes = doctor.preprocessed!.periods.map((s, i) => ({
      id: `adj-${i}`,
      accountCode: '110505',
      status: 'applied',
      period: s.period,
    }));
    expect(unknownAdjustmentPeriodReasons(niif, ajustes)).toEqual([]);
  });

  it('la unidad confirmada llega a los dos caminos: pesos, no miles', async () => {
    const doctor = rebuildRepairBalance(CSV_MILES_JUNIO);
    expect(doctor.preprocessed!.primary.controlTotals.activo).toBe(140_000_000);
    const ctx = await prepareFinancialContext({ rawData: CSV_MILES_JUNIO, company: COMPANY, language: 'es' });
    expect((ctx.preprocessed as PreprocessedBalance).primary.controlTotals.activo).toBe(140_000_000);
  });
});
