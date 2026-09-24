// ---------------------------------------------------------------------------
// toFriendlyError — el bloqueo del balance muestra sus razones (I4-escudo 1)
// ---------------------------------------------------------------------------
// `EscudoBalanceBloqueadoError` no coincidía con ningún patrón y salía como
// «Ocurrio un error interno… referencia <uuid>»: el usuario no veía que el
// balance tenía la unidad sin confirmar o un descuadre. Se reconoce por forma
// (code 'BALANCE_VALIDATION_FAILED' + reasons) y se muestran las razones.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { toFriendlyError } from '../gateway-errors';
import { EscudoBalanceBloqueadoError } from '@/lib/agents/financial/escudo-survival/lib/balance-ingesta';

const MOTIVO = '[2025] La ecuacion contable no cuadra: Activo (100) != Pasivo (40) + Patrimonio (50).';

describe('toFriendlyError — balance bloqueado', () => {
  it('es: devuelve las razones con código propio, no el error interno genérico', () => {
    const f = toFriendlyError(new EscudoBalanceBloqueadoError([MOTIVO]), 'es');
    expect(f.code).toBe('balance_validation_failed');
    expect(f.message).toContain(MOTIVO);
    expect(f.message).toMatch(/balance de prueba/i);
    expect(f.message).not.toMatch(/error interno/i);
  });

  it('en: encabezado en inglés con las mismas razones', () => {
    const f = toFriendlyError(new EscudoBalanceBloqueadoError([MOTIVO], 'en'), 'en');
    expect(f.message).toMatch(/trial balance/i);
    expect(f.message).toContain(MOTIVO);
  });

  it('un error sin razones o con otro código sigue al genérico', () => {
    const sinRazones = Object.assign(new Error('x'), { code: 'BALANCE_VALIDATION_FAILED', reasons: [] });
    expect(toFriendlyError(sinRazones).code).toBe('internal_error');
    const otro = Object.assign(new Error('x'), { code: 'OTRO', reasons: ['a'] });
    expect(toFriendlyError(otro).code).toBe('internal_error');
  });
});
