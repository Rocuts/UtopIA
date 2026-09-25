// ---------------------------------------------------------------------------
// F03 sólo admite crédito imputable al impuesto de RENTA
// ---------------------------------------------------------------------------
// Auditoría fiscal 2026-08 (superficie 2). El extractor sumaba a F03 todas las
// hojas 1355 y 1805, incluidas:
//   - 135517 «Impuesto a las ventas retenido» (ReteIVA), que el Art. 484-1 E.T.
//     manda acreditar en la DECLARACIÓN DE IVA del período de la retención;
//   - 135518 «Impuesto de industria y comercio retenido» / anticipo de ICA,
//     que se acredita en la declaración municipal de ICA.
// Ninguno de los dos es una retención a título de renta, así que el Art. 373
// E.T. no permite imputarlos al impuesto de renta. Sumarlos infla el crédito,
// baja el «neto a pagar» F04 e induce a subdeclarar: Art. 647 E.T. (100% del
// mayor impuesto) y Art. 670 E.T. (20% de la devolución improcedente).
//
// Medido sobre el balance real (Grupo Empresarial 2 Tres SAS, 2025):
//   ReteIVA 135517 = $4.857.142,54 · ReteICA 135518 = $602.281,42
//   → $5.459.423,96 acreditados indebidamente contra renta.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { extractFiscalBaseFromTrialBalance } from '../extractor';
import type { PeriodSnapshot, ValidatedAccount } from '@/lib/preprocessing/trial-balance';

function leaf(code: string, name: string, balance: number): ValidatedAccount {
  return { code, name, level: 'Auxiliar', balance, isLeaf: true } as ValidatedAccount;
}

/** Snapshot mínimo: al extractor sólo le interesan las hojas por clase. */
function snapshotConHojas(accounts: ValidatedAccount[]): PeriodSnapshot {
  return {
    period: '2025',
    classes: [{ code: 1, name: 'ACTIVO', total: 0, accounts }],
  } as unknown as PeriodSnapshot;
}

describe('extractFiscalBaseFromTrialBalance — F03 sólo con crédito de renta', () => {
  const snapshot = snapshotConHojas([
    // Retenciones a título de renta — SÍ acreditan (Art. 373 E.T.).
    leaf('13551501', 'Anticipo Retención en la fuente 2', 24_249_425.49),
    leaf('13551503', 'Anticipo Retención en la fuente 4%', 89_494.57),
    leaf('13551515', 'Anticipo Retención en la fuente 2%', 1_240_380.97),
    leaf('13551517', 'Anticipo Retención en la fuente 1%', 607_543.03),
    // 1805 es «Bienes de arte y cultura» en el PUC oficial; «Servicios 6%» no
    // declara un impuesto → NO es crédito de renta (auditoría 2026-09).
    leaf('18050504', 'Servicios 6%', 3_839_538.0),
    // ReteIVA — Art. 484-1 E.T., va contra IVA.
    leaf('13551701', 'Impuesto a las ventas retenido 15%', 4_857_142.54),
    // ReteICA — tributo municipal.
    leaf('13551801', 'Rete Ica 11', 25_972.17),
    leaf('13551813', 'Rete Ica 4', 562_808.36),
    leaf('13551814', 'Devolución Rete Ica 4', 515.82),
    leaf('13551815', 'Impuesto de industria y comercio retenido', 12_104.19),
    leaf('13551818', 'Anticipo de impuesto de industria y comercio', 880.88),
  ]);

  const base = extractFiscalBaseFromTrialBalance(snapshot);

  it('F03 excluye ReteIVA (135517), ReteICA (135518) y 1805 sin nombre de impuesto', () => {
    // 24.249.425,49 + 89.494,57 + 1.240.380,97 + 607.543,03
    // Antes se sumaba también 18050504 «Servicios 6%» ($3.839.538,00): la
    // auditoría 2026-09 (tributario-modulos-01) fijó que 1805 sólo acredita
    // renta si el nombre de la cuenta declara un impuesto.
    expect(base.retencionesAFavorCents).toBe(BigInt('2618684406')); // $26.186.844,06
    expect(base.otrosActivosImpuestoNoRentaCents).toBe(BigInt('383953800'));
  });

  it('el ReteIVA se extrae aparte, no se pierde', () => {
    expect(base.reteIvaAFavorCents).toBe(BigInt('485714254')); // $4.857.142,54
  });

  it('el ReteICA se extrae aparte, no se pierde', () => {
    // 25.972,17 + 562.808,36 + 515,82 + 12.104,19 + 880,88
    expect(base.reteIcaAFavorCents).toBe(BigInt('60228142')); // $602.281,42
  });

  it('el crédito ajeno a renta que antes inflaba F03 son $5.459.423,96', () => {
    expect(base.reteIvaAFavorCents + base.reteIcaAFavorCents).toBe(BigInt('545942396'));
  });

  it('13551517 (retefuente 1%) NO se confunde con 135517 (ReteIVA)', () => {
    // El prefijo de exclusión es de SEIS dígitos: 135517 ≠ 1355 15 17.
    const soloRetefuente = extractFiscalBaseFromTrialBalance(
      snapshotConHojas([leaf('13551517', 'Anticipo Retención en la fuente 1%', 607_543.03)]),
    );
    expect(soloRetefuente.retencionesAFavorCents).toBe(BigInt('60754303'));
    expect(soloRetefuente.reteIvaAFavorCents).toBe(BigInt(0));
  });

  it('un balance sin ReteIVA ni ReteICA no cambia de F03', () => {
    const sinAjenos = extractFiscalBaseFromTrialBalance(
      snapshotConHojas([leaf('135505', 'Retenciones en la fuente a favor', 46_073_407.76)]),
    );
    expect(sinAjenos.retencionesAFavorCents).toBe(BigInt('4607340776'));
    expect(sinAjenos.reteIvaAFavorCents).toBe(BigInt(0));
    expect(sinAjenos.reteIcaAFavorCents).toBe(BigInt(0));
  });
});

