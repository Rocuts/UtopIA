// ---------------------------------------------------------------------------
// /api/escudo-survival — el Âncora Fiscal se valida antes de entregarse
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-03, integración W3-B):
// `validateFiscalAnchorAll` estaba en cuarentena sin llamador. Corregidas sus
// reglas (plazos del Decreto 2229/2023, lista blanca de crédito de renta,
// normas de L1.2/L3.1), `validateSurvivalReport` lo corre sobre el ancla que
// publica el orquestador: sin falsos positivos sobre un ancla correcta y con
// error cuando F03 no es el crédito de renta de la lista blanca.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const llm: Record<string, unknown> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => ({
    json: structuredClone(llm[opts.agentName]),
    meta: {},
  })),
}));

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { orchestrateEscudoSurvival } from '../orchestrator';
import { validateSurvivalReport } from '../validators/survival-validators';

// UAI 100M; impuesto causado 30M; 135515 = 20M (crédito de renta), 135530 y
// 180505 no lo son.
const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
111005,Bancos cuenta corriente,Auxiliar,1,152000000
130505,Clientes nacionales,Auxiliar,1,260000000
135515,Retencion en la fuente,Auxiliar,1,20000000
135530,Impuestos descontables,Auxiliar,1,30000000
180505,Obras de arte,Auxiliar,1,5000000
143505,Mercancias no fabricadas por la empresa,Auxiliar,1,165000000
220505,Proveedores nacionales,Auxiliar,1,310000000
240805,Impuesto sobre las ventas por pagar,Auxiliar,1,44000000
240405,Impuesto de renta y complementarios,Auxiliar,1,30000000
310505,Capital suscrito y pagado,Auxiliar,1,150000000
330505,Reserva legal,Auxiliar,1,26000000
360505,Utilidad o perdida del ejercicio,Auxiliar,1,70000000
370505,Resultados de ejercicios anteriores,Auxiliar,1,20000000
413550,Comercio al por mayor y al por menor,Auxiliar,1,1240000000
613550,Costo de venta de mercancias,Auxiliar,1,760000000
510506,Sueldos de personal administrativo,Auxiliar,1,158000000
529505,Gastos de venta comisiones,Auxiliar,1,222000000
540505,Impuesto de renta y complementarios,Auxiliar,1,30000000
`;

const uai = 100_000_000;
llm['escudo-survival-tet'] = {
  markdown: '## TET\nArt. 240 E.T. tarifa general. UVT 2026 $52.374.',
  warnings: [],
  data: { tet: 0.3, ttd: null, nivelAlerta: 'amarillo', impuestoProyectado: 30_000_000, uai, sugerenciasOptimizacion: [] },
};
llm['escudo-survival-retention'] = {
  markdown: 'retenciones 1355 ............',
  warnings: [],
  data: { retencionesAcumuladas: 20_000_000, impuestoProyectado: 35_000_000, saldoAFavorProyectado: null, acciones: [] },
};
llm['escudo-survival-antidian'] = {
  markdown: 'Art. 771-5 §1 E.T. ..........',
  warnings: [],
  data: { pagosEfectivoTotal: null, pagosNoDeduciblesIndividuales: [], excesoNoDeducibleGeneral: null, crucesExogenaSospechosos: [], mayorImpuestoEstimado: null },
};
llm['escudo-survival-reserve'] = {
  markdown: 'reserva .............',
  warnings: [],
  data: { utilidadNeta: 70_000_000, reservaSugerida: 7_000_000, pctUtilidad: 0.1, cuentaSugerida: '11', reservaLegalActual: null, gapReservaLegal: null },
};
llm['escudo-survival-dividend'] = {
  markdown: 'Art. 242 E.T. ..........',
  warnings: [],
  data: {
    utilidadDistribuible: 63_000_000,
    escenarios: {
      distribuirTotal: { ahorroSocio: 0, impuestoSocio: 887_351, netoSocio: 62_112_649, fortPatrimonio: null },
      capitalizarTotal: { ahorroSocio: 0, impuestoSocio: 887_351, netoSocio: 0, fortPatrimonio: 63_000_000 },
      hibrido50_50: { ahorroSocio: 0, impuestoSocio: 887_351, netoSocio: 31_056_324, fortPatrimonio: 31_500_000 },
    },
    recomendacion: 'Distribuir.',
    norma: 'Art. 242 E.T.',
  },
};
llm['escudo-survival-synth'] = {
  markdown: 'Dictamen... requiere validación de revisor fiscal.',
  topRecommendations: [{ orden: 1, titulo: 'x', impacto: 1, norma: 'Art. 240 E.T.' }],
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Calendario 2026 verificado: las fechas del ancla se evalúan (no N/D).
  vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

const anclaErrores = (errors: string[]) => errors.filter((e) => e.startsWith('[Âncora Fiscal'));

describe('validateSurvivalReport corre validateFiscalAnchorAll sobre el ancla publicada', () => {
  it('ancla correcta (NIT con dígito, calendario 2026): sin errores del Âncora Fiscal', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV, company: { nit: '901714014-6' } });
    expect(r.fiscalAnchor).toBeDefined();
    expect(r.fiscalAnchor!.f03).toBe('2000000000');
    expect(r.validation).toBeDefined();
    expect(anclaErrores(r.validation!.errors)).toEqual([]);
  });

  it('sin NIT (calendario «verificar»): tampoco hay errores del Âncora Fiscal', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV });
    expect(anclaErrores(r.validation!.errors)).toEqual([]);
  });

  it('F03 que suma la obra de arte (1805) se reporta como error L3.7', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV, company: { nit: '901714014-6' } });
    const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const f03Inflado = BigInt(r.fiscalAnchor!.f03) + BigInt(500_000_000);
    const f04 = BigInt(r.fiscalAnchor!.f02) - f03Inflado;
    const alterado = {
      ...r,
      fiscalAnchor: { ...r.fiscalAnchor!, f03: f03Inflado.toString(), f04: f04.toString() },
    };
    const v = validateSurvivalReport(alterado, pre);
    expect(v.ok).toBe(false);
    expect(anclaErrores(v.errors).some((e) => e.includes('L3.7_f03_solo_credito_renta'))).toBe(true);
  });
});
