// ---------------------------------------------------------------------------
// Tests — Módulo 6 · Devoluciones y Saldos a Favor
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (pendiente #8): las pruebas anteriores
// exigían saldo a favor = |F04|, justo lo que tributario-modulos-02 prohibió
// (F04 es una posición de referencia contable). Ahora el saldo publicado debe
// ser el DECLARADO y la prosa no puede presentar |F04| como saldo a favor.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  validateDevoluciones,
  validateDevolucionesL1,
  validateDevolucionesL2,
  validateDevolucionesL3,
} from '../validators/devoluciones.validator';
import type { Modulo6Devoluciones } from '../validators/types';
import { RESP_DEVOLUCION_RETENCIONES } from '../__fixtures__/respuestas-prueba.fixture';

const M6_OK = RESP_DEVOLUCION_RETENCIONES.modulo6 as Modulo6Devoluciones;

const SIN_DECLARACION: Modulo6Devoluciones = {
  saldoDeclaradoCents: null,
  saldoAFavorCents: null,
  viabilidad: 'no_determinable',
  f04Cents: '-320000000',
  textoAnalisis:
    'Sin la declaración (Formulario 110) el saldo a favor no es determinable. F04 = $3.200.000,00 es una estimación contable.',
  documentosRequeridos: ['Declaración de renta del periodo (Formulario 110)'],
  pasosProcedimentales: ['Verificar en la declaración presentada si existe saldo a favor liquidado (Art. 850 E.T.).'],
};

function findCheck(checks: ReturnType<typeof validateDevoluciones>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Devoluciones Validator — L1 Cifras', () => {
  it('M6.L1.1: saldo publicado = saldo declarado', () => {
    expect(findCheck(validateDevolucionesL1(M6_OK), 'M6.L1.1_saldo_publicado_es_el_declarado')?.passed).toBe(true);
  });

  it('M6.L1.1: publicar |F04| como saldo sin declaración falla', () => {
    const bad = { ...SIN_DECLARACION, saldoAFavorCents: '320000000', viabilidad: 'media' as const };
    const checks = validateDevolucionesL1(bad);
    expect(findCheck(checks, 'M6.L1.1_saldo_publicado_es_el_declarado')?.passed).toBe(false);
    expect(findCheck(checks, 'M6.L1.2_viabilidad_coherente')?.passed).toBe(false);
  });

  it('M6.L1.1: saldo distinto del declarado falla', () => {
    const bad = { ...M6_OK, saldoAFavorCents: '600000000' };
    expect(findCheck(validateDevolucionesL1(bad), 'M6.L1.1_saldo_publicado_es_el_declarado')?.passed).toBe(false);
  });

  it('M6.L1.2: declaración sin saldo a favor ⇒ saldo 0 y viabilidad no_aplica', () => {
    const ok = {
      ...M6_OK,
      saldoDeclaradoCents: '0',
      saldoAFavorCents: '0',
      viabilidad: 'no_aplica' as const,
      pasosProcedimentales: [],
    };
    expect(validateDevolucionesL1(ok).every((c) => c.passed)).toBe(true);
  });
});

describe('Devoluciones Validator — L2 Prosa y citas', () => {
  it('M6.L2.1: |F04| rotulado como estimación pasa', () => {
    expect(findCheck(validateDevolucionesL2(SIN_DECLARACION), 'M6.L2.1_f04_no_presentado_como_saldo_a_favor')?.passed).toBe(true);
    expect(findCheck(validateDevolucionesL2(M6_OK), 'M6.L2.1_f04_no_presentado_como_saldo_a_favor')?.passed).toBe(true);
  });

  it('M6.L2.1: |F04| presentado como saldo a favor devolvible falla', () => {
    const bad = {
      ...SIN_DECLARACION,
      textoAnalisis: 'El saldo a favor de $3.200.000,00 puede devolverse en 50 días hábiles.',
    };
    const c = findCheck(validateDevolucionesL2(bad), 'M6.L2.1_f04_no_presentado_como_saldo_a_favor');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('Art. 670');
  });

  it('M6.L2.1: si el saldo declarado coincide con |F04| la cifra es legítima', () => {
    const coincide = {
      ...M6_OK,
      saldoDeclaradoCents: '320000000',
      saldoAFavorCents: '320000000',
      textoAnalisis: M6_OK.textoAnalisis + ' Saldo a favor declarado: $3.200.000,00.',
    };
    expect(findCheck(validateDevolucionesL2(coincide), 'M6.L2.1_f04_no_presentado_como_saldo_a_favor')).toBeUndefined();
  });

  it('M6.L2.2: con saldo declarado cita Arts. 850, 854 y 855', () => {
    expect(findCheck(validateDevolucionesL2(M6_OK), 'M6.L2.2_citas_850_854_855')?.passed).toBe(true);
  });

  it('M6.L2.2: rango 854-860 en lugar del artículo puntual falla', () => {
    const bad = { ...M6_OK, textoAnalisis: M6_OK.textoAnalisis.replace(/Art\. 855 E\.T\./, 'Arts. 854-860 E.T.') };
    expect(findCheck(validateDevolucionesL2(bad), 'M6.L2.2_citas_850_854_855')?.passed).toBe(false);
  });

  it('M6.L2.3: sin saldo devolvible no se publica un paso de solicitud', () => {
    expect(findCheck(validateDevolucionesL2(SIN_DECLARACION), 'M6.L2.3_sin_pasos_de_solicitud')?.passed).toBe(true);
    const bad = { ...SIN_DECLARACION, pasosProcedimentales: ['Radicar la solicitud de devolución en MUISCA'] };
    expect(findCheck(validateDevolucionesL2(bad), 'M6.L2.3_sin_pasos_de_solicitud')?.passed).toBe(false);
  });
});

describe('Devoluciones Validator — L3 Requisitos', () => {
  it('M6.L3.1: lista requisitos completos pasa', () => {
    expect(findCheck(validateDevolucionesL3(M6_OK), 'M6.L3.1_requisitos_completos')?.passed).toBe(true);
  });

  it('M6.L3.1: requisitos incompletos (sin MUISCA) falla con detalle', () => {
    const bad = { ...M6_OK, documentosRequeridos: M6_OK.documentosRequeridos.filter((d) => !/MUISCA/.test(d)) };
    const c = findCheck(validateDevolucionesL3(bad), 'M6.L3.1_requisitos_completos');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('MUISCA');
  });

  it('M6.L3.1: sin saldo devolvible no se exigen requisitos de solicitud', () => {
    expect(validateDevolucionesL3(SIN_DECLARACION)).toEqual([]);
  });
});
