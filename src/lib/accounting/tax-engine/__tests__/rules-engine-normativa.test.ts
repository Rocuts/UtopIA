// rules-engine-normativa.test.ts — Regresiones normativas del Smart-Tax Engine.
//
// Cubre los dos defectos ESTRUCTURALES de la auditoría normativa 2026-08:
//
//   (a) Reglas del mismo taxType con triggers solapados se aplicaban TODAS a la
//       vez: una compra generaba IVA 19% Y 5% sobre la misma base (24% de
//       descontable improcedente → sanción por inexactitud, Art. 648 E.T.) y un
//       servicio generaba ReteFuente 4% Y 11%.
//       Norma: las tarifas de IVA son mutuamente excluyentes por bien o
//       servicio (Arts. 468, 468-1, 468-3, 477, 424 y 476 E.T.) y un pago se
//       somete a un solo concepto de retención (Art. 392 E.T.).
//
//   (b) No existía forma de EXCLUIR un régimen, de modo que se practicaba
//       retención a autorretenedores y a contribuyentes del SIMPLE.
//       Norma: Art. 369 E.T. (pagos no sometidos a retención), Art. 368 par. 1
//       E.T. y DUR 1625/2016 Arts. 1.2.6.1-1.2.6.2 (la obligación se traslada al
//       autorretenedor), Art. 911 E.T. (los contribuyentes del SIMPLE no están
//       sujetos a retención en la fuente, salvo pagos laborales).
//
// Y las ventanas de vigencia de las bases mínimas (Decreto 0572/2025 arts. 2 y
// 6; auto de suspensión del Consejo de Estado del 07-may-2026; auto CE 30229
// del 02-jun-2026 que restableció los efectos desde el 01-jul-2026).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaxRuleRow, ThirdPartyTaxProfileRow } from '@/lib/db/schema-tax';

vi.mock('@/lib/accounting/tax-engine/repository', () => ({
  getRules: vi.fn(),
  getTaxProfile: vi.fn(),
  getAccountByCode: vi.fn(),
  recordAudit: vi.fn(),
}));

import * as repo from '@/lib/accounting/tax-engine/repository';
import { matchRules } from '../rules-engine';
import { generateLines } from '../line-generator';
import { TAX_TREATMENT } from '../types';
import type { TaxRuleTriggers } from '../types';

const NOW = new Date('2026-08-07T00:00:00Z');

