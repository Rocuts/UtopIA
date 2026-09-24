// ---------------------------------------------------------------------------
// W5-5 — Anclas de Supervivencia y contexto de Planeación sobre ingresos netos
// ---------------------------------------------------------------------------
// recalculo-final-01: `extract-totals.ts` (anclas de Supervivencia) y
// `planeacion.agent.ts` leían `controlTotals.ingresos` / `cents.ingresos`, la
// Σ FIRMADA de la clase 4 (4175 con el signo del ERP). El mismo balance
// publicaba 104 M (export natural, 4175 +4 M) o 96 M (export algebraico) como
// «Ingresos». La base es `cents.ingresosNetos` (= 100 M − 4 M = 96 M en las
// dos convenciones), la misma del margen neto del preprocesador.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

const userContents: Record<string, string> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string; userContent: string }) => {
    userContents[opts.agentName] = opts.userContent;
    return {
      json: {
        markdown: 'm',
        warnings: [],
        data: {
          escenarios: {
            conservador: esc('conservador'),
            base: esc('base'),
            agresivo: esc('agresivo'),
          },
          recomendacion: 'base',
          razonRecomendacion: 'x',
        },
      },
      meta: {},
    };
  }),
}));

function esc(nombre: string) {
  return {
    nombre,
    impuestoBase: '1',
    impuestoEscenario: null,
    ahorroEstimado: null,
    ahorroPct: null,
    articulosAplicables: [],
    documentacionRequerida: [],
    riesgo: 'baja',
    justificacion: 'x',
  };
}

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildAnchorBlock, extractSurvivalAnchors } from '../lib/extract-totals';
import { buildFiscalAnchor } from '../fiscal-anchor';
import { runPlaneacionAgent } from '../fiscal-agent/agents/planeacion.agent';

/** Mismo balance en las dos convenciones de signo (R1b de la re-auditoría). */
const NATURAL = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,170000000',
  '310505,Capital,Auxiliar,100000000',
  '360505,Utilidad del ejercicio,Auxiliar,70000000',
  '413505,Ventas,Auxiliar,100000000',
  '417505,Devoluciones en ventas,Auxiliar,4000000',
  '510506,Sueldos,Auxiliar,26000000',
].join('\n');
const ALGEBRAICA = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,170000000',
  '310505,Capital,Auxiliar,-100000000',
  '360505,Utilidad del ejercicio,Auxiliar,-70000000',
  '413505,Ventas,Auxiliar,-100000000',
  '417505,Devoluciones en ventas,Auxiliar,4000000',
  '510506,Sueldos,Auxiliar,26000000',
].join('\n');

const pre = (csv: string) => preprocessTrialBalance(parseTrialBalanceCSV(csv));

describe('W5-5 — anclas de Supervivencia: ingresos netos, no la Σ firmada', () => {
  it('natural y algebraica publican los mismos ingresos: 96 M (100 M − devoluciones 4 M)', () => {
    const nat = pre(NATURAL);
    const alg = pre(ALGEBRAICA);
    // Precondición: la Σ firmada difiere entre convenciones; los netos no.
    expect(nat.primary.controlTotals.cents!.ingresos).not.toBe(alg.primary.controlTotals.cents!.ingresos);
    expect(nat.primary.controlTotals.cents!.ingresosNetos).toBe(BigInt(9_600_000_000));
    expect(alg.primary.controlTotals.cents!.ingresosNetos).toBe(BigInt(9_600_000_000));

    const a = extractSurvivalAnchors(nat);
    const b = extractSurvivalAnchors(alg);
    expect(a.ingresos).toBe(96_000_000);
    expect(b.ingresos).toBe(96_000_000);
    expect(buildAnchorBlock(a)).toContain('- Ingresos netos (neto de devoluciones 4175): $96.000.000');
  });
});

describe('W5-5 — contexto de Planeación: ingresos netos', () => {
  it.each([
    ['natural', NATURAL],
    ['algebraica', ALGEBRAICA],
  ])('export %s ⇒ «Ingresos netos … $96.000.000»', async (_k, csv) => {
    const p = pre(csv);
    const company = { name: 'PYME', nit: '900123456-1' };
    const anchor = buildFiscalAnchor({ preprocessed: p, company, hoy: new Date('2026-09-23T12:00:00Z') });
    await runPlaneacionAgent({
      input: { preprocessed: p, fiscalAnchor: anchor, company, language: 'es', mode: 'full' },
    });
    const ctx = userContents['escudo-fiscal:planeacion'];
    const line = ctx.split('\n').find((l) => l.trim().startsWith('Ingresos'));
    expect(line).toContain('$96.000.000');
    expect(line).toMatch(/netos/i);
    expect(ctx).not.toContain('$104.000.000');
  });
});
