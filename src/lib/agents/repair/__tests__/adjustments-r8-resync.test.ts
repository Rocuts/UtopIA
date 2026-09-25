// ---------------------------------------------------------------------------
// Doctor de Datos + Cierre Virtual (R8) — integración auditoría 2026-09
// ---------------------------------------------------------------------------
// `applyAdjustments` recalculaba las clases 4-7 pero dejaba 3605VC con la
// utilidad PRE-ajuste y el bloqueo CUR-R8 del balance original. Mientras R8
// absorbía todo residual en 3710VC el desfase no se veía; desde WP03
// (niif-preproceso-06) R8 ya no absorbe, así que un ajuste que SÍ corrige el
// balance seguía bloqueado (y el patrimonio publicado era el anterior).
// Ahora R8 se re-ejecuta sobre el snapshot ajustado.
//
// Además `cloneSnapshot` descartaba `integrityReasons` y
// `curatorBlockingReasons`, con lo que el Bridge de Cuadratura del
// orquestador podía degradarlos tras cualquier ajuste.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { applyAdjustments } from '../adjustments';
import type { Adjustment } from '../types';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import {
  BalanceValidationError,
  prepareFinancialContext,
} from '@/lib/agents/financial/orchestrator';

// Libros cerrados con una causación duplicada de sueldos ($50M) en el P&G:
// A 1.000M = P 400M + K 600M (capital 300M + 3705 100M + 3605 200M), pero las
// clases 4-7 dan 900 − 450 − 300 = 150M ≠ 3605. R8 no puede explicar la
// diferencia y bloquea.
const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,300000000',
  '130505,Clientes,Auxiliar,1,700000000',
  '220505,Proveedores,Auxiliar,1,400000000',
  '311505,Capital,Auxiliar,1,300000000',
  '370505,Utilidades acumuladas,Auxiliar,1,100000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,200000000',
  '410505,Ventas,Auxiliar,1,900000000',
  '510505,Sueldos,Auxiliar,1,450000000',
  '613505,CMV,Auxiliar,1,300000000',
].join('\n');

const COMPANY = { name: 'Empresa Prueba SAS', nit: '900123456-7', fiscalPeriod: '2025' };

function sueldos(amount: number): Adjustment {
  return {
    id: 'adj-sueldos',
    accountCode: '510505',
    accountName: 'Sueldos',
    amount,
    rationale: 'Causación duplicada confirmada por el contador',
    status: 'applied',
    proposedAt: '2026-09-24T00:00:00Z',
    appliedAt: '2026-09-24T00:00:00Z',
  };
}

const balanceOf = (code: string, snap: ReturnType<typeof preprocessTrialBalance>['primary']) =>
  snap.classes.find((c) => c.code === 3)!.accounts.find((a) => a.code === code)?.balance ?? 0;

