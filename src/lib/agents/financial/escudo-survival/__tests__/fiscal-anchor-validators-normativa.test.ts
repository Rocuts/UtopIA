// ---------------------------------------------------------------------------
// Validadores del Âncora Fiscal — reglas con fuente y vigencia (auditoría
// 2026-09, integración W3-B; tributario-modulos-03)
// ---------------------------------------------------------------------------
// El validador no se podía cablear porque sus reglas contradecían el ancla:
//   · L3.6 exigía la renta PJ del AG 2025 entre el 9 y el 22 de abril de 2026;
//     el calendario del repo (Decreto 2229/2023, DUR 1625/2016 art.
//     1.6.1.13.2.12) la publica en mayo (declaración y 1ª cuota) y julio
//     (2ª cuota), del 7º al 16º día hábil según el último dígito del NIT.
//   · L3.5 fijaba la retención mensual en los días 8-17 «aprox», sin fuente;
//     el dígito 0 vence el 16º día hábil (p. ej. 23-feb-2026) y el 9 el 15º.
//   · L3.7 anclaba F03 en Σ(1355+1805) − 135517 − 135518: aceptaba una obra de
//     arte (1805) o un anticipo de ICA (135510) como crédito de renta.
//   · L1.2 citaba el Art. 850 E.T. para una identidad aritmética y L3.1 la
//     «diferencia de criterio» del Art. 647 E.T. y ordenaba provisionar F02
//     (UAI × 35 %), que no es base fiscal.
//   · L1.7 fallaba sin NIT (calendario ya marcado «verificar»), L1.3 exigía
//     que el grupo 24 contuviera las cuentas 2365 y 2368 (grupo 23) y L1.5
//     trataba como error una tasa contable de impuesto superior al 100 %.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  validateFiscalAnchorL1,
  validateFiscalAnchorL2,
  validateFiscalAnchorL3,
  type L3Context,
} from '../validators/fiscal-anchor-validators';
import type { FiscalAnchorBlock, VencimientoDian } from '../fiscal-anchor/types';
import { buildFiscalAnchorBlockMarkdown } from '../fiscal-anchor/block-builder';

function venc(obligacion: string, frecuencia: VencimientoDian['frecuencia'], fecha: string, estado: VencimientoDian['estado'] = 'pendiente'): VencimientoDian {
  return {
    obligacion,
    frecuencia,
    proximoVencimiento: fecha,
    diasRestantes: 30,
    estado,
    baseCcv: frecuencia === 'anual' ? 'F04' : 'F06',
    valorEstimado: '0',
    norma: 'Decreto 2229 de 2023',
  };
}

function block(opts: {
  nit?: string;
  ultimoDigito?: number;
  vencimientos?: VencimientoDian[];
  f03?: string;
  f06?: string;
  f07?: string;
  f08?: string;
  f09?: number;
} = {}): FiscalAnchorBlock {
  const f03 = opts.f03 ?? '1000000000';
  return {
    f01: '10000000000',
    f02: '3500000000',
    f03,
    f04: String(BigInt(3500000000) - BigInt(f03)),
    f05: '0',
    f06: opts.f06 ?? '0',
    f07: opts.f07 ?? '0',
    f08: opts.f08 ?? '0',
    f09: opts.f09 ?? 30,
    f10: Math.round((Number(f03) / 3500000000) * 1000) / 10,
    calendarioDian: {
      nit: opts.nit ?? '901714014-6',
      ultimoDigito: opts.ultimoDigito ?? 4,
      periodo: '2025',
      vencimientos: opts.vencimientos ?? [],
      alertaAnticipacionDias: 15,
    },
    alertas: [],
    fuente: { periodo: '2025', balanceHash: 'test' },
  };
}

const L3_BASE: L3Context = {
  clase54Cents: 3000000000,
  markdownBlock: 'Referencia antes de depuraciones fiscales.',
};

const find = (checks: ReturnType<typeof validateFiscalAnchorL3>, name: string) => {
  const c = checks.find((x) => x.name === name);
  if (!c) throw new Error(`sin check ${name}`);
  return c;
};

