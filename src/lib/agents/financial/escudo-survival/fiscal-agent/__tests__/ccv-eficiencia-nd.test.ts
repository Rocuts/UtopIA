// Eficiencia fiscal del Módulo 1 (CCV): sin impuesto de referencia positivo
// (F02 ≤ 0) F10 no es una cobertura —el Âncora la deja en 0 por falta de
// denominador— y con F10 no finito o negativo tampoco hay razón válida. En
// esos casos la clase es null (N/D), nunca 'media' ni 'baja': antes se
// devolvía 'media' como "placeholder neutro", una clasificación inventada.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clasificarEficienciaFiscal } from '../tools/ccv-calculator';
import { runCcvFiscalAgent } from '../agents/ccv-fiscal.agent';
import { runSynthesizer } from '../agents/synthesizer.agent';
import { buildCcvFiscalPrompt } from '../prompts/ccv-fiscal.prompt';
import { ccvModuleSchema } from '../schemas';
import type { CcvModuleResult, FiscalAgentInput, RiskScoreModuleResult } from '../types';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

type LlmCall = { module: string; userContent: string };
const calls = vi.hoisted(() => ({ list: [] as LlmCall[], ccvEficiencia: 'alta' as string | null }));

// El LLM intenta imponer su propia clase: el snapshot determinístico gana.
vi.mock('../runtime', () => ({
  callFiscalAgent: vi.fn(async (args: LlmCall) => {
    calls.list.push({ module: args.module, userContent: args.userContent });
    if (args.module === 'ccv') {
      return { json: { markdown: 'Análisis', warnings: [], data: { eficienciaFiscal: calls.ccvEficiencia } } };
    }
    return { json: { markdown: 'Dictamen', topRecommendations: [], cierre: 'x' } };
  }),
}));

function anchor(f02: string, f10: number): FiscalAnchorBlock {
  return {
    f01: '100000', f02, f03: '0', f04: '0', f05: '0', f06: '0', f07: '0', f08: '0',
    f09: 0,
    f10,
    calendarioDian: { nit: '900123456-8', ultimoDigito: 8, periodo: '2025', vencimientos: [], alertaAnticipacionDias: 15 },
    alertas: [],
    fuente: { periodo: '2025', balanceHash: 'test' },
  };
}

function input(fiscalAnchor: FiscalAnchorBlock): FiscalAgentInput {
  return { fiscalAnchor, language: 'es', company: { name: 'Prueba SAS', nit: '900123456-8' } } as FiscalAgentInput;
}

beforeEach(() => {
  calls.list = [];
  calls.ccvEficiencia = 'alta';
});

describe('clasificarEficienciaFiscal — la clase exige su denominador', () => {
  it.each(['0', '-100'])('F02=%s es N/D aunque F10 diga "alta"', (f02) => {
    expect(clasificarEficienciaFiscal(anchor(f02, 80))).toBeNull();
    // El caso real: el Âncora deja F10 en 0 cuando F02 ≤ 0.
    expect(clasificarEficienciaFiscal(anchor(f02, 0))).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, -1])('F10=%s no es una cobertura válida: N/D', (f10) => {
    expect(clasificarEficienciaFiscal(anchor('100', f10))).toBeNull();
  });

  it.each([
    [0, 'baja'],
    [49.99, 'baja'],
    [50, 'media'],
    [79.99, 'media'],
    [80, 'alta'],
    [120, 'alta'],
  ] as const)('con F02 positivo conserva los umbrales: F10=%s → %s', (f10, esperado) => {
    expect(clasificarEficienciaFiscal(anchor('100', f10))).toBe(esperado);
  });
});

describe('Módulo 1 — el snapshot manda sobre el LLM', () => {
  it('F02 ≤ 0: la clase del LLM se descarta y queda null', async () => {
    calls.ccvEficiencia = 'alta';
    const ccv = await runCcvFiscalAgent({ input: input(anchor('0', 0)) });
    expect(ccv.data.eficienciaFiscal).toBeNull();
  });

  it('F02 > 0: la clase calculada gana a la del LLM', async () => {
    calls.ccvEficiencia = 'baja';
    const ccv = await runCcvFiscalAgent({ input: input(anchor('100', 85)) });
    expect(ccv.data.eficienciaFiscal).toBe('alta');
  });

  it('el contexto del LLM dice N/D, no null ni una clase', async () => {
    await runCcvFiscalAgent({ input: input(anchor('0', 0)) });
    const ctx = calls.list.find((c) => c.module === 'ccv')!.userContent;
    expect(ctx).toContain('EFICIENCIA_FISCAL: N/D');
    expect(ctx).not.toMatch(/EFICIENCIA_FISCAL: (null|undefined|alta|media|baja)/);
  });

  it('el sintetizador también recibe N/D', async () => {
    const ccv = await runCcvFiscalAgent({ input: input(anchor('0', 0)) });
    await runSynthesizer({
      input: input(anchor('0', 0)),
      modules: {
        ccv,
        riskScore: {
          markdown: '', warnings: [],
          data: { publicable: false, noPublicableMotivo: 'prueba' },
        } as unknown as RiskScoreModuleResult,
        conciliacion: null, planeacion: null, defensaDian: null, devoluciones: null, supervivencia: null,
      },
    });
    const ctx = calls.list.find((c) => c.module === 'synthesizer')!.userContent;
    expect(ctx).toContain('eficiencia: N/D');
    expect(ctx).not.toMatch(/eficiencia: (null|undefined|alta|media|baja)/);
  });
});

describe('prompt y esquema del Módulo 1', () => {
  it('el prompt pide copiar la clase y tratar N/D como no determinable', () => {
    const prompt = buildCcvFiscalPrompt('es');
    expect(prompt).not.toContain('salvo que justifiques el cambio');
    expect(prompt).toContain('null cuando EFICIENCIA_FISCAL es N/D');
    expect(prompt).toContain('If EFICIENCIA_FISCAL es N/D entonces');
    // La regla de cobertura baja no se dispara sobre el F10 = 0 construido.
    expect(prompt).toContain('If F02 > 0 y F10 < 50%');
  });

  it('el esquema acepta null (nullable) y sigue exigiendo el campo', () => {
    const base: CcvModuleResult = {
      markdown: 'x', warnings: [],
      data: {
        f01: '0', f02: '0', f03: '0', f04: '0', f05: '0', f06: '0', f07: '0', f08: '0',
        f09Pct: 0, f10Pct: 0,
        alertaTasaMinima: { aplica: null, f09Actual: 0, brechaPp: null, impuestoAdicionalEstimado: null, norma: 'Art. 240 par. 6 E.T.' },
        eficienciaFiscal: null,
      },
    };
    expect(ccvModuleSchema.safeParse(base).success).toBe(true);
    const { eficienciaFiscal: _omitida, ...sinCampo } = base.data;
    void _omitida;
    expect(ccvModuleSchema.safeParse({ ...base, data: sinCampo }).success).toBe(false);
    expect(ccvModuleSchema.safeParse({ ...base, data: { ...base.data, eficienciaFiscal: 'n/d' } }).success).toBe(false);
  });
});
