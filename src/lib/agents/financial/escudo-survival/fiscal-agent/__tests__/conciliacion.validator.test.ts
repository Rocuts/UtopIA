// ---------------------------------------------------------------------------
// Tests — Módulo 2 · Conciliación
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  validateConciliacion,
  validateConciliacionL1,
  validateConciliacionL2,
  validateConciliacionL3,
} from '../validators/conciliacion.validator';
import type { Modulo2Conciliacion } from '../validators/types';
import {
  RESP_CONCILIACION_OK,
  RESP_CONCILIACION_BAD_158_3,
} from '../__fixtures__/respuestas-prueba.fixture';

const M2_OK: Modulo2Conciliacion = RESP_CONCILIACION_OK.modulo2 as Modulo2Conciliacion;

function findCheck(checks: ReturnType<typeof validateConciliacion>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Conciliación Validator — L1 Aritmética', () => {
  it('M2.L1.1: suma de adiciones detalladas debe igualar adicionesCents', () => {
    const checks = validateConciliacionL1(M2_OK);
    const c = findCheck(checks, 'M2.L1.1_suma_adiciones');
    expect(c?.passed).toBe(true);
  });

  it('M2.L1.1: detecta desbalance en suma de adiciones', () => {
    const bad: Modulo2Conciliacion = {
      ...M2_OK,
      adicionesCents: '999999999', // no coincide con detalles (suman 2_000_000_000)
    };
    const checks = validateConciliacionL1(bad);
    const c = findCheck(checks, 'M2.L1.1_suma_adiciones');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('Suma de detalles');
  });

  it('M2.L1.3: renta líquida = UAI + adiciones − deducciones (identidad exacta)', () => {
    const checks = validateConciliacionL1(M2_OK);
    const c = findCheck(checks, 'M2.L1.3_renta_liquida_identidad');
    expect(c?.passed).toBe(true);
  });

  it('M2.L1.3: detecta renta líquida incorrecta (off by 100 cents)', () => {
    const bad: Modulo2Conciliacion = {
      ...M2_OK,
      rentaLiquidaCents: '11500000100', // 100 cents off
    };
    const checks = validateConciliacionL1(bad);
    const c = findCheck(checks, 'M2.L1.3_renta_liquida_identidad');
    expect(c?.passed).toBe(false);
  });

  it('M2.L1.4: impuesto bruto = renta líquida × 35% (Art. 240)', () => {
    const checks = validateConciliacionL1(M2_OK);
    const c = findCheck(checks, 'M2.L1.4_impuesto_bruto_tarifa');
    expect(c?.passed).toBe(true);
    expect(c?.norma).toBe('Art. 240 E.T.');
  });

  it('M2.L1.5: impuesto neto aplica tope 25% Art. 258 a desc 254/256/257 y suma 258-1 libre', () => {
    const checks = validateConciliacionL1(M2_OK);
    const c = findCheck(checks, 'M2.L1.5_impuesto_neto_descuentos');
    expect(c?.passed).toBe(true);
  });
});

describe('Conciliación Validator — L2 Lógica de negocio', () => {
  it('M2.L2.4: tarifa 35% es válida para PJ 2026', () => {
    const checks = validateConciliacionL2(M2_OK);
    const c = findCheck(checks, 'M2.L2.4_tarifa_valida_2026');
    expect(c?.passed).toBe(true);
  });

  it('M2.L2.4: tarifa 50% NO válida (era Decreto 1474 INEXEQUIBLE)', () => {
    const bad: Modulo2Conciliacion = { ...M2_OK, tarifa: 50 };
    const checks = validateConciliacionL2(bad);
    const c = findCheck(checks, 'M2.L2.4_tarifa_valida_2026');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('Sentencia C-079/2026');
  });

  it('M2.L2.3: rentas exentas > UAI dispara warning de plausibilidad', () => {
    const bad: Modulo2Conciliacion = {
      ...M2_OK,
      rentasExentasCents: '20000000000', // > UAI 10_000_000_000
    };
    const checks = validateConciliacionL2(bad);
    const c = findCheck(checks, 'M2.L2.3_rentas_exentas_excesivas');
    expect(c).toBeDefined();
    expect(c?.passed).toBe(false);
    expect(c?.severity).toBe('warning');
  });
});

describe('Conciliación Validator — L3 Defensa tributaria', () => {
  it('M2.L3.1: closingNote cita parágrafo Art. 647', () => {
    const checks = validateConciliacionL3(M2_OK);
    const c = findCheck(checks, 'M2.L3.1_closing_note_cita_par_647');
    expect(c?.passed).toBe(true);
    expect(c?.norma).toBe('Art. 647 par. E.T.');
  });

  it('M2.L3.2: detecta cita prohibida Art. 158-3 (derogado) en norma de detalle', () => {
    const m2bad = RESP_CONCILIACION_BAD_158_3.modulo2 as Modulo2Conciliacion;
    const checks = validateConciliacionL3(m2bad);
    const c = findCheck(checks, 'M2.L3.2_no_cita_art_158_3_derogado');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('DEROGADO');
  });

  it('M2.L3.2: pasa cuando ninguna cita es Art. 158-3', () => {
    const checks = validateConciliacionL3(M2_OK);
    const c = findCheck(checks, 'M2.L3.2_no_cita_art_158_3_derogado');
    expect(c?.passed).toBe(true);
  });
});

describe('Conciliación Validator — Entry point composite', () => {
  it('validateConciliacion ejecuta L1 + L2 + L3', () => {
    const all = validateConciliacion(M2_OK);
    expect(all.length).toBeGreaterThan(8);
    expect(all.some((c) => c.name.startsWith('M2.L1.'))).toBe(true);
    expect(all.some((c) => c.name.startsWith('M2.L2.'))).toBe(true);
    expect(all.some((c) => c.name.startsWith('M2.L3.'))).toBe(true);
  });
});
