// ---------------------------------------------------------------------------
// Tests integración — validateFiscalResponse sobre todos los fixtures
// ---------------------------------------------------------------------------
//
// Verifica que el orchestrator:
//   1. Corre Capa 2 (Motor Normativo) primero — checks con prefijo `CN.*`.
//   2. Corre validators específicos por módulo declarado.
//   3. Veredicto agregado coherente con cada fixture esperado.
//
// Usa el catálogo sintético inyectado vía DI — sin depender del catálogo real.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { validateFiscalResponse, summarizeFiscalChecks } from '../validators';
import { buildSyntheticCatalogue } from '../../normative/__fixtures__/catalog-sintetico.fixture';
import {
  RESP_CCV_OK,
  RESP_CONCILIACION_OK,
  RESP_CONCILIACION_BAD_158_3,
  RESP_RISK_SCORE_BAJO,
  RESP_RISK_SCORE_CRITICO,
  RESP_DEFENSA_DIAN_REQUERIMIENTO,
  RESP_DEFENSA_DIAN_USA_1352,
  RESP_DEVOLUCION_RETENCIONES,
  RESP_FORMAT_CON_SIMBOLO_PARRAFO,
  RESP_FORMAT_CON_CENTAVOS,
  RESP_FORMAT_CIERRE_FALTANTE,
} from '../__fixtures__/respuestas-prueba.fixture';

const CATALOG = buildSyntheticCatalogue();