// ---------------------------------------------------------------------------
// Auditoría 2026-09 — tributario-modulos-01: lista blanca de crédito de renta
// ---------------------------------------------------------------------------
describe('extractFiscalBaseFromTrialBalance — lista blanca (135505/135515 + nombre)', () => {
  it('135510 (anticipo ICA), 135520, 135525, 135530 y 180505 «Obras de arte» no son F03', () => {
    const base = extractFiscalBaseFromTrialBalance(
      snapshotConHojas([
        leaf('135515', 'Retención en la fuente', 20_000_000),
        leaf('135510', 'Anticipo de impuestos de industria y comercio', 15_000_000),
        leaf('135520', 'Sobrantes en liquidación privada de impuestos', 1_000_000),
        leaf('135525', 'Contribuciones', 2_000_000),
        leaf('135530', 'Impuestos descontables', 30_000_000),
        leaf('180505', 'Obras de arte', 500_000_000),
      ]),
    );
    expect(base.retencionesAFavorCents).toBe(BigInt('2000000000')); // sólo 135515
    expect(base.reteIcaAFavorCents).toBe(BigInt('1500000000')); // 135510
    expect(base.otrosActivosImpuestoNoRentaCents).toBe(BigInt('53300000000'));
  });

  it('135595 sólo acredita renta si su nombre es de renta', () => {
    const base = extractFiscalBaseFromTrialBalance(
      snapshotConHojas([
        leaf('13559501', 'Autorretención especial de renta', 4_000_000),
        leaf('13559502', 'Otros', 1_000_000),
      ]),
    );
    expect(base.retencionesAFavorCents).toBe(BigInt('400000000'));
    expect(base.otrosActivosImpuestoNoRentaCents).toBe(BigInt('100000000'));
  });

  it('1805 cuenta como crédito de renta si el nombre (propio o del padre) indica impuesto', () => {
    const base = extractFiscalBaseFromTrialBalance(
      snapshotConHojas([
        { code: '180510', name: 'Retención en la fuente a favor', level: 'Subcuenta', balance: 0, isLeaf: false } as ValidatedAccount,
        leaf('18051001', 'Servicios 4%', 2_000_000),
        leaf('180520', 'Saldo a favor impuesto de renta', 3_000_000),
        leaf('180530', 'IVA retenido', 700_000),
      ]),
    );
    expect(base.retencionesAFavorCents).toBe(BigInt('500000000'));
    expect(base.reteIvaAFavorCents).toBe(BigInt('70000000'));
  });

  it('135515 con nombre de ICA no se imputa a renta', () => {
    const base = extractFiscalBaseFromTrialBalance(
      snapshotConHojas([leaf('13551590', 'Rete ICA Bogotá', 800_000)]),
    );
    expect(base.retencionesAFavorCents).toBe(BigInt(0));
    expect(base.reteIcaAFavorCents).toBe(BigInt('80000000'));
  });
});
