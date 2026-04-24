// ---------------------------------------------------------------------------
// Audit Orchestrator — parallel execution of 4 auditors + consolidation
// ---------------------------------------------------------------------------
// All 4 auditors run in PARALLEL (Promise.allSettled) so individual failures
// don't block the others. Results are consolidated into a single audit report.
// ---------------------------------------------------------------------------

import { runNiifAuditor } from './agents/niif-auditor';
import { runTaxAuditor } from './agents/tax-auditor';
import { runLegalAuditor } from './agents/legal-auditor';
import { runFiscalReviewer } from './agents/fiscal-reviewer';
import type { FinancialReport } from '../types';
import type {
  AuditRequest,
  AuditReport,
  AuditorResult,
  AuditFinding,
  AuditOpinionType,
  AuditProgressEvent,
  FindingSeverity,
} from './types';

export interface AuditOrchestrateOptions {
  onProgress?: (event: AuditProgressEvent) => void;
}

const SEVERITY_ORDER: FindingSeverity[] = ['critico', 'alto', 'medio', 'bajo', 'informativo'];

const DOMAIN_WEIGHTS = {
  niif: 0.30,
  tributario: 0.25,
  legal: 0.20,
  revisoria: 0.25,
} as const;

/**
 * Execute the full audit pipeline — 4 auditors in parallel, then consolidate.
 */
