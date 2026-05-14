// ---------------------------------------------------------------------------
// Wave 7.B2 — Fiscal Reviewer v2.1 render tests
// ---------------------------------------------------------------------------
// Verifica que `renderFiscalReviewerMarkdown` produce el formato ASCII-boxed
// del Spec v2.1 "Dictamen 4 — Auditor Fiscal" cuando los campos
// estructurados estan presentes, mantiene el bloque NIA-700 (legacy) al
// final, y cae gracefully al render legacy completo cuando los campos
// estructurados son null.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { renderFiscalReviewerMarkdown } from '../agents/fiscal-reviewer';
import {
  FiscalReviewReportSchema,
  type FiscalReviewReportJson,
} from '../../contracts/audit-report';
import type { AuditFinding } from '../types';
import type { CompanyInfo } from '../../types';

const COMPANY: CompanyInfo = {
  name: 'ACME SAS',
  nit: '900.123.456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  comparativePeriod: '2024',
};

function baseJson(): FiscalReviewReportJson {
  return {
    complianceScore: 82,
    executiveSummary:
      'La sociedad muestra cumplimiento general de las obligaciones DIAN del periodo.',
    materiality: {
      benchmarkLabel: '5% utilidad antes de impuestos',
      materialityAmountCop: '11142483949',
      performanceMateriality: '7799738764',
      comment: 'Materialidad establecida sobre utilidad antes de impuestos.',
    },
    goingConcern: {
      hasMaterialUncertainty: false,
      indicatorsFound: [],
      conclusion: 'No se identifica duda sustancial sobre empresa en funcionamiento.',
    },
    findings: [],
    opinionType: 'favorable',
    dictamen: 'DICTAMEN FORMAL DEL REVISOR FISCAL — [bloque de firma literal]',
    formalObligations: null,
    criticalSaldos: null,
    dianRiskIndicators: null,
    riesgoFiscalizacionGlobal: null,
    obligations2026: null,
    fiscalAuditOpinion: null,
    fiscalRequiredActions: null,
  };
}