function makeRule(
  overrides: Partial<TaxRuleRow> & { applicableTriggers?: TaxRuleTriggers },
): TaxRuleRow {
  return {
    id: 'rule-' + (overrides.code ?? 'default'),
    workspaceId: null,
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

function makeProfile(
  overrides: Partial<ThirdPartyTaxProfileRow>,
): ThirdPartyTaxProfileRow {
  return {
    id: 'profile-1',
    workspaceId: 'ws-1',
    thirdPartyId: 'tp-1',
    regime: 'regimen_comun',
    isGranContribuyente: false,
    isAutorretenedor: false,
    isResponsableIva: true,
    isRegimenSimple: false,
    cityCode: '11001',
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

// Réplica mínima de las reglas sembradas, para no acoplar el test a la BD.
const IVA_19 = makeRule({
  id: 'r-iva19',
  code: 'IVA_19_PURCHASE',
  taxType: 'IVA',
  rate: '0.190000',
  applicableTriggers: {
    transactionTypes: ['purchase', 'service_purchase'],
    exclusionGroup: 'iva',
    specificity: 0,
  },
});

const IVA_5_BIENES = makeRule({
  id: 'r-iva5b',
  code: 'IVA_5_PURCHASE_BIENES',
  taxType: 'IVA',
  rate: '0.050000',
  applicableTriggers: {
    transactionTypes: ['purchase'],
    requiresTreatments: [TAX_TREATMENT.IVA_5_BIENES],
    exclusionGroup: 'iva',
    specificity: 10,
  },
});

const IVA_EXCLUIDO = makeRule({
  id: 'r-ivaexcl',
  code: 'IVA_EXCLUIDO',
  taxType: 'IVA',
  rate: '0.000000',
  taxAccountCode: null,
  applicableTriggers: {
    transactionTypes: ['purchase', 'sale', 'service_purchase', 'service_sale'],
    requiresTreatments: [TAX_TREATMENT.IVA_EXCLUIDO],
    exclusionGroup: 'iva',
    specificity: 20,
  },
});

const RTF_BASE: TaxRuleTriggers = {
  transactionTypes: ['service_purchase'],
  supplierRegimes: [
    'regimen_comun',
    'regimen_simplificado',
    'persona_natural',
    'no_responsable_iva',
  ],
  excludeSupplierRegimes: ['autorretenedor', 'regimen_simple'],
  verifySupplierRegimes: ['gran_contribuyente'],
  exclusionGroup: 'retefuente_renta',
};

const RTF_SVC_4 = makeRule({
  id: 'r-svc4',
  code: 'RTF_SVC_4',
  taxType: 'RETEFUENTE',
  rate: '0.040000',
  accountSide: 'credit',
  taxAccountCode: '236525',
  applyThresholdUvt: '2.0000',
  applicableTriggers: { ...RTF_BASE, specificity: 0 },
});

const RTF_HONO_11 = makeRule({
  id: 'r-hono11',
  code: 'RTF_HONO_11',
  taxType: 'RETEFUENTE',
  rate: '0.110000',
  accountSide: 'credit',
  taxAccountCode: '236525',
  applicableTriggers: {
    ...RTF_BASE,
    requiresTreatments: [TAX_TREATMENT.HONORARIOS],
    specificity: 10,
  },
});

const RTF_HONO_10 = makeRule({
  id: 'r-hono10',
  code: 'RTF_HONO_10',
  taxType: 'RETEFUENTE',
  rate: '0.100000',
  accountSide: 'credit',
  taxAccountCode: '236525',
  applicableTriggers: {
    ...RTF_BASE,
    supplierRegimes: ['persona_natural', 'regimen_simplificado', 'no_responsable_iva'],
    requiresTreatments: [
      TAX_TREATMENT.HONORARIOS,
      TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE,
    ],
    specificity: 20,
  },
});

const SERVICE_INPUT = {
  ...BASE_INPUT,
  transactionType: 'service_purchase' as const,
  subtotalCop: '10000000.00',
};

describe('exclusión mutua de tarifas de IVA (Arts. 468, 468-1, 477, 424/476 E.T.)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('una compra sin tratamiento declarado sólo genera IVA 19% — nunca 19% + 5%', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([IVA_19, IVA_5_BIENES]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules(BASE_INPUT);

    expect(matched.map((m) => m.rule.code)).toEqual(['IVA_19_PURCHASE']);
  });

  it('declarar el bien del Art. 468-1 desplaza el 19%: gana el 5%, y sólo el 5%', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([IVA_19, IVA_5_BIENES]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules({
      ...BASE_INPUT,
      taxTreatments: [TAX_TREATMENT.IVA_5_BIENES],
    });

    expect(matched.map((m) => m.rule.code)).toEqual(['IVA_5_PURCHASE_BIENES']);
    // Rastro de auditoría: consta qué regla fue desplazada.
    expect(matched[0].warnings.join(' ')).toMatch(/IVA_19_PURCHASE/);
  });

  it('operación excluida (Arts. 424/476 E.T.) desplaza al 19% y al 5%', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([IVA_19, IVA_5_BIENES, IVA_EXCLUIDO]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules({
      ...BASE_INPUT,
      taxTreatments: [TAX_TREATMENT.IVA_5_BIENES, TAX_TREATMENT.IVA_EXCLUIDO],
    });

    expect(matched.map((m) => m.rule.code)).toEqual(['IVA_EXCLUIDO']);
  });

  it('un solo IVA descontable llega al asiento: 19% de 1.000.000, no 24%', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([IVA_19, IVA_5_BIENES]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);
    vi.mocked(repo.getAccountByCode).mockResolvedValue({
      id: 'acc-240810',
      isPostable: true,
    } as never);

    const matched = await matchRules(BASE_INPUT);
    const generated = await generateLines(BASE_INPUT, matched);

    expect(generated.journalLines).toHaveLength(1);
    expect(generated.journalLines[0].debit).toBe('190000.00');
    // Total a pagar al proveedor: subtotal + un solo IVA.
    expect(generated.totalPayableCentavos).toBe(BigInt(119_000_000));
  });

  it('empate de especificidad: ninguna se contabiliza y el conflicto queda visible', async () => {
    const gemela = makeRule({
      id: 'r-iva5b-dup',
      code: 'IVA_5_PURCHASE_BIENES_DUP',
      taxType: 'IVA',
      rate: '0.050000',
      applicableTriggers: {
        transactionTypes: ['purchase'],
        requiresTreatments: [TAX_TREATMENT.IVA_5_BIENES],
        exclusionGroup: 'iva',
        specificity: 10,
      },
    });
    vi.mocked(repo.getRules).mockResolvedValue([IVA_5_BIENES, gemela]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);
    vi.mocked(repo.getAccountByCode).mockResolvedValue({
      id: 'acc-240810',
      isPostable: true,
    } as never);

    const input = { ...BASE_INPUT, taxTreatments: [TAX_TREATMENT.IVA_5_BIENES] };
    const matched = await matchRules(input);
    expect(matched).toHaveLength(2);
    expect(matched.every((m) => m.ambiguous === true)).toBe(true);

    const generated = await generateLines(input, matched);
    expect(generated.journalLines).toHaveLength(0);
    expect(generated.proposals.every((p) => p.confidence === 0)).toBe(true);
    expect(generated.totalPayableCentavos).toBe(BigInt(100_000_000));
    expect(generated.warnings.join(' ')).toMatch(/exclusión mutua/i);
  });
});

