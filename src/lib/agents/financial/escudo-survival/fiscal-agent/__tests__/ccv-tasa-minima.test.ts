import { describe, it, expect, vi } from 'vitest';
import { buildAlertaTasaMinima, clasificarEficienciaFiscal } from '../tools/ccv-calculator';
import { runCcvFiscalAgent } from '../agents/ccv-fiscal.agent';
import { runSupervivenciaAgent } from '../agents/supervivencia.agent';
import type { FiscalAgentInput } from '../types';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

/** UAI del balance real Grupo Empresarial 2 Tres SAS 2025: $2.228.496.789,73. */
const UAI_CENTS = '222849678973';

function anchorConF09(f09: number, f01: string = UAI_CENTS): FiscalAnchorBlock {
  return {
    f01,
    f02: '0',
    f03: '0',
    f04: '0',
    f05: '0',
    f06: '0',
    f07: '0',
    f08: '0',
    f09,
    f10: 0,
    calendarioDian: {
      nit: '901714014-6',
      ultimoDigito: 4,
      periodo: '2025',
      vencimientos: [],
      alertaAnticipacionDias: 15,
    },
    alertas: [],
    fuente: { periodo: '2025', balanceHash: 'test' },
  };
}

describe('TTD requires adjusted tax and adjusted profit, not accounting proxies', () => {
  it.each([0, 10, 14.9, 14.94, 14.96, 15, 35])('F09=%s does not establish legal applicability or additional tax', f09 => {
    const a = buildAlertaTasaMinima(anchorConF09(f09));
    expect(a.aplica).toBeNull();
    expect(a.brechaPp).toBeNull();
    expect(a.impuestoAdicionalEstimado).toBeNull();
    expect(a.f09Actual).toBe(f09);
  });
  it.each(['0', '-100'])('UAI=%s does not prove that adjusted profit is nonpositive', f01 => {
    expect(buildAlertaTasaMinima(anchorConF09(0, f01)).aplica).toBeNull();
  });
});

vi.mock('../runtime', () => ({ callFiscalAgent: vi.fn(async () => ({ json: {
  markdown: 'Analysis', warnings: [], data: { f01: '999', eficienciaFiscal: 'alta',
    alertaTasaMinima: { aplica: true, impuestoAdicionalEstimado: '999' },
    tet: { tetActual: 99, brecha15Pct: 99, impuestoAdicional: '999' } },
} })) }));
vi.mock('../tools/risk-score-calculator', () => ({ computeRiskScore: () => ({
  score: 0, nivel: 'bajo', factores: [],
}) }));

it('LLM output cannot override fiscal anchors or invent TTD in either module', async () => {
  const input = { fiscalAnchor: anchorConF09(14.96), language: 'es',
    company: { name: 'Test', nit: '901714014-6' },
  } as FiscalAgentInput;
  const ccv = await runCcvFiscalAgent({ input });
  expect(ccv.data.f01).toBe(UAI_CENTS);
  expect(ccv.data.eficienciaFiscal).toBeNull();
  expect(ccv.data.alertaTasaMinima.aplica).toBeNull();
  expect(ccv.data.alertaTasaMinima.impuestoAdicionalEstimado).toBeNull();
  expect(ccv.warnings.join(' ')).toContain('TTD no determinable');
  const survival = await runSupervivenciaAgent({ input });
  expect(survival.data.tet).toEqual({ tetActual: 14.96, brecha15Pct: null, impuestoAdicional: null });
});


describe('Coverage classification requires its denominator', () => {
  it.each(['0', '-100'])('F02=%s is unavailable, not medium efficiency', f02 => {
    expect(clasificarEficienciaFiscal({ ...anchorConF09(10), f02, f10: 80 })).toBeNull();
  });
  it.each([NaN, Infinity, -1])('invalid coverage %s is unavailable', f10 => {
    expect(clasificarEficienciaFiscal({ ...anchorConF09(10), f02: '100', f10 })).toBeNull();
  });
  it.each([[0, 'baja'], [49.99, 'baja'], [50, 'media'], [79.99, 'media'], [80, 'alta']])('preserves existing coverage thresholds for %s', (f10, expected) => {
    expect(clasificarEficienciaFiscal({ ...anchorConF09(10), f02: '100', f10: f10 as number })).toBe(expected);
  });
});
