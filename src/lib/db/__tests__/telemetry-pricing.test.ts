// telemetry-pricing.test.ts — Regresión de la tabla de costos.
//
// Bug corregido: PRICING no conocía `gpt-5.6-sol`, que es el DEFAULT de
// `MODEL_IDS.FINANCIAL_PIPELINE`. Todo el gasto del pipeline más caro del
// producto se contabilizaba como $0 y la alerta de costo diario >$50
// (docs/TELEMETRY.md) no podía dispararse nunca.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateCostUsdMicros,
  getModelPricing,
  normalizeModelId,
  __resetPricingCachesForTests,
} from '../telemetry-pricing';
import { MODEL_IDS } from '@/lib/config/models';

beforeEach(() => {
  __resetPricingCachesForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.UTOPIA_MODEL_PRICING_JSON;
  __resetPricingCachesForTests();
  vi.restoreAllMocks();
});

describe('pricing del modelo default del pipeline financiero', () => {
  it('el default de MODEL_IDS.FINANCIAL_PIPELINE tiene tarifa', () => {
    expect(getModelPricing(MODEL_IDS.FINANCIAL_PIPELINE)).not.toBeNull();
    expect(getModelPricing(MODEL_IDS.FINANCIAL_PIPELINE_PREMIUM)).not.toBeNull();
  });

  it('gpt-5.6-sol cobra $5/1M input y $30/1M output (tier Standard)', () => {
    // 1M input sin cache + 1M output = $35 = 35_000_000 micros.
    const micros = calculateCostUsdMicros({
      modelId: 'gpt-5.6-sol',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(micros).toBe(35_000_000);
  });

  it('los tokens cacheados cobran 1/10 del input', () => {
    const micros = calculateCostUsdMicros({
      modelId: 'gpt-5.6-sol',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(micros).toBe(500_000); // $0,50
  });
});

describe('miss de pricing', () => {
  it('devuelve null (no 0): un 0 falso silenciaría la alerta de presupuesto', () => {
    const micros = calculateCostUsdMicros({
      modelId: 'modelo-que-no-existe',
      inputTokens: 10_000,
      outputTokens: 10_000,
    });
    expect(micros).toBeNull();
  });
});

describe('normalización del modelId', () => {
  it('quita el prefijo legacy openai/ y el sufijo de snapshot', () => {
    expect(normalizeModelId('openai/GPT-5.6-Sol')).toBe('gpt-5.6-sol');
    expect(normalizeModelId('gpt-5.6-sol-2026-05-12')).toBe('gpt-5.6-sol');
    expect(normalizeModelId('gpt-5.6-sol-20260512')).toBe('gpt-5.6-sol');
  });

  it('un modelo pineado a snapshot conserva su tarifa', () => {
    expect(
      calculateCostUsdMicros({
        modelId: 'gpt-5.6-sol-2026-05-12',
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(5_000_000);
  });
});

describe('override por env (modelo publicado después del deploy)', () => {
  it('UTOPIA_MODEL_PRICING_JSON define tarifas sin redeploy', () => {
    process.env.UTOPIA_MODEL_PRICING_JSON = JSON.stringify({
      'gpt-9-futuro': { input: 10, output: 40, cached: 1 },
    });
    __resetPricingCachesForTests();
    expect(
      calculateCostUsdMicros({
        modelId: 'gpt-9-futuro',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(50_000_000);
  });

  it('un JSON inválido no rompe el cálculo', () => {
    process.env.UTOPIA_MODEL_PRICING_JSON = '{ esto no es json';
    __resetPricingCachesForTests();
    expect(
      calculateCostUsdMicros({ modelId: 'gpt-5.6-sol', inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(5_000_000);
  });
});
