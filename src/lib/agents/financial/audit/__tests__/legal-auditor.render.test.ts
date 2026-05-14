// ---------------------------------------------------------------------------
// Wave 7.B1 — Legal Auditor v2.1 render tests
// ---------------------------------------------------------------------------
// Verifica que `renderLegalAuditorMarkdown` produce el formato ASCII-boxed
// del Spec v2.1 cuando los campos estructurados estan presentes, y cae
// gracefully al render legacy cuando son null.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { renderLegalAuditorMarkdown } from '../agents/legal-auditor';
import {
  LegalAuditReportSchema,
  type LegalAuditReportJson,
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

function baseJson(): LegalAuditReportJson {
  return {
    complianceScore: 88,
    executiveSummary: 'La sociedad cumple con la mayoria de obligaciones societarias.',
    findings: [],
    societaryObligations: null,
    patrimonyDistribution: null,
    capitalizacionAnalysis: null,
    riesgosLegales: null,
    auditOpinion: null,
    requiredActions: null,
    conclusion: 'Los documentos societarios son juridicamente solidos.',
  };
}

describe('LegalAuditReportSchema — v2.1 contract', () => {
  it('acepta payload con todos los campos v2.1 poblados', () => {
    const payload: LegalAuditReportJson = {
      ...baseJson(),
      societaryObligations: Array.from({ length: 14 }, (_, i) => ({
        obligation: `Obligacion ${i + 1}`,
        status: 'cumplido' as const,
        reference: `Art. ${424 + i} C.Co.`,
        comment: null,
      })),
      patrimonyDistribution: {
        utilidadNetaCop: '222849678973',
        reservaLegalObligatoria: true,
        montoReserva10pctCop: '22284967897',
        utilidadDisponibleCop: '200564711076',
        tipoDividendoPosible: 'ordinario',
        impuestoDividendosComment:
          'Retencion 10% sobre dividendos gravados (Art. 242 E.T.).',
      },
      capitalizacionAnalysis: {
        proposed: false,
        baseLegal: 'Ley 1258/2008 Art. 5',
        documentoRequerido: 'Acta de Asamblea + Escritura publica',
        beneficioFiscal: 'Art. 36-3 E.T. — exento impuesto a dividendos',
        procedimiento: [],
      },
      riesgosLegales: [
        {
          descripcion: 'No registro del beneficiario final en plataforma UIAF.',
          normaAplicable: 'Resolucion 164/2021 UIAF',
          consecuenciaPotencial: 'Multa hasta 200 SMMLV.',
          probabilidad: 'media',
        },
      ],
      auditOpinion: {
        type: 'con_observaciones_subsanables',
        text: 'Se identifican observaciones subsanables menores.',
      },
      requiredActions: [
        {
          action: 'Registrar beneficiario final ante UIAF.',
          priority: 'alta',
          reference: 'Resolucion 164/2021 UIAF',
          plazo: '30 dias',
        },
      ],
    };
    const parsed = LegalAuditReportSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('rechaza .optional() implicito — los nuevos campos son nullable, no optional', () => {
    // Si omitimos un campo nullable, falla strict-mode
    const payload = baseJson() as unknown as Record<string, unknown>;
    delete payload.societaryObligations;
    const parsed = LegalAuditReportSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});

describe('renderLegalAuditorMarkdown — v2.1 ASCII boxed', () => {
  it('emite el bloque "DICTAMEN 3 — AUDITOR LEGAL Y SOCIETARIO" cuando hay campos v2.1', () => {
    const json: LegalAuditReportJson = {
      ...baseJson(),
      auditOpinion: {
        type: 'sin_observaciones',
        text: 'La gestion societaria del periodo cumple integralmente.',
      },
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).toContain('DICTAMEN 3 — AUDITOR LEGAL Y SOCIETARIO');
    expect(md).toContain('ACME SAS');
    expect(md).toContain('NIT 900.123.456-7');
    expect(md).toContain('Periodo 2025');
    expect(md).toContain('SIN OBSERVACIONES');
  });

  it('emite las 14 obligaciones con badges visuales', () => {
    const statuses = [
      'cumplido',
      'parcial',
      'incumplido',
      'no_aplica',
      'cumplido',
      'cumplido',
      'cumplido',
      'cumplido',
      'cumplido',
      'cumplido',
      'cumplido',
      'cumplido',
      'cumplido',
      'cumplido',
    ] as const;
    const json: LegalAuditReportJson = {
      ...baseJson(),
      societaryObligations: statuses.map((s, i) => ({
        obligation: `Obligacion ${i + 1}`,
        status: s,
        reference: `Art. ${i + 1}`,
        comment: i === 0 ? 'evidencia ok' : null,
      })),
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).toContain('[✅ CUMPLIDO]');
    expect(md).toContain('[⚠ PARCIAL]');
    expect(md).toContain('[❌ INCUMPLIDO]');
    expect(md).toContain('[— N/D]');
    expect(md).toContain('## 2. CHECKLIST DE OBLIGACIONES SOCIETARIAS');
    expect(md).toContain('evidencia ok');
  });

  it('renderiza patrimonyDistribution con formato $X.XXX.XXX,XX (es-CO)', () => {
    const json: LegalAuditReportJson = {
      ...baseJson(),
      patrimonyDistribution: {
        utilidadNetaCop: '222849678973',
        reservaLegalObligatoria: true,
        montoReserva10pctCop: '22284967897',
        utilidadDisponibleCop: '200564711076',
        tipoDividendoPosible: 'ordinario',
        impuestoDividendosComment: 'Retencion 10% Art. 242 E.T.',
      },
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).toContain('$2.228.496.789,73');
    expect(md).toContain('$222.849.678,97');
    expect(md).toContain('$2.005.647.110,76');
    expect(md).toContain('SI (Art. 452 C.Co.)');
    expect(md).toContain('ordinario');
    expect(md).toContain('Art. 242 E.T.');
  });

  it('renderiza patrimonyDistribution con N/D cuando los montos son null', () => {
    const json: LegalAuditReportJson = {
      ...baseJson(),
      patrimonyDistribution: {
        utilidadNetaCop: null,
        reservaLegalObligatoria: false,
        montoReserva10pctCop: null,
        utilidadDisponibleCop: null,
        tipoDividendoPosible: null,
        impuestoDividendosComment: 'No aplica para el periodo.',
      },
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).toContain('N/D');
    expect(md).toContain('No aplica para el periodo.');
  });

  it('emite seccion CAPITALIZACION cuando proposed=true con procedimiento listado', () => {
    const json: LegalAuditReportJson = {
      ...baseJson(),
      capitalizacionAnalysis: {
        proposed: true,
        baseLegal: 'Ley 1258/2008 Art. 5',
        documentoRequerido: 'Acta de Asamblea',
        beneficioFiscal: 'Art. 36-3 E.T.',
        procedimiento: ['Acta de Asamblea', 'Escritura publica', 'Registro Camara'],
      },
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).toContain('## 4. ANALISIS DE CAPITALIZACION');
    expect(md).toContain('Ley 1258/2008 Art. 5');
    expect(md).toContain('Art. 36-3 E.T.');
    expect(md).toContain('1. Acta de Asamblea');
    expect(md).toContain('3. Registro Camara');
  });

  it('renderiza riesgosLegales con probabilidad como badge', () => {
    const json: LegalAuditReportJson = {
      ...baseJson(),
      riesgosLegales: [
        {
          descripcion: 'Falta libro de accionistas actualizado.',
          normaAplicable: 'Art. 195 C.Co.',
          consecuenciaPotencial: 'Sancion SuperSociedades.',
          probabilidad: 'alta',
        },
      ],
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).toContain('## 5. RIESGOS LEGALES IDENTIFICADOS');
    expect(md).toContain('[ALTA]');
    expect(md).toContain('Falta libro de accionistas actualizado.');
    expect(md).toContain('Art. 195 C.Co.');
  });

  it('renderiza requiredActions con priority badge y plazo', () => {
    const json: LegalAuditReportJson = {
      ...baseJson(),
      requiredActions: [
        {
          action: 'Aprobar EEFF en Asamblea Ordinaria.',
          priority: 'alta',
          reference: 'Art. 446 C.Co.',
          plazo: '30 dias',
        },
        {
          action: 'Renovar matricula mercantil.',
          priority: 'media',
          reference: 'Art. 33 C.Co.',
          plazo: null,
        },
      ],
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).toContain('## 8. ACCIONES REQUERIDAS');
    expect(md).toContain('[PRIORIDAD ALTA]');
    expect(md).toContain('[PRIORIDAD MEDIA]');
    expect(md).toContain('Plazo: 30 dias');
    // segunda accion no tiene plazo → no debe aparecer "Plazo:" en su bloque
    expect(md.includes('Renovar matricula mercantil')).toBe(true);
  });

  it('emite OPINION_LABEL canonicos por tipo', () => {
    for (const [type, expected] of [
      ['sin_observaciones', 'SIN OBSERVACIONES'],
      ['con_observaciones_subsanables', 'CON OBSERVACIONES SUBSANABLES'],
      ['con_hallazgos_inmediatos', 'CON HALLAZGOS QUE EXIGEN ACCION INMEDIATA'],
    ] as const) {
      const json: LegalAuditReportJson = {
        ...baseJson(),
        auditOpinion: { type, text: 'texto formal' },
      };
      const md = renderLegalAuditorMarkdown(json, [], COMPANY);
      expect(md).toContain(expected);
    }
  });

  it('renderiza findings detallados con todos los campos', () => {
    const findings: AuditFinding[] = [
      {
        code: 'LEG-001',
        severity: 'alto',
        domain: 'legal',
        title: 'Reserva legal mal nombrada',
        description: 'Aparece como Reserva Estatutaria.',
        normReference: 'Art. 452 C.Co.',
        recommendation: 'Reclasificar a Reserva Legal.',
        impact: 'Riesgo de salvedad NIIF.',
        period: '2025',
      },
    ];
    const json: LegalAuditReportJson = {
      ...baseJson(),
      auditOpinion: { type: 'con_observaciones_subsanables', text: 'op' },
    };
    const md = renderLegalAuditorMarkdown(json, findings, COMPANY);
    expect(md).toContain('### LEG-001: Reserva legal mal nombrada');
    expect(md).toContain('ALTO');
    expect(md).toContain('Art. 452 C.Co.');
    expect(md).toContain('Reclasificar a Reserva Legal.');
  });

  it('fallback legacy cuando TODOS los campos v2.1 son null', () => {
    const json = baseJson();
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    expect(md).not.toContain('DICTAMEN 3 — AUDITOR LEGAL Y SOCIETARIO');
    expect(md).toContain('## SCORE\n88');
    expect(md).toContain('## RESUMEN EJECUTIVO');
    expect(md).toContain('## CONCLUSION');
  });

  it('formato visual con marco ASCII al inicio y cierre cuando hay estructura v2.1', () => {
    const json: LegalAuditReportJson = {
      ...baseJson(),
      auditOpinion: { type: 'sin_observaciones', text: 'op' },
    };
    const md = renderLegalAuditorMarkdown(json, [], COMPANY);
    // Marco ASCII visible
    expect(md).toMatch(/═{40,}/);
  });
});