describe('exclusión mutua de conceptos de ReteFuente (Art. 392 E.T.)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('un servicio no genera 4% Y 11% a la vez: sin declarar honorarios gana el 4%', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4, RTF_HONO_11]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(makeProfile({}));

    const matched = await matchRules(SERVICE_INPUT);

    expect(matched.map((m) => m.rule.code)).toEqual(['RTF_SVC_4']);
  });

  it('declarar honorarios desplaza servicios generales: gana el 11%, y sólo el 11%', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4, RTF_HONO_11]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(makeProfile({}));

    const matched = await matchRules({
      ...SERVICE_INPUT,
      taxTreatments: [TAX_TREATMENT.HONORARIOS],
    });

    expect(matched.map((m) => m.rule.code)).toEqual(['RTF_HONO_11']);
  });

  it('honorarios a persona natural NO declarante retienen 10%, no 11% (Art. 392 inc. 2 E.T.)', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4, RTF_HONO_11, RTF_HONO_10]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(
      makeProfile({ regime: 'persona_natural', isResponsableIva: false }),
    );
    vi.mocked(repo.getAccountByCode).mockResolvedValue({
      id: 'acc-236525',
      isPostable: true,
    } as never);

    const input = {
      ...SERVICE_INPUT,
      taxTreatments: [
        TAX_TREATMENT.HONORARIOS,
        TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE,
      ],
    };
    const matched = await matchRules(input);
    expect(matched.map((m) => m.rule.code)).toEqual(['RTF_HONO_10']);

    // $10.000.000 x 10% = $1.000.000 (no $1.100.000).
    const generated = await generateLines(input, matched);
    expect(generated.journalLines).toHaveLength(1);
    expect(generated.journalLines[0].credit).toBe('1000000.00');
  });
});

describe('sujetos no sometidos a retención (Art. 369 E.T. / Art. 911 E.T.)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('proveedor régimen común que ADEMÁS es autorretenedor: no se le retiene', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(
      makeProfile({ regime: 'regimen_comun', isAutorretenedor: true }),
    );

    const matched = await matchRules(SERVICE_INPUT);

    expect(matched).toHaveLength(0);
  });

  it('contribuyente del SIMPLE: no está sujeto a retención en la fuente (Art. 911 E.T.)', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(
      makeProfile({ regime: 'regimen_comun', isRegimenSimple: true }),
    );

    const matched = await matchRules(SERVICE_INPUT);

    expect(matched).toHaveLength(0);
  });

  it('proveedor régimen común NO autorretenedor: la retención sí procede', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(makeProfile({}));

    const matched = await matchRules(SERVICE_INPUT);

    expect(matched.map((m) => m.rule.code)).toEqual(['RTF_SVC_4']);
  });

  it('gran contribuyente no autorretenedor: se retiene PERO se exige verificar el RUT', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(
      makeProfile({ isGranContribuyente: true }),
    );

    const matched = await matchRules(SERVICE_INPUT);

    expect(matched).toHaveLength(1);
    expect(matched[0].warnings.join(' ')).toMatch(/gran_contribuyente|gran contribuyente/i);
  });

  it('sin perfil tributario: se advierte que la exclusión no pudo verificarse', async () => {
    vi.mocked(repo.getRules).mockResolvedValue([RTF_SVC_4]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(null);

    const matched = await matchRules(SERVICE_INPUT);

    expect(matched).toHaveLength(1);
    expect(matched[0].warnings.join(' ')).toMatch(/Art\. 369 E\.T\./);
    expect(matched[0].warnings.join(' ')).toMatch(/Art\. 911 E\.T\./);
  });
});

describe('advertencias normativas permanentes (advisory)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('la tarifa del 10% arrastra la advertencia del acumulado de 3.300 UVT', async () => {
    const hono10 = makeRule({
      ...RTF_HONO_10,
      applicableTriggers: {
        ...(RTF_HONO_10.applicableTriggers as TaxRuleTriggers),
        advisory:
          'Tarifa del 10% condicionada: si los pagos acumulados superan 3.300 UVT ' +
          'la tarifa es del 11% (DUR 1625/2016 Art. 1.2.4.3.1).',
      },
    });
    vi.mocked(repo.getRules).mockResolvedValue([hono10]);
    vi.mocked(repo.getTaxProfile).mockResolvedValue(
      makeProfile({ regime: 'persona_natural' }),
    );

    const matched = await matchRules({
      ...SERVICE_INPUT,
      taxTreatments: [
        TAX_TREATMENT.HONORARIOS,
        TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE,
      ],
    });

    expect(matched[0].warnings.join(' ')).toMatch(/3\.300 UVT/);
  });
});
