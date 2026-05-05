// rules-engine.test.ts — Motor de reglas tributarias.
//
// DISEÑO: matchRules() hace I/O vía repository.ts (getRules, getTaxProfile).
// Mockeamos el módulo completo con vi.mock para mantener el test puro y rápido.
// No se modifica código de producción — solo se intercepta el import en tiempo
// de test, que es el patrón estándar de Vitest para módulos con side-effects de BD.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaxRuleRow, ThirdPartyTaxProfileRow } from '@/lib/db/schema-tax';

// ── Tipos auxiliares de mock ─────────────────────────────────────────────────

type MockRulePartial = Partial<TaxRuleRow> & {
  id: string;
  code: string;
  taxType: TaxRuleRow['taxType'] | string;
  rate: string;
  workspaceId: string | null;
  applicableTriggers: TaxRuleRow['applicableTriggers'];
  isActive: boolean;
  accountSide: string;
  description: string;
};

// ── Mock del repositorio ─────────────────────────────────────────────────────

// IMPORTANTE: vi.mock se eleva (hoisted) por Vitest al inicio del módulo.
// Las funciones deben definirse dentro del factory para que la referencia a
// `vi.fn()` sea capturable después del hoist.
vi.mock('@/lib/accounting/tax-engine/repository', () => ({
  getRules: vi.fn(),
  getTaxProfile: vi.fn(),
  getAccountByCode: vi.fn(),
  recordAudit: vi.fn(),
}));

import * as repo from '@/lib/accounting/tax-engine/repository';
import { matchRules } from '../rules-engine';

// ── Fábricas de datos de prueba ──────────────────────────────────────────────

const NOW = new Date('2026-01-15T00:00:00Z');

