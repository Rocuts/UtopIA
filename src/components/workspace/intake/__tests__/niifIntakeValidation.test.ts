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

// ---------------------------------------------------------------------------
// P4 (auditoría integral 2026-09-24, pendiente #4): unidad pendiente de
// confirmar y confirmaciones del intake escritas en `rawData`.
// ---------------------------------------------------------------------------
import {
  UNIT_PENDING_LABEL,
  applyIntakeDirectives,
  parseMaturityOverrideCode,
} from '../niifIntakeValidation';
import { buildExtractedFields } from '../useDocumentExtraction';
import { leerDirectivasIngesta } from '@/lib/upload/ingest-directives';

describe('P4-a — unidad declarada sin confirmar bloquea el paso "Revisar"', () => {
  it('con la unidad pendiente falta un campo; confirmada, no', () => {
    expect(collectMissingRequired(empresaCompleta, '1105,Caja,1', { unitPending: true })).toEqual([
      UNIT_PENDING_LABEL,
    ]);
    expect(isReviewStepValid(empresaCompleta, '1105,Caja,1', { unitPending: false })).toBe(true);
  });

  it('buildExtractedFields conserva la unidad y los motivos de ingesta de /api/upload', () => {
    const unit = { declared: 'miles' as const, declaredText: 'Saldo 2025 (miles)', confirmed: null, requiresConfirmation: true };
    const extracted = buildExtractedFields({
      success: true,
      filename: 'b.csv',
      chunks: 0,
      extractedText: 'x',
      rawData: 'codigo,nombre,Saldo 2025 (miles)\n110505,Caja,1',
      detectedCaseType: null,
      isTrialBalance: true,
      preprocessed: null,
      detectedPeriods: [],
      ingestErrors: ['conflicto'],
      unit,
      message: 'ok',
    });
    expect(extracted.unit).toEqual(unit);
    expect(extracted.ingestErrors).toEqual(['conflicto']);
    expect(extracted.rawText.startsWith('codigo')).toBe(true);
  });
});

describe('P4 — applyIntakeDirectives', () => {
  const CSV = 'codigo,nombre,saldo 2025\n110505,Caja,100\n310505,Capital,100';

  it('sin confirmaciones devuelve el texto intacto (no regresión)', () => {
    expect(applyIntakeDirectives(CSV, { vencimientos: {} })).toBe(CSV);
    expect(applyIntakeDirectives(CSV, {})).toBe(CSV);
  });

  it('escribe las excepciones y la unidad pegada; conserva la unidad que ya confirmó el upload', () => {
    const conUnidad = `[unidad-confirmada=miles]\n${CSV}`;
    const out = applyIntakeDirectives(conUnidad, { vencimientos: { '2105': 'no_corriente' } });
    const d = leerDirectivasIngesta(out);
    expect(d.unidadConfirmada).toBe('miles');
    expect(d.vencimientos).toEqual({ '2105': 'no_corriente' });
    expect(d.resto).toBe(CSV);

    const pegado = leerDirectivasIngesta(applyIntakeDirectives(CSV, { unidadConfirmada: 'millones' }));
    expect(pegado.unidadConfirmada).toBe('millones');
  });

  it('parseMaturityOverrideCode normaliza puntos y rechaza clases distintas de 1 y 2', () => {
    expect(parseMaturityOverrideCode('21.05')).toEqual({ ok: true, code: '2105' });
    expect(parseMaturityOverrideCode('4135').ok).toBe(false);
    expect(parseMaturityOverrideCode('abc').ok).toBe(false);
  });
});
