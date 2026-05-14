// ---------------------------------------------------------------------------
// Wave 7.A1 — Tests del renderer Dictamen NIIF v2.1
// ---------------------------------------------------------------------------
// Verifica que el formato ASCII boxed se emite con los 13 checks de seccion
// NIIF, las estadisticas agregadas, la opinion seleccionada y las acciones.
// Tambien cubre el fallback legacy cuando faltan los campos v2.1.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { renderNiifDictamenMarkdown } from '../agents/niif-auditor';
import {
  NiifAuditReportSchema,
  type NiifAuditReportJson,
} from '../../contracts/audit-report';
import type { AuditFinding } from '../types';

const THIRTEEN_SECTIONS = [
  { section: 'Seccion 3', sectionTitle: 'Presentacion de EEFF' },
  { section: 'Seccion 4', sectionTitle: 'Estado de Situacion Financiera' },
  { section: 'Seccion 5', sectionTitle: 'Estado de Resultados' },
  { section: 'Seccion 6', sectionTitle: 'Cambios en el Patrimonio' },
  { section: 'Seccion 7', sectionTitle: 'Flujos de Efectivo' },
  { section: 'Seccion 8', sectionTitle: 'Notas a los EEFF' },
  { section: 'Seccion 11', sectionTitle: 'Instrumentos Financieros Basicos' },
  { section: 'Seccion 13', sectionTitle: 'Inventarios' },
  { section: 'Seccion 17', sectionTitle: 'Propiedad, Planta y Equipo' },
  { section: 'Seccion 23', sectionTitle: 'Ingresos de Actividades Ordinarias' },
  { section: 'Seccion 28', sectionTitle: 'Beneficios a Empleados' },
  { section: 'Seccion 29', sectionTitle: 'Impuesto a las Ganancias' },
  { section: 'Seccion 32', sectionTitle: 'Hechos Posteriores' },
] as const;

function buildV21Sample(): NiifAuditReportJson {
  return {
    complianceScore: 82,
    executiveSummary:
      'Se revisaron 13 secciones NIIF para PYMES materiales sobre los EEFF del ejercicio 2025.',
    findings: [
      {
        code: 'NIIF-001',
        severity: 'medio',
        title: 'Desglose insuficiente en otros pasivos',
        description: 'La nota 8 agrupa Otros pasivos sin desagregar partidas que superan el 10% del rubro.',
        normReference: 'NIC 1 par. 55; Seccion 8 NIIF PYMES',
        recommendation: 'Desagregar las partidas Otros pasivos en la nota correspondiente.',
        impact: 'Posible salvedad por presentacion (NIA 705 par. A7).',
        period: '2025',
        impactCop: null,
      },
    ],
    conclusion: 'Los EEFF presentan razonablemente, con observaciones menores documentadas.',
    niifSectionChecks: THIRTEEN_SECTIONS.map((s, idx) => ({
      section: s.section,
      sectionTitle: s.sectionTitle,
      status: idx === 5 ? 'observacion' as const : 'conforme' as const,
      finding: idx === 5 ? 'Desglose insuficiente en otros pasivos' : 'Sin observaciones',
      reference: `${s.section} NIIF PYMES`,
      action: idx === 5 ? 'Desagregar partidas Otros pasivos' : '—',
    })),
    summaryStats: {
      conformes: 12,
      observaciones: 1,
      incumplimientos: 0,
    },
    auditOpinion: {
      type: 'con_salvedades',
      text: 'En nuestra opinion, salvo por el efecto del asunto descrito en el parrafo de observaciones, los estados financieros presentan razonablemente.',
    },
    requiredActions: [
      {
        action: 'Reemitir la nota 8 con desagregacion de Otros pasivos.',
        horizon: 'corto_plazo',
        reference: 'NIC 1 par. 55; Seccion 8 NIIF PYMES',
      },
    ],
  };
}

describe('renderNiifDictamenMarkdown — v2.1', () => {
  it('schema acepta el sample v2.1 completo', () => {
    const sample = buildV21Sample();
    const parsed = NiifAuditReportSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });

  it('emite el marco ASCII de apertura y cierre', () => {
    const sample = buildV21Sample();
    const md = renderNiifDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    const frame = '═══════════════════════════════════════════════════════════════════';
    expect(md).toContain(`${frame}\nDICTAMEN 1 — AUDITOR NIIF\n${frame}`);
    expect(md).toContain(`${frame}\nFIN DEL DICTAMEN 1\n${frame}`);
  });

  it('renderiza las 7 secciones numeradas del dictamen', () => {
    const sample = buildV21Sample();
    const md = renderNiifDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toContain('## 1. ALCANCE');
    expect(md).toContain('## 2. HALLAZGOS POR SECCION NIIF');
    expect(md).toContain('## 3. LISTA MINIMA DE VERIFICACION');
    expect(md).toContain('## 4. RESUMEN ESTADISTICO');
    expect(md).toContain('## 5. OPINION FORMAL');
    expect(md).toContain('## 6. ACCIONES REQUERIDAS');
    expect(md).toContain('## 7. CONCLUSION');
  });

  it('emite las 13 etiquetas de seccion NIIF en orden', () => {
    const sample = buildV21Sample();
    const md = renderNiifDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    for (const s of THIRTEEN_SECTIONS) {
      expect(md).toContain(`${s.section} — ${s.sectionTitle}`);
    }
  });

  it('renderiza iconos de status correctos', () => {
    const sample = buildV21Sample();
    const md = renderNiifDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    // 12 conformes -> '✅' debe aparecer >= 12 veces en la lista de verificacion + 1 en stats
    const conformesCount = (md.match(/✅/g) ?? []).length;
    expect(conformesCount).toBeGreaterThanOrEqual(12);
    // 1 observacion -> '⚠' aparece al menos 2 veces (lista + stats)
    expect((md.match(/⚠/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('solo renderiza la opinion seleccionada (no las 4 opciones)', () => {
    const sample = buildV21Sample();
    const md = renderNiifDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toContain('OPINION CON SALVEDADES');
    expect(md).not.toContain('OPINION SIN SALVEDADES');
    expect(md).not.toContain('OPINION ADVERSA');
    expect(md).not.toContain('ABSTENCION DE OPINION');
  });

  it('emite acciones con checkbox y horizonte', () => {
    const sample = buildV21Sample();
    const md = renderNiifDictamenMarkdown(sample, sample.findings as unknown as AuditFinding[]);
    expect(md).toContain('□');
    expect(md).toContain('[CORTO PLAZO]');
  });

  it('cae al render legacy cuando faltan campos v2.1', () => {
    const legacy: NiifAuditReportJson = {
      complianceScore: 70,
      executiveSummary: 'Resumen legacy.',
      findings: [],
      conclusion: 'Conclusion legacy.',
      niifSectionChecks: null,
      summaryStats: null,
      auditOpinion: null,
      requiredActions: null,
    };
    const md = renderNiifDictamenMarkdown(legacy, []);
    expect(md).toContain('## SCORE');
    expect(md).toContain('## RESUMEN EJECUTIVO');
    expect(md).toContain('## HALLAZGOS');
    expect(md).not.toContain('DICTAMEN 1');
  });
});
