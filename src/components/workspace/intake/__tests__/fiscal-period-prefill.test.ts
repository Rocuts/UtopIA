// pipeline-flujo-17 (a) — el periodo fiscal del intake NIIF.
//
// DEFAULT_VALUES fija `fiscalPeriod` = año actual − 1 y el prefill sólo
// rellenaba el campo si estaba VACÍO, así que el periodo extraído del balance
// nunca corregía el valor por defecto: un balance 2024 subido en 2026 se
// enviaba como ejercicio 2025 y el servidor sellaba el informe por periodo
// incoherente. El periodo del balance (`preprocessed.primary.period`) ahora
// sustituye al valor por defecto salvo que el usuario haya editado el campo.
import { describe, it, expect } from 'vitest';
import {
  fiscalPeriodFromPreprocessed,
  resolveExtractedFiscalPeriod,
} from '../niifIntakeValidation';

describe('fiscalPeriodFromPreprocessed', () => {
  it('toma el año del periodo primario del balance', () => {
    expect(fiscalPeriodFromPreprocessed({ primary: { period: '2024' } })).toBe('2024');
    expect(fiscalPeriodFromPreprocessed({ primary: { period: '2025-06' } })).toBe('2025');
    expect(fiscalPeriodFromPreprocessed({ primary: { period: 'Saldo Dic 2023' } })).toBe('2023');
  });

  it('sin periodo reconocible no inventa un año', () => {
    expect(fiscalPeriodFromPreprocessed(null)).toBeUndefined();
    expect(fiscalPeriodFromPreprocessed({ primary: { period: 'Saldo final' } })).toBeUndefined();
    expect(fiscalPeriodFromPreprocessed({ primary: {} })).toBeUndefined();
    expect(fiscalPeriodFromPreprocessed('2024')).toBeUndefined();
  });
});

describe('resolveExtractedFiscalPeriod', () => {
  it('el periodo del balance sustituye al valor por defecto del intake', () => {
    expect(
      resolveExtractedFiscalPeriod({ current: '2025', extracted: '2024', userEdited: false }),
    ).toBe('2024');
  });

  it('respeta la edición explícita del usuario', () => {
    expect(
      resolveExtractedFiscalPeriod({ current: '2022', extracted: '2024', userEdited: true }),
    ).toBe('2022');
  });

  it('rellena un campo vacío aunque el usuario lo haya tocado', () => {
    expect(
      resolveExtractedFiscalPeriod({ current: '  ', extracted: '2024', userEdited: true }),
    ).toBe('2024');
  });

  it('sin periodo extraído conserva el valor actual', () => {
    expect(
      resolveExtractedFiscalPeriod({ current: '2025', extracted: undefined, userEdited: false }),
    ).toBe('2025');
  });
});
