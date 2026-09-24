// ---------------------------------------------------------------------------
// Agente Fiscal — las cifras con cálculo determinista sobrescriben al LLM
// ---------------------------------------------------------------------------
// Auditoría 2026-09:
//   - tributario-modulos-04: Conciliación, Devoluciones, Supervivencia y
//     Planeación devolvían montos del modelo (incluidos los «intocables»).
//   - tributario-modulos-05: el Score mostrado era el del LLM; se perdía
//     `publicable` y el schema no admitía 2 de los 7 factores.
//   - tributario-modulos-12: el modo «devolucion» siempre fallaba.
//   - tributario-modulos-03: la validación determinista no se ejecutaba.
// Cada caso inyecta una salida manipulada del modelo.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llm: Record<string, unknown> = {};
const userContents: Record<string, string> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string; userContent: string }) => {
    userContents[opts.agentName] = opts.userContent;
    if (!(opts.agentName in llm)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llm[opts.agentName]), meta: {} };
  }),
}));

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '../../fiscal-anchor';
import { runConciliacionAgent } from '../agents/conciliacion.agent';
import { runDevolucionesAgent } from '../agents/devoluciones.agent';
import { runRiskScoreAgent } from '../agents/risk-score.agent';
import { runSupervivenciaAgent } from '../agents/supervivencia.agent';
import { runPlaneacionAgent } from '../agents/planeacion.agent';
import { orchestrateFiscalAgent } from '../orchestrator';
import { computeRiskScore } from '../tools/risk-score-calculator';
import { riskScoreModuleSchema } from '../schemas';
import type { FiscalAgentInput } from '../types';

// UAI 100M; F02 35M; F03 (135515) 20M; utilidad neta 70M.
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

const p = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const anchor = buildFiscalAnchor({ preprocessed: p, company: { name: 'PYME', nit: '900123456-1' }, hoy: new Date('2026-09-23T12:00:00Z') });
const input: FiscalAgentInput = { preprocessed: p, fiscalAnchor: anchor, company: { name: 'PYME', nit: '900123456-1' }, language: 'es', mode: 'full' };

const ccvJson = {
  markdown: 'ccv', warnings: [],
  data: { f01: '1', f02: '1', f03: '1', f04: '1', f05: '1', f06: '1', f07: '1', f08: '1', f09Pct: 1, f10Pct: 1,
    alertaTasaMinima: { aplica: true, f09Actual: 1, brechaPp: 1, impuestoAdicionalEstimado: '1', norma: 'x' }, eficienciaFiscal: 'alta' },
};
const riskJson = {
  markdown: 'm', warnings: [],
  data: { score: 97, nivel: 'critico', factores: [{ factor: 'tet_baja', descripcion: 'x', puntos: 97, detalle: 'inventado' }], interpretacion: 'i', recomendaciones: [] },
};
const devolJson = {
  markdown: 'm', warnings: [],
  data: { saldoAFavor: '500000000000', viabilidad: 'alta', plazoDian: 'x', plazoConGarantia: '20 días hábiles con garantía bancaria personal', documentosRequeridos: [], pasosProcedimentales: ['radicar'], riesgosIdentificados: [], normaRef: 'Art. 850 E.T.' },
};
const synthJson = {
  markdown: 'Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.',
  topRecommendations: [], cierre: 'c',
};

beforeEach(() => {
  for (const k of Object.keys(llm)) delete llm[k];
});

describe('Conciliación — identidades recalculadas desde las líneas', () => {
  it('F01 y F03 intocables; renta, impuesto, tope 258 y saldo en código', async () => {
    llm['escudo-fiscal:conciliacion'] = {
      markdown: 'm', warnings: [],
      data: {
        uaiContable: '1',
        lineas: [
          { concepto: 'Multas', monto: '1000000000', norma: 'Art. 105 E.T.', tipo: 'adicion' },
          { concepto: 'Donación ESAL', monto: '5000000000', norma: 'Art. 257 E.T.', tipo: 'descuento' },
        ],
        rentaLiquidaGravable: '100', tarifaPct: 35, impuestoBruto: '35', totalDescuentos: '5000',
        impuestoNeto: '1', retencionesYAnticipos: '1', saldoFinal: '-999999999', disclaimer: 'd',
      },
    };
    const r = await runConciliacionAgent({ input });
    expect(r.data.uaiContable).toBe(anchor.f01); // 100M
    expect(r.data.rentaLiquidaGravable).toBe('11000000000'); // 100M + 10M
    expect(r.data.impuestoBruto).toBe('3850000000'); // 38,5M
    // 257 = 50M topado al 25% de 38,5M = 9.625.000
    expect(r.data.totalDescuentos).toBe('962500000');
    expect(r.data.impuestoNeto).toBe('2887500000');
    expect(r.data.retencionesYAnticipos).toBe(anchor.f03);
    expect(r.data.saldoFinal).toBe('887500000');
    expect(r.warnings.join(' ')).toMatch(/Art\. 258/);
    expect(r.warnings.join(' ')).toMatch(/Art\. 807/);
  });
});

describe('Devoluciones — saldo y viabilidad del análisis determinista', () => {
  it('sin declaración: N/D aunque el modelo invente $5.000M «alta»', async () => {
    llm['escudo-fiscal:devoluciones'] = devolJson;
    const r = await runDevolucionesAgent({ input });
    expect(r.data.saldoAFavor).toBeNull();
    expect(r.data.viabilidad).toBe('no_determinable');
    expect(r.data.plazoConGarantia).not.toMatch(/personal/);
  });
});

