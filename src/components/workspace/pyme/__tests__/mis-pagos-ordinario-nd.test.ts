// Auditoría 2026-09 (tributario-calc-11, integración IW5b) — Mis Pagos.
// La tarjeta «Régimen Ordinario» pintaba una cifra con margen supuesto del
// 35 % y sin ICA; ahora: N/D con motivo cuando faltan datos del usuario,
// rótulo de la tarifa de renta (Art. 241 PN / Art. 240 PJ), advertencias,
// selector PN/PJ y campos de margen e ICA. Guardar exige una comparación
// concluyente (la API no admite `recommended: null`).
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import { dict } from '@/lib/i18n/dictionaries';
import { faltantesOrdinario, parseIcaPorMilInput, parseMarginInput } from '../regimen-display';

const labels = dict.es.pyme.pagos;

describe('entradas del usuario', () => {
  it('margen en %: vacío o fuera de rango = dato faltante', () => {
    expect(parseMarginInput('15')).toBeCloseTo(0.15);
    expect(parseMarginInput('12,5')).toBeCloseTo(0.125);
    expect(parseMarginInput('')).toBeUndefined();
    expect(parseMarginInput('0')).toBeUndefined();
    expect(parseMarginInput('150')).toBeUndefined();
  });

  it('ICA en por mil', () => {
    expect(parseIcaPorMilInput('9,66')).toBeCloseTo(0.00966);
    expect(parseIcaPorMilInput('')).toBeUndefined();
    expect(parseIcaPorMilInput('80')).toBeUndefined();
  });

  it('lista lo que falta con el mismo criterio del calculador', () => {
    expect(faltantesOrdinario({}, labels)).toBe('el margen de utilidad y la tarifa de ICA del municipio');
    expect(faltantesOrdinario({ margin: 0.2 }, labels)).toBe('la tarifa de ICA del municipio');
    expect(faltantesOrdinario({ margin: 0.2, icaRate: 0.01 }, labels)).toBeNull();
  });
});

describe('MisPagosView', () => {
  const src = fs
    .readFileSync(path.resolve(process.cwd(), 'src/components/workspace/pyme/MisPagosView.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('muestra N/D con el motivo cuando la cifra ordinaria no está disponible', () => {
    expect(src).toMatch(/ordinarioDisponible/);
    expect(src).toMatch(/pt\.notAvailable/);
    expect(src).toMatch(/pt\.ordinarioND/);
    expect(src).not.toMatch(/value=\{fmtM\(ordinario\)\}/);
  });

  it('rotula la tarifa de renta, pinta las advertencias y pasa PN/PJ, margen e ICA', () => {
    expect(src).toMatch(/baseLegalPJ/);
    expect(src).toMatch(/advertencias/);
    expect(src).toMatch(/tipoContribuyente/);
    expect(src).toMatch(/icaRate/);
    expect(src).toMatch(/margin/);
  });

  it('no permite guardar una comparación no concluyente', () => {
    expect(src).toMatch(/disabled=\{saving \|\| !comparable\}/);
  });
});
