// ---------------------------------------------------------------------------
// Wave 7.A2 — Tests del renderer Dictamen Tributario v2.1
// ---------------------------------------------------------------------------
// Verifica que el formato ASCII boxed se emite con los 9 analisis numerados
// (alcance, renta cascada, retenciones, IVA/ICA, TMT, riesgos, calendario,
// opinion, acciones), el marco ASCII y el fallback legacy.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { renderTaxDictamenMarkdown } from '../agents/tax-auditor';
import {
  TaxAuditReportSchema,
  type TaxAuditReportJson,
} from '../../contracts/audit-report';
import type { AuditFinding } from '../types';

function buildV21Sample(): TaxAuditReportJson {
  return {
    complianceScore: 78,
    executiveSummary:
      'Auditoria tributaria del periodo 2025 conforme al E.T. 2026 y Resoluciones DIAN vigentes.',
    findings: [
      {
        code: 'TRIB-001',
        severity: 'medio',
        title: 'Falta verificar TMT',
        description: 'Activos exceden 30.000 UVT y no se documenta el calculo TMT.',
        normReference: 'Paragrafo 6 Art. 240 E.T.; Ley 2277/2022',
        recommendation: 'Anexar memoria de calculo TMT 15%.',
        impact: 'Posible diferencia de impuesto al alza si la tasa efectiva < 15%.',
        period: '2025',
        impactCop: '5000000000',
      },
    ],
    totalFiscalExposureCop: '5000000000',
    conclusion: 'Riesgo tributario moderado; recomendamos cierre formal de calculo TMT.',
    rentaAnalysis: {
      tarifaGeneralPct: 35,
      utilidadAntesImpuestosCop: '222849678973',
      provisionTeoricaCop: '77997387640',
      impuestoRegistradoCop: '383953800',
      brechaCop: '77613433840',
      evaluacion: 'incoherente',
      accion: 'Reconciliar Cta.1805 con Clase 54 y registrar provision corriente.',
      reference: 'Art. 240 E.T.; Ley 2277 de 2022; NIIF PYMES Sec. 29',
    },
    retencionesAnalysis: {
      saldo1355Cop: '291666600',
      saldo1805Cop: '383953800',
      saldo24Cop: '120000000',
      posicionFiscalNetaCop: '555620400',
      evaluacion: 'Posicion fiscal neta a favor del contribuyente; pendiente solicitud de devolucion.',
      reference: 'Art. 850 E.T.; Decreto 2235/2017',
    },
    ivaIcaAnalysis: {
      pasivoIvaNetoCop: '85000000',
      regimenIva: 'responsable',
      icaComment: 'ICA municipio Bogota (actividad CIIU 4690); declaracion bimestral pendiente.',
      reference: 'Art. 437-1 E.T.; Acuerdo 65/2002 Bogota',
    },
    tmtAnalysis: {
      tasaMinimaExigidaPct: 15,
      tasaEfectivaPct: 0.17,
      status: 'no_cumple',
      reference: 'Art. 240-1 E.T.; Ley 2277/2022',
    },
    riesgosTributarios: [
      {
        descripcion: 'Brecha entre provision teorica y registrado (Cta.1805).',
        probabilidad: 'alta',
        exposicionCop: '77613433840',
        reference: 'Art. 240 E.T.; Art. 647 E.T.',
      },
    ],
    calendario2026: [
      {
        obligacion: 'Renta persona juridica 2025',
        fechaLimite: 'Mayo 2026 (segun ultimo digito NIT)',
        notes: 'Verificar grupo de plazo conforme Decreto vigente.',
        reference: 'Decreto 2229 de 2023; Resolucion DIAN 000238/2025',
      },
    ],
    auditOpinion: {
      type: 'con_observaciones',
      text: 'Existen observaciones materiales sobre la conciliacion de impuesto corriente y la verificacion TMT que deben corregirse antes del cierre fiscal.',
      exposicionTotalCop: '5000000000',
    },
    requiredActions: [
      {
        action: 'Documentar calculo TMT 15% con memoria firmada por contador.',
        priority: 'alta',
        reference: 'Art. 240-1 E.T.',
      },
      {
        action: 'Sustentar diferencia de criterio razonable Art. 647 E.T.',
        priority: 'media',
        reference: 'Art. 647 E.T.; Concepto DIAN 100208221-1352/2018',
      },
    ],
  };
}

