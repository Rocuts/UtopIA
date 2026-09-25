// ---------------------------------------------------------------------------
// Bridge de Cuadratura — motivos que nunca se degradan (auditoría 2026-09)
// ---------------------------------------------------------------------------
// El Bridge levanta las razones pre-R8 cuando el traslado del resultado
// (3605VC) cuadra la ecuación. Pero pasaba a "informativo" TODAS las razones
// del snapshot, incluidas:
//   - `validation.integrityReasons` (WP02, niif-preproceso-05): importes
//     ilegibles, columnas ambiguas, filas desplazadas, códigos no PUC;
//   - `validation.curatorBlockingReasons` (WP03, recalculo-03/-08): bloqueos
//     escritos por el curator DESPUÉS de R8 (CUR-R12 P&G acumulado, CUR-R5
//     desglose ≠ clase 3, CUR-R8 residual).
// Ningún cierre virtual resuelve esos motivos: el gate debe responder 422
// con ellos y dejar como informativas sólo las razones pre-R8.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { BalanceValidationError, prepareFinancialContext } from '../orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

const COMPANY = { name: 'Empresa Prueba SAS', nit: '900123456-7', fiscalPeriod: '2025' };

async function reasonsOf(rawData: string): Promise<string[]> {
  const err = await prepareFinancialContext({ rawData, company: COMPANY, language: 'es' }).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BalanceValidationError);
  return (err as BalanceValidationError).reasons;
}

// Libros abiertos que cuadran con el traslado: A 1.000M = P 400M + K 500M +
// utilidad 100M. Pre-R8 la ecuación "no cuadra" por 100M; R8 lo explica.
const ABIERTO = [
  'codigo,nombre,Saldo 2025',
  '110505,Caja,1000000000',
  '220505,Proveedores,400000000',
  '310505,Capital,500000000',
  '413505,Ventas,800000000',
  '513505,Gastos,700000000',
].join('\n');

describe('Bridge de Cuadratura — motivos persistentes', () => {
  it('control: con el traslado explicado y sin otros motivos, el Bridge levanta el bloqueo', async () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(ABIERTO));
    expect(pp.primary.validation.blocking).toBe(true); // razones pre-R8
    expect(pp.primary.summary.equationBalanced).toBe(true);
    const ctx = await prepareFinancialContext({ rawData: ABIERTO, company: COMPANY, language: 'es' });
    expect(ctx.ppForAgents?.primary.controlTotals.patrimonio).toBe(600_000_000);
  });

  it('un importe ilegible (integridad) bloquea aunque R8 cuadre la ecuación', async () => {
    const csv = ABIERTO.replace('220505,', '111005,Bancos,#DIV/0!\n220505,');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pp.primary.summary.equationBalanced).toBe(true);
    const integrity = pp.primary.validation.integrityReasons ?? [];
    expect(integrity.length).toBeGreaterThan(0);

    const reasons = await reasonsOf(csv);
    expect(reasons).toEqual(integrity.map((r) => `[2025] ${r}`));
    expect(reasons.join('\n')).toMatch(/111005/);
    // Las razones pre-R8 que el traslado explica no bloquean.
    expect(reasons.join('\n')).not.toMatch(/La ecuacion contable no cuadra/);
  });

  it('P&G acumulado (CUR-R12) bloquea con la cifra alternativa aunque R8 cuadre la ecuación', async () => {
    // 2024 nunca se cerró: el P&G 2025 trae 2024 + 2025 (resultado 900M, del
    // ejercicio 400M). Ver curator-integridad-2026-09.test.ts (recalculo-03).
    const csv = [
      'codigo,nombre,Saldo 2024,Saldo 2025',
      '110505,Caja,1000000000,1500000000',
      '220505,Proveedores,400000000,500000000',
      '310505,Capital,100000000,100000000',
      '413505,Ventas,800000000,1500000000',
      '513505,Gastos,300000000,600000000',
    ].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pp.primary.summary.equationBalanced).toBe(true);
    const r12 = pp.primary.validation.curatorBlockingReasons ?? [];
    expect(r12).toHaveLength(1);
    expect(r12[0]).toMatch(/^\[CUR-R12\]/);

    const reasons = await reasonsOf(csv);
    expect(reasons).toEqual([`[2025] ${r12[0]}`]);
    expect(reasons[0]).toContain('400.000.000,00');
  });
});
