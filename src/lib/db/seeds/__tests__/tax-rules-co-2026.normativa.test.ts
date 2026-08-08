// tax-rules-co-2026.normativa.test.ts — Regresiones de la auditoría normativa
// 2026-08 sobre el seed de reglas tributarias built-in.
//
// El seed alimenta el Smart-Tax Engine, cuyas propuestas de asiento terminan en
// dictámenes que el cliente firma ante la DIAN. Cada aserción lleva su cita.

import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_RULES,
  RETIRED_RULE_CODES,
  UVT_VALUES,
} from '../tax-rules-co-2026';
import type { TaxRuleTriggers } from '@/lib/accounting/tax-engine/types';
import { TAX_TREATMENT } from '@/lib/accounting/tax-engine/types';

function rule(code: string) {
  const found = BUILT_IN_RULES.find((r) => r.code === code);
  if (!found) throw new Error(`Regla ${code} no está en el seed`);
  return found;
}

function triggers(code: string): TaxRuleTriggers {
  return rule(code).applicableTriggers;
}

describe('ICA Bogotá — Acuerdo 65/2002 art. 3 (mod. Acuerdos 780/2020 y 816/2021)', () => {
  it('la tarifa es 11,04 por mil = 0,01104, no 0,0011 (error aritmético de 10x)', () => {
    // "Demás actividades comerciales" en Bogotá = 11,04 x 1.000. El seed traía
    // 0.001100 (= 1,1 por mil) con el comentario "11/1000 = 0.0011", que es
    // aritméticamente falso: 11/1000 = 0,011. Se retenía 10 veces menos ReteICA
    // del debido y el agente retenedor responde por el mayor valor no retenido.
    const r = rule('ICA_BOG_11');
    expect(parseFloat(r.rate)).toBeCloseTo(0.01104, 6);
    expect(parseFloat(r.rate)).not.toBeCloseTo(0.0011, 6);
  });

  it('la tarifa cae dentro del rango legal de Bogotá (4,14 a 13,8 por mil)', () => {
    const r = parseFloat(rule('ICA_BOG_11').rate);
    expect(r).toBeGreaterThanOrEqual(0.00414);
    expect(r).toBeLessThanOrEqual(0.0138);
  });

  it('advierte que la tarifa de ReteICA es la del CIIU del retenido', () => {
    expect(triggers('ICA_BOG_11').advisory).toMatch(/CIIU|actividad económica/i);
  });
});

