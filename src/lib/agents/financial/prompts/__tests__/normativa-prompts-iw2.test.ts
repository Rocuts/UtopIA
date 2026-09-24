// ---------------------------------------------------------------------------
// Prompts financieros — integración IW2 (auditoría 2026-09)
// ---------------------------------------------------------------------------
// recalculo-11          EFE: el bloque R2 ya no se publica; fuente = EFE
//                       DETERMINISTA; sin comparativo no hay ajuste de cierre.
// prompts-normativa-09  Art. 647 E.T. sólo respecto de declaraciones, sin
//                       "anula la sanción" ni el concepto DIAN no verificado.
// prompts-normativa-05  NIIF 18 emitida por el IASB, no incorporada al DUR 2420.
// prompts-normativa-15  deterioro Grupo 2 = pérdida incurrida (Sec. 11.21-11.26).
// niif-preproceso-13    capital del acta = grupo 31 del PUC.
// tributario-calc-13    zona franca: 20 % sólo sobre renta de exportación.
// tributario-calc-04    sanción mínima = MIN_SANCTION ($524.000).
// valoracion-18         Estrategia sin constantes macro sin fecha ni fuente.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { buildNiifAnalystPass2Prompt } from '../niif-analyst.prompt';
import { buildGovernancePrompt } from '../governance-specialist.prompt';
import { buildStrategyDirectorPrompt } from '../strategy-director.prompt';
import { buildQualityAuditorPrompt } from '../../quality/prompt';
import { buildTaxAuditorPrompt } from '../../audit/prompts/tax-auditor.prompt';
import { buildTaxOptimizerPrompt } from '../../tax-planning/prompts/tax-optimizer.prompt';
import { buildComplianceValidatorPrompt } from '../../tax-planning/prompts/compliance-validator.prompt';
import { buildTPDocumentationPrompt } from '../../transfer-pricing/prompts/tp-documentation.prompt';
import { buildMotorNormativoPrompt } from '../../escudo-survival/normative/prompts/motor-normativo.prompt';
import { MIN_SANCTION } from '@/lib/tools/sanction-calculator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

const company = { name: 'X SAS', nit: '1', niifGroup: 2, fiscalPeriod: '2025', entityType: 'SAS' } as never;
const companyG1 = { name: 'X SA', nit: '1', niifGroup: 1, fiscalPeriod: '2025', entityType: 'SA' } as never;
const anchors1 = {
  totalAssetsPrimary: '100', totalLiabilitiesPrimary: '0', totalEquityPrimary: '100',
  netIncomePrimary: '10', oriPrimary: '0',
  totalAssetsComparative: null, totalLiabilitiesComparative: null, totalEquityComparative: null,
  grossProfitComparative: null, operatingProfitComparative: null, netIncomeComparative: null, oriComparative: null,
  curatorFlags: {
    equityConvergenceApplied: false, cashFlowClosureForced: false, negativeAssetReclassified: false,
    presumedCostWarning: false, reclassifiedAmountCop: '0',
  },
};

describe('recalculo-11 — EFE en el prompt del Analista NIIF', () => {
  const pass2 = buildNiifAnalystPass2Prompt(company, 'es', 'COMPARATIVO_COMPLETO', anchors1 as never);

  it('ya no remite al bloque "EFE INDIRECTO PRECALCULADO (Curator R2)"; la fuente es el EFE DETERMINISTA', () => {
    expect(pass2).not.toMatch(/EFE INDIRECTO PRECALCULADO/);
    expect(pass2).toMatch(/EFE DETERMINISTA/);
  });

  it('sin comparativo no hay flujos por actividad ni ajuste de cierre', () => {
    expect(pass2).toMatch(/"EFE DETERMINISTA"[^\n]*no es calculable[^\n]*NO presentes flujos por actividades/);
    expect(pass2).toMatch(/sin comparativo el EFE no es calculable y R6 no registra ajuste/);
  });

  it('el ajuste de redondeo R6 no invoca una "Nota Maestra Defensa Art. 647"', () => {
    expect(pass2).not.toMatch(/Nota Maestra Defensa Art\. 647/);
  });
});

describe('prompts-normativa-09 — Art. 647 E.T.', () => {
  const prompts = {
    governance: buildGovernancePrompt(company, 'es'),
    taxAuditor: buildTaxAuditorPrompt(company, 'es'),
    taxOptimizer: buildTaxOptimizerPrompt(company, 'es'),
    complianceValidator: buildComplianceValidatorPrompt(company, 'es'),
    tpDocumentation: buildTPDocumentationPrompt(company, 'es'),
  };

  for (const [name, p] of Object.entries(prompts)) {
    it(`${name}: no afirma que el Art. 647 "anula" la sanción ni que el criterio no es sancionable`, () => {
      expect(p).not.toMatch(/anula(r)? (la )?sanci[oó]n/i);
      expect(p).not.toMatch(/Esta defensa anula/);
      expect(p).not.toMatch(/NO configuran inexactitud sancionable/i);
    });
  }

  it('Gobierno no se apoya en el Concepto DIAN 100208221-1352 como sustento', () => {
    expect(prompts.governance).not.toMatch(/invocan la doctrina[^\n]*1352/);
    expect(prompts.governance).toMatch(/hechos y cifras declarados son completos y verdaderos/);
  });

  it('los prompts tributarios condicionan el Art. 647 a hechos y cifras completos y verdaderos', () => {
    for (const p of [prompts.taxOptimizer, prompts.complianceValidator, prompts.tpDocumentation, prompts.taxAuditor]) {
      expect(p).toMatch(/completos y verdaderos/);
    }
  });
});

