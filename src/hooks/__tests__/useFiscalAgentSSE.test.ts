// tributario-modulos-02 (integración W3-B, auditoría 2026-09). La ruta
// /api/escudo/fiscal y el orquestador aceptan `saldoAFavorDeclaradoCents` (saldo
// a favor LIQUIDADO en el Formulario 110, MoneyCop) para que el módulo de
// devoluciones no parta de F04, que es una estimación contable. El hook del
// cliente no lo reenviaba: el análisis quedaba siempre N/D.
import { describe, expect, it } from 'vitest';

import { buildFiscalAgentRequestBody } from '../useFiscalAgentSSE';

describe('useFiscalAgentSSE — cuerpo de la solicitud', () => {
  it('reenvía saldoAFavorDeclaradoCents cuando existe', () => {
    const body = buildFiscalAgentRequestBody({
      rawData: 'csv',
      mode: 'full',
      saldoAFavorDeclaradoCents: '1500000000',
    });
    expect(body.saldoAFavorDeclaradoCents).toBe('1500000000');
  });

  it('lo omite cuando no se conoce (no envía 0 ni cadena vacía)', () => {
    const sinDato = buildFiscalAgentRequestBody({ rawData: 'csv', mode: 'full' });
    expect('saldoAFavorDeclaradoCents' in sinDato).toBe(false);
    const vacio = buildFiscalAgentRequestBody({ rawData: 'csv', mode: 'full', saldoAFavorDeclaradoCents: '' });
    expect('saldoAFavorDeclaradoCents' in vacio).toBe(false);
  });

  it('conserva el resto del contrato (idioma por defecto es)', () => {
    const body = buildFiscalAgentRequestBody({ rawData: 'csv', mode: 'full', company: { nit: '900123456-1' } });
    expect(body).toMatchObject({ rawData: 'csv', mode: 'full', language: 'es', company: { nit: '900123456-1' } });
  });
});
