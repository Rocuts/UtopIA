// ---------------------------------------------------------------------------
// Planeación (Módulo 4) — tope conjunto del Art. 258 E.T. por escenario
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (pendiente #8): el esquema de escenarios no
// desglosaba los descuentos por artículo, así que el tope conjunto del 25% de
// los Arts. 255, 256 y 257 (Art. 258 E.T.) sólo vivía en el prompt. Ahora cada
// escenario trae el impuesto antes de descuentos y los descuentos por artículo
// (strict-mode) y el código recalcula el impuesto del escenario:
//   impuesto = max(0, antes − 254 − 258-1 − min(255 + 256 + 257, 25% × antes))
// El Art. 254 (impuestos pagados en el exterior) y el 258-1 (IVA de activos
// fijos productivos) no entran en el tope. Sin impuesto antes de descuentos y
// con descuentos topeables, el tope no es verificable ⇒ escenario N/D.
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
import { runPlaneacionAgent } from '../agents/planeacion.agent';
import { planeacionModuleSchema } from '../schemas';
import { aplicarTope258Escenario } from '../tools/planeacion-tope-258';
import type { FiscalAgentInput } from '../types';

// UAI 322M → F02 = 112,7M.
const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
135515,Retencion en la fuente,Auxiliar,1,20000000
413550,Comercio al por mayor y al por menor,Auxiliar,1,1240000000
613550,Costo de venta de mercancias,Auxiliar,1,760000000
510506,Sueldos de personal administrativo,Auxiliar,1,158000000
540505,Impuesto de renta y complementarios,Auxiliar,1,30000000
`;
const p = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const anchor = buildFiscalAnchor({ preprocessed: p, company: { name: 'PYME' }, hoy: new Date('2026-09-23T12:00:00Z') });
const input: FiscalAgentInput = { preprocessed: p, fiscalAnchor: anchor, company: { name: 'PYME' }, language: 'es', mode: 'full' };

const SIN_DESCUENTOS = { art254Cents: null, art255Cents: null, art256Cents: null, art257Cents: null, art258_1Cents: null };

function esc(
  nombre: 'conservador' | 'base' | 'agresivo',
  impuestoEscenario: string | null,
  impuestoAntesDescuentos: string | null,
  descuentos: Record<string, string | null> = SIN_DESCUENTOS,
) {
  return {
    nombre, impuestoBase: '1', impuestoEscenario, impuestoAntesDescuentos, descuentos,
    ahorroEstimado: '1', ahorroPct: 1, articulosAplicables: ['Art. 258 E.T.'], documentacionRequerida: ['x'],
    riesgo: 'baja', justificacion: 'x',
  };
}

beforeEach(() => {
  for (const k of Object.keys(llm)) delete llm[k];
});

describe('aplicarTope258Escenario', () => {
  it('255 + 256 + 257 por encima del 25% se topean; 254 y 258-1 quedan fuera', () => {
    // antes $100.000.000; 256 $20M + 257 $15M = $35M > tope $25M; 254 $5M; 258-1 $10M
    const r = aplicarTope258Escenario('10000000000', {
      art254Cents: '500000000', art255Cents: null, art256Cents: '2000000000', art257Cents: '1500000000', art258_1Cents: '1000000000',
    });
    expect(r.tope258).toBe('2500000000');
    expect(r.excesoTope258).toBe('1000000000');
    // 100M − 5M − 10M − 25M = 60M
    expect(r.impuestoEscenario).toBe('6000000000');
    expect(r.motivo).toBeNull();
  });

  it('sin impuesto antes de descuentos y con descuentos topeables ⇒ N/D con motivo', () => {
    const r = aplicarTope258Escenario(null, { ...SIN_DESCUENTOS, art256Cents: '2000000000' });
    expect(r.impuestoEscenario).toBeNull();
    expect(r.motivo).toMatch(/Art\. 258/);
  });

  it('el impuesto no baja de cero', () => {
    const r = aplicarTope258Escenario('1000000000', { ...SIN_DESCUENTOS, art258_1Cents: '5000000000' });
    expect(r.impuestoEscenario).toBe('0');
  });
});

describe('runPlaneacionAgent — el tope del Art. 258 se aplica en código', () => {
  it('el esquema (strict) exige el desglose por artículo', () => {
    const data = {
      escenarios: { conservador: esc('conservador', '9000000000', '9000000000'), base: esc('base', null, null), agresivo: esc('agresivo', '1', '1') },
      recomendacion: 'base', razonRecomendacion: 'x',
    };
    expect(planeacionModuleSchema.safeParse({ markdown: 'm', warnings: [], data }).success).toBe(true);
    const { descuentos: _d, ...sinDesglose } = data.escenarios.agresivo;
    void _d;
    const mal = { ...data, escenarios: { ...data.escenarios, agresivo: sinDesglose } };
    expect(planeacionModuleSchema.safeParse({ markdown: 'm', warnings: [], data: mal }).success).toBe(false);
  });

  it('el escenario agresivo que excede el tope se recalcula y el ahorro sale del impuesto topeado', async () => {
    // Antes de descuentos $112.700.000 (= F02). 256 $40M + 257 $10M = $50M > tope $28.175.000.
    // El «modelo» restó los $50M completos: $62.700.000.
    llm['escudo-fiscal:planeacion'] = {
      markdown: 'm', warnings: [],
      data: {
        escenarios: {
          conservador: esc('conservador', anchor.f02, anchor.f02),
          base: esc('base', null, null),
          agresivo: esc('agresivo', '6270000000', anchor.f02, { ...SIN_DESCUENTOS, art256Cents: '4000000000', art257Cents: '1000000000' }),
        },
        recomendacion: 'agresivo', razonRecomendacion: 'x',
      },
    };
    const r = await runPlaneacionAgent({ input });
    const a = r.data.escenarios.agresivo;
    // 112.700.000 − min(50.000.000, 28.175.000) = 84.525.000
    expect(a.impuestoEscenario).toBe('8452500000');
    expect(a.excesoTope258).toBe('2182500000');
    expect(a.ahorroEstimado).toBe('2817500000');
    expect(r.warnings.some((w) => /Art\. 258/.test(w) && /agresivo/.test(w))).toBe(true);
  });

  it('descuentos topeables sin impuesto antes de descuentos ⇒ escenario y ahorro N/D', async () => {
    llm['escudo-fiscal:planeacion'] = {
      markdown: 'm', warnings: [],
      data: {
        escenarios: {
          conservador: esc('conservador', anchor.f02, anchor.f02),
          base: esc('base', null, null),
          agresivo: esc('agresivo', '100', null, { ...SIN_DESCUENTOS, art255Cents: '4000000000' }),
        },
        recomendacion: 'agresivo', razonRecomendacion: 'x',
      },
    };
    const r = await runPlaneacionAgent({ input });
    expect(r.data.escenarios.agresivo).toMatchObject({ impuestoEscenario: null, ahorroEstimado: null, ahorroPct: null });
  });
});