describe('L3.5 — retención mensual en el día hábil del dígito (Decreto 2229/2023)', () => {
  it('dígito 0 vence el 16º día hábil (23-feb-2026): no es «fuera de plazo»', () => {
    const b = block({ nit: '800123450-3', ultimoDigito: 0, vencimientos: [venc('Retención en la fuente', 'mensual', '2026-02-23')] });
    expect(find(validateFiscalAnchorL3(b, L3_BASE), 'L3.5_retefuente_rango_dias').passed).toBe(true);
  });

  it('dígito 9 vence el 15º día hábil (20-feb-2026)', () => {
    const b = block({ nit: '800123459-1', ultimoDigito: 9, vencimientos: [venc('Retención en la fuente', 'mensual', '2026-02-20')] });
    expect(find(validateFiscalAnchorL3(b, L3_BASE), 'L3.5_retefuente_rango_dias').passed).toBe(true);
  });

  it('un día hábil antes del que corresponde al dígito se señala', () => {
    // Dígito 4 → 10º día hábil = 13-feb-2026. El 12-feb estaba «en [8..17]».
    const b = block({ vencimientos: [venc('Retención en la fuente', 'mensual', '2026-02-12')] });
    const c = find(validateFiscalAnchorL3(b, L3_BASE), 'L3.5_retefuente_rango_dias');
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('2026-02-13');
    expect(c.norma).toMatch(/Decreto 2229/);
  });

  it('fecha marcada «verificar» o NIT sin dígito inequívoco → N/D, sin veredicto', () => {
    const verificar = block({ vencimientos: [venc('Retención en la fuente', 'mensual', '2026-02-02', 'verificar')] });
    const c1 = find(validateFiscalAnchorL3(verificar, L3_BASE), 'L3.5_retefuente_rango_dias');
    expect(c1.passed).toBe(true);
    expect(c1.detail).toMatch(/N\/D/);
    const ambiguo = block({ nit: '9017140146', ultimoDigito: 6, vencimientos: [venc('Retención en la fuente', 'mensual', '2026-02-02')] });
    const c2 = find(validateFiscalAnchorL3(ambiguo, L3_BASE), 'L3.5_retefuente_rango_dias');
    expect(c2.passed).toBe(true);
    expect(c2.detail).toMatch(/N\/D/);
  });
});

describe('L3.6 — renta PJ: declaración y 1ª cuota en mayo, 2ª cuota en julio', () => {
  const MAYO = venc('Declaración de Renta PJ — Declaración y 1ª cuota', 'anual', '2026-05-15');
  const JULIO = venc('Declaración de Renta PJ — 2ª cuota', 'anual', '2026-07-14');

  it('las fechas del calendario del repo (dígito 4: 15-may y 14-jul) pasan', () => {
    const c = find(validateFiscalAnchorL3(block({ vencimientos: [MAYO, JULIO] }), L3_BASE), 'L3.6_renta_juridica_2025_fecha');
    expect(c.passed).toBe(true);
    expect(c.norma).toMatch(/1\.6\.1\.13\.2\.12/);
  });

  it('abril (el rango anterior) se señala', () => {
    const abril = venc('Impuesto de renta persona jurídica 2025', 'anual', '2026-04-14');
    const c = find(validateFiscalAnchorL3(block({ vencimientos: [abril] }), L3_BASE), 'L3.6_renta_juridica_2025_fecha');
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('2026-05-15');
  });

  it('la 2ª cuota en mayo se señala (le corresponde julio)', () => {
    const mal = venc('Declaración de Renta PJ — 2ª cuota', 'anual', '2026-05-15');
    expect(find(validateFiscalAnchorL3(block({ vencimientos: [mal] }), L3_BASE), 'L3.6_renta_juridica_2025_fecha').passed).toBe(false);
  });
});

