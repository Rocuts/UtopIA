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
import { classificationFromKind } from '../tools/dian-letter-builder';
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
  it('M5.L1.1: detecta las secciones del esqueleto en carta canónica', () => {
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
      cartaTexto: `## Firmas\nRepresentante legal\n\n## Antecedentes\nReq. ordinario Art. 686\n\n## Posición Jurídica\nDef.\n\n## Soporte Documental\nDocs.\n\n## Defensa Art. 647\nArt. 647 par.\n\n## Petición\nArchivar.`,
    };
    const checks = validateDefensaDianL1(bad);
    const cOrden = findCheck(checks, 'M5.L1.1b_secciones_ordenadas');
    expect(cOrden?.passed).toBe(false);
  });

  it('M5.L1.1: sin diferencia de criterio la sección del Art. 647 no se exige', () => {
    const sin647: Modulo5DefensaDian = {
      ...M5_OK,
      defensaArt647: null,
      cartaTexto: M5_OK.cartaTexto.replace(/## Defensa Art\. 647 E\.T\.[\s\S]*?(?=## Petición)/, ''),
    };
    expect(findCheck(validateDefensaDianL1(sin647), 'M5.L1.1_secciones_presentes')?.passed).toBe(true);
    const con647 = { ...sin647, defensaArt647: 'Parágrafo Art. 647 E.T.' };
    expect(findCheck(validateDefensaDianL1(con647), 'M5.L1.1_secciones_presentes')?.passed).toBe(false);
  });
});

describe('Defensa DIAN Validator — L2 Plazos, citas y reducciones', () => {
  it('M5.L2.1: plazo y norma publicados = clasificación determinista del tipo', () => {
    expect(findCheck(validateDefensaDianL2(M5_OK), 'M5.L2.1_plazo_y_norma_deterministas')?.passed).toBe(true);
  });

  it('M5.L2.1: pliego de cargos publicado con «3 meses» (plazo del requerimiento especial) falla', () => {
    // tributario-modulos-13: el traslado de cargos es de 1 mes; los 3 meses
    // del Art. 707 son del requerimiento especial.
    const bad: Modulo5DefensaDian = {
      ...M5_OK,
      tipoRequerimiento: 'pliego_cargos',
      plazoRespuesta: '3 meses (Art. 707 E.T.)',
      normaPlazo: 'Art. 707 E.T.',
    };
    const c = findCheck(validateDefensaDianL2(bad), 'M5.L2.1_plazo_y_norma_deterministas');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('1 mes');
  });

  it('M5.L2.1b: carta que no cita la norma del plazo deja aviso (no bloqueo)', () => {
    const bad: Modulo5DefensaDian = { ...M5_OK, cartaTexto: M5_OK.cartaTexto.replace(/\(Arts\. 684 y 686 E\.T\.\)/, '') };
    const c = findCheck(validateDefensaDianL2(bad), 'M5.L2.1b_carta_cita_norma_del_plazo');
    expect(c?.passed).toBe(false);
    expect(c?.severity).toBe('warning');
    expect(findCheck(validateDefensaDianL2(M5_OK), 'M5.L2.1b_carta_cita_norma_del_plazo')?.passed).toBe(true);
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
      cartaTexto: M5_OK.cartaTexto + '\n\nSolicitamos reducción de sanción.',
    };
    const c = findCheck(validateDefensaDianL2(bad), 'M5.L2.4_reduccion_cita_norma');
    expect(c?.passed).toBe(false);
  });

  it('M5.L2.4: la reducción debe citar una norma disponible para el tipo de actuación', () => {
    const liquidacion = classificationFromKind('liquidacion_oficial_revision');
    const base: Modulo5DefensaDian = {
      ...M5_OK,
      tipoRequerimiento: 'liquidacion_oficial_revision',
      plazoRespuesta: liquidacion.plazoRespuesta,
      normaPlazo: liquidacion.normaPlazo,
    };
    const ok = { ...base, cartaTexto: base.cartaTexto + '\n\nSolicitamos la reducción a la mitad conforme al Art. 713 E.T.' };
    expect(findCheck(validateDefensaDianL2(ok), 'M5.L2.4_reduccion_cita_norma')?.passed).toBe(true);
    const bad = { ...base, cartaTexto: base.cartaTexto + '\n\nSolicitamos la reducción conforme al Art. 644 E.T.' };
    expect(findCheck(validateDefensaDianL2(bad), 'M5.L2.4_reduccion_cita_norma')?.passed).toBe(false);
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

  it('M5.L3.2: requerimiento especial sin cita del Art. 647 deja aviso', () => {
    const especial = classificationFromKind('requerimiento_especial');
    const bad: Modulo5DefensaDian = {
      ...M5_OK,
      tipoRequerimiento: 'requerimiento_especial',
      plazoRespuesta: especial.plazoRespuesta,
      normaPlazo: especial.normaPlazo,
      defensaArt647: null,
      cartaTexto: 'Antecedentes: requerimiento especial (Art. 703 E.T.).',
    };
    const c = findCheck(validateDefensaDianL3(bad), 'M5.L3.2_cita_art_647');
    expect(c?.passed).toBe(false);
    expect(c?.severity).toBe('warning');
    // En un requerimiento ordinario de información no se exige.
    expect(findCheck(validateDefensaDianL3(M5_OK), 'M5.L3.2_cita_art_647')).toBeUndefined();
  });
});
