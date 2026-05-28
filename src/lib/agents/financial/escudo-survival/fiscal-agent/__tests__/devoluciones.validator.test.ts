// ---------------------------------------------------------------------------
// Tests — Módulo 6 · Devoluciones y Saldos a Favor
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

function findCheck(checks: ReturnType<typeof validateDevoluciones>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Devoluciones Validator — L1 Aritmética', () => {
  it('M6.L1.1: saldo a favor = |F04| (signo negativo) en fixture canónico', () => {
    const checks = validateDevolucionesL1(M6_OK);
    const c = findCheck(checks, 'M6.L1.1_saldo_favor_coincide_f04');
    expect(c?.passed).toBe(true);
  });

  it('M6.L1.1: detecta desbalance saldo-vs-F04', () => {
    const bad: Modulo6Devoluciones = {
      ...M6_OK,
      f04CitadoCents: '-400000000', // |F04| = 4M ≠ saldo 5M
    };
    const checks = validateDevolucionesL1(bad);
    const c = findCheck(checks, 'M6.L1.1_saldo_favor_coincide_f04');
    expect(c?.passed).toBe(false);
  });
});

describe('Devoluciones Validator — L2 Lógica de negocio', () => {
  it('M6.L2.1: retenciones cita Art. 850 + 855 correctamente', () => {
    const checks = validateDevolucionesL2(M6_OK);
    const c = findCheck(checks, 'M6.L2.1_retenciones_cita_850_855');
    expect(c?.passed).toBe(true);
  });

  it('M6.L2.1: si usa rango 854-860 (incorrecto) falla', () => {
    const bad: Modulo6Devoluciones = {
      ...M6_OK,
      textoAnalisis:
        'Conforme al Art. 850 y al rango Art. 854-860 E.T., procede la devolución. Art. 855 E.T. también aplicable. Art. 854 prescribe 2 años.',
    };
    const checks = validateDevolucionesL2(bad);
    const c = findCheck(checks, 'M6.L2.1_retenciones_cita_850_855');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('rango 854-860');
  });

  it('M6.L2.2: origen IVA requiere cita Art. 815 (compensación)', () => {
    const ivaSinCompensacion: Modulo6Devoluciones = {
      ...M6_OK,
      origen: 'iva',
      textoAnalisis:
        'Saldo a favor en IVA. Solicitar devolución conforme al Art. 850 E.T. Art. 854 prescripción 2 años. Art. 855 plazos 50 días hábiles.',
    };
    const checks = validateDevolucionesL2(ivaSinCompensacion);
    const c = findCheck(checks, 'M6.L2.2_iva_cita_815_compensacion');
    expect(c?.passed).toBe(false);
  });

  it('M6.L2.3: cita Art. 854 (prescripción 2 años) en fixture pasa', () => {
    const checks = validateDevolucionesL2(M6_OK);
    const c = findCheck(checks, 'M6.L2.3_prescripcion_cita_854');
    expect(c?.passed).toBe(true);
  });
});

describe('Devoluciones Validator — L3 Defensa tributaria', () => {
  it('M6.L3.1: lista requisitos completos pasa', () => {
    const checks = validateDevolucionesL3(M6_OK);
    const c = findCheck(checks, 'M6.L3.1_requisitos_completos');
    expect(c?.passed).toBe(true);
  });

  it('M6.L3.1: requisitos incompletos (sin MUISCA) falla con detalle', () => {
    const bad: Modulo6Devoluciones = {
      ...M6_OK,
      listaRequisitos: [
        // No MUISCA
        'Certificación del contador público',
        'Relación de retenedores con NIT',
        'Copia de la declaración tributaria',
      ],
    };
    const checks = validateDevolucionesL3(bad);
    const c = findCheck(checks, 'M6.L3.1_requisitos_completos');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('MUISCA');
  });
});
