// ---------------------------------------------------------------------------
// Citas normativas de los prompts financieros (auditoría 2026-09)
// ---------------------------------------------------------------------------
// prompts-normativa-01  causal de disolución derogada (Arts. 457 num. 2 / 459
//                       C.Co., Ley 2069/2020 art. 4)
// prompts-normativa-05  NIIF 18 presentada como obligatoria en Colombia 2027
// prompts-normativa-06  C.Co. 446/448/187 y Ley 1258 Art. 40 mal citados
// prompts-normativa-15  deterioro PYMES, activos contingentes, NIIF 16.26
// prompts-normativa-10  cascada del impuesto (1805, 35% × UAI, Art. 14)
// prompts-normativa-23  impracticabilidad como sustituto de "dato no
//                       suministrado", 1% de tolerancia, "valor por defecto"
// prompts-normativa-09  Art. 647 como conclusión jurídica genérica
// niif-contrato-15      anclas en centavos con signo de pesos; notas en centavos
// prompts-normativa-11  capital PUC 31xx tratado como ORI
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { buildColombia2026Context } from '../colombia-2026-context';
import { buildAntiHallucinationGuardrail } from '../anti-hallucination';
import {
  buildNiifMeasurementKnowledge,
  buildNiifDisclosureKnowledge,
} from '../niif-colombia-knowledge';
import { buildResilienceSection0 } from '../resilience-section0';
import {
  buildNiifAnalystPass1Prompt,
  buildNiifAnalystPass2Prompt,
  buildNiifAnalystPass3Prompt,
} from '../niif-analyst.prompt';
import { detectOriComponents, computeActiveEcpColumns } from '../presentation-v3';
import { buildStrategyDirectorPrompt } from '../strategy-director.prompt';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

const company = { name: 'X SAS', nit: '1', niifGroup: 2, fiscalPeriod: '2025' } as never;
const companyG1 = { name: 'X SA', nit: '1', niifGroup: 1, fiscalPeriod: '2025' } as never;
const anchors1 = {
  totalAssetsPrimary: '419655824290', totalLiabilitiesPrimary: '0', totalEquityPrimary: '419655824290',
  netIncomePrimary: '222849678973', oriPrimary: '0',
  totalAssetsComparative: null, totalLiabilitiesComparative: null, totalEquityComparative: null,
  grossProfitComparative: null, operatingProfitComparative: null, netIncomeComparative: null, oriComparative: null,
  curatorFlags: {
    equityConvergenceApplied: true, cashFlowClosureForced: false, negativeAssetReclassified: false,
    presumedCostWarning: false, reclassifiedAmountCop: '0',
  },
};
const anchors2 = { cashOpening: '100000', cashClosing: '241367788864', netChange: '1', ecpClosingTotal: '1' };

const pass1 = buildNiifAnalystPass1Prompt(company, 'es', 'COMPARATIVO_COMPLETO');
const pass2 = buildNiifAnalystPass2Prompt(company, 'es', 'COMPARATIVO_COMPLETO', anchors1);
const pass3 = buildNiifAnalystPass3Prompt(company, 'es', 'COMPARATIVO_COMPLETO', anchors1, anchors2);
const pass3G1 = buildNiifAnalystPass3Prompt(companyG1, 'es', 'COMPARATIVO_COMPLETO', anchors1, anchors2);
const all = [pass1, pass2, pass3];

describe('prompts-normativa-01 — causal de disolución derogada', () => {
  it('ningún pase ordena convocar disolución por el Art. 459 ni lo cita como sanción', () => {
    for (const p of all) {
      expect(p).not.toMatch(/Art\. 459/);
      expect(p).not.toMatch(/DEBE convocar disolución/);
    }
  });

  it('la nota de empresa en marcha cita la Ley 2069 de 2020 y el Decreto 1378 de 2021', () => {
    expect(pass3).toMatch(/Ley 2069 de 2020/);
    expect(pass3).toMatch(/Decreto 1378 de 2021/);
  });
});

