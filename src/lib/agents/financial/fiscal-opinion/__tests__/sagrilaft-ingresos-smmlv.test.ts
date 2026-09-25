// NM-15 (re-auditoría normativa-metricas, 2026-09-24) — SAGRILAFT leía los
// ingresos como la Σ bruta de la clase 4 (sumaba las devoluciones 4175 bajo la
// convención de magnitudes: 2.120 M en vez de 1.920 M) y fijaba el SMMLV 2026
// aunque el balance fuera de 2025.
//   · Umbral (CE 100-000016/2020, SAGRILAFT_FUENTE): 40.000 SMMLV de ingresos
//     totales o activos. Los ingresos se leen netos de devoluciones (NIIF 15
//     §47), del preprocesador; nunca la Σ firmada de la clase 4.
//   · SMMLV del año del corte, de la constante del repo (sólo 2026 verificado:
//     Decreto 1469/2025). Otro año → umbral N/D con motivo, no el de 2026.
//   · El umbral mide cifras anuales a 31 de diciembre: un corte parcial no
//     compara sus ingresos contra el umbral.
import { describe, expect, it } from 'vitest';

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import {
  evaluateSagrilaft,
  readSagrilaftInputs,
  renderSagrilaftBlock,
  smmlvDelAnio,
} from '@/lib/agents/financial/fiscal-opinion/sagrilaft';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

const filas = [
  '110505,Caja,Auxiliar,1,500000000',
  '310505,Capital,Auxiliar,1,200000000',
  '413550,Ventas,Auxiliar,1,2000000000',
  '417505,Devoluciones en ventas,Auxiliar,1,100000000',
  '421005,Intereses financieros,Auxiliar,1,20000000',
  '510506,Sueldos,Auxiliar,1,1620000000',
];
const csv = (periodo: string) =>
  [`codigo,nombre,nivel,transaccional,Saldo [${periodo}]`, ...filas].join('\n');
const pre = (periodo: string) => preprocessTrialBalance(parseTrialBalanceCSV(csv(periodo)));

describe('NM-15 — SAGRILAFT con ingresos netos y SMMLV del año del corte', () => {
  it('ingresos = ingresos netos de devoluciones del preprocesador (1.920 M), no la Σ bruta de la clase 4', () => {
    const pp = pre('2026');
    expect(pp.primary.controlTotals.ingresosNetos).toBe(1_920_000_000);
    const ins = readSagrilaftInputs(pp);
    expect(ins.ingresosCop).toBe(1_920_000_000);
    expect(ins.anioCorte).toBe(2026);
  });

  it('balance 2026: umbral 40.000 × SMMLV 2026 (constante del repo)', () => {
    const ev = evaluateSagrilaft(readSagrilaftInputs(pre('2026')));
    expect(ev.smmlv).toBe(SMMLV_2026);
    expect(ev.umbralCop).toBe(40_000 * SMMLV_2026);
    expect(ev.superaUmbralGeneral).toBe(false);
  });

  it('balance 2025: el SMMLV 2025 no está verificado en el repo → umbral N/D con motivo (nunca el de 2026)', () => {
    expect(smmlvDelAnio(2025)).toBeNull();
    const ev = evaluateSagrilaft(readSagrilaftInputs(pre('2025')));
    expect(ev.umbralCop).toBeNull();
    expect(ev.smmlv).toBeNull();
    expect(ev.superaUmbralGeneral).toBeNull();
    expect(ev.obligada).toBe('no_determinable');
    expect(ev.motivo).toMatch(/SMMLV.*2025/);
    const bloque = renderSagrilaftBlock(ev);
    expect(bloque).not.toContain('70.036.200.000');
    expect(bloque).toMatch(/N\/D/);
  });

  it('corte parcial (2026-06): los ingresos de 6 meses no se comparan con el umbral anual', () => {
    const ins = readSagrilaftInputs(pre('2026-06'));
    expect(ins.ingresosCop).toBeNull();
    expect(ins.motivoIngresos).toMatch(/parcial/);
    const ev = evaluateSagrilaft(ins);
    // Los activos al corte sí se comparan (500 M < umbral).
    expect(ev.activosCop).toBe(500_000_000);
    expect(ev.superaUmbralGeneral).toBe(false);
    expect(renderSagrilaftBlock(ev)).toMatch(/parcial/);
  });

  it('sin año de corte identificable el umbral es N/D (no se asume 2026)', () => {
    const ev = evaluateSagrilaft({ activosCop: 90_000_000_000, ingresosCop: null, anioCorte: null });
    expect(ev.umbralCop).toBeNull();
    expect(ev.superaUmbralGeneral).toBeNull();
  });
});
