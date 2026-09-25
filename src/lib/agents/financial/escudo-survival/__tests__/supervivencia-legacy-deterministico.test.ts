// ---------------------------------------------------------------------------
// /api/escudo-survival — cifras deterministas sobre la salida del LLM
// ---------------------------------------------------------------------------
// Auditoría 2026-09:
//   - tributario-modulos-06: TET = impuesto causado / UAI (no UAI × 35% /
//     UAI); TTD null; fallback sin nivel «verde» por defecto.
//   - tributario-modulos-07: bancarización N/D sin flujo de pagos;
//     costosTotales sin duplicar la clase 6 ni incluir el impuesto (54).
//   - tributario-calc-01: capitalizar tributa como distribuir (Art. 36-3
//     derogado); el prompt ya no lo exige ni el validador C1.6 exige $0.
//   - tributario-modulos-03: el orquestador ejecuta validateSurvivalReport.
//   - tributario-modulos-02: el escudo de retenciones no publica saldo a favor.
// El LLM se simula con salidas que siguen los prompts anteriores.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';

const llm: Record<string, unknown> = {};
let failAgent: string | null = null;
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    if (opts.agentName === failAgent) throw new Error('simulated LLM failure');
    return { json: structuredClone(llm[opts.agentName]), meta: {} };
  }),
}));

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { orchestrateEscudoSurvival } from '../orchestrator';
import { extractSurvivalAnchors } from '../lib/extract-totals';
import { buildDividendOptimizerPrompt } from '../prompts/dividend-optimizer.prompt';
import { buildTetCalculatorPrompt } from '../prompts/tet-calculator.prompt';

// UAI 100M; impuesto causado 30M (tasa contable 30% ⇒ amarillo); caja 18M;
// 1355 con 135515 = 20M y 135530 = 30M (no es crédito de renta).
const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
111005,Bancos cuenta corriente,Auxiliar,1,157000000
130505,Clientes nacionales,Auxiliar,1,260000000
135515,Retencion en la fuente,Auxiliar,1,20000000
135530,Impuestos descontables,Auxiliar,1,30000000
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
  data: { tet: 0.35, ttd: 0.35, nivelAlerta: 'rojo', impuestoProyectado: uai * 0.35, uai,
    sugerenciasOptimizacion: [{ norma: 'Art. 256 E.T.', ahorroEstimado: 1, requisitos: [], factibilidad: 'alta' }] },
};
llm['escudo-survival-retention'] = { markdown: 'retenciones 1355 ............', warnings: [], data: { retencionesAcumuladas: 50_000_000, impuestoProyectado: 35_000_000, saldoAFavorProyectado: 15_000_000,
  acciones: [{ tipo: 'devolucion', norma: 'Decreto 1625/2016', dificultad: 'media', riesgo: 'x' }, { tipo: 'compensacion', norma: 'Forma 1502', dificultad: 'baja', riesgo: 'x' }] } };
llm['escudo-survival-antidian'] = { markdown: 'Art. 771-5 §1 E.T. ..........', warnings: [], data: { pagosEfectivoTotal: 18_000_000, pagosNoDeduciblesIndividuales: [], excesoNoDeducibleGeneral: 10_800_000, crucesExogenaSospechosos: [], mayorImpuestoEstimado: 3_780_000 } };
llm['escudo-survival-reserve'] = { markdown: 'reserva .............', warnings: [], data: { utilidadNeta: 70_000_000, reservaSugerida: 7_000_000, pctUtilidad: 0.1, cuentaSugerida: '11', reservaLegalActual: null, gapReservaLegal: null } };
llm['escudo-survival-dividend'] = { markdown: 'Art. 242 E.T. ..........', warnings: [], data: { utilidadDistribuible: 63_000_000, escenarios: {
  distribuirTotal: { ahorroSocio: 0, impuestoSocio: 887_351, netoSocio: 62_112_649, fortPatrimonio: null },
  capitalizarTotal: { ahorroSocio: 887_351, impuestoSocio: 0, netoSocio: 0, fortPatrimonio: 63_000_000 },
  hibrido50_50: { ahorroSocio: 443_675, impuestoSocio: 443_676, netoSocio: 31_056_324, fortPatrimonio: 31_500_000 } },
  recomendacion: 'Capitalizar para fortalecer el patrimonio de la sociedad.', norma: 'Art. 242 E.T.' } };