describe('prompts-normativa-05 — NIIF 18', () => {
  it('el contexto no la presenta como obligatoria en Colombia desde 2027', () => {
    for (const lang of ['es', 'en'] as const) {
      const ctx = buildColombia2026Context(lang);
      expect(ctx).not.toMatch(/Obligatoria para ejercicios que inicien en o despues del 01 de enero de 2027/);
      expect(ctx).not.toMatch(/Mandatory for annual periods beginning on or after 01 January 2027/);
      expect(ctx).toMatch(lang === 'es' ? /no esta incorporada/i : /not incorporated/i);
    }
  });

  it('el guardarraíl no la lista como referencia usable con seguridad', () => {
    const g = buildAntiHallucinationGuardrail('es');
    const usable = g.split('\n').find((l) => /usables con seguridad/i.test(l)) ?? '';
    expect(usable).not.toMatch(/NIIF 18|IFRS 18/);
  });

  it('Pass-3 del Grupo 1 no la declara obligatoria a partir de 2027', () => {
    expect(pass3G1).not.toMatch(/obligatoria a partir de 2027/);
    expect(pass3G1).not.toMatch(/obligatoria 2027/);
  });
});

describe('prompts-normativa-06 — citas societarias', () => {
  for (const lang of ['es', 'en'] as const) {
    it(`contexto (${lang}) sin 448 como quórum ni Ley 1258 Art. 40 como reserva legal`, () => {
      const ctx = buildColombia2026Context(lang);
      expect(ctx).not.toMatch(/448 \((quorum|quórum)\)/i);
      expect(ctx).not.toMatch(/Art\. 40 \((reserva legal|legal reserve)/i);
      expect(ctx).not.toMatch(/446 \((convocatoria|assembly call)/i);
      expect(ctx).toMatch(/424/);
      expect(ctx).toMatch(/427/);
      expect(ctx).toMatch(/189/);
    });
  }
  it('el guardarraíl no recomienda citar el Art. 448', () => {
    expect(buildAntiHallucinationGuardrail('es')).not.toMatch(/448/);
    expect(buildAntiHallucinationGuardrail('en')).not.toMatch(/448/);
  });
});

describe('prompts-normativa-15 — conocimiento NIIF', () => {
  for (const lang of ['es', 'en'] as const) {
    const k = buildNiifMeasurementKnowledge(lang) + buildNiifDisclosureKnowledge(lang);
    it(`(${lang}) Sección 11 PYMES con pérdida incurrida, sin pérdida esperada`, () => {
      expect(k).not.toMatch(/PYMES \(Sec\. 11\): enfoque simplificado de pérdida incurrida \+ pérdida esperada/);
      expect(k).not.toMatch(/incurred loss \+ lifetime expected loss/i);
      expect(k).toMatch(/11\.21/);
    });
    it(`(${lang}) activo contingente se revela cuando es probable, no posible`, () => {
      expect(k).not.toMatch(/Activos contingentes: revelar si es posible/i);
      expect(k).not.toMatch(/Contingent assets: disclose if possible/i);
    });
    it(`(${lang}) NIIF 16.26 usa primero la tasa implícita`, () => {
      expect(k).toMatch(/16\.26/);
    });
  }
});

describe('prompts-normativa-10 / Corrección 4 — impuesto de renta', () => {
  it('Pass-1 no usa la cuenta 1805 como gasto ni calcula 35% × UAI ni cita el Art. 14 E.T.', () => {
    expect(pass1).not.toMatch(/Cta\.1805 — retenciones anticipadas/);
    expect(pass1).not.toMatch(/Provisión teórica de impuesto de renta/);
    expect(pass1).not.toMatch(/Art\. 14 E\.T\./);
    expect(pass1).not.toMatch(/Cta\.1805 = Anticipos y retenciones pagadas/);
  });
  it('sin clase 54 el impuesto queda no reconocido con nota (NIC 12 / Sección 29)', () => {
    expect(pass1).toMatch(/no reconocido/i);
    expect(pass1).toMatch(/Sección 29/);
  });
  it('la Anomalía A5 no compara contra un 35% de la utilidad operativa', () => {
    expect(pass1).not.toMatch(/35% × utilidad operativa/);
  });
});

describe('prompts-normativa-23 — dato faltante e impracticabilidad', () => {
  it('ningún pase prohíbe "datos no disponibles" ni obliga a citar impracticabilidad por un dato faltante', () => {
    for (const p of all) {
      expect(p).not.toMatch(/Si un dato falta, citar la norma de impracticabilidad/);
      expect(p).not.toMatch(/§29\.27/);
      expect(p).not.toMatch(/NIC 7 §50/);
    }
  });
  it('el guardarraíl no tolera un 1% frente a los totales vinculantes', () => {
    expect(buildAntiHallucinationGuardrail('es')).not.toMatch(/1\s?%/);
    expect(buildAntiHallucinationGuardrail('en')).not.toMatch(/1\s?%/);
  });
  it('la resiliencia TIPO C no ordena usar un valor por defecto ni afirma que las cifras no se afectan', () => {
    for (const lang of ['es', 'en'] as const) {
      const r = buildResilienceSection0(lang);
      expect(r).not.toMatch(/usar valor por defecto/i);
      expect(r).not.toMatch(/use (a )?default value/i);
      expect(r).not.toMatch(/Las cifras financieras no se ven afectadas/);
    }
  });
});

describe('prompts-normativa-09 — Art. 647 E.T.', () => {
  it('ningún pase afirma que las diferencias de criterio "no configuran inexactitud sancionable" ni cita el concepto no verificado', () => {
    for (const p of all) {
      expect(p).not.toMatch(/no configuran inexactitud sancionable/);
      expect(p).not.toMatch(/no constituyen inexactitud sancionable/);
      expect(p).not.toMatch(/100208221-1352/);
      expect(p).not.toMatch(/configura diferencia de criterio no sancionable/);
    }
  });
  it('Pass-1 y Pass-2 no piden una sub-nota Art. 647 por cada ajuste', () => {
    expect(pass1).not.toMatch(/por CADA ajuste automático del Curator/);
    expect(pass2).not.toMatch(/por CADA ajuste automático del Curator/);
  });
});

describe('niif-contrato-15 — montos en las notas', () => {
  it('las anclas de <previously_computed> se imprimen en pesos es-CO con el token aparte', () => {
    expect(pass3).not.toMatch(/totalAssetsPrimary: \$419655824290/);
    expect(pass3).toMatch(/totalAssetsPrimary: \$4\.196\.558\.242,90 \[MoneyCop: 419655824290\]/);
    expect(pass3).toMatch(/cashClosing: \$2\.413\.677\.888,64 \[MoneyCop: 241367788864\]/);
  });
  it('Pass-3 no exige citar montos en centavos dentro de las notas', () => {
    expect(pass3).not.toMatch(/MoneyCop serializado en CENTAVOS como string entero cuando se cite un monto dentro de una nota/);
  });
});

describe('prompts-normativa-11 — el grupo 31 es capital, no ORI', () => {
  const snap = {
    period: '2025',
    classes: [
      {
        code: 3,
        name: 'Patrimonio',
        accounts: [
          { code: '311505', name: 'APORTES SOCIALES', level: 'Auxiliar', balance: 500000, isLeaf: true },
          { code: '380505', name: 'Valorizaciones', level: 'Auxiliar', balance: 100000, isLeaf: true },
        ],
      },
    ],
  } as unknown as PeriodSnapshot;

  it('una Ltda. con aportes sociales 3115 y valorizaciones 3805 no genera componentes ORI', () => {
    expect(detectOriComponents(snap)).toEqual([]);
  });
  it('3115 activa la columna de capital del ECP y no la de ORI', () => {
    const soloCapital = {
      period: '2025',
      classes: [{ code: 3, name: 'Patrimonio', accounts: [snap.classes[0].accounts[0]] }],
    } as unknown as PeriodSnapshot;
    const cols = computeActiveEcpColumns(soloCapital);
    expect(cols.capital).toBe(true);
    expect(cols.oci).toBe(false);
  });
});

describe('valoracion-20 / ratios-kpis-24 — Strategy Director', () => {
  const sd = buildStrategyDirectorPrompt(company, 'es');
  it('una sola base del impuesto proyectado (UAI) y sin "TMT 15% activa" como tarifa', () => {
    expect(sd).not.toMatch(/Utilidad Operativa Proyectada × 35%/);
    expect(sd).not.toMatch(/TMT 15% activa/);
    expect(sd).toMatch(/UAI proyectada × 35%/);
  });
  it('la TTD se describe como piso ID/UD, no como tarifa', () => {
    expect(sd).not.toMatch(/Tarifa Mínima de Tributación \(TMT\): 15%/);
    expect(sd).toMatch(/Tasa de Tributación Depurada/);
  });
  it('el EBITDA no se exige "al centavo" contra un binding que no lo contiene', () => {
    expect(sd).not.toMatch(/Ingresos, EBITDA, UAI, Utilidad Neta, Caja\) coinciden con TOTALES VINCULANTES al centavo/);
  });
  it('días de proveedores con la fórmula del KPI vinculante (Proveedores 22 / costo 6+7)', () => {
    expect(sd).not.toMatch(/Cuentas por Pagar × 365 \/ Compras/);
    expect(sd).toMatch(/Proveedores \(PUC 22\) × 365/);
  });
  it('sin "anular sanción" ni el concepto DIAN no verificado', () => {
    expect(sd).not.toMatch(/anular sanción/);
    expect(sd).not.toMatch(/100208221-1352/);
  });
});
