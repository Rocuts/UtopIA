// ---------------------------------------------------------------------------
// Escudo — motivos propios del bloqueo del balance en el idioma del informe
// ---------------------------------------------------------------------------
// `leerBalanceEscudo` escribe dos motivos propios (texto tabular sin filas
// legibles y texto sin filas contables) además de los del preprocesador. Con
// `language: 'en'` el encabezado del error salía en inglés y esos dos motivos
// en español. Ahora siguen el idioma del informe.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { EscudoBalanceBloqueadoError, leerBalanceEscudo } from '../lib/balance-ingesta';

function bloqueo(rawData: string, language: 'es' | 'en'): EscudoBalanceBloqueadoError {
  try {
    leerBalanceEscudo(rawData, { language, sinFilas: 'bloquear' });
  } catch (e) {
    if (e instanceof EscudoBalanceBloqueadoError) return e;
    throw e;
  }
  throw new Error('se esperaba EscudoBalanceBloqueadoError');
}

const TABULAR_SIN_ENCABEZADO = [
  'titulo sin columnas',
  ...Array.from({ length: 12 }, (_, i) => `${110505 + i},Cuenta ${i},x,${1000 + i}`),
].join('\n');

describe('leerBalanceEscudo — motivos es/en', () => {
  it('texto tabular sin filas legibles: motivo en inglés con language=en', () => {
    const e = bloqueo(TABULAR_SIN_ENCABEZADO, 'en');
    expect(e.reasons).toHaveLength(1);
    expect(e.reasons[0]).toMatch(/trial balance rows could not be read/i);
    expect(e.reasons[0]).not.toMatch(/No se pudieron/);
    expect(e.message).toMatch(/^The trial balance cannot be used/);
  });

  it('texto sin filas contables: motivo en inglés con language=en', () => {
    const e = bloqueo('texto OCR libre sin tabla', 'en');
    expect(e.reasons[0]).toMatch(/No accounting rows could be read/i);
    expect(e.reasons[0]).not.toMatch(/No se pudieron/);
  });

  it('en español se conservan los motivos en español', () => {
    expect(bloqueo(TABULAR_SIN_ENCABEZADO, 'es').reasons[0]).toMatch(
      /^No se pudieron leer las filas del balance de prueba/,
    );
    expect(bloqueo('texto OCR libre sin tabla', 'es').reasons[0]).toMatch(
      /^No se pudieron leer filas contables/,
    );
  });
});
