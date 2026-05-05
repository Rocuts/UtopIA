// calculator.test.ts — Depreciación lineal BigInt-centavos.
// calculateDepreciation() es puramente síncrona, sin I/O. Tests < 5ms c/u.

import { describe, it, expect } from 'vitest';
import { calculateDepreciation } from '../calculator';
import type { DepreciationCalcInput } from '../calculator';
import type { FixedAssetRow } from '@/lib/db/schema';
import type { AccountingPeriodRow } from '@/lib/db/schema';

// ── Fábricas ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-01-31T00:00:00Z');
const ACQ = new Date('2023-02-01T00:00:00Z');

function makePeriod(year: number, month: number): AccountingPeriodRow {
  return {
    id: `period-${year}-${month}`,
    workspaceId: 'ws-1',
    year,
    month,
    status: 'open',
    startsAt: new Date(year, month - 1, 1),
    endsAt: NOW,
    closedAt: null,
    closedBy: null,
    lockedAt: null,
  } as AccountingPeriodRow;
}

function makeAsset(overrides: Partial<FixedAssetRow & { lastDepreciatedPeriod?: { year: number; month: number } | null }>): FixedAssetRow & { lastDepreciatedPeriod?: { year: number; month: number } | null } {
  return {
    id: 'asset-1',
    workspaceId: 'ws-1',
    code: 'COMP-001',
    name: 'Computador HP',
    category: 'equipment',
    assetAccountId: 'acc-asset',
    depreciationAccountId: 'acc-depr-acum',
    expenseAccountId: 'acc-depr-gasto',
    acquisitionDate: ACQ,
    acquisitionCost: '3000000.00',
    salvageValue: '0',
    usefulLifeMonths: 36,
    depreciationMethod: 'straight_line',
    accumulatedDepreciation: '0',
    lastDepreciatedPeriodId: null,
    active: true,
    disposedAt: null,
    notes: null,
    createdAt: ACQ,
    updatedAt: NOW,
    lastDepreciatedPeriod: null,
    ...overrides,
  } as FixedAssetRow & { lastDepreciatedPeriod?: { year: number; month: number } | null };
}