describe('IVA — tarifas mutuamente excluyentes (Arts. 468, 468-1, 468-3, 477, 424/476 E.T.)', () => {
  it('todas las reglas de IVA comparten grupo de exclusión mutua', () => {
    const iva = BUILT_IN_RULES.filter((r) => r.taxType === 'IVA');
    expect(iva.length).toBeGreaterThan(1);
    for (const r of iva) {
      expect(r.applicableTriggers.exclusionGroup).toBe('iva');
    }
  });

  it('no hay dos reglas de IVA con los MISMOS triggers efectivos', () => {
    // El defecto original: IVA_5_PURCHASE tenía exactamente los mismos triggers
    // que IVA_19_PURCHASE, así que una compra generaba 19% + 5% = 24% de IVA
    // descontable sobre la misma base → descontable improcedente y sanción por
    // inexactitud del 100% (Art. 648 E.T.).
    const iva = BUILT_IN_RULES.filter((r) => r.taxType === 'IVA');
    const firmas = iva.map((r) => {
      const t = r.applicableTriggers;
      return JSON.stringify({
        tt: [...(t.transactionTypes ?? [])].sort(),
        rt: [...(t.requiresTreatments ?? [])].sort(),
        sp: t.specificity ?? 0,
      });
    });
    expect(new Set(firmas).size).toBe(firmas.length);
  });

  it('la tarifa general del 19% es la residual (especificidad 0) y no exige tratamiento', () => {
    for (const code of ['IVA_19_PURCHASE', 'IVA_19_SALE']) {
      expect(triggers(code).specificity).toBe(0);
      expect(triggers(code).requiresTreatments).toBeUndefined();
      expect(parseFloat(rule(code).rate)).toBeCloseTo(0.19, 6);
    }
  });

  it('las tarifas del 5% exigen que el caller afirme la lista taxativa', () => {
    for (const code of [
      'IVA_5_PURCHASE_BIENES',
      'IVA_5_PURCHASE_SERVICIOS',
      'IVA_5_SALE_BIENES',
      'IVA_5_SALE_SERVICIOS',
    ]) {
      const t = triggers(code);
      expect(t.requiresTreatments?.length).toBeGreaterThan(0);
      expect(t.specificity).toBeGreaterThan(0);
      expect(parseFloat(rule(code).rate)).toBeCloseTo(0.05, 6);
    }
  });

  it('el 5% de BIENES cita el Art. 468-1 y el de SERVICIOS el Art. 468-3', () => {
    // El Art. 468-1 lista exclusivamente BIENES; los servicios al 5% están en el
    // Art. 468-3 (medicina prepagada, pólizas de cirugía y hospitalización,
    // vigilancia/aseo/temporales sobre el AIU). Citar el 468-1 para un servicio
    // es indefendible ante la DIAN (Art. 647 E.T., diferencia de criterio).
    for (const code of ['IVA_5_PURCHASE_BIENES', 'IVA_5_SALE_BIENES']) {
      expect(rule(code).description).toMatch(/468-1/);
      expect(rule(code).description).not.toMatch(/468-3/);
      expect(triggers(code).requiresTreatments).toContain(
        TAX_TREATMENT.IVA_5_BIENES,
      );
    }
    for (const code of ['IVA_5_PURCHASE_SERVICIOS', 'IVA_5_SALE_SERVICIOS']) {
      expect(rule(code).description).toMatch(/468-3/);
      expect(rule(code).description).not.toMatch(/468-1/);
      expect(triggers(code).requiresTreatments).toContain(
        TAX_TREATMENT.IVA_5_SERVICIOS,
      );
    }
    // Ninguna regla de servicios puede quedar amparada en el Art. 468-1.
    const serviciosCon4681 = BUILT_IN_RULES.filter(
      (r) =>
        r.taxType === 'IVA' &&
        (r.applicableTriggers.transactionTypes ?? []).some((t) =>
          t.startsWith('service_'),
        ) &&
        /468-1/.test(r.description),
    );
    expect(serviciosCon4681).toHaveLength(0);
  });

  it('EXENTO (Art. 477) y EXCLUIDO (Arts. 424/476) son reglas distintas con efectos opuestos', () => {
    const exento = rule('IVA_EXENTO');
    const excluido = rule('IVA_EXCLUIDO');

    // Exento: tarifa 0% pero CONSERVA el derecho a impuestos descontables y a la
    // devolución bimestral (Arts. 477, 481 y 850 E.T.).
    expect(exento.isDeductible).toBe(true);
    expect(exento.description).toMatch(/477/);
    expect(triggers('IVA_EXENTO').advisory).toMatch(/devoluci[óo]n/i);

    // Excluido: no se causa el impuesto y el IVA de los insumos es mayor valor
    // del costo o gasto — NO descontable (Arts. 424, 476, 488 y 490 E.T.).
    expect(excluido.isDeductible).toBe(false);
    expect(excluido.description).toMatch(/424/);
    expect(excluido.description).toMatch(/476/);
    expect(triggers('IVA_EXCLUIDO').advisory).toMatch(/490/);

    expect(parseFloat(exento.rate)).toBe(0);
    expect(parseFloat(excluido.rate)).toBe(0);
  });

  it('la regla que colapsaba exentos y excluidos quedó retirada', () => {
    expect(RETIRED_RULE_CODES).toContain('IVA_0_EXEMPT');
    expect(RETIRED_RULE_CODES).toContain('IVA_5_PURCHASE');
    for (const code of RETIRED_RULE_CODES) {
      expect(BUILT_IN_RULES.some((r) => r.code === code)).toBe(false);
    }
  });
});

describe('ReteFuente renta — Art. 392 E.T. y sujetos excluidos (Arts. 369 y 911 E.T.)', () => {
  const rtf = () => BUILT_IN_RULES.filter((r) => r.taxType === 'RETEFUENTE');

  it('toda regla de ReteFuente excluye autorretenedores y régimen SIMPLE', () => {
    // Art. 369 E.T. + Art. 368 par. 1 E.T. + DUR 1625/2016 Arts. 1.2.6.1-1.2.6.2:
    // no hay lugar a retención cuando el beneficiario es autorretenedor del
    // concepto. Art. 911 E.T.: los contribuyentes del SIMPLE no están sujetos a
    // retención en la fuente. Antes esto no era ni siquiera expresable.
    for (const r of rtf()) {
      expect(r.applicableTriggers.excludeSupplierRegimes).toContain('autorretenedor');
      expect(r.applicableTriggers.excludeSupplierRegimes).toContain('regimen_simple');
    }
  });

  it('gran contribuyente NO se excluye automáticamente: se exige verificar el RUT', () => {
    for (const r of rtf()) {
      expect(r.applicableTriggers.excludeSupplierRegimes).not.toContain(
        'gran_contribuyente',
      );
      expect(r.applicableTriggers.verifySupplierRegimes).toContain(
        'gran_contribuyente',
      );
      expect(r.applicableTriggers.verifyMessage).toMatch(/369|autorretenedor/i);
    }
  });

  it('honorarios y servicios generales comparten grupo de exclusión mutua', () => {
    // El defecto original: RTF_SVC_4 y RTF_HONO_11 tenían triggers idénticos
    // sobre 'service_purchase', de modo que un servicio disparaba 4% Y 11%.
    for (const r of rtf()) {
      expect(r.applicableTriggers.exclusionGroup).toBe('retefuente_renta');
    }
    expect(triggers('RTF_SVC_4').specificity).toBe(0);
    expect(triggers('RTF_SVC_4').requiresTreatments).toBeUndefined();
    expect(triggers('RTF_HONO_11').requiresTreatments).toContain(
      TAX_TREATMENT.HONORARIOS,
    );
    expect(triggers('RTF_HONO_11').specificity!).toBeGreaterThan(0);
  });

  it('existe la tarifa del 10% para personas naturales NO declarantes (Art. 392 inc. 2 E.T.)', () => {
    // Art. 392 inc. 2 E.T. (mod. Art. 75 Ley 1819/2016): la tarifa por honorarios
    // y comisiones de los NO obligados a declarar es del 10%. El seed sólo tenía
    // el 11% plano, así que se retenía un punto de más a todo contratista no
    // declarante y el certificado del Art. 381 E.T. salía por suma superior.
    const r10 = rule('RTF_HONO_10');
    expect(parseFloat(r10.rate)).toBeCloseTo(0.1, 6);
    expect(triggers('RTF_HONO_10').requiresTreatments).toEqual(
      expect.arrayContaining([
        TAX_TREATMENT.HONORARIOS,
        TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE,
      ]),
    );
    // Es más específica que la del 11%, para que gane cuando ambas apliquen.
    expect(triggers('RTF_HONO_10').specificity!).toBeGreaterThan(
      triggers('RTF_HONO_11').specificity!,
    );
  });

  it('el 10% arrastra la advertencia del acumulado de 3.300 UVT (DUR 1.2.4.3.1)', () => {
    // 3.300 UVT x $52.374 (UVT 2026) = $172.834.200. El motor no lleva el
    // acumulado anual por tercero, así que la condición se declara, no se asume.
    expect(triggers('RTF_HONO_10').advisory).toMatch(/3\.300 UVT/);
    expect(triggers('RTF_HONO_10').advisory).toMatch(/172\.834\.200/);
    expect(3300 * 52_374).toBe(172_834_200);
  });

  it('el 11% aplica a personas jurídicas y personas naturales declarantes, sin base mínima', () => {
    const r11 = rule('RTF_HONO_11');
    expect(parseFloat(r11.rate)).toBeCloseTo(0.11, 6);
    expect(r11.applyThresholdUvt).toBeNull();
    expect(r11.description).toMatch(/declarante/i);
  });
});