export async function orchestrateAudit(
  request: AuditRequest,
  options: AuditOrchestrateOptions = {},
): Promise<AuditReport> {
  const { report, language } = request;
  const { onProgress } = options;

  const auditorNames = [
    'Auditor NIIF/Contable',
    'Auditor Tributario',
    'Auditor Legal/Societario',
    'Auditor de Revisoria Fiscal',
  ];

  onProgress?.({ type: 'audit_start', auditors: auditorNames });

  // ---------------------------------------------------------------------------
  // Launch all 4 auditors in parallel
  // ---------------------------------------------------------------------------
  const reportContent = report.consolidatedReport;

  onProgress?.({ type: 'auditor_start', domain: 'niif', name: 'Auditor NIIF/Contable' });
  onProgress?.({ type: 'auditor_start', domain: 'tributario', name: 'Auditor Tributario' });
  onProgress?.({ type: 'auditor_start', domain: 'legal', name: 'Auditor Legal/Societario' });
  onProgress?.({ type: 'auditor_start', domain: 'revisoria', name: 'Auditor de Revisoria Fiscal' });

  const results = await Promise.allSettled([
    runNiifAuditor(reportContent, report.company, language, onProgress),
    runTaxAuditor(reportContent, report.company, language, onProgress),
    runLegalAuditor(reportContent, report.company, language, onProgress),
    runFiscalReviewer(reportContent, report.company, language, onProgress),
  ]);

  // ---------------------------------------------------------------------------
  // Collect results (handle individual failures gracefully)
  // ---------------------------------------------------------------------------
  const auditorResults: AuditorResult[] = [];
  let fiscalOpinionType: AuditOpinionType = 'con_salvedades';
  let fiscalDictamen = '';

  const domains: Array<'niif' | 'tributario' | 'legal' | 'revisoria'> = ['niif', 'tributario', 'legal', 'revisoria'];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const domain = domains[i];

    if (result.status === 'fulfilled') {
      auditorResults.push(result.value);
      onProgress?.({
        type: 'auditor_complete',
        domain,
        name: result.value.auditorName,
        score: result.value.complianceScore,
      });

      // Extract fiscal reviewer's opinion
      if (domain === 'revisoria' && 'opinionType' in result.value) {
        const fiscalResult = result.value as AuditorResult & { opinionType: AuditOpinionType; dictamen: string };
        fiscalOpinionType = fiscalResult.opinionType;
        fiscalDictamen = fiscalResult.dictamen;
      }
    } else {
      const errorMsg = result.reason instanceof Error ? result.reason.message : 'Error desconocido';
      console.error(`[audit] ${auditorNames[i]} failed:`, errorMsg);

      onProgress?.({
        type: 'auditor_failed',
        domain,
        name: auditorNames[i],
        error: errorMsg,
      });

      auditorResults.push({
        domain,
        auditorName: auditorNames[i],
        complianceScore: 0,
        findings: [],
        summary: `El auditor no pudo completar la revision debido a un error tecnico: ${errorMsg}`,
        fullContent: '',
        failed: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({ type: 'consolidating' });

  // Merge all findings sorted by severity
  const consolidatedFindings = auditorResults
    .flatMap((r) => r.findings)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  // Count by severity
  const findingCounts: Record<FindingSeverity, number> = {
    critico: 0,
    alto: 0,
    medio: 0,
    bajo: 0,
    informativo: 0,
  };
  for (const f of consolidatedFindings) {
    findingCounts[f.severity]++;
  }

  // Weighted overall score
  const successfulResults = auditorResults.filter((r) => !r.failed);
  let overallScore = 0;
  if (successfulResults.length > 0) {
    let totalWeight = 0;
    for (const r of successfulResults) {
      const weight = DOMAIN_WEIGHTS[r.domain];
      overallScore += r.complianceScore * weight;
      totalWeight += weight;
    }
    overallScore = Math.round(overallScore / totalWeight);
  }

  // Determine opinion type from overall score if fiscal reviewer failed
  if (auditorResults.find((r) => r.domain === 'revisoria')?.failed) {
    if (overallScore >= 90) fiscalOpinionType = 'favorable';
    else if (overallScore >= 75) fiscalOpinionType = 'con_salvedades';
    else if (overallScore >= 40) fiscalOpinionType = 'desfavorable';
    else fiscalOpinionType = 'abstension';
  }

  // Executive summary
  const executiveSummary = buildExecutiveSummary(
    auditorResults,
    consolidatedFindings,
    findingCounts,
    overallScore,
    fiscalOpinionType,
    language,
  );

  // Build consolidated Markdown report
  const consolidatedReport = buildConsolidatedAuditReport(
    report.company,
    auditorResults,
    consolidatedFindings,
    findingCounts,
    overallScore,
    fiscalOpinionType,
    fiscalDictamen,
    executiveSummary,
    language,
  );

  const auditReport: AuditReport = {
    company: report.company,
    auditorResults,
    overallScore,
    opinionType: fiscalOpinionType,
    opinionText: fiscalDictamen,
    consolidatedFindings,
    findingCounts,
    executiveSummary,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({ type: 'done' });

  return auditReport;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildExecutiveSummary(
  results: AuditorResult[],
  findings: AuditFinding[],
  counts: Record<FindingSeverity, number>,
  score: number,
  opinion: AuditOpinionType,
  language: 'es' | 'en',
): string {
  const successful = results.filter((r) => !r.failed);
  const failed = results.filter((r) => r.failed);

  const opinionLabels: Record<AuditOpinionType, string> = language === 'es'
    ? { favorable: 'Favorable (sin salvedades)', con_salvedades: 'Con Salvedades', desfavorable: 'Desfavorable', abstension: 'Abstencion de Opinion' }
    : { favorable: 'Unqualified (Clean)', con_salvedades: 'Qualified', desfavorable: 'Adverse', abstension: 'Disclaimer of Opinion' };

  const lines: string[] = [];
  lines.push(`**Score Global de Cumplimiento: ${score}/100** — Opinion: **${opinionLabels[opinion]}**`);
  lines.push('');

  if (successful.length > 0) {
    const scoreTable = successful
      .map((r) => `| ${r.auditorName} | ${r.complianceScore}/100 |`)
      .join('\n');
    lines.push('| Auditor | Score |');
    lines.push('|---------|-------|');
    lines.push(scoreTable);
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push(`**Auditores con error:** ${failed.map((r) => r.auditorName).join(', ')}`);
    lines.push('');
  }

  lines.push(`**Total hallazgos:** ${findings.length} — Criticos: ${counts.critico}, Altos: ${counts.alto}, Medios: ${counts.medio}, Bajos: ${counts.bajo}, Informativos: ${counts.informativo}`);

  if (counts.critico > 0) {
    lines.push('');
    lines.push('**Hallazgos criticos que requieren atencion inmediata:**');
    for (const f of findings.filter((f) => f.severity === 'critico')) {
      lines.push(`- **[${f.code}]** ${f.title} — ${f.normReference}`);
    }
  }

  return lines.join('\n');
}

function buildConsolidatedAuditReport(
  company: FinancialReport['company'],
  results: AuditorResult[],
  findings: AuditFinding[],
  counts: Record<FindingSeverity, number>,
  score: number,
  opinion: AuditOpinionType,
  dictamen: string,
  executiveSummary: string,
  language: 'es' | 'en',
): string {
  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  const opinionLabels: Record<AuditOpinionType, string> = {
    favorable: 'FAVORABLE (Sin Salvedades)',
    con_salvedades: 'CON SALVEDADES',
    desfavorable: 'DESFAVORABLE',
    abstension: 'ABSTENCION DE OPINION',
  };

  const findingsTable = findings.length > 0
    ? [
        '| Codigo | Severidad | Dominio | Hallazgo | Norma |',
        '|--------|-----------|---------|----------|-------|',
        ...findings.map((f) =>
          `| ${f.code} | ${f.severity.toUpperCase()} | ${f.domain} | ${f.title} | ${f.normReference} |`,
        ),
      ].join('\n')
    : '*No se encontraron hallazgos.*';

  const detailedFindings = findings.length > 0
    ? findings
        .map(
          (f) =>
            `### ${f.code}: ${f.title}\n- **Severidad:** ${f.severity.toUpperCase()}\n- **Dominio:** ${f.domain}\n- **Norma:** ${f.normReference}\n- **Descripcion:** ${f.description}\n- **Recomendacion:** ${f.recommendation}\n- **Impacto:** ${f.impact}`,
        )
        .join('\n\n')
    : '';

  const auditorSections = results
    .filter((r) => !r.failed)
    .map((r) => `### ${r.auditorName} (Score: ${r.complianceScore}/100)\n\n${r.fullContent}`)
    .join('\n\n---\n\n');

  return `# INFORME DE AUDITORIA INTEGRAL
## ${company.name} — Periodo ${company.fiscalPeriod}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Periodo Auditado** | ${company.fiscalPeriod} |
| **Fecha de Auditoria** | ${date} |
| **Score Global** | **${score}/100** |
| **Opinion** | **${opinionLabels[opinion]}** |
| **Total Hallazgos** | ${findings.length} (Criticos: ${counts.critico}, Altos: ${counts.alto}, Medios: ${counts.medio}) |
| **Sistema** | 1+1 — Audit Pipeline (4 Auditores Especializados en Paralelo) |

---

# RESUMEN EJECUTIVO

${executiveSummary}

---

# OPINION DEL REVISOR FISCAL

**Tipo de Opinion:** ${opinionLabels[opinion]}

${dictamen || '*Opinion no disponible — el auditor de revisoria fiscal no pudo completar la evaluacion.*'}

---

# MATRIZ DE HALLAZGOS

${findingsTable}

---

# HALLAZGOS DETALLADOS

${detailedFindings || '*Sin hallazgos detallados.*'}

---

# INFORMES INDIVIDUALES DE AUDITORES

${auditorSections}

---

> **Nota Legal:** Este informe de auditoria fue generado por 1+1, un sistema de inteligencia artificial. Los hallazgos, opiniones y recomendaciones deben ser validados por un Contador Publico certificado y un Revisor Fiscal independiente antes de su uso oficial. Este informe no constituye un dictamen de auditoria vinculante conforme a la Ley 43 de 1990.
`;
}
