// ---------------------------------------------------------------------------
// tributario-modulos-22 — C3.5 «tarifa_general_correcta» sin falsos positivos
// ---------------------------------------------------------------------------
// El regex /\b(3[12349]|2[0-9]|3[0-2])\s*%/ marcaba como «tarifa prohibida»
// (error duro, ya en producción vía validateSurvivalReport) cualquier 20-32%,
// 34% o 39%: el descuento del 25% (Art. 257), el tope del 25% (Art. 258), el
// 30% del Art. 256 o la tarifa marginal del 39% de personas naturales
// (Art. 241). Lo prohibido es la tarifa de renta de PERSONAS JURÍDICAS de los
// regímenes anteriores a la Ley 2277/2022 (30-34%) presentada como vigente
// (Art. 240 E.T. — src/data/tax_docs/et_articulo_240_renta_juridica.md).
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
import { detectarTarifasPjAnteriores } from '../validators/tarifa-pj-anterior';

describe('detectarTarifasPjAnteriores', () => {
  it.each([
    'Descuento del 25% por donaciones (Art. 257 E.T.).',
    'Los descuentos de los Arts. 255, 256 y 257 no pueden exceder el 25% del impuesto (Art. 258).',
    'Descuento del 30% de la inversión en I+D+i (Art. 256 E.T.).',
    'El socio persona natural queda en la tarifa marginal del 39% (Art. 241 E.T.).',
    'Nivel de alerta: TET entre 20% y 30% es amarillo.',
    'Tarifa general del IVA: 19%.',
    'Zona franca: tarifa del 20% sobre la renta de exportación (Art. 240-1).',
    'Tarifa general de renta PJ: 35% (Art. 240 E.T.).',
  ])('no marca menciones legítimas: %s', (txt) => {
    expect(detectarTarifasPjAnteriores(txt)).toEqual([]);
  });

  it.each([
    ['La tarifa general de renta es del 33%.', '33%'],
    ['Tarifa de renta para personas jurídicas: 34%.', '34%'],
    ['Aplicamos la tarifa del Art. 240 E.T. (32%).', '32%'],
    ['tarifa nominal 31 %', '31 %'],
  ])('marca la tarifa PJ anterior a la Ley 2277/2022: %s', (txt, esperado) => {
    expect(detectarTarifasPjAnteriores(txt)).toEqual([esperado]);
  });
});

// ── Integración: el check dentro de validateSurvivalReport ──────────────────

const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
111005,Bancos cuenta corriente,Auxiliar,1,187000000
130505,Clientes nacionales,Auxiliar,1,260000000
135515,Retencion en la fuente,Auxiliar,1,20000000
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
  markdown: '## TET\nArt. 240 E.T. tarifa general 35%. UVT 2026 $52.374. Descuento del 25% (Art. 257) con tope del 25% (Art. 258); I+D+i 30% (Art. 256).',
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
  markdown: 'Art. 242 E.T. El socio persona natural tributa con la tabla del Art. 241 (tarifa marginal hasta 39%).',
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
  vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

const c35 = (v: ReturnType<typeof validateSurvivalReport>) =>
  v.layers.defensaTributaria.checks.find((c) => c.name === 'tarifa_general_correcta');

describe('C3.5 dentro de validateSurvivalReport', () => {
  it('25% (Arts. 257/258), 30% (Art. 256) y 39% (Art. 241 PN) no son error', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV, company: { nit: '901714014-6' } });
    const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const v = validateSurvivalReport(r, pre);
    expect(c35(v)?.passed).toBe(true);
    expect(v.errors.some((e) => e.includes('tarifa_general_correcta'))).toBe(false);
  });

  it('«tarifa general 33%» sí es error', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV, company: { nit: '901714014-6' } });
    const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const alterado = { ...r, tet: { ...r.tet, markdown: 'La tarifa general de renta es del 33%.' } };
    const v = validateSurvivalReport(alterado, pre);
    expect(c35(v)?.passed).toBe(false);
    expect(c35(v)?.detail).toContain('33%');
  });
});