describe('Bases mínimas de retención — ventanas de vigencia del Decreto 0572/2025', () => {
  const svc = () =>
    BUILT_IN_RULES.filter(
      (r) => r.taxType === 'RETEFUENTE' && r.code.startsWith('RTF_SVC_'),
    );

  it('el umbral de servicios se modela en cuatro ventanas, no en un solo número', () => {
    // Decreto 0572/2025 art. 2 (2 UVT desde 01-jun-2025); auto del Consejo de
    // Estado del 07-may-2026 (suspensión provisional de los arts. 2 a 8 → vuelve
    // la base de 4 UVT); auto CE 30229 del 02-jun-2026 (restablecimiento desde
    // el 01-jul-2026). El seed original insertaba 2 UVT sin valid_from/valid_until,
    // de modo que al recontabilizar 2024 o el bimestre may-jun 2026 proponía
    // retenciones que no debieron practicarse.
    expect(svc()).toHaveLength(4);
    expect(
      svc().every(
        (r) => r.applicableTriggers.exclusionGroup === 'retefuente_renta',
      ),
    ).toBe(true);
  });

  it('la ventana vigente (desde 01-jul-2026) usa 2 UVT', () => {
    const r = rule('RTF_SVC_4');
    expect(parseFloat(r.applyThresholdUvt!)).toBe(2);
    expect(r.validFrom).toBe('2026-07-01T00:00:00-05:00');
    expect(r.validUntil).toBeNull();
  });

  it('la ventana de suspensión (08-may a 30-jun-2026) revive la base de 4 UVT', () => {
    const r = rule('RTF_SVC_4_SUSPENSION');
    expect(parseFloat(r.applyThresholdUvt!)).toBe(4);
    expect(r.validFrom).toBe('2026-05-08T00:00:00-05:00');
    expect(r.validUntil).toBe('2026-06-30T23:59:59-05:00');
  });

  it('la ventana anterior al Decreto 0572/2025 usa 4 UVT y cierra el 31-may-2025', () => {
    const r = rule('RTF_SVC_4_PRE_D572');
    expect(parseFloat(r.applyThresholdUvt!)).toBe(4);
    expect(r.validFrom).toBeNull();
    expect(r.validUntil).toBe('2025-05-31T23:59:59-05:00');
  });

  it('las cuatro ventanas son temporalmente disjuntas', () => {
    const intervalos = svc()
      .map((r) => ({
        code: r.code,
        from: r.validFrom ? Date.parse(r.validFrom) : Number.NEGATIVE_INFINITY,
        until: r.validUntil ? Date.parse(r.validUntil) : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.from - b.from);

    for (let i = 1; i < intervalos.length; i++) {
      expect(intervalos[i].from).toBeGreaterThan(intervalos[i - 1].until);
    }
  });
});

describe('UVT', () => {
  it('UVT 2026 = $52.374 (Resolución DIAN de diciembre de 2025)', () => {
    const uvt2026 = UVT_VALUES.find((u) => u.year === 2026);
    expect(parseFloat(uvt2026!.valueCop)).toBe(52_374);
  });
});
