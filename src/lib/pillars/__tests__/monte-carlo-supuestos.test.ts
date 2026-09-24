// ratios-kpis-21 — "inversión PPE" buscaba la clase 15 (que no existe: las
// clases son 1-9) y caía siempre al activo no corriente (16-19 incluidos).
// valoracion-22 — supuestos ocultos, histograma teórico (PDF normal) en lugar
// de los resultados simulados y rótulos no sustentados.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runMonteCarlo } from '../monte-carlo';
import { makeClass, makeControlTotals, makePnlSnapshot, makeSnapshot } from './_fixtures';

describe('ratios-kpis-21 — PPE neto del grupo 15 de la clase 1', () => {
  it('suma las cuentas 15xx de la clase 1 netas de depreciación (no el activo no corriente)', () => {
    const snap = makePnlSnapshot();
    snap.classes[0].accounts.push({
      code: '165505', name: 'Licencias', level: 'Auxiliar', balance: 150_000_000, isLeaf: true,
    });
    snap.controlTotals.activoNoCorriente = 550_000_000;
    const r = runMonteCarlo(snap, { iterations: 200 });
    expect(r.inversionPPE).toBe(400_000_000); // 152405 500M − 159205 100M
  });

  it('sin grupo 15 ⇒ PPE N/D y ROI N/D (sin caer al activo no corriente)', () => {
    const snap = makeSnapshot(
      makeControlTotals({ ingresos: 600_000_000, gastos: 400_000_000, activoNoCorriente: 300_000_000 }),
      [makeClass(1, [{ code: '110505', balance: 10_000_000 }])],
    );
    const r = runMonteCarlo(snap, { iterations: 200 });
    expect(r.inversionPPE).toBeNull();
    expect(r.roiProbabilistico).toBeNull();
  });

  it('los flujos usan ingresos netos de devoluciones (no el bruto de la clase 4)', () => {
    const snap = makePnlSnapshot();
    const r = runMonteCarlo(snap, { iterations: 2000, ingresoSigma: 0 });
    // Sin volatilidad: utilidad 12m = (ingresos netos − gastos) del año.
    expect(r.utilidadAcumulada.mean).toBeCloseTo(2_120_000_000 - 1_775_000_000, -2);
  });
});

describe('valoracion-22 — supuestos visibles e histograma empírico', () => {
  it('expone distribución, σ, horizonte, N y semilla', () => {
    const r = runMonteCarlo(makePnlSnapshot(), { iterations: 500, seed: 7 });
    expect(r.supuestos).toMatchObject({
      distribucion: 'normal-iid-mensual',
      variable: 'ingresos',
      ingresoSigmaMensual: 0.15,
      horizonteMeses: 12,
      iteraciones: 500,
      semilla: 7,
    });
    expect(r.supuestos.exclusionesEs).toMatch(/impuestos/);
  });

  it('el histograma se construye con los ROI simulados (conteos suman N)', () => {
    const r = runMonteCarlo(makePnlSnapshot(), { iterations: 1000 });
    const h = r.roiHistograma!;
    expect(h).not.toBeNull();
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(1000);
    expect(h[0].from).toBeCloseTo(Math.min(...h.map((b) => b.from)), 12);
  });

  it('la UI rotula N real y escenario simulado, sin cita a "Bank of England"', () => {
    const ui = readFileSync(
      resolve(__dirname, '../../../components/workspace/pillars/MonteCarloHistogram.tsx'),
      'utf8',
    );
    const engine = readFileSync(resolve(__dirname, '../monte-carlo.ts'), 'utf8');
    expect(ui).not.toMatch(/9\.600 escenarios|9,600 scenarios/);
    expect(ui).not.toMatch(/normalPdf/);
    expect(`${ui}\n${engine}`).not.toMatch(/Bank of England/);
    expect(ui).toMatch(/result\.iterations/);
  });
});
