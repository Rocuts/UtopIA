// seed-engine-retenciones.test.ts — Smart-Tax Engine evaluado con las reglas
// REALES del seed (src/lib/db/seeds/tax-rules-co-2026.ts).
//
// tributario-calc-08: `amountIncludesTax` y `uvtYear` viajaban en el input pero
//   el motor los ignoraba: con $1.190.000 IVA incluido liquidaba IVA 19 % y
//   ReteFuente 4 % sobre $1.190.000 (Art. 447 E.T.: la base del IVA es el valor
//   de la operación SIN el impuesto).
// tributario-calc-09: el seed no tenía ReteFuente por compras (2,5 % / 3,5 %,
//   base 10 UVT desde el 01-jul-2026 — DUR 1625/2016 Art. 1.2.4.9.1 lit. i,
//   mod. Decreto 0572/2025), ni servicios al 6 % para no declarantes; los
//   honorarios se diferenciaban por "declarante" cuando el DUR 1.2.4.3.1 fija
//   11 % a personas jurídicas y 10 % a personas naturales salvo contrato o pagos
//   > 3.300 UVT; no advertía la tabla del Art. 383 para rentas de trabajo no
//   laborales (par. 2 mod. art. 8 Ley 2277/2022; DUR 1.2.4.1.17 par. 4 mod.
//   Decreto 2231/2023); y practicaba ReteICA Bogotá sin verificar que el
//   comprador sea agente retenedor de ICA.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaxRuleRow, ThirdPartyTaxProfileRow } from '@/lib/db/schema-tax';

vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    throw new Error('sin BD en pruebas');
  },
}));
vi.mock('@/lib/accounting/tax-engine/repository', () => ({
  getRules: vi.fn(),
  getTaxProfile: vi.fn(),
  getAccountByCode: vi.fn(),
  recordAudit: vi.fn(() => Promise.resolve()),
}));

import * as repo from '@/lib/accounting/tax-engine/repository';
import { taxEngine } from '@/lib/accounting/tax-engine';
import { TAX_TREATMENT, type TaxEvaluationInput } from '@/lib/accounting/tax-engine/types';
import { BUILT_IN_RULES } from '@/lib/db/seeds/tax-rules-co-2026';

const NOW = new Date('2026-09-23T12:00:00-05:00');

function seedRows(): TaxRuleRow[] {
  return BUILT_IN_RULES.map((r) => ({
    id: 'rule-' + r.code,
    workspaceId: null,
    code: r.code,
    taxType: r.taxType,
    description: r.description,
    rate: r.rate,
    baseAccountCode: null,
    taxAccountCode: r.taxAccountCode,
    accountSide: r.accountSide,
    applyThresholdUvt: r.applyThresholdUvt,
    applyThresholdCop: null,
    applicableTriggers: r.applicableTriggers,
    isDeductible: r.isDeductible,
    isActive: true,
    validFrom: r.validFrom ? new Date(r.validFrom) : null,
    validUntil: r.validUntil ? new Date(r.validUntil) : null,
    createdAt: NOW,
    updatedAt: NOW,
  })) as unknown as TaxRuleRow[];
}

