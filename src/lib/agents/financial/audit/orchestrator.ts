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
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
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
  /**
   * Balance preprocesado (multiperiodo). Si se provee, los auditores reciben
   * contexto numerico vinculante (controlTotals + equityBreakdown del periodo
   * primario y comparativo) para validar coherencia inter-periodo.
   */
  preprocessed?: PreprocessedBalance;
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
  const { onProgress, preprocessed } = options;

  const auditorNames = [
    'Auditor NIIF/Contable',
    'Auditor Tributario',
    'Auditor Legal/Societario',
    'Auditor de Revisoria Fiscal',
  ];

  onProgress?.({ type: 'audit_start', auditors: auditorNames });

  // ---------------------------------------------------------------------------
  // Build multiperiodo context block (if preprocessed available)
  // ---------------------------------------------------------------------------
  // Lee el contrato canonico T1: preprocessed.primary, preprocessed.comparative,
  // preprocessed.periods[]. Antes vivia en preprocessed.summary/.controlTotals
  // top-level — esa forma fue eliminada.
  const periodContext = buildPeriodContext(preprocessed);

  // ---------------------------------------------------------------------------
  // Launch all 4 auditors in parallel
  // ---------------------------------------------------------------------------
  const reportContent = periodContext
    ? `${report.consolidatedReport}\n\n${periodContext}`
    : report.consolidatedReport;

  onProgress?.({ type: 'auditor_start', domain: 'niif', name: 'Auditor NIIF/Contable' });
  onProgress?.({ type: 'auditor_start', domain: 'tributario', name: 'Auditor Tributario' });
  onProgress?.({ type: 'auditor_start', domain: 'legal', name: 'Auditor Legal/Societario' });
  onProgress?.({ type: 'auditor_start', domain: 'revisoria', name: 'Auditor de Revisoria Fiscal' });

  const primaryPeriod = preprocessed?.primary.period ?? report.company.fiscalPeriod;

  const results = await Promise.allSettled([
    runNiifAuditor(reportContent, report.company, language, onProgress, primaryPeriod),
    runTaxAuditor(reportContent, report.company, language, onProgress, primaryPeriod),
    runLegalAuditor(reportContent, report.company, language, onProgress, primaryPeriod),
    runFiscalReviewer(reportContent, report.company, language, onProgress, primaryPeriod),
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

/**
 * Construye un bloque de contexto multiperiodo para anexar al reporte que cada
 * auditor recibe. Usa el contrato canonico T1: preprocessed.primary,
 * preprocessed.comparative, preprocessed.periods[].
 *
 * Si solo hay un periodo, emite contexto minimo. Si hay 2+ periodos, emite
 * tablas comparativas de control totals + equity breakdown que los auditores
 * usan para validar coherencia inter-periodo.
 */
function buildPeriodContext(preprocessed: PreprocessedBalance | undefined): string {
  if (!preprocessed) return '';

  const { primary, comparative, periods } = preprocessed;
  const lines: string[] = [];

  lines.push('---');
  lines.push('## CONTEXTO MULTIPERIODO (Preprocesador — Datos Vinculantes)');
  lines.push('');
  lines.push(`**Periodos detectados:** ${periods.length} (${periods.map((p) => p.period).join(', ')})`);
  lines.push(`**Periodo primario (auditado):** ${primary.period}`);

  if (comparative) {
    lines.push(`**Periodo comparativo:** ${comparative.period}`);
    lines.push('');
    lines.push('### Totales de Control — Comparacion Inter-Periodo');
    lines.push('');
    lines.push('| Concepto | ' + comparative.period + ' | ' + primary.period + ' | Variacion $ | Variacion % |');
    lines.push('|----------|-----------|-----------|-------------|-------------|');
    const ct0 = comparative.controlTotals;
    const ct1 = primary.controlTotals;
    const rowFor = (label: string, prev: number, curr: number) => {
      const delta = curr - prev;
      const pct = prev !== 0 ? ((delta / Math.abs(prev)) * 100).toFixed(2) + '%' : 'N/A';
      lines.push(`| ${label} | ${fmtCOP(prev)} | ${fmtCOP(curr)} | ${fmtCOP(delta)} | ${pct} |`);
    };
    rowFor('Activo Total', ct0.activo, ct1.activo);
    rowFor('Pasivo Total', ct0.pasivo, ct1.pasivo);
    rowFor('Patrimonio Total', ct0.patrimonio, ct1.patrimonio);
    rowFor('Ingresos', ct0.ingresos, ct1.ingresos);
    rowFor('Gastos+Costos', ct0.gastos, ct1.gastos);
    rowFor('Utilidad Neta', ct0.utilidadNeta, ct1.utilidadNeta);
    rowFor('Impuestos por Pagar (PUC 24)', ct0.impuestosCuenta24, ct1.impuestosCuenta24);
    lines.push('');

    // Equity breakdown comparison — para cuadre inter-periodo del Estado de
    // Cambios en el Patrimonio.
    lines.push('### Desglose de Patrimonio — Comparacion Inter-Periodo');
    lines.push('');
    const eb0 = comparative.equityBreakdown;
    const eb1 = primary.equityBreakdown;
    lines.push('| Cuenta | ' + comparative.period + ' | ' + primary.period + ' | Movimiento |');
    lines.push('|--------|-----------|-----------|------------|');
    const equityRow = (label: string, prev: number | undefined, curr: number | undefined) => {
      const p = prev ?? 0;
      const c = curr ?? 0;
      lines.push(`| ${label} | ${fmtCOP(p)} | ${fmtCOP(c)} | ${fmtCOP(c - p)} |`);
    };
    equityRow('Capital suscrito y pagado', eb0.capitalSuscritoPagado, eb1.capitalSuscritoPagado);
    equityRow('Reserva legal', eb0.reservaLegal, eb1.reservaLegal);
    equityRow('Otras reservas', eb0.otrasReservas, eb1.otrasReservas);
    equityRow('Utilidad del ejercicio', eb0.utilidadEjercicio, eb1.utilidadEjercicio);
    equityRow('Utilidades acumuladas', eb0.utilidadesAcumuladas, eb1.utilidadesAcumuladas);
    lines.push('');

    // Cuadre patrimonial: saldo final = saldo inicial + utilidad - dividendos
    const eq0Total = (eb0.capitalSuscritoPagado ?? 0) + (eb0.reservaLegal ?? 0) +
      (eb0.otrasReservas ?? 0) + (eb0.utilidadEjercicio ?? 0) + (eb0.utilidadesAcumuladas ?? 0);
    const eq1Total = (eb1.capitalSuscritoPagado ?? 0) + (eb1.reservaLegal ?? 0) +
      (eb1.otrasReservas ?? 0) + (eb1.utilidadEjercicio ?? 0) + (eb1.utilidadesAcumuladas ?? 0);
    lines.push(
      `**Movimiento neto patrimonial:** ${fmtCOP(eq0Total)} (${comparative.period}) → ${fmtCOP(eq1Total)} (${primary.period}) = ${fmtCOP(eq1Total - eq0Total)}`,
    );
    lines.push(
      `**Utilidad del ejercicio ${primary.period}:** ${fmtCOP(ct1.utilidadNeta)} — el cambio neto de patrimonio deberia conciliar con esta utilidad menos dividendos declarados.`,
    );
    lines.push('');
  } else {
    lines.push('**Sin periodo comparativo disponible** — la auditoria se limita al periodo primario.');
    lines.push('');
  }

  // Validation status per period
  lines.push('### Estado de Validacion por Periodo');
  lines.push('');
  for (const p of periods) {
    lines.push(
      `- **${p.period}:** Ecuacion patrimonial ${p.summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'} | ` +
        `Discrepancias: ${p.discrepancies.length} | ` +
        `Cuentas faltantes: ${p.missingExpectedAccounts.length}`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

function fmtCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

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