describe('renderTaxDictamenMarkdown — v2.1', () => {
  it('schema acepta el sample v2.1 completo', () => {
    const sample = buildV21Sample();
    const parsed = TaxAuditReportSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });

  it('emite el marco ASCII de apertura y cierre', () => {
    const sample = buildV21Sample();
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    const frame = '═══════════════════════════════════════════════════════════════════';
    expect(md).toContain(`${frame}\nDICTAMEN 2 — AUDITOR TRIBUTARIO\n${frame}`);
    expect(md).toContain(`${frame}\nFIN DEL DICTAMEN 2\n${frame}`);
  });

  it('renderiza los 9 analisis numerados', () => {
    const sample = buildV21Sample();
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toContain('## 1. ALCANCE');
    expect(md).toContain('## 2. IMPUESTO DE RENTA — CASCADA TEORICA');
    expect(md).toContain('## 3. RETENCIONES, ANTICIPOS Y POSICION FISCAL NETA');
    expect(md).toContain('## 4. IVA / ICA / IMPUESTOS TERRITORIALES');
    expect(md).toContain('## 5. TASA MINIMA DE TRIBUTACION (TMT)');
    expect(md).toContain('## 6. RIESGOS TRIBUTARIOS PRIORIZADOS');
    expect(md).toContain('## 7. CALENDARIO TRIBUTARIO 2026');
    expect(md).toContain('## 8. OPINION TRIBUTARIA FORMAL');
    expect(md).toContain('## 9. ACCIONES REQUERIDAS');
  });

  it('formatea cifras en es-CO ($X.XXX.XXX,XX)', () => {
    const sample = buildV21Sample();
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    // 222849678973 centavos = $2.228.496.789,73
    expect(md).toContain('$2.228.496.789,73');
    // Provision teorica 77997387640 = $779.973.876,40
    expect(md).toContain('$779.973.876,40');
  });

  it('solo renderiza la opinion seleccionada (no las 3 opciones)', () => {
    const sample = buildV21Sample();
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toContain('DICTAMEN CON OBSERVACIONES');
    expect(md).not.toContain('DICTAMEN SIN HALLAZGOS');
    expect(md).not.toContain('DICTAMEN CON HALLAZGOS CRITICOS');
  });

  it('emite checkbox y prioridad en acciones', () => {
    const sample = buildV21Sample();
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toContain('□');
    expect(md).toContain('[ALTA]');
    expect(md).toContain('[MEDIA]');
  });

  it('marca status TMT con icono ❌ cuando no_cumple', () => {
    const sample = buildV21Sample();
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    // Linea TMT
    expect(md).toMatch(/Estado:\s*❌\s*NO CUMPLE/);
  });

  it('marca evaluacion renta cuando incoherente', () => {
    const sample = buildV21Sample();
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toMatch(/Evaluacion:\s*❌\s*INCOHERENTE/);
  });

  it('renderiza "— Dato no suministrado" cuando un campo es null', () => {
    const sample = buildV21Sample();
    sample.rentaAnalysis!.utilidadAntesImpuestosCop = null;
    sample.rentaAnalysis!.provisionTeoricaCop = null;
    const md = renderTaxDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toContain('— Dato no suministrado');
  });

  it('cae al render legacy cuando faltan los campos v2.1', () => {
    const legacy: TaxAuditReportJson = {
      complianceScore: 60,
      executiveSummary: 'Resumen legacy.',
      findings: [],
      totalFiscalExposureCop: null,
      conclusion: 'Conclusion legacy.',
      rentaAnalysis: null,
      retencionesAnalysis: null,
      ivaIcaAnalysis: null,
      tmtAnalysis: null,
      riesgosTributarios: null,
      calendario2026: null,
      auditOpinion: null,
      requiredActions: null,
    };
    const md = renderTaxDictamenMarkdown(legacy, []);
    expect(md).toContain('## SCORE');
    expect(md).toContain('## RESUMEN EJECUTIVO');
    expect(md).not.toContain('DICTAMEN 2');
  });
});