describe('FiscalReviewReportSchema — v2.1 contract', () => {
  it('acepta payload con todos los campos v2.1 poblados', () => {
    const payload: FiscalReviewReportJson = {
      ...baseJson(),
      formalObligations: Array.from({ length: 10 }, (_, i) => ({
        obligation: `Obligacion ${i + 1}`,
        periodicidad: 'mensual' as const,
        vencimientoProximo: null,
        status: 'al_dia' as const,
        reference: `Art. ${600 + i} E.T.`,
      })),
      criticalSaldos: {
        retenciones2365Cop: '500000000',
        retenciones1355Cop: '380000000',
        ivaPorPagarNetoCop: '120000000',
        anticipoRentaSiguienteCop: '835686296',
        sancionPotencialMoraCop: null,
      },
      dianRiskIndicators: Array.from({ length: 6 }, (_, i) => ({
        indicator: `Indicador ${i + 1}`,
        level: 'medio' as const,
        observation: null,
      })),
      riesgoFiscalizacionGlobal: 'medio',
      obligations2026: {
        anticipoRenta2026Cop: '835686296',
        baseAnticipo: '75% del impuesto causado 2025',
        icaEstimado2026Cop: null,
        baseIca: null,
      },
      fiscalAuditOpinion: {
        type: 'riesgo_medio',
        text: 'Riesgo de fiscalizacion medio por indicadores sectoriales.',
      },
      fiscalRequiredActions: [
        {
          action: 'Presentar Formato 2516 antes del cierre.',
          reference: 'Art. 772-1 E.T.',
          fechaLimite: '30-06-2026',
          consecuenciaIncumplimiento: 'Sancion Art. 641 E.T. 5% por mes de retraso.',
        },
      ],
    };
    const parsed = FiscalReviewReportSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('rechaza payload sin los nuevos campos v2.1 (deben ser nullable explicitos)', () => {
    const payload = baseJson() as unknown as Record<string, unknown>;
    delete payload.formalObligations;
    const parsed = FiscalReviewReportSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('mantiene compatibilidad con materiality y goingConcern existentes', () => {
    const parsed = FiscalReviewReportSchema.safeParse(baseJson());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.materiality.benchmarkLabel).toBe('5% utilidad antes de impuestos');
      expect(parsed.data.goingConcern.hasMaterialUncertainty).toBe(false);
    }
  });
});

describe('renderFiscalReviewerMarkdown — v2.1 ASCII boxed + NIA-700 legacy coexisten', () => {
  it('emite "DICTAMEN 4 — AUDITOR FISCAL (DIAN)" cuando hay campos v2.1', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      fiscalAuditOpinion: {
        type: 'riesgo_bajo',
        text: 'Riesgo bajo de fiscalizacion DIAN.',
      },
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('DICTAMEN 4 — AUDITOR FISCAL (DIAN)');
    expect(md).toContain('ACME SAS');
    expect(md).toContain('NIT 900.123.456-7');
    expect(md).toContain('Periodo 2025');
    expect(md).toContain('RIESGO BAJO DE FISCALIZACION DIAN');
  });

  it('preserva el bloque NIA-700 (legacy) al final cuando hay campos v2.1', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      fiscalAuditOpinion: {
        type: 'riesgo_medio',
        text: 'op',
      },
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'con_salvedades', COMPANY);
    // El bloque v2.1 viene primero
    const idxV21 = md.indexOf('DICTAMEN 4 — AUDITOR FISCAL');
    const idxLegacy = md.indexOf('DICTAMEN DEL REVISOR FISCAL (NIA 700-706 / Ley 43/1990)');
    expect(idxV21).toBeGreaterThan(-1);
    expect(idxLegacy).toBeGreaterThan(-1);
    expect(idxV21).toBeLessThan(idxLegacy);
    expect(md).toContain('## MATERIALIDAD');
    expect(md).toContain('## EMPRESA EN FUNCIONAMIENTO');
    expect(md).toContain('## DICTAMEN');
    expect(md).toContain('DICTAMEN FORMAL DEL REVISOR FISCAL');
    expect(md).toContain('## TIPO DE OPINION\ncon_salvedades');
  });

  it('emite las 10 obligaciones formales con badges visuales', () => {
    const statuses = [
      'al_dia',
      'verificar',
      'posible_mora',
      'no_aplica',
      'al_dia',
      'al_dia',
      'al_dia',
      'al_dia',
      'al_dia',
      'al_dia',
    ] as const;
    const periodicidades = [
      'anual',
      'bimestral',
      'anual',
      'mensual',
      'mensual',
      'mensual',
      'anual',
      'mensual',
      'anual',
      'anual',
    ] as const;
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      formalObligations: statuses.map((s, i) => ({
        obligation: `Obligacion ${i + 1}`,
        periodicidad: periodicidades[i],
        vencimientoProximo: i === 0 ? '14-04-2026' : null,
        status: s,
        reference: `Art. ${i + 1}`,
      })),
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('[✅ AL DIA]');
    expect(md).toContain('[⚠ VERIFICAR]');
    expect(md).toContain('[❌ POSIBLE MORA]');
    expect(md).toContain('[— N/A]');
    expect(md).toContain('## 2. OBLIGACIONES FORMALES DIAN');
    expect(md).toContain('Proximo vencimiento: 14-04-2026');
    expect(md).toContain('(anual)');
    expect(md).toContain('(mensual)');
  });

  it('renderiza criticalSaldos con formato $X.XXX.XXX,XX', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      criticalSaldos: {
        retenciones2365Cop: '500000000',
        retenciones1355Cop: '380000000',
        ivaPorPagarNetoCop: '120000000',
        anticipoRentaSiguienteCop: '835686296',
        sancionPotencialMoraCop: null,
      },
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('## 3. SALDOS CRITICOS');
    expect(md).toContain('$5.000.000,00');
    expect(md).toContain('$3.800.000,00');
    expect(md).toContain('$1.200.000,00');
    expect(md).toContain('$8.356.862,96');
    expect(md).toContain('Sancion potencial por mora          : N/D');
  });

  it('renderiza los 6 indicadores de riesgo DIAN con badges', () => {
    const levels = ['bajo', 'medio', 'alto', 'bajo', 'medio', 'bajo'] as const;
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      dianRiskIndicators: levels.map((l, i) => ({
        indicator: `Indicador ${i + 1}`,
        level: l,
        observation: i === 2 ? 'Crecimiento >50% vs banda sectorial' : null,
      })),
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('## 4. INDICADORES DE RIESGO DIAN');
    expect(md).toContain('[✅ BAJO]');
    expect(md).toContain('[⚠ MEDIO]');
    expect(md).toContain('[❌ ALTO]');
    expect(md).toContain('Crecimiento >50% vs banda sectorial');
  });

  it('renderiza riesgoFiscalizacionGlobal como bloque destacado', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      riesgoFiscalizacionGlobal: 'alto',
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('## 5. RIESGO GLOBAL DE FISCALIZACION');
    expect(md).toContain('Nivel agregado: [❌ ALTO]');
  });

  it('renderiza obligations2026 con anticipo y base', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      obligations2026: {
        anticipoRenta2026Cop: '835686296',
        baseAnticipo: '75% del impuesto causado 2025',
        icaEstimado2026Cop: '50000000',
        baseIca: 'ingresos brutos por actividad, 5 por mil',
      },
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('## 6. OBLIGACIONES DEL SIGUIENTE PERIODO');
    expect(md).toContain('Anticipo de renta (Art. 807 E.T.):** $8.356.862,96');
    expect(md).toContain('75% del impuesto causado 2025');
    expect(md).toContain('ICA estimado:** $500.000,00');
    expect(md).toContain('5 por mil');
  });

  it('renderiza obligations2026 con N/D cuando los montos son null', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      obligations2026: {
        anticipoRenta2026Cop: null,
        baseAnticipo: 'Sin impuesto causado en 2025, no aplica anticipo',
        icaEstimado2026Cop: null,
        baseIca: null,
      },
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('Anticipo de renta (Art. 807 E.T.):** N/D');
    expect(md).toContain('ICA estimado:** N/D');
  });

  it('emite FISCAL_OPINION_LABEL canonicos por tipo', () => {
    for (const [type, expected] of [
      ['riesgo_bajo', 'RIESGO BAJO DE FISCALIZACION DIAN'],
      ['riesgo_medio', 'RIESGO MEDIO DE FISCALIZACION DIAN'],
      ['riesgo_alto', 'RIESGO ALTO DE FISCALIZACION DIAN'],
    ] as const) {
      const json: FiscalReviewReportJson = {
        ...baseJson(),
        fiscalAuditOpinion: { type, text: 'op' },
      };
      const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
      expect(md).toContain(expected);
    }
  });

  it('renderiza fiscalRequiredActions con norma, plazo y consecuencia', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      fiscalRequiredActions: [
        {
          action: 'Conciliar Formato 2516.',
          reference: 'Art. 772-1 E.T.',
          fechaLimite: '30-06-2026',
          consecuenciaIncumplimiento: 'Sancion Art. 641 E.T. 5% por mes.',
        },
        {
          action: 'Revisar saldo Cta. 1355.',
          reference: 'Art. 815 E.T.',
          fechaLimite: null,
          consecuenciaIncumplimiento: 'Riesgo de revision DIAN.',
        },
      ],
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('## 8. ACCIONES REQUERIDAS DIAN');
    expect(md).toContain('Fecha limite: 30-06-2026');
    expect(md).toContain('Sancion Art. 641 E.T.');
    expect(md).toContain('Norma: Art. 815 E.T.');
    expect(md).toContain('Riesgo de revision DIAN.');
  });

  it('fallback legacy cuando TODOS los campos v2.1 son null — solo bloque NIA-700', () => {
    const json = baseJson();
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).not.toContain('DICTAMEN 4 — AUDITOR FISCAL (DIAN)');
    expect(md).toContain('DICTAMEN DEL REVISOR FISCAL (NIA 700-706 / Ley 43/1990)');
    expect(md).toContain('## SCORE');
    expect(md).toContain('## MATERIALIDAD');
    expect(md).toContain('## EMPRESA EN FUNCIONAMIENTO');
    expect(md).toContain('## DICTAMEN');
  });

  it('preserva el campo dictamen NIA-700 con bloque de firma literal', () => {
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      dictamen: 'DICTAMEN — bloque firma literal con guiones bajos ______',
      fiscalAuditOpinion: { type: 'riesgo_bajo', text: 'op' },
    };
    const md = renderFiscalReviewerMarkdown(json, [], 'favorable', COMPANY);
    expect(md).toContain('bloque firma literal con guiones bajos');
  });

  it('renderiza findings detallados dentro del bloque NIA-700', () => {
    const findings: AuditFinding[] = [
      {
        code: 'RF-001',
        severity: 'alto',
        domain: 'revisoria',
        title: 'Hallazgo de aseguramiento',
        description: 'Variacion no documentada en cuenta 1355.',
        normReference: 'NIA 315 §25',
        recommendation: 'Documentar el origen.',
        impact: 'Riesgo de salvedad.',
        period: '2025',
      },
    ];
    const json: FiscalReviewReportJson = {
      ...baseJson(),
      fiscalAuditOpinion: { type: 'riesgo_medio', text: 'op' },
    };
    const md = renderFiscalReviewerMarkdown(json, findings, 'con_salvedades', COMPANY);
    expect(md).toContain('### RF-001: Hallazgo de aseguramiento');
    expect(md).toContain('NIA 315 §25');
    expect(md).toContain('ALTO');
  });
});
