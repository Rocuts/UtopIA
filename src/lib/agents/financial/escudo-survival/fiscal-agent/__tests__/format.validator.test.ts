// ---------------------------------------------------------------------------
// Tests — Módulo 7 · Formato y Entrega
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  validateFormat,
  validateFormatL1,
  validateFormatL2,
  validateFormatL3,
} from '../validators/format.validator';
import type { Modulo7Format } from '../validators/types';
import {
  RESP_FORMAT_CON_SIMBOLO_PARRAFO,
  RESP_FORMAT_CON_CENTAVOS,
  RESP_FORMAT_CIERRE_FALTANTE,
} from '../__fixtures__/respuestas-prueba.fixture';

const M7_OK: Modulo7Format = {
  textoSalida: `Análisis tributario rápido

El impuesto bruto es $40.250.000,00 (tarifa 35%, Art. 240 E.T.) y el impuesto neto resulta $37.250.000,00.

Cualquier interpretación divergente puede invocarse bajo el parágrafo del Art. 647 E.T.

Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.`,
  modo: 'full',
};

const M7_SIMBOLO = RESP_FORMAT_CON_SIMBOLO_PARRAFO.modulo7 as Modulo7Format;
const M7_CENTAVOS = RESP_FORMAT_CON_CENTAVOS.modulo7 as Modulo7Format;
const M7_SIN_CIERRE = RESP_FORMAT_CIERRE_FALTANTE.modulo7 as Modulo7Format;

function findCheck(checks: ReturnType<typeof validateFormat>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Format Validator — L1 Sintaxis', () => {
  it('M7.L1.1: detecta símbolo § y reporta error', () => {
    const checks = validateFormatL1(M7_SIMBOLO);
    const c = findCheck(checks, 'M7.L1.1_no_simbolo_paragrafo');
    expect(c?.passed).toBe(false);
  });

  it('M7.L1.1: pasa cuando no hay símbolo §', () => {
    const checks = validateFormatL1(M7_OK);
    const c = findCheck(checks, 'M7.L1.1_no_simbolo_paragrafo');
    expect(c?.passed).toBe(true);
  });

  it('M7.L1.2: detecta palabra "centavos" visible', () => {
    const checks = validateFormatL1(M7_CENTAVOS);
    const c = findCheck(checks, 'M7.L1.2_no_palabra_centavos');
    expect(c?.passed).toBe(false);
  });

  it('M7.L1.3: detecta formato anglo $1,234,567.89', () => {
    const bad: Modulo7Format = {
      ...M7_OK,
      textoSalida: `Impuesto $1,234,567.89. ${M7_OK.textoSalida}`,
    };
    const checks = validateFormatL1(bad);
    const c = findCheck(checks, 'M7.L1.3_formato_peso_es_co');
    expect(c?.passed).toBe(false);
  });

  it('M7.L1.4: modo quick > 5 líneas falla', () => {
    const bad: Modulo7Format = {
      modo: 'quick',
      textoSalida: `Línea 1
Línea 2
Línea 3
Línea 4
Línea 5
Línea 6
Línea 7

Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.`,
    };
    const checks = validateFormatL1(bad);
    const c = findCheck(checks, 'M7.L1.4_quick_lineas_max');
    expect(c?.passed).toBe(false);
  });

  it('M7.L1.5: modo full > 4000 caracteres falla', () => {
    const bad: Modulo7Format = {
      modo: 'full',
      textoSalida: 'X'.repeat(4500),
    };
    const checks = validateFormatL1(bad);
    const c = findCheck(checks, 'M7.L1.5_full_caracteres_max');
    expect(c?.passed).toBe(false);
  });
});

describe('Format Validator — L2 Tono profesional', () => {
  it('M7.L2.1: pasa con tono profesional', () => {
    const checks = validateFormatL2(M7_OK);
    const c = findCheck(checks, 'M7.L2.1_tono_profesional');
    expect(c?.passed).toBe(true);
  });

  it('M7.L2.1: detecta tono marketing-y ("compra ya")', () => {
    const bad: Modulo7Format = {
      ...M7_OK,
      textoSalida:
        '¡Compra ya nuestro servicio! Oferta limitada. ' + M7_OK.textoSalida,
    };
    const checks = validateFormatL2(bad);
    const c = findCheck(checks, 'M7.L2.1_tono_profesional');
    expect(c?.passed).toBe(false);
  });
});

describe('Format Validator — L3 Cierre obligatorio', () => {
  it('M7.L3.1: pasa con cierre obligatorio exacto', () => {
    const checks = validateFormatL3(M7_OK);
    const c = findCheck(checks, 'M7.L3.1_cierre_obligatorio');
    expect(c?.passed).toBe(true);
  });

  it('M7.L3.1: detecta cierre faltante', () => {
    const checks = validateFormatL3(M7_SIN_CIERRE);
    const c = findCheck(checks, 'M7.L3.1_cierre_obligatorio');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('Art. 647');
  });

  it('M7.L3.1: tolera mayúsculas/minúsculas y espacios extra', () => {
    const variante: Modulo7Format = {
      ...M7_OK,
      textoSalida:
        'Análisis completo.\n\n  Este  ANÁLISIS  fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.  ',
    };
    const checks = validateFormatL3(variante);
    const c = findCheck(checks, 'M7.L3.1_cierre_obligatorio');
    expect(c?.passed).toBe(true);
  });
});
