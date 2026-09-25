// ---------------------------------------------------------------------------
// recalculo-final-04 (re-auditoría 2026-09-24) — el API v1 publicaba status
// 'balanced' para balances que /niif bloquea: CUR-R12 (P&G posiblemente
// acumulado) e importes fuera del rango de precisión. El status usa ahora los
// mismos motivos persistentes que el gate 422 de /niif.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { BalanceValidationError, prepareFinancialContext } from '@/lib/agents/financial/orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { summarize } from '../trial-balances';

const COMPANY = { name: 'Empresa Prueba SAS', nit: '900123456-7', fiscalPeriod: '2025' };
const pre = (csv: string) => preprocessTrialBalance(parseTrialBalanceCSV(csv));
const niif422 = (rawData: string) =>
  prepareFinancialContext({ rawData, company: COMPANY, language: 'es' }).then(
    () => false,
    (e: unknown) => e instanceof BalanceValidationError,
  );

// 2024 no se cerró: el P&G 2025 trae el acumulado 2024 + 2025 (CUR-R12).
const CSV_ACUMULADO = [
  'codigo,nombre,Saldo 2024,Saldo 2025',
  '110505,Caja,1000000000,1500000000',
  '220505,Proveedores,400000000,500000000',
  '310505,Capital,100000000,100000000',
  '413505,Ventas,800000000,1500000000',
  '513505,Gastos,300000000,600000000',
].join('\n');

describe('recalculo-final-04 — status del API v1 coherente con /niif', () => {
  it('CUR-R12 (P&G posiblemente acumulado): ecuación cuadrada pero unbalanced, como el 422 de /niif', async () => {
    const pp = pre(CSV_ACUMULADO);
    expect(pp.primary.validation.curatorBlockingReasons?.some((r) => r.startsWith('[CUR-R12]'))).toBe(true);
    const s = summarize(pp);
    expect(s.control_totals.equation_delta.amount).toBe('0');
    expect(s.status).toBe('unbalanced');
    expect(await niif422(CSV_ACUMULADO)).toBe(true);
  });

  it('importes fuera del rango de precisión: motivo de integridad ⇒ unbalanced y 422', async () => {
    const csv = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__/patologicos/cifras-mayores-2e53.csv'),
      'utf8',
    );
    const pp = pre(csv);
    expect(pp.primary.validation.integrityReasons?.some((r) => /rango de precisión/.test(r))).toBe(true);
    expect(summarize(pp).status).toBe('unbalanced');
    expect(await niif422(csv)).toBe(true);
  });

  it('control: balance cuadrado sin motivos persistentes sigue balanced y /niif no bloquea', async () => {
    const csv = [
      'codigo,nombre,Saldo 2025',
      '110505,Caja,1000000000',
      '220505,Proveedores,400000000',
      '310505,Capital,500000000',
      '360505,Utilidad del ejercicio,100000000',
      '413505,Ventas,800000000',
      '513505,Gastos,700000000',
    ].join('\n');
    expect(summarize(pre(csv)).status).toBe('balanced');
    expect(await niif422(csv)).toBe(false);
  });
});