describe('prompts-normativa-05 — NIIF 18 no incorporada', () => {
  it('Gobierno (Nota 14) no la presenta con vigencia 2027 en Colombia', () => {
    const p = buildGovernancePrompt(companyG1, 'es');
    expect(p).not.toMatch(/vigencia 2027 para Grupo 1 Colombia/);
    expect(p).toMatch(/no está incorporada al DUR 2420/);
    expect(p).toMatch(/Preparación voluntaria NIIF 18/);
  });

  it('el meta-auditor de calidad no la declara efectiva en Colombia', () => {
    const p = buildQualityAuditorPrompt(company, 'es');
    expect(p).not.toMatch(/NIIF 18 \(efectiva 1 enero 2027\)/);
    expect(p).toMatch(/NO incorporada al DUR 2420/);
  });
});

describe('prompts-normativa-15 — deterioro en la Nota 2 de Gobierno', () => {
  it('Grupo 2 = pérdida incurrida (Sección 11.21-11.26); NIIF 9 sólo para el Grupo 1', () => {
    const p = buildGovernancePrompt(company, 'es');
    expect(p).not.toMatch(/deterioro NIIF 9 \/ enfoque simplificado PYMES/);
    expect(p).toMatch(/pérdida incurrida \(NIIF para las PYMES, Sección 11\.21-11\.26\)/);
  });
});

describe('tributario-calc-13 / -04 — Auditor Tributario', () => {
  const p = buildTaxAuditorPrompt(company, 'es');

  it('zona franca: 20 % sólo sobre la renta de exportación del usuario industrial', () => {
    expect(p).not.toMatch(/Para zona franca: 20% \(Art\. 240-1 E\.T\.\)\./);
    expect(p).toMatch(/20% solo sobre la renta de exportacion del usuario industrial con plan de internacionalizacion/);
    expect(p).toMatch(/35% sobre el resto/);
  });

  it('sanción mínima = MIN_SANCTION del calculador (no el literal $523.740 sin aproximar)', () => {
    expect(MIN_SANCTION).toBe(524_000);
    expect(p).toMatch(/Sancion minima: 10 UVT = \$524\.000/);
  });

  it('el Motor Normativo usa la misma constante', () => {
    const m = buildMotorNormativoPrompt({ language: 'es' });
    expect(m).toMatch(/Sanción mínima: 10 UVT = \$524\.000 COP/);
  });
});

describe('valoracion-18 — Estrategia sin macro sin fecha ni fuente', () => {
  it('sin constantes de inflación/PIB literales y con el bloque <macro_vigente>', () => {
    const p = buildStrategyDirectorPrompt(company, 'es');
    expect(p).not.toMatch(/IPC inflación: 4-5%/);
    expect(p).not.toMatch(/inflación máxima \(5%\)/);
    expect(p).not.toMatch(/inflación esperada \(4%\)/);
    expect(p).not.toMatch(/inflación mínima \(4%\)/);
    expect(p).not.toMatch(/PIB esperado: 2-3%/);
    expect(p).toMatch(/<macro_vigente>/);
    expect(p).toMatch(/Inflación anual Colombia \(IPC\): N\/D/);
  });

  it('con dato verificado lo publica con vigencia y fuente', () => {
    const p = buildStrategyDirectorPrompt(company, 'es', undefined, {
      macro: {
        inflationCopYoYPercent: { value: 5.1, asOf: '2026-08-31', source: 'DANE — IPC' },
      },
    });
    expect(p).toMatch(/Inflación anual Colombia \(IPC\): 5,10% \(vigencia 2026-08-31; fuente: DANE — IPC\)/);
  });
});

describe('niif-preproceso-13 — capital del acta', () => {
  it('el techo del Art. 452 no evaluable remite al grupo 31 del PUC, no sólo a 3115/3120', () => {
    // Utilidad de 100M sin cuentas del grupo 31: el techo no es evaluable.
    const pp = preprocessTrialBalance(
      parseTrialBalanceCSV(
        [
          'codigo,nombre,nivel,transaccional,Saldo 2025',
          '110505,Caja,Auxiliar,1,300000000',
          '370505,Utilidades acumuladas,Auxiliar,1,200000000',
          '360505,Utilidad del ejercicio,Auxiliar,1,100000000',
          '413505,Ventas,Auxiliar,1,500000000',
          '510506,Sueldos,Auxiliar,1,400000000',
        ].join('\n'),
      ),
    );
    // S.A.: la reserva legal es obligatoria (Art. 452 C.Co.), así que el techo aplica.
    const p = buildGovernancePrompt(companyG1, 'es', pp);
    expect(p).toMatch(/Techo del Art\. 452 C\.Co\.: NO EVALUABLE/);
    expect(p).toMatch(/PUC grupo 31: 3105 capital suscrito y pagado, 3115 aportes sociales, 3120 capital asignado/);
    expect(p).not.toMatch(/capital suscrito y pagado \(PUC 3115\/3120\)/);
  });
});
