// ---------------------------------------------------------------------------
// Tests — Módulo 5 · Defensa DIAN
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  validateDefensaDian,
  validateDefensaDianL1,
  validateDefensaDianL2,
  validateDefensaDianL3,
} from '../validators/defensa-dian.validator';
import type { Modulo5DefensaDian } from '../validators/types';
import {
  RESP_DEFENSA_DIAN_REQUERIMIENTO,
  RESP_DEFENSA_DIAN_USA_1352,
} from '../__fixtures__/respuestas-prueba.fixture';

const M5_OK = RESP_DEFENSA_DIAN_REQUERIMIENTO.modulo5 as Modulo5DefensaDian;
const M5_1352 = RESP_DEFENSA_DIAN_USA_1352.modulo5 as Modulo5DefensaDian;

function findCheck(checks: ReturnType<typeof validateDefensaDian>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Defensa DIAN Validator — L1 Sintaxis estructural', () => {
  it('M5.L1.1: detecta las 6 secciones obligatorias en carta canónica', () => {
    const checks = validateDefensaDianL1(M5_OK);
    const c = findCheck(checks, 'M5.L1.1_secciones_presentes');
    expect(c?.passed).toBe(true);
  });

  it('M5.L1.1: detecta sección faltante', () => {
    const bad: Modulo5DefensaDian = {
      ...M5_OK,
      cartaTexto: M5_OK.cartaTexto.replace(/## Firmas[\s\S]*$/m, ''),
    };
    const checks = validateDefensaDianL1(bad);
    const c = findCheck(checks, 'M5.L1.1_secciones_presentes');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('Firmas');
  });

  it('M5.L1.1b: secciones desordenadas son detectadas', () => {
    // Swap: pongo Firmas antes de Antecedentes
    const bad: Modulo5DefensaDian = {
      ...M5_OK,
      cartaTexto: `## Firmas\nRepresentante legal\n\n## Antecedentes\nReq. ordinario Art. 752 plazo 15 días hábiles\n\n## Posición Jurídica\nDef.\n\n## Soporte Documental\nDocs.\n\n## Defensa Art. 647\nArt. 647 par.\n\n## Petición\nArchivar.`,
    };
    const checks = validateDefensaDianL1(bad);
    const cOrden = findCheck(checks, 'M5.L1.1b_secciones_ordenadas');
    expect(cOrden?.passed).toBe(false);
  });
});

describe('Defensa DIAN Validator — L2 Lógica de negocio', () => {
  it('M5.L2.1: requerimiento Art. 752 con plazo 15 días hábiles citado pasa', () => {
    const checks = validateDefensaDianL2(M5_OK);
    const c = findCheck(checks, 'M5.L2.1_plazo_y_cita_correctos');
    expect(c?.passed).toBe(true);
  });

  it('M5.L2.1: requerimiento 685 sin "1 mes" falla', () => {
    const bad: Modulo5DefensaDian = {
      ...M5_OK,
      tipoRequerimiento: 'requerimiento_especial_685',
      // texto no menciona "1 mes"
    };
    const checks = validateDefensaDianL2(bad);
    const c = findCheck(checks, 'M5.L2.1_plazo_y_cita_correctos');
    expect(c?.passed).toBe(false);
  });

  it('M5.L2.2: invoca diferencia de criterio → cita parágrafo Art. 647', () => {
    const checks = validateDefensaDianL2(M5_OK);
    const c = findCheck(checks, 'M5.L2.2_diferencia_criterio_cita_par_647');
    expect(c?.passed).toBe(true);
  });

  it('M5.L2.3: detecta cita a Concepto 1352/2018 (blacklist CRITICA)', () => {
    const checks = validateDefensaDianL2(M5_1352);
    const c = findCheck(checks, 'M5.L2.3_no_cita_concepto_1352');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('100208221-1352');
  });

  it('M5.L2.4: mención de reducción sin cita de norma falla', () => {
    const bad: Modulo5DefensaDian = {
      ...M5_OK,
      mencionaReduccion: true,
      cartaTexto: M5_OK.cartaTexto + '\n\nSolicitamos reducción de sanción.',
    };
    const checks = validateDefensaDianL2(bad);
    const c = findCheck(checks, 'M5.L2.4_reduccion_cita_norma');
    expect(c?.passed).toBe(false);
  });

  it('M5.L2.4: mención de reducción con cita Art. 713 pasa', () => {
    const ok: Modulo5DefensaDian = {
      ...M5_OK,
      mencionaReduccion: true,
      cartaTexto:
        M5_OK.cartaTexto + '\n\nSolicitamos reducción del 50% conforme al Art. 713 E.T.',
    };
    const checks = validateDefensaDianL2(ok);
    const c = findCheck(checks, 'M5.L2.4_reduccion_cita_norma');
    expect(c?.passed).toBe(true);
  });
});

describe('Defensa DIAN Validator — L3 Defensa tributaria', () => {
  it('M5.L3.1: declara borrador para revisión profesional', () => {
    const checks = validateDefensaDianL3(M5_OK);
    const c = findCheck(checks, 'M5.L3.1_cierre_borrador_revision');
    expect(c?.passed).toBe(true);
  });

  it('M5.L3.1: sin disclaimer de borrador falla', () => {
    const bad: Modulo5DefensaDian = {
      ...M5_OK,
      cartaTexto: M5_OK.cartaTexto.replace(/Este es un borrador[^\n]*\n/i, ''),
    };
    const checks = validateDefensaDianL3(bad);
    const c = findCheck(checks, 'M5.L3.1_cierre_borrador_revision');
    expect(c?.passed).toBe(false);
  });

  it('M5.L3.2: carta cita Art. 647 E.T. (norma raíz)', () => {
    const checks = validateDefensaDianL3(M5_OK);
    const c = findCheck(checks, 'M5.L3.2_cita_art_647');
    expect(c?.passed).toBe(true);
  });
});
