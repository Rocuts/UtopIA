// ---------------------------------------------------------------------------
// recalculo-final-07 (re-auditoría 2026-09-24) — "Riesgo de liquidez" (AC < PC)
// es un hallazgo del análisis, no un error de los datos. Antes era motivo
// bloqueante: un ESF cuadrado sin P&G (R8 no actúa, el Bridge no degrada)
// respondía 422, y el mismo caso con P&G pasaba como informativo.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { prepareFinancialContext } from '@/lib/agents/financial/orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';

const COMPANY = { name: 'Empresa Prueba SAS', nit: '900123456-7', fiscalPeriod: '2025' };

// A 500 M = P 300 M + K 200 M; AC (caja) 100 M < PC (obligaciones CP) 300 M.
const ESF_SIN_PYG = [
  'codigo,nombre,Saldo 2025',
  '110505,Caja,100000000',
  '152405,Maquinaria,400000000',
  '210505,Obligaciones bancarias,300000000',
  '310505,Capital,200000000',
].join('\n');

// Mismo ESF con un P&G del periodo (utilidad 50 M trasladada en 3605).
const ESF_CON_PYG = [
  'codigo,nombre,Saldo 2025',
  '110505,Caja,100000000',
  '152405,Maquinaria,450000000',
  '210505,Obligaciones bancarias,300000000',
  '310505,Capital,200000000',
  '360505,Utilidad del ejercicio,50000000',
  '413505,Ventas,300000000',
  '513505,Gastos,250000000',
].join('\n');

describe.each([
  ['sin P&G', ESF_SIN_PYG],
  ['con P&G', ESF_CON_PYG],
])('recalculo-final-07 — AC < PC en un balance cuadrado %s', (_n, csv) => {
  it('no es motivo bloqueante: queda como ajuste informativo y discrepancia de análisis', () => {
    const s = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary;
    expect(s.controlTotals.activoCorriente).toBeLessThan(s.controlTotals.pasivoCorriente);
    expect(s.validation.reasons.some((r) => /liquidez/i.test(r))).toBe(false);
    expect(s.validation.adjustments.some((a) => /Riesgo de liquidez \(hallazgo informativo/.test(a))).toBe(true);
    expect(s.discrepancies.some((d) => d.location.startsWith('Riesgo de Liquidez'))).toBe(true);
  });

  it('el gate de /niif no responde 422', async () => {
    const ctx = await prepareFinancialContext({ rawData: csv, company: COMPANY, language: 'es' });
    expect(ctx.ppForAgents?.primary.controlTotals.activo).toBeGreaterThan(0);
  });
});