function makeInput(assets: ReturnType<typeof makeAsset>[], period = makePeriod(2026, 1)): DepreciationCalcInput {
  return {
    workspaceId: 'ws-1',
    period,
    entryDate: NOW,
    assets,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateDepreciation — straight-line', () => {
  it('computador 3.000.000 COP, 36 meses, salvage 0 → primer mes incluye remainder', () => {
    // 3.000.000 / 36 = 83.333,33… → 8333333 centavos con 9 centavos de remainder
    // El primer mes recibe el remainder: monthlyBase + remainder = 83333 + 12/... wait
    // En BigInt: 300000000 / 36 = 8333333, remainder = 300000000 % 36 = 12 centavos
    // Primer mes = 8333333 + 12 = 8333345 centavos = 83333.45 (no 83333.33)
    // Veamos: 3.000.000 × 100 = 300.000.000 centavos; 300.000.000 / 36 = 8.333.333 r 12
    const asset = makeAsset({});
    const result = calculateDepreciation(makeInput([asset]));

    expect(result.lines).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    // El monthlyAmountCop del primer mes = (300000000/36) + (300000000%36) centavos
    // = 8333333 + 12 = 8333345 centavos = "83333.45"
    expect(result.lines[0].monthlyAmountCop).toBe('83333.45');
    expect(result.lines[0].method).toBe('straight_line');
    expect(result.totalAmountCop).toBe('83333.45');
  });

  it('computador 3.000.000, 36 meses, salvage 300.000 → cuota = 2.700.000/36 = 75.000 exacto', () => {
    // 2.700.000 / 36 = 75.000 → sin remainder (270000000 % 36 = 0)
    const asset = makeAsset({ salvageValue: '300000.00' });
    const result = calculateDepreciation(makeInput([asset]));

    expect(result.lines[0].monthlyAmountCop).toBe('75000.00');
    expect(result.skipped).toHaveLength(0);
  });

  it('segundo mes (accumulated > 0) usa monthlyBase sin remainder', () => {
    // Después del primer mes, accumulated = 83333.45 → remainder = 0 en meses siguientes
    const asset = makeAsset({
      accumulatedDepreciation: '83333.45',
      lastDepreciatedPeriod: { year: 2026, month: 1 },
    });
    const period = makePeriod(2026, 2);
    const result = calculateDepreciation(makeInput([asset], period));

    // Segundo mes: remainder = ZERO (accumulated > 0); monthly = 8333333 centavos = "83333.33"
    expect(result.lines[0].monthlyAmountCop).toBe('83333.33');
  });

  it('activo totalmente depreciado: skipped con reason=fully_depreciated', () => {
    const asset = makeAsset({ accumulatedDepreciation: '3000000.00' });
    const result = calculateDepreciation(makeInput([asset]));

    expect(result.lines).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('fully_depreciated');
    expect(result.proposedEntry).toBeNull();
  });

  it('activo dado de baja: skipped con reason=disposed', () => {
    const asset = makeAsset({ disposedAt: new Date('2025-12-31T00:00:00Z') });
    const result = calculateDepreciation(makeInput([asset]));

    expect(result.lines).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('disposed');
  });

  it('período anterior al last_depreciated: skipped con reason=already_depreciated_this_period', () => {
    // lastDepreciated = 2026-02, pedimos 2026-01 → ya aplicado (cmp <= 0)
    const asset = makeAsset({
      lastDepreciatedPeriod: { year: 2026, month: 2 },
    });
    const period = makePeriod(2026, 1);  // período ANTERIOR al ya depreciado
    const result = calculateDepreciation(makeInput([asset], period));

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('already_depreciated_this_period');
  });

  it('mismo período que last_depreciated: skipped (cmp === 0)', () => {
    const asset = makeAsset({
      lastDepreciatedPeriod: { year: 2026, month: 1 },
    });
    const period = makePeriod(2026, 1);  // mismo período
    const result = calculateDepreciation(makeInput([asset], period));

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('already_depreciated_this_period');
  });

  it('previewDepreciation es idempotente (no modifica el asset de entrada)', () => {
    const asset = makeAsset({});
    const originalAccum = asset.accumulatedDepreciation;

    calculateDepreciation(makeInput([asset]));
    calculateDepreciation(makeInput([asset]));  // segunda llamada

    // El objeto original no debe haber sido mutado
    expect(asset.accumulatedDepreciation).toBe(originalAccum);
  });

  it('múltiples activos: total = suma de líneas individuales', () => {
    const asset1 = makeAsset({ id: 'a1', code: 'A1', acquisitionCost: '1200000.00', usefulLifeMonths: 12, salvageValue: '0' });
    const asset2 = makeAsset({ id: 'a2', code: 'A2', acquisitionCost: '2400000.00', usefulLifeMonths: 24, salvageValue: '0' });

    const result = calculateDepreciation(makeInput([asset1, asset2]));

    expect(result.lines).toHaveLength(2);
    // Verificar que el total es consistente
    const total = result.lines.reduce(
      (s, l) => s + parseFloat(l.monthlyAmountCop),
      0,
    );
    expect(parseFloat(result.totalAmountCop)).toBeCloseTo(total, 2);
  });

  it('proposedEntry tiene sourceType=depreciation y las líneas correctas', () => {
    const asset = makeAsset({});
    const result = calculateDepreciation(makeInput([asset]));

    expect(result.proposedEntry).not.toBeNull();
    expect(result.proposedEntry!.sourceType).toBe('depreciation');
    // 2 líneas por activo: gasto + depreciación acumulada
    expect(result.proposedEntry!.lines).toHaveLength(2);
    expect(result.proposedEntry!.lines[0].accountId).toBe('acc-depr-gasto');
    expect(result.proposedEntry!.lines[1].accountId).toBe('acc-depr-acum');
  });
});