llm['escudo-survival-synth'] = { markdown: 'Dictamen... requiere validación de revisor fiscal.', topRecommendations: [{ orden: 1, titulo: 'x', impacto: 1, norma: 'Art. 240 E.T.' }] };

describe('Modo Supervivencia legacy — cifras deterministas', () => {
  it('TET contable = causado / UAI (30% ⇒ amarillo); TTD null', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV, company: { nit: '900123456-1' } });
    expect(r.tet.data.tet).toBeCloseTo(0.3, 6);
    expect(r.tet.data.impuestoProyectado).toBe(30_000_000);
    expect(r.tet.data.nivelAlerta).toBe('amarillo');
    expect(r.tet.data.ttd).toBeNull();
  });

  it('retenciones = crédito de renta (sin 135530); sin saldo a favor ni acción de devolución', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV });
    expect(r.retentionShield.data.retencionesAcumuladas).toBe(20_000_000);
    expect(r.retentionShield.data.saldoAFavorProyectado).toBeNull();
    expect(r.retentionShield.data.acciones.some((a) => a.tipo === 'devolucion')).toBe(false);
  });

  it('bancarización N/D sin flujo de pagos: el saldo de caja no genera «no deducible»', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV });
    expect(r.antiDian.data.pagosEfectivoTotal).toBeNull();
    expect(r.antiDian.data.excesoNoDeducibleGeneral).toBeNull();
    expect(r.antiDian.data.mayorImpuestoEstimado).toBeNull();
  });

  it('costosTotales = gastos (5+6+7) − impuesto de renta; sin duplicar la clase 6', () => {
    const a = extractSurvivalAnchors(preprocessTrialBalance(parseTrialBalanceCSV(CSV)));
    expect(a.gastos).toBe(1_170_000_000);
    expect(a.costosTotales).toBe(1_140_000_000);
    expect(a.creditoRenta).toBe(20_000_000);
  });

  it('capitalizar tributa como distribuir (Art. 36-3 derogado)', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV });
    const e = r.dividendOptimizer.data.escenarios;
    expect(e.capitalizarTotal.impuestoSocio).toBe(e.distribuirTotal.impuestoSocio);
    expect(e.capitalizarTotal.ahorroSocio).toBe(0);
    expect(e.hibrido50_50.impuestoSocio).toBe(e.distribuirTotal.impuestoSocio);
    expect(r.dividendOptimizer.warnings.join(' ')).toMatch(/36-3/);
  });

  it('el orquestador adjunta la validación determinista (C1.6 ya no exige impuesto $0)', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV });
    expect(r.validation).toBeDefined();
    expect(r.validation!.errors.join(' ')).not.toMatch(/capitalizaci[oó]n es INCRGNO/);
    expect(r.validation!.errors.join(' ')).not.toMatch(/dividend_capitalizar/);
  });

  it('fallback del TET: cifras deterministas y sin «verde» por defecto', async () => {
    failAgent = 'escudo-survival-tet';
    const r = await orchestrateEscudoSurvival({ rawData: CSV });
    failAgent = null;
    expect(r.tet.data.tet).toBeCloseTo(0.3, 6);
    expect(r.tet.data.ttd).toBeNull();
    expect(r.tet.data.nivelAlerta).toBe('amarillo');
  });

  it('prompts: sin Art. 36-3 exigido ni TTD ≈ TET', () => {
    const d = buildDividendOptimizerPrompt('es');
    expect(d).not.toMatch(/impuestoSocio = 0/);
    expect(d).not.toMatch(/ALWAYS cita textualmente "Art\. 242 E\.T\." y "Art\. 36-3 E\.T\."/);
    expect(d).toMatch(/derogado/);
    const t = buildTetCalculatorPrompt('es');
    expect(t).not.toMatch(/TTD ~ TET/);
    expect(t).not.toMatch(/data\.impuestoProyectado = uai x tarifa/);
  });
});