describe('applyAdjustments re-ejecuta R8 sobre el balance ajustado', () => {
  it('el balance original bloquea por CUR-R8 (fixture)', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    expect(pp.primary.controlTotals.utilidadNeta).toBe(150_000_000);
    expect(pp.primary.virtualCloseAdjustment?.blocking).toBe(true);
    expect(pp.primary.validation.curatorBlockingReasons).toHaveLength(1);
    expect(pp.primary.validation.curatorBlockingReasons![0]).toMatch(/^\[CUR-R8\]/);
  });

  it('un ajuste que explica el descuadre retira el bloqueo y ancla 3605VC a la utilidad ajustada', () => {
    const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const { balance } = applyAdjustments(original, [sueldos(-50_000_000)]);
    const s = balance.primary;

    expect(s.controlTotals.utilidadNeta).toBe(200_000_000);
    expect(balanceOf('3605VC', s)).toBe(200_000_000);
    expect(balanceOf('3710VC', s)).toBe(0);
    expect(s.controlTotals.patrimonio).toBe(600_000_000);
    expect(s.controlTotals.cents!.patrimonio).toBe(BigInt(60_000_000_000));
    expect(s.controlTotals.raw!.patrimonio).toBe('600000000.00');
    expect(s.summary.equationBalanced).toBe(true);
    expect(s.virtualCloseAdjustment).toMatchObject({
      dynamicNetIncome: 200_000_000,
      reclassifiedFrom3605: false,
      unexplainedResidualRaw: '0.00',
      blocking: false,
    });
    expect(s.equityBreakdown.utilidadEjercicio).toBe(200_000_000);
    expect(s.equityBreakdown.utilidadesAcumuladas).toBe(100_000_000);
    expect(s.validation.curatorBlockingReasons ?? []).toHaveLength(0);
    expect(s.validation.blocking).toBe(false);
    // Hallazgos CUR-R8 reemplazados (sin el crítico del balance original).
    expect(
      (s.curator?.findings ?? []).some((f) => f.code === 'CUR-R8' && f.severity === 'critico'),
    ).toBe(false);
    expect(s.curator?.virtualCloseAdjustment).toBe(s.virtualCloseAdjustment);
    expect(s.discrepancies.some((d) => /CUR-R8 · CRITICO/.test(d.location))).toBe(false);

    // Pura: el balance original no cambia.
    expect(original.primary.controlTotals.patrimonio).toBe(750_000_000);
    expect(original.primary.validation.curatorBlockingReasons).toHaveLength(1);
  });

  it('un ajuste insuficiente deja el bloqueo con el residual POST-ajuste exacto al centavo', () => {
    const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const { balance } = applyAdjustments(original, [sueldos(-49_999_500)]);
    const s = balance.primary;

    expect(s.controlTotals.utilidadNeta).toBe(199_999_500);
    expect(balanceOf('3605VC', s)).toBe(199_999_500);
    expect(s.virtualCloseAdjustment?.unexplainedResidualRaw).toBe('500.00');
    expect(s.summary.equationBalanced).toBe(false);
    expect(s.validation.blocking).toBe(true);
    expect(s.validation.curatorBlockingReasons).toHaveLength(1);
    expect(s.validation.curatorBlockingReasons![0]).toContain('$500,00');
    expect(s.validation.reasons).toEqual(s.validation.curatorBlockingReasons);
  });

  it('conserva integrityReasons y curatorBlockingReasons al clonar', () => {
    const pp = preprocessTrialBalance(
      parseTrialBalanceCSV(
        [
          'codigo,nombre,Saldo 2025',
          '110505,Caja,1000000000',
          '111005,Bancos,#DIV/0!',
          '220505,Proveedores,400000000',
          '310505,Capital,500000000',
          '413505,Ventas,800000000',
          '513505,Gastos,700000000',
        ].join('\n'),
      ),
    );
    const integrity = pp.primary.validation.integrityReasons ?? [];
    expect(integrity.join('\n')).toMatch(/111005/);
    const { balance } = applyAdjustments(pp, [
      { ...sueldos(1_000), accountCode: '130505', accountName: 'Clientes' },
    ]);
    expect(balance.primary.validation.integrityReasons).toEqual(integrity);
    expect(balance.primary.validation.integrityReasons).not.toBe(integrity);
  });
});

describe('prepareFinancialContext — Doctor de Datos con R8 al centavo', () => {
  it('el ajuste confirmado que cuadra el balance levanta el 422 y publica el patrimonio ajustado', async () => {
    const ctx = await prepareFinancialContext(
      { rawData: CSV, company: COMPANY, language: 'es' },
      { adjustmentLedger: { adjustments: [sueldos(-50_000_000)] } },
    );
    const s = ctx.ppForAgents!.primary;
    expect(s.controlTotals.patrimonio).toBe(600_000_000);
    expect(s.controlTotals.utilidadNeta).toBe(200_000_000);
    expect(ctx.bindingTotalsBlock).toContain('600.000.000');
  });

  it('un residual post-ajuste de $500 (bajo la tolerancia de revalidate) sigue siendo 422', async () => {
    const run = () =>
      prepareFinancialContext(
        { rawData: CSV, company: COMPANY, language: 'es' },
        { adjustmentLedger: { adjustments: [sueldos(-49_999_500)] } },
      );
    await expect(run()).rejects.toBeInstanceOf(BalanceValidationError);
    const err = (await run().catch((e: unknown) => e)) as BalanceValidationError;
    const text = err.reasons.join('\n');
    expect(text).toContain('[CUR-R8]');
    expect(text).toContain('$500,00');
  });
});