describe('L3.7 — F03 anclado a la lista blanca de crédito de renta', () => {
  const composicion = {
    creditoRentaCents: 1000000000,
    reteIvaCents: 50000000,
    reteIcaCents: 20000000,
    otrosNoRentaCents: 500000000, // p. ej. 1805 «Obras de arte»
  };

  it('F03 igual al crédito de renta pasa', () => {
    const c = find(validateFiscalAnchorL3(block(), { ...L3_BASE, creditoRenta: composicion }), 'L3.7_f03_solo_credito_renta');
    expect(c.passed).toBe(true);
  });

  it('F03 que suma una obra de arte (1805) no pasa, aunque excluya ReteIVA y ReteICA', () => {
    const c = find(
      validateFiscalAnchorL3(block({ f03: '1500000000' }), { ...L3_BASE, creditoRenta: composicion }),
      'L3.7_f03_solo_credito_renta',
    );
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('$5.000.000,00');
  });
});

describe('L1.2 / L3.1 — normas', () => {
  it('L1.2 es identidad aritmética de una estimación contable, no el Art. 850 E.T.', () => {
    const c = validateFiscalAnchorL1(block()).find((x) => x.name === 'L1.2_f04_neto_pagar')!;
    expect(c.norma).not.toMatch(/850/);
    expect(c.norma).toMatch(/estimaci[oó]n contable/i);
  });

  it('L3.1 no invoca la «diferencia de criterio» ni ordena provisionar F02', () => {
    const b = { ...block(), f01: '10000000000' };
    const sinAlerta = find(validateFiscalAnchorL3(b, { ...L3_BASE, clase54Cents: 0 }), 'L3.1_sin_provision_renta');
    expect(sinAlerta.passed).toBe(false);
    expect(sinAlerta.norma).not.toMatch(/647/);
    expect(sinAlerta.norma).toMatch(/Secci[oó]n 29|NIC 12/);
    expect(sinAlerta.detail).not.toMatch(/diferencia de criterio/i);
    expect(sinAlerta.detail).not.toMatch(/Provisionar impuesto renta/);
    const conAlerta = find(
      validateFiscalAnchorL3(
        { ...b, alertas: [{ codigo: 'A5_SIN_PROVISION', severidad: 'error', mensaje: 'x', norma: 'NIC 12' }] },
        { ...L3_BASE, clase54Cents: 0 },
      ),
      'L3.1_sin_provision_renta',
    );
    expect(conAlerta.passed).toBe(true);
    expect(conAlerta.detail).not.toMatch(/diferencia de criterio/i);
  });
});

describe('L1 / L2 — sin falsos positivos sobre el ancla que produce el repo', () => {
  it('L1.7: sin NIT el calendario ya dice «verificar» → N/D, no error', () => {
    const c = validateFiscalAnchorL1(block({ nit: '', ultimoDigito: -1 })).find((x) => x.name === 'L1.7_calendario_digito_nit')!;
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/N\/D/);
  });

  it('L1.7: NIT sin separador de DV (ambiguo) → N/D, no error', () => {
    const c = validateFiscalAnchorL1(block({ nit: '9017140146', ultimoDigito: 6 })).find((x) => x.name === 'L1.7_calendario_digito_nit')!;
    expect(c.passed).toBe(true);
  });

  it('L1.3: 2365 y 2368 son del grupo 23; el grupo 24 no tiene por qué contenerlas', () => {
    const c = validateFiscalAnchorL1(block({ f06: '900000000', f07: '100000000', f08: '50000000' })).find((x) => x.name === 'L1.3_f08_contiene_f06_f07')!;
    expect(c.passed).toBe(true);
  });

  it('L1.5: impuesto contable mayor que la UAI (F09 > 100 %) es advertencia, no error aritmético', () => {
    const c = validateFiscalAnchorL1(block({ f09: 140 })).find((x) => x.name === 'L1.5_f09_rango')!;
    expect(c.severity).toBe('warning');
  });

  it('L2.4: sin NIT no hay formato que evaluar', () => {
    const c = validateFiscalAnchorL2(block({ nit: '', ultimoDigito: -1 }), {
      clase54Cents: 0,
      rawBalance: { hasCta1355: true, hasCta1805: false, caja: 0 },
    }).find((x) => x.name === 'L2.4_nit_formato')!;
    expect(c.passed).toBe(true);
  });

  it('el markdown del repo contiene la frase obligatoria de L3.3', () => {
    expect(buildFiscalAnchorBlockMarkdown(block())).toContain('Referencia antes de depuraciones fiscales');
  });
});