function makeRule(overrides: Partial<MockRulePartial>): TaxRuleRow {
  return {
    id: 'rule-' + (overrides.code ?? 'default'),
    workspaceId: null,  // built-in por defecto
    code: 'TEST_RULE',
    taxType: 'IVA',
    description: 'Regla de prueba',
    rate: '0.19',
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

function makeProfile(overrides: Partial<ThirdPartyTaxProfileRow>): ThirdPartyTaxProfileRow {
  return {
    id: 'profile-1',
    workspaceId: 'ws-1',
    thirdPartyId: 'tp-1',
    regime: 'regimen_comun',
    isGranContribuyente: false,
    isAutorretenedor: false,
    isResponsableIva: true,
    isRegimenSimple: false,
    cityCode: '11001',  // Bogotá
    economicActivity: '6201',
    resolutionRef: null,
    notes: null,
    verifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ThirdPartyTaxProfileRow;
}

const BASE_INPUT = {
  workspaceId: 'ws-1',
  transactionType: 'purchase' as const,
  subtotalCop: '1000000.00',
  transactionDate: NOW,
  thirdPartyId: 'tp-1',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('matchRules — filtrado de reglas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sin reglas disponibles → lista vacía', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules(BASE_INPUT);
    expect(matched).toHaveLength(0);
  });

  it('regla con transactionType que no coincide → descartada', async () => {
    const rule = makeRule({
      code: 'RTF_SVC',
      taxType: 'RETEFUENTE',
      applicableTriggers: { transactionTypes: ['service_purchase'] },
    });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(makeProfile({}));

    // transactionType es 'purchase', la regla exige 'service_purchase'
    const matched = await matchRules({ ...BASE_INPUT, transactionType: 'purchase' });
    expect(matched).toHaveLength(0);
  });

  it('regla sin filtro de transactionType aplica a cualquier tipo', async () => {
    const rule = makeRule({
      code: 'IVA_19',
      taxType: 'IVA',
      applicableTriggers: {},
    });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules(BASE_INPUT);
    expect(matched).toHaveLength(1);
    expect(matched[0].rule.code).toBe('IVA_19');
  });

  it('regla filtrada por supplierRegime=gran_contribuyente excluye régimen_común', async () => {
    const rule = makeRule({
      code: 'RTF_GC',
      taxType: 'RETEFUENTE',
      applicableTriggers: {
        transactionTypes: ['purchase'],
        supplierRegimes: ['gran_contribuyente'],
      },
    });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(
      makeProfile({ isGranContribuyente: false, regime: 'regimen_comun' }),
    );

    const matched = await matchRules(BASE_INPUT);
    expect(matched).toHaveLength(0);
  });

  it('regla filtrada por supplierRegime=regimen_comun incluye proveedor común', async () => {
    const rule = makeRule({
      code: 'RTF_SVC_4',
      taxType: 'RETEFUENTE',
      rate: '0.04',
      applicableTriggers: {
        transactionTypes: ['purchase'],
        supplierRegimes: ['regimen_comun'],
      },
    });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(
      makeProfile({ isGranContribuyente: false, isAutorretenedor: false }),
    );

    const matched = await matchRules(BASE_INPUT);
    expect(matched).toHaveLength(1);
    expect(matched[0].rule.code).toBe('RTF_SVC_4');
  });

  it('subtotal por debajo del umbral UVT (Art. 401 ET) → regla no aplica', async () => {
    // 4 UVT 2026 = 209.496 COP. Subtotal 100.000 < umbral.
    const rule = makeRule({
      code: 'RTF_THRESHOLD',
      taxType: 'RETEFUENTE',
      applyThresholdUvt: '4',
      applicableTriggers: { transactionTypes: ['purchase'] },
    });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules({ ...BASE_INPUT, subtotalCop: '100000.00' });
    expect(matched).toHaveLength(0);
  });

  it('subtotal sobre el umbral UVT → regla aplica', async () => {
    const rule = makeRule({
      code: 'RTF_THRESHOLD',
      taxType: 'RETEFUENTE',
      applyThresholdUvt: '4',
      applicableTriggers: { transactionTypes: ['purchase'] },
    });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    // 1.000.000 > 209.496
    const matched = await matchRules({ ...BASE_INPUT, subtotalCop: '1000000.00' });
    expect(matched).toHaveLength(1);
  });

  it('tercero sin perfil → warning emitido, se asume régimen común', async () => {
    const rule = makeRule({
      code: 'RTF_COMUN',
      taxType: 'RETEFUENTE',
      applicableTriggers: {
        transactionTypes: ['purchase'],
        supplierRegimes: ['regimen_comun'],
      },
    });
    vi.mocked(repo.getRules).mockResolvedValue([rule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);  // sin perfil

    const matched = await matchRules(BASE_INPUT);
    // Asume régimen común → la regla que exige régimen_común SÍ aplica
    expect(matched).toHaveLength(1);
    expect(matched[0].warnings.length).toBeGreaterThan(0);
    expect(matched[0].warnings[0]).toMatch(/régimen común/i);
  });

  it('workspace override: rule con mismo code preferida sobre built-in', async () => {
    const builtIn = makeRule({
      id: 'rule-builtin',
      code: 'IVA_19',
      taxType: 'IVA',
      rate: '0.19',
      workspaceId: null,
      applicableTriggers: {},
    });
    const wsOverride = makeRule({
      id: 'rule-ws',
      code: 'IVA_19',
      taxType: 'IVA',
      rate: '0.05',  // tarifa especial del workspace
      workspaceId: 'ws-1',
      applicableTriggers: {},
    });
    // El repo devuelve ambas (built-in + workspace)
    vi.mocked(repo.getRules).mockResolvedValue([builtIn, wsOverride]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules(BASE_INPUT);
    expect(matched).toHaveLength(1);
    // Debe preferir la del workspace
    expect(matched[0].rule.id).toBe('rule-ws');
    expect(matched[0].rule.rate).toBe('0.05');
  });

  it('excludeTaxTypes filtra reglas del tipo excluido', async () => {
    const ivaRule = makeRule({ code: 'IVA_19', taxType: 'IVA', applicableTriggers: {} });
    const rtfRule = makeRule({ code: 'RTF_4', taxType: 'RETEFUENTE', applicableTriggers: {} });
    vi.mocked(repo.getRules).mockResolvedValue([ivaRule, rtfRule]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules({ ...BASE_INPUT, excludeTaxTypes: ['IVA'] });
    expect(matched).toHaveLength(1);
    expect(matched[0].rule.taxType).toBe('RETEFUENTE');
  });
});