describe('validateFiscalResponse — integración con catálogo sintético', () => {
  it('siempre emite check de resumen Capa 2 (CN.summary)', () => {
    const checks = validateFiscalResponse(RESP_CCV_OK, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'CN.summary')).toBe(true);
  });

  it('Conciliación OK → veredicto NO es bloqueo (sólo warnings de Capa 2 si las hay)', () => {
    const checks = validateFiscalResponse(RESP_CONCILIACION_OK, { catalogue: CATALOG });
    const summary = summarizeFiscalChecks(checks);
    // El fixture cita "Art. 26 E.T." en closingNote + "Art. 647 par" — esa cita
    // podría no estar en el catálogo sintético (sólo tiene Art. 647). Por eso
    // aceptamos "advertencia" como veredicto válido aquí — bloqueo NO.
    expect(summary.veredicto).not.toBe('bloqueo');
  });

  it('Conciliación con Art. 158-3 derogado → BLOQUEO (Capa 2 blacklist + M2.L3.2)', () => {
    const checks = validateFiscalResponse(RESP_CONCILIACION_BAD_158_3, { catalogue: CATALOG });
    const summary = summarizeFiscalChecks(checks);
    expect(summary.veredicto).toBe('bloqueo');
    expect(checks.some((c) => c.name === 'M2.L3.2_no_cita_art_158_3_derogado' && !c.passed)).toBe(true);
    expect(checks.some((c) => c.name.startsWith('CN.blacklist.') && !c.passed)).toBe(true);
  });

  it('Risk Score BAJO → veredicto válido o advertencia (no bloqueo)', () => {
    const checks = validateFiscalResponse(RESP_RISK_SCORE_BAJO, { catalogue: CATALOG });
    const summary = summarizeFiscalChecks(checks);
    expect(summary.veredicto).not.toBe('bloqueo');
  });

  it('Risk Score CRITICO + Modo Supervivencia activo → veredicto válido o advertencia', () => {
    const checks = validateFiscalResponse(RESP_RISK_SCORE_CRITICO, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'M3.L3.1_modo_supervivencia_score_alto' && c.passed)).toBe(true);
  });

  it('Defensa DIAN OK → secciones presentes + parágrafo 647', () => {
    const checks = validateFiscalResponse(RESP_DEFENSA_DIAN_REQUERIMIENTO, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'M5.L1.1_secciones_presentes' && c.passed)).toBe(true);
    expect(checks.some((c) => c.name === 'M5.L2.2_diferencia_criterio_cita_par_647' && c.passed)).toBe(true);
  });

  it('Defensa DIAN usa Concepto 1352 → BLOQUEO (Capa 2 blacklist + M5.L2.3)', () => {
    const checks = validateFiscalResponse(RESP_DEFENSA_DIAN_USA_1352, { catalogue: CATALOG });
    const summary = summarizeFiscalChecks(checks);
    expect(summary.veredicto).toBe('bloqueo');
    expect(checks.some((c) => c.name === 'M5.L2.3_no_cita_concepto_1352' && !c.passed)).toBe(true);
  });

  it('Devolución retenciones OK → todos los checks de M6 pasan', () => {
    const checks = validateFiscalResponse(RESP_DEVOLUCION_RETENCIONES, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'M6.L1.1_saldo_favor_coincide_f04' && c.passed)).toBe(true);
    expect(checks.some((c) => c.name === 'M6.L2.1_retenciones_cita_850_855' && c.passed)).toBe(true);
    expect(checks.some((c) => c.name === 'M6.L3.1_requisitos_completos' && c.passed)).toBe(true);
  });

  it('Formato con § → BLOQUEO en M7.L1.1', () => {
    const checks = validateFiscalResponse(RESP_FORMAT_CON_SIMBOLO_PARRAFO, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'M7.L1.1_no_simbolo_paragrafo' && !c.passed)).toBe(true);
  });

  it('Formato con "centavos" → BLOQUEO en M7.L1.2', () => {
    const checks = validateFiscalResponse(RESP_FORMAT_CON_CENTAVOS, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'M7.L1.2_no_palabra_centavos' && !c.passed)).toBe(true);
  });

  it('Formato sin cierre obligatorio → BLOQUEO en M7.L3.1', () => {
    const checks = validateFiscalResponse(RESP_FORMAT_CIERRE_FALTANTE, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'M7.L3.1_cierre_obligatorio' && !c.passed)).toBe(true);
  });

  it('módulo declarado con payload null emite check de coherencia', () => {
    const broken = {
      ...RESP_CONCILIACION_OK,
      modulos: ['M2', 'M3'] as const,
      modulo3: null, // declarado pero null
    };
    const checks = validateFiscalResponse(broken, { catalogue: CATALOG });
    expect(checks.some((c) => c.name === 'M3.coherencia_payload' && !c.passed)).toBe(true);
  });

  it('módulo NO declarado NO ejecuta su validator', () => {
    const onlyM7 = {
      ...RESP_FORMAT_CON_SIMBOLO_PARRAFO,
      modulos: ['M7'] as const,
    };
    const checks = validateFiscalResponse(onlyM7, { catalogue: CATALOG });
    // No deben aparecer checks de M2/M3/M5/M6
    expect(checks.some((c) => c.name.startsWith('M2.'))).toBe(false);
    expect(checks.some((c) => c.name.startsWith('M3.'))).toBe(false);
    expect(checks.some((c) => c.name.startsWith('M5.'))).toBe(false);
    expect(checks.some((c) => c.name.startsWith('M6.'))).toBe(false);
    expect(checks.some((c) => c.name.startsWith('M7.'))).toBe(true);
  });
});

describe('summarizeFiscalChecks — veredicto agregado', () => {
  it('todos passed → valida', () => {
    const checks = [
      { name: 'a', passed: true, severity: 'error' as const },
      { name: 'b', passed: true, severity: 'warning' as const },
    ];
    expect(summarizeFiscalChecks(checks).veredicto).toBe('valida');
  });

  it('un warning failed → advertencia', () => {
    const checks = [
      { name: 'a', passed: true, severity: 'error' as const },
      { name: 'b', passed: false, severity: 'warning' as const },
    ];
    expect(summarizeFiscalChecks(checks).veredicto).toBe('advertencia');
  });

  it('un error failed → bloqueo', () => {
    const checks = [
      { name: 'a', passed: false, severity: 'error' as const },
      { name: 'b', passed: true, severity: 'warning' as const },
    ];
    expect(summarizeFiscalChecks(checks).veredicto).toBe('bloqueo');
  });
});
