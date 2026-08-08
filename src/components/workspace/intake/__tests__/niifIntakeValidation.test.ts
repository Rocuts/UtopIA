import { describe, it, expect } from 'vitest';
import {
  RAW_DATA_LABEL,
  collectMissingRequired,
  isReviewStepValid,
  resolveNiifRawData,
} from '../niifIntakeValidation';

/**
 * Regresión del callejón sin salida "Llenar manualmente".
 *
 * Antes: `handleSkipUpload` mandaba al paso 2 y ningún paso posterior pedía
 * datos contables; `isValid` del paso "Revisar" solo miraba empresa/NIT/periodo/
 * grupo. El usuario terminaba los 4 pasos y el pipeline reventaba con
 * HTTP 400 «rawData: Raw accounting data is required»
 * (src/lib/validation/schemas.ts → financialReportRequestSchema).
 */

const empresaCompleta = {
  company: {
    name: 'Inversiones Colombia S.A.S.',
    nit: '900.123.456-7',
    entityType: 'SAS' as const,
    sector: 'Servicios',
    city: 'Bogotá D.C.',
    legalRepresentative: '',
    accountant: '',
    fiscalAuditor: '',
  },
  fiscalPeriod: '2025',
  niifGroup: 2 as const,
};

describe('resolveNiifRawData', () => {
  it('prefiere el texto extraído por OCR sobre lo tecleado', () => {
    expect(resolveNiifRawData('  1105 CAJA 100  ', 'pegado a mano')).toBe('1105 CAJA 100');
  });

  it('cae al texto pegado a mano cuando no hubo extracción', () => {
    expect(resolveNiifRawData(undefined, '  1105 CAJA 100 ')).toBe('1105 CAJA 100');
  });

  it('devuelve cadena vacía cuando no hay ninguna fuente (ruta "Llenar manualmente")', () => {
    expect(resolveNiifRawData(undefined, undefined)).toBe('');
    expect(resolveNiifRawData(null, '   \n  ')).toBe('');
  });
});

describe('collectMissingRequired', () => {
  it('bloquea el paso Revisar cuando no hay balance, aunque la empresa esté completa', () => {
    const rawData = resolveNiifRawData(undefined, '');
    const missing = collectMissingRequired(empresaCompleta, rawData);

    // Sin el fix esta lista venía vacía y el wizard dejaba llegar al submit.
    expect(missing).toContain(RAW_DATA_LABEL);
    expect(isReviewStepValid(empresaCompleta, rawData)).toBe(false);
  });

  it('desbloquea en cuanto el usuario pega el balance a mano', () => {
    const rawData = resolveNiifRawData(undefined, '1105 CAJA GENERAL 12500000');
    expect(collectMissingRequired(empresaCompleta, rawData)).toEqual([]);
    expect(isReviewStepValid(empresaCompleta, rawData)).toBe(true);
  });

  it('sigue reportando los campos de empresa faltantes junto al balance', () => {
    const missing = collectMissingRequired(
      { ...empresaCompleta, company: { ...empresaCompleta.company, name: '  ', nit: '' } },
      '',
    );
    expect(missing).toEqual(['Razón Social', 'NIT', RAW_DATA_LABEL]);
  });

  it('no bloquea cuando el balance llegó por OCR', () => {
    const rawData = resolveNiifRawData('1105 CAJA 12500000', '');
    expect(collectMissingRequired(empresaCompleta, rawData)).toEqual([]);
  });
});
