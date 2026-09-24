// valoracion-24 — Comando: la serie de «salidas fiscales» restaba
// 35 % × utilidad neta / 12 (utilidad ya neta del impuesto, 5405 dentro de los
// gastos). La inflexión fiscal quedó retirada (ratios-kpis-10); el runway se
// extrae a una función pura con los escenarios rotulados como supuestos.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRunway, RUNWAY_ESCENARIOS } from '../runway';

const desde = new Date('2026-09-15T12:00:00Z');

describe('buildRunway', () => {
  it('sin meses cubiertos no hay runway (nunca 12 supuestos)', () => {
    expect(buildRunway({ ingresosPeriodo: 1200, egresosPeriodo: 600, cajaInicial: 100, meses: null, desde })).toEqual([]);
  });

  it('flujo mensual = (ingresos − egresos) / meses; escenarios sólo sobre ingresos; sin impuesto adicional', () => {
    const r = buildRunway({ ingresosPeriodo: 1200, egresosPeriodo: 900, cajaInicial: 100, meses: 12, desde });
    expect(r).toHaveLength(36);
    expect(r[0]).toMatchObject({ base: 100, conservador: 100, agresivo: 100 });
    // mes 2: base 100 + 100 − 75 = 125; cons 100 + 85 − 75 = 110; agr 100 + 110 − 75 = 135
    expect(r[1].base).toBe(125);
    expect(r[1].conservador).toBeCloseTo(110, 10);
    expect(r[1].agresivo).toBeCloseTo(135, 10);
  });

  it('los escenarios se rotulan como supuestos de sensibilidad', () => {
    expect(RUNWAY_ESCENARIOS.conservador.rotulo).toMatch(/no es un pronóstico/);
    expect(RUNWAY_ESCENARIOS.agresivo.rotulo).toMatch(/\+10 %/);
  });

  it('la página Comando usa buildRunway y no calcula salidas fiscales con 35 %', () => {
    const src = readFileSync(resolve(__dirname, '../../../app/workspace/comando/page.tsx'), 'utf8');
    expect(src).toMatch(/buildRunway\(/);
    expect(src).not.toMatch(/0[.,]35/);
    expect(src).not.toMatch(/\* 0\.85|\* 1\.10/);
  });
});
