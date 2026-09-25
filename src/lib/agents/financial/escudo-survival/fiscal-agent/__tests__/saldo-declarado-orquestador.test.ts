// ---------------------------------------------------------------------------
// Agente Fiscal — el saldo a favor declarado llega al módulo de devoluciones
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-02, integración IW5b): FiscalAgentInput
// ya admitía `saldoAFavorDeclaradoCents` (Formulario 110), pero el orquestador
// no lo aceptaba ni lo reenviaba, así que la devolución quedaba N/D aunque el
// caller conociera el saldo liquidado en la declaración.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llm: Record<string, unknown> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    if (!(opts.agentName in llm)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llm[opts.agentName]), meta: {} };
  }),
}));

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '../../fiscal-anchor';
import { orchestrateFiscalAgent } from '../orchestrator';

// 111005 Bancos cuadra la ecuación con el resultado del ejercicio sin trasladar
// (A = P + K + resultado: 752.000.000 = 310.000.000 + 150.000.000 + 292.000.000).
// Sin ella el balance estaba descuadrado y el Escudo lo bloquea como /niif
// (I4-escudo 2). No cambia la UAI, F02, F03 ni F04.
const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
111005,Bancos nacionales,Auxiliar,1,714000000
135515,Retencion en la fuente,Auxiliar,1,20000000
220505,Proveedores nacionales,Auxiliar,1,310000000
310505,Capital suscrito y pagado,Auxiliar,1,150000000
413550,Comercio al por mayor y al por menor,Auxiliar,1,1240000000
613550,Costo de venta de mercancias,Auxiliar,1,760000000
510506,Sueldos de personal administrativo,Auxiliar,1,158000000
540505,Impuesto de renta y complementarios,Auxiliar,1,30000000
`;

const p = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const company = { name: 'PYME', nit: '900123456-1' };
const anchor = buildFiscalAnchor({ preprocessed: p, company, hoy: new Date('2026-09-23T12:00:00Z') });

const ccvJson = {
  markdown: 'ccv', warnings: [],
  data: { f01: '1', f02: '1', f03: '1', f04: '1', f05: '1', f06: '1', f07: '1', f08: '1', f09Pct: 1, f10Pct: 1,
    alertaTasaMinima: { aplica: true, f09Actual: 1, brechaPp: 1, impuestoAdicionalEstimado: '1', norma: 'x' }, eficienciaFiscal: 'alta' },
};
const riskJson = {
  markdown: 'm', warnings: [],
  data: { score: 10, nivel: 'bajo', factores: [], interpretacion: 'i', recomendaciones: [] },
};
const devolJson = {
  markdown: 'm', warnings: [],
  data: { saldoAFavor: '999', viabilidad: 'alta', plazoDian: 'x', plazoConGarantia: 'x', documentosRequeridos: [], pasosProcedimentales: ['radicar'], riesgosIdentificados: [], normaRef: 'x' },
};
const synthJson = {
  markdown: 'Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.',
  topRecommendations: [], cierre: 'c',
};

beforeEach(() => {
  for (const k of Object.keys(llm)) delete llm[k];
  llm['escudo-fiscal:ccv'] = ccvJson;
  llm['escudo-fiscal:risk-score'] = riskJson;
  llm['escudo-fiscal:devoluciones'] = devolJson;
  llm['escudo-fiscal:synthesizer'] = synthJson;
});

describe('orchestrateFiscalAgent — saldoAFavorDeclaradoCents', () => {
  it('reenvía el saldo declarado al módulo de devoluciones', async () => {
    const r = await orchestrateFiscalAgent({
      rawData: '',
      preprocessed: p,
      fiscalAnchor: anchor,
      company,
      mode: 'devolucion',
      saldoAFavorDeclaradoCents: '150000000',
    });
    expect(r.devoluciones?.data.saldoAFavor).toBe('150000000');
    expect(r.devoluciones?.data.viabilidad).not.toBe('no_determinable');
  });

  it('sin saldo declarado la devolución sigue N/D (no se toma |F04|)', async () => {
    const r = await orchestrateFiscalAgent({
      rawData: '',
      preprocessed: p,
      fiscalAnchor: anchor,
      company,
      mode: 'devolucion',
    });
    expect(r.devoluciones?.data.saldoAFavor).toBeNull();
    expect(r.devoluciones?.data.viabilidad).toBe('no_determinable');
  });
});
