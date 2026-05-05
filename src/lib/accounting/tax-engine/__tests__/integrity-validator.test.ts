// integrity-validator.test.ts — Validador |tax = base × rate| ±1 centavo.
//
// IMPORTANTE: La implementación calcula la base como max(sumDebits, sumCredits)
// de líneas SIN taxRuleId. Para tests de compras, la base son los débitos
// (gasto + IVA descontable). Las líneas de crédito (CxP) también son "base"
// si no tienen taxRuleId, por lo que deben excluirse o su crédito > débito
// haría que el validador use el crédito como base.
//
// Estrategia: usamos solo líneas de débito para la base en tests de compra
// (sin línea de CxP), o construimos estructuras donde el débito es la base.
//
// validateLines() llama getRules() del repositorio → mockeamos el módulo.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaxRuleRow } from '@/lib/db/schema-tax';
import type { JournalLineInput } from '@/lib/accounting/types';

vi.mock('@/lib/accounting/tax-engine/repository', () => ({
  getRules: vi.fn(),
  getTaxProfile: vi.fn(),
  getAccountByCode: vi.fn(),
  recordAudit: vi.fn(),
}));

import * as repo from '@/lib/accounting/tax-engine/repository';
import { validateLines } from '../integrity-validator';

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-01-15T00:00:00Z');

function makeRule(overrides: Partial<TaxRuleRow>): TaxRuleRow {
  return {
    id: 'rule-1',
    workspaceId: null,
    code: 'IVA_19',
    taxType: 'IVA',
    description: 'IVA 19%',
    rate: '0.190000',
    baseAccountCode: '529505',
    taxAccountCode: '240810',
    accountSide: 'debit',
    applyThresholdUvt: null,
    applyThresholdCop: null,
    applicableTriggers: {},
    isDeductible: false,
    isActive: true,
    validFrom: null,
    validUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as TaxRuleRow;
}

function taxLine(amount: string, ruleId: string, ruleCode = 'IVA_19'): JournalLineInput {
  return {
    accountId: 'acc-iva',
    debit: amount,
    credit: '0',
    dimensions: { taxRuleId: ruleId, taxRuleCode: ruleCode },
  };
}

// Construcción correcta: líneas de base SOLO con débitos (para compras).
// La suma de débitos de base lines = baseCentavosDb > baseCentavosCr (= 0).
// Así el validador usa el débito como base gravable.
function buildPurchaseLines(
  baseDebit: string,
  taxAmountDebit: string,
  ruleId: string,
): JournalLineInput[] {
  return [
    { accountId: 'acc-gasto', debit: baseDebit, credit: '0' },   // base
    taxLine(taxAmountDebit, ruleId),                                // tax (con taxRuleId)
  ];
}

const COMMON_INPUT = {
  workspaceId: 'ws-1',
  transactionType: 'purchase' as const,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('validateLines — integridad tax = base × rate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sin líneas con taxRuleId → ok:true inmediatamente', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([]);

    const result = await validateLines({
      ...COMMON_INPUT,
      lines: [
        { accountId: 'acc-gasto', debit: '1000000.00', credit: '0' },
        { accountId: 'acc-cxp', debit: '0', credit: '1000000.00' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('tax = base × rate exacto → no violations', async () => {
    // Base = 1.000.000; rate = 0.19; expected = 190.000 COP exacto.
    // BigInt: 100_000_000 * 190_000 / 1_000_000 = 19_000_000 centavos = 190.000 COP
    const rule = makeRule({ id: 'rule-iva', rate: '0.190000' });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);

    const result = await validateLines({
      ...COMMON_INPUT,
      lines: buildPurchaseLines('1000000.00', '190000.00', 'rule-iva'),
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('desviación de 1 centavo → no violation (TOLERANCE_CENTAVOS = 1, diff=1 NO es > 1)', async () => {
    // diff = 1 centavo; TOLERANCE = 1 centavo; condición: diff > TOLERANCE → false.
    // 190.000,01 COP = 19_000_001 centavos; expected = 19_000_000; diff = 1.
    const rule = makeRule({ id: 'rule-iva', rate: '0.190000' });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);

    const result = await validateLines({
      ...COMMON_INPUT,
      lines: buildPurchaseLines('1000000.00', '190000.01', 'rule-iva'),
    });
    // diff = 1 centavo ≤ TOLERANCE_CENTAVOS (1) → ok
    expect(result.ok).toBe(true);
  });

  it('desviación de 2 centavos → violation con severity=warning', async () => {
    // diff = 2 centavos > TOLERANCE(1) → violation
    // diff = 2 centavos ≤ 100 centavos → severity='warning'
    const rule = makeRule({ id: 'rule-iva', rate: '0.190000' });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);

    const result = await validateLines({
      ...COMMON_INPUT,
      lines: buildPurchaseLines('1000000.00', '190000.02', 'rule-iva'),
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe('warning');
    expect(result.violations[0].ruleCode).toBe('IVA_19');
  });

  it('desviación de 101 COP → severity=error', async () => {
    // diff = 10100 centavos > 100 centavos → severity='error'
    const rule = makeRule({ id: 'rule-iva', rate: '0.190000' });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);

    const result = await validateLines({
      ...COMMON_INPUT,
      lines: buildPurchaseLines('1000000.00', '190101.00', 'rule-iva'),
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe('error');
  });

  it('línea sin metadata.taxRuleId es ignorada (no hay nada que validar → ok)', async () => {
    const rule = makeRule({ id: 'rule-iva', rate: '0.190000' });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);

    // Solo líneas de base y CxP, ninguna con taxRuleId
    const result = await validateLines({
      ...COMMON_INPUT,
      lines: [
        { accountId: 'acc-gasto', debit: '1000000.00', credit: '0' },
        { accountId: 'acc-cxp', debit: '0', credit: '1000000.00' },
      ],
    });
    // taxLines es vacío → retorna ok:true inmediatamente
    expect(result.ok).toBe(true);
  });

  it('múltiples líneas con violaciones retorna todas', async () => {
    const ivaRule = makeRule({ id: 'rule-iva', code: 'IVA_19', rate: '0.190000' });
    const rtfRule = makeRule({ id: 'rule-rtf', code: 'RTF_4', taxType: 'RETEFUENTE', rate: '0.040000' });
    vi.mocked(repo.getRules).mockResolvedValue([ivaRule, rtfRule]);

    // base = 1.000.000; IVA esperado 190.000; RTF esperado 40.000
    // Ambas líneas tienen desviación > 100 centavos → error
    const result = await validateLines({
      ...COMMON_INPUT,
      lines: [
        { accountId: 'acc-gasto', debit: '1000000.00', credit: '0' },
        { accountId: 'acc-iva', debit: '191000.00', credit: '0', dimensions: { taxRuleId: 'rule-iva', taxRuleCode: 'IVA_19' } },
        { accountId: 'acc-rtf', debit: '41000.00', credit: '0', dimensions: { taxRuleId: 'rule-rtf', taxRuleCode: 'RTF_4' } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});
