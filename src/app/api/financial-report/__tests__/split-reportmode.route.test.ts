// ---------------------------------------------------------------------------
// pipeline-flujo-11 — el camino partido propaga el reportMode del balance
// ---------------------------------------------------------------------------
// /strategy y /governance no recibían `reportMode`: Estrategia y Gobierno
// caían al default 'COMPARATIVO_COMPLETO' (verbos comparativos, ROE con
// patrimonio promedio sin patrimonio de inicio) para balances de un solo
// periodo que el NIIF y el HTML trataban como LINEA_BASE. El servidor lo
// deriva ahora del preprocesado revivido, igual que el camino legacy.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: Array<{ agentName: string; system: string }> = [];

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => null) }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));
// runStrategyPhase consulta el servicio macro (valoracion-18): sin BD ni red en
// la prueba (su espera acotada a 5 s quedaba cerca del testTimeout de 10 s).
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: vi.fn(async () => null) };
});
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (args: { agentName: string; system: string }) => {
    captured.push({ agentName: args.agentName, system: args.system });
    throw new Error('SENTINEL: prompt capturado');
  }),
}));

import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { deriveReportMode } from '@/lib/preprocessing/v8-helpers';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

const { POST: strategyPOST } = await import('../strategy/route');
const { POST: governancePOST } = await import('../governance/route');

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const company = { name: 'X SAS', nit: '900123456', fiscalPeriod: '2025' };
const niifResult = { fullContent: '## NIIF\nTotal Activo $90.000.000,00' };
const strategyResult = { fullContent: '## Estrategia' };

const req = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const modeOf = (agentName: string) =>
  captured.find((c) => c.agentName === agentName)?.system.match(/- Valor: (\w+)/)?.[1];

beforeEach(() => {
  captured.length = 0;
});

describe('camino partido — reportMode derivado del preprocesado', () => {
  it('el balance es de un solo periodo → LINEA_BASE', () => {
    expect(deriveReportMode(pp)).toBe('LINEA_BASE');
  });

  it('/strategy construye el prompt en LINEA_BASE', async () => {
    const res = await strategyPOST(
      req('http://localhost/api/financial-report/strategy', {
        niifResult,
        bindingTotals: 'TOTALES VINCULANTES',
        preprocessed: toJsonSafe(pp),
        company,
        language: 'es',
      }),
    );
    expect(res.status).toBe(500); // el sentinela corta tras capturar el prompt
    expect(modeOf('strategy-director')).toBe('LINEA_BASE');
  });

  it('/governance construye el prompt en LINEA_BASE', async () => {
    const res = await governancePOST(
      req('http://localhost/api/financial-report/governance', {
        niifResult,
        strategyResult,
        bindingTotals: 'TOTALES VINCULANTES',
        preprocessed: toJsonSafe(pp),
        company,
        language: 'es',
      }),
    );
    expect(res.status).toBe(500);
    expect(modeOf('governance-specialist')).toBe('LINEA_BASE');
  });
});