function profile(over: Partial<ThirdPartyTaxProfileRow>): ThirdPartyTaxProfileRow {
  return {
    id: 'p',
    workspaceId: 'ws',
    thirdPartyId: 'tp',
    regime: 'regimen_comun',
    isGranContribuyente: false,
    isAutorretenedor: false,
    isResponsableIva: true,
    isRegimenSimple: false,
    cityCode: '05001',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ThirdPartyTaxProfileRow;
}

function input(over: Partial<TaxEvaluationInput>): TaxEvaluationInput {
  return {
    workspaceId: 'ws',
    transactionType: 'service_purchase',
    subtotalCop: '1000000',
    transactionDate: NOW,
    ...over,
  };
}

const rtfDe = (r: Awaited<ReturnType<typeof taxEngine.evaluate>>) =>
  r.proposedLines.filter((p) => p.taxType === 'RETEFUENTE');

beforeEach(() => {
  vi.clearAllMocks();
  // Réplica del filtro de vigencia de repository.getRules.
  vi.mocked(repo.getRules).mockImplementation(async (_ws: string, d: Date) =>
    seedRows().filter(
      (r) => (!r.validFrom || r.validFrom <= d) && (!r.validUntil || r.validUntil >= d),
    ),
  );
  vi.mocked(repo.getAccountByCode).mockImplementation(
    async (_ws: string, code: string) => ({ id: 'acc-' + code, code, isPostable: true }) as never,
  );
  vi.mocked(repo.getTaxProfile).mockResolvedValue(null);
});

describe('tributario-calc-08 — amountIncludesTax y uvtYear', () => {
  it('$1.190.000 IVA incluido → base $1.000.000: IVA 190.000, ReteFuente 40.000, neto 1.150.000', async () => {
    const r = await taxEngine.evaluate(input({ subtotalCop: '1190000', amountIncludesTax: true }));
    const iva = r.proposedLines.find((p) => p.taxType === 'IVA');
    expect(iva?.taxAmountCop).toBe('190000.00');
    expect(iva?.baseAmountCop).toBe('1000000.00');
    expect(rtfDe(r)[0]?.taxAmountCop).toBe('40000.00');
    expect(r.totalPayableCop).toBe('1150000.00');
    expect(r.warnings.join(' ')).toMatch(/447/);
  });

  it('uvtYear gobierna la conversión de la base mínima en UVT', async () => {
    // 2 UVT: 2026 → $104.748; 2025 → $99.598. Pago de $100.000 en jul-2026.
    const jul = new Date('2026-07-15T12:00:00-05:00');
    const d2026 = await taxEngine.evaluate(input({ subtotalCop: '100000', transactionDate: jul }));
    const d2025 = await taxEngine.evaluate(
      input({ subtotalCop: '100000', transactionDate: jul, uvtYear: 2025 }),
    );
    expect(rtfDe(d2026)).toHaveLength(0);
    expect(rtfDe(d2025)).toHaveLength(1);
  });
});

describe('tributario-calc-09 — reglas sembradas de retención', () => {
  it('compra de bienes de $10.000.000: ReteFuente 2,5 % (declarante)', async () => {
    const r = await taxEngine.evaluate(input({ transactionType: 'purchase', subtotalCop: '10000000' }));
    expect(rtfDe(r).map((p) => p.taxAmountCop)).toEqual(['250000.00']);
  });

  it('compra a no declarante: 3,5 %', async () => {
    const r = await taxEngine.evaluate(
      input({
        transactionType: 'purchase',
        subtotalCop: '10000000',
        taxTreatments: [TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE],
      }),
    );
    expect(rtfDe(r).filter((p) => p.confidence > 0).map((p) => p.taxAmountCop)).toEqual([
      '350000.00',
    ]);
  });

  it('compras: base mínima 10 UVT desde el 01-jul-2026 y 27 UVT en la suspensión', async () => {
    const bajo10 = await taxEngine.evaluate(input({ transactionType: 'purchase', subtotalCop: '500000' }));
    expect(rtfDe(bajo10)).toHaveLength(0);
    const sobre10 = await taxEngine.evaluate(input({ transactionType: 'purchase', subtotalCop: '600000' }));
    expect(rtfDe(sobre10).map((p) => p.taxAmountCop)).toEqual(['15000.00']);
    const junio = await taxEngine.evaluate(
      input({
        transactionType: 'purchase',
        subtotalCop: '1000000',
        transactionDate: new Date('2026-06-15T12:00:00-05:00'),
      }),
    );
    expect(rtfDe(junio)).toHaveLength(0); // < 27 UVT = $1.414.098
  });

  it('servicios a no declarante: 6 %', async () => {
    const r = await taxEngine.evaluate(
      input({ taxTreatments: [TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE] }),
    );
    expect(rtfDe(r).filter((p) => p.confidence > 0).map((p) => p.rate)).toEqual(['0.060000']);
  });

  it('honorarios: 11 % por defecto, con advertencia de 3.300 UVT y del Art. 383', async () => {
    const r = await taxEngine.evaluate(input({ taxTreatments: [TAX_TREATMENT.HONORARIOS] }));
    const [rtf] = rtfDe(r).filter((p) => p.confidence > 0);
    expect(rtf?.rate).toBe('0.110000');
    expect(rtf?.warnings.join(' ')).toMatch(/3\.300 UVT/);
    expect(rtf?.warnings.join(' ')).toMatch(/383/);
  });

  it('honorarios a persona natural con contrato/pagos ≤ 3.300 UVT: 10 % (sin exigir "no declarante")', async () => {
    const r = await taxEngine.evaluate(
      input({
        taxTreatments: [TAX_TREATMENT.HONORARIOS, TAX_TREATMENT.HONORARIOS_PN_HASTA_3300_UVT],
      }),
    );
    expect(rtfDe(r).filter((p) => p.confidence > 0).map((p) => p.rate)).toEqual(['0.100000']);
  });

  it('rentas de trabajo no laborales por tabla del Art. 383: no se contabiliza tarifa plana', async () => {
    const r = await taxEngine.evaluate(
      input({
        taxTreatments: [TAX_TREATMENT.HONORARIOS, TAX_TREATMENT.RENTA_TRABAJO_TABLA_383],
      }),
    );
    const rtf = rtfDe(r);
    expect(rtf.every((p) => p.confidence === 0)).toBe(true);
    expect(r.journalLines.some((l) => l.dimensions?.taxType === 'RETEFUENTE')).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/Art\. 383/);
  });

  it('ReteICA Bogotá exige que el comprador sea agente retenedor de ICA', async () => {
    vi.mocked(repo.getTaxProfile).mockResolvedValue(profile({ cityCode: '11001' }));
    const sin = await taxEngine.evaluate(input({ thirdPartyId: 'tp' }));
    const icaSin = sin.proposedLines.find((p) => p.taxType === 'ICA');
    expect(icaSin?.confidence).toBe(0);
    expect(sin.journalLines.some((l) => l.dimensions?.taxType === 'ICA')).toBe(false);
    expect(icaSin?.warnings.join(' ')).toMatch(/agente retenedor/i);

    const con = await taxEngine.evaluate(
      input({ thirdPartyId: 'tp', taxTreatments: [TAX_TREATMENT.AGENTE_RETENEDOR_ICA] }),
    );
    expect(con.journalLines.some((l) => l.dimensions?.taxType === 'ICA')).toBe(true);
  });
});
