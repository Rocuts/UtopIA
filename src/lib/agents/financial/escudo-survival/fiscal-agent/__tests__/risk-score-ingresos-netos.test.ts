// W4-C (re-auditoría 2026-09-24, recalculo-final-01) — el score de riesgo DIAN
// medía margen, costos y crecimiento sobre `cents.ingresos` (Σ firmada de la
// clase 4): con devoluciones 4175 exportadas con el signo de las ventas el
// mismo balance cambiaba de banda según el ERP. La base es la de los KPIs del
// preprocesador: ingresos netos de devoluciones (|ordinarias| − |4175|).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '../../fiscal-anchor';
import { computeRiskScore } from '../tools/risk-score-calculator';

const pre = (csv: string) => preprocessTrialBalance(parseTrialBalanceCSV(csv));
const score = (csv: string) => {
  const preprocessed = pre(csv);
  const anchor = buildFiscalAnchor({
    preprocessed,
    company: { name: 'Demo SAS', nit: '900123456' },
    hoy: new Date('2026-09-24'),
  });
  return { preprocessed, rs: computeRiskScore({ anchor, preprocessed }) };
};
const factor = (rs: ReturnType<typeof computeRiskScore>, f: string) =>
  rs.factores.find((x) => x.factor === f)!;

// Ventas 100 M, devoluciones 4 M, sueldos 26 M ⇒ UN 70 M sobre ingresos netos 96 M = 72,9 %.
const NATURAL = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,170000000',
  '310505,Capital,Auxiliar,100000000',
  '360505,Utilidad del ejercicio,Auxiliar,70000000',
  '413505,Ventas,Auxiliar,100000000',
  '417505,Devoluciones en ventas,Auxiliar,4000000',
  '510506,Sueldos,Auxiliar,26000000',
].join('\n');
const ALGEBRAICA = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,170000000',
  '310505,Capital,Auxiliar,-100000000',
  '360505,Utilidad del ejercicio,Auxiliar,-70000000',
  '413505,Ventas,Auxiliar,-100000000',
  '417505,Devoluciones en ventas,Auxiliar,4000000',
  '510506,Sueldos,Auxiliar,26000000',
].join('\n');

describe('recalculo-final-01 — score de riesgo DIAN sobre ingresos netos', () => {
  it('mismo balance en convención natural y algebraica ⇒ mismo margen, mismos puntos y mismo nivel', () => {
    const n = score(NATURAL);
    const a = score(ALGEBRAICA);
    expect(n.preprocessed.primary.controlTotals.margenNeto).toBeCloseTo(
      a.preprocessed.primary.controlTotals.margenNeto!,
      9,
    );
    expect(factor(n.rs, 'margen_alto').detalle).toBe(factor(a.rs, 'margen_alto').detalle);
    expect(factor(n.rs, 'margen_alto').detalle).toContain('Margen neto 72.9%');
    expect(factor(n.rs, 'margen_alto').puntos).toBe(15);
    expect(factor(n.rs, 'costo_bajo').detalle).toBe(factor(a.rs, 'costo_bajo').detalle);
    expect(n.rs.score).toBe(a.rs.score);
    expect(n.rs.nivel).toBe(a.rs.nivel);
  });

  it('fixtures devoluciones-4175: natural, algebraica y signos mixtos dan los mismos factores', () => {
    const dir = path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__/devoluciones-4175');
    const out = ['natural.csv', 'algebraica.csv', 'signos-mixtos.csv'].map((f) => {
      const { rs } = score(fs.readFileSync(path.join(dir, f), 'utf8'));
      return rs.factores
        .filter((x) => x.factor === 'margen_alto' || x.factor === 'costo_bajo')
        .map((x) => `${x.factor}:${x.puntos}:${x.detalle}`);
    });
    expect(out[0]).toEqual(out[1]);
    expect(out[2]).toEqual(out[1]);
  });

  it('crecimiento sólo contra un comparativo de igual duración (corte a junio vs año)', () => {
    const csv = [
      'codigo,nombre,nivel,Saldo [2024],Saldo [2025-06]',
      '110505,Caja,Auxiliar,100000000,300000000',
      '310505,Capital,Auxiliar,70000000,70000000',
      '360505,Utilidad del ejercicio,Auxiliar,30000000,230000000',
      '413505,Ventas,Auxiliar,100000000,400000000',
      '510506,Sueldos,Auxiliar,70000000,170000000',
    ].join('\n');
    const { rs } = score(csv);
    const f = factor(rs, 'crecimiento_inusual');
    expect(f.puntos).toBe(0);
    expect(f.detalle).toMatch(/no comparable/);
  });
});