describe('Score de Riesgo — el determinista, con publicable y 7 factores', () => {
  it('score/nivel/factores del LLM se reemplazan', async () => {
    const det = computeRiskScore({ anchor, preprocessed: p });
    llm['escudo-fiscal:risk-score'] = riskJson;
    const r = await runRiskScoreAgent({ input });
    expect(r.data.score).toBe(det.score);
    expect(r.data.nivel).toBe(det.nivel);
    expect(r.data.factores).toEqual(det.factores);
    expect(r.data.publicable).toBe(det.publicable);
  });

  it('el schema admite los 7 códigos de factor', () => {
    const det = computeRiskScore({ anchor, preprocessed: p });
    const allowed = (riskScoreModuleSchema.shape.data.shape.factores.element.shape.factor as unknown as { options: string[] }).options;
    expect(det.factores.map((f) => f.factor).filter((c) => !allowed.includes(c))).toEqual([]);
  });
});

describe('Supervivencia — cifras del Âncora, activación y N/D', () => {
  it('f03/F10 del Âncora, activo forzado, exposiciones N/D, reserva 10% y 36-3 retirado', async () => {
    llm['escudo-fiscal:supervivencia'] = {
      markdown: 'm', warnings: [],
      data: {
        activo: false, razonActivacion: 'r', riesgoDetectado: 'r', accionesInmediatas: [],
        exposicionFiscalEstimada: '123456789000', exposicionMitigada: '1',
        tet: { tetActual: 3, brecha15Pct: 12, impuestoAdicional: '500000000' },
        escudoRetenciones: { f03: '999999999999', ratioF10: 500, recomendacion: 'x' },
        antiDian: { resumen: 'x', norma: 'Art. 771-5 E.T.' },
        reservaContingencia: { sugerida: '777777777777', pctUtilidad: 0.3 },
        dividendos: { recomendacion: 'capitalizar', norma: 'Art. 36-3 E.T.' },
      },
    };
    const r = await runSupervivenciaAgent({ input, forceActive: true });
    expect(r.data.activo).toBe(true);
    expect(r.data.escudoRetenciones.f03).toBe(anchor.f03);
    expect(r.data.escudoRetenciones.ratioF10).toBe(anchor.f10);
    expect(r.data.exposicionFiscalEstimada).toBeNull();
    expect(r.data.exposicionMitigada).toBeNull();
    expect(r.data.reservaContingencia).toEqual({ sugerida: '700000000', pctUtilidad: 0.1 });
    expect(r.data.dividendos.norma).not.toMatch(/^Art\. 36-3/);
    expect(r.data.dividendos.norma).toMatch(/derogado/);
  });
});

describe('Planeación — ahorro = F02 − escenario en código', () => {
  it('ahorro y % recalculados; escenario N/D ⇒ ahorro N/D', async () => {
    const esc = (nombre: string, impuestoEscenario: string | null) => ({
      nombre, impuestoBase: '1', impuestoEscenario, ahorroEstimado: '999999999999', ahorroPct: 99,
      articulosAplicables: [], documentacionRequerida: [], riesgo: 'baja', justificacion: 'x',
    });
    llm['escudo-fiscal:planeacion'] = {
      markdown: 'm', warnings: [],
      data: { escenarios: { conservador: esc('conservador', '3000000000'), base: esc('base', null), agresivo: esc('agresivo', '2500000000') }, recomendacion: 'base', razonRecomendacion: 'x' },
    };
    const r = await runPlaneacionAgent({ input });
    expect(r.data.escenarios.conservador).toMatchObject({ impuestoBase: anchor.f02, ahorroEstimado: '500000000', ahorroPct: 14.29 });
    expect(r.data.escenarios.base).toMatchObject({ ahorroEstimado: null, ahorroPct: null });
    expect(r.data.escenarios.agresivo.ahorroEstimado).toBe('1000000000');
  });
});

describe('Orquestador — modo devolución y validación', () => {
  it('el modo «devolucion» sintetiza (Score determinista activo) y adjunta la validación', async () => {
    llm['escudo-fiscal:ccv'] = ccvJson;
    llm['escudo-fiscal:risk-score'] = riskJson;
    llm['escudo-fiscal:devoluciones'] = devolJson;
    llm['escudo-fiscal:synthesizer'] = synthJson;
    const r = await orchestrateFiscalAgent({ rawData: '', preprocessed: p, fiscalAnchor: anchor, company: input.company, mode: 'devolucion' });
    expect(r.devoluciones?.data.viabilidad).toBe('no_determinable');
    expect(r.riskScore.data.score).toBe(computeRiskScore({ anchor, preprocessed: p }).score);
    expect(r.validation).toBeDefined();
    expect(r.validation.checks.some((c) => c.name === 'CN.summary')).toBe(true);
    expect(r.validation.checks.some((c) => c.name.startsWith('M7'))).toBe(true);
  });

  it('el contexto que recibe el modelo no rotula F04 como «saldo» (tributario-modulos-02)', async () => {
    llm['escudo-fiscal:ccv'] = ccvJson;
    llm['escudo-fiscal:risk-score'] = riskJson;
    llm['escudo-fiscal:synthesizer'] = synthJson;
    await orchestrateFiscalAgent({ rawData: '', preprocessed: p, fiscalAnchor: anchor, company: input.company, mode: 'full' }).catch(() => undefined);
    const ccv = userContents['escudo-fiscal:ccv'];
    expect(ccv).toBeDefined();
    expect(ccv).not.toMatch(/Saldo neto F02-F03/);
    expect(ccv).not.toMatch(/F03 \(Retenciones a favor\)/);
    expect(ccv).toMatch(/F04 \(Posición de referencia F02 − F03; estimación contable/);
  });
});
