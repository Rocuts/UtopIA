// ---------------------------------------------------------------------------
// Renderer determinístico JSON-strict -> Markdown legacy
// ---------------------------------------------------------------------------
//
// El NIIF Analyst (y, gradualmente, los demás agentes financieros) producen
// JSON validado por Zod en lugar de Markdown. Los renderers downstream que
// todavía esperan strings Markdown — PDF Élite (`StatementsPages.tsx`),
// Excel export (`excel-export.ts`), validators v1 — consumen las funciones
// de este archivo para mantener compatibilidad durante Fases 1 + 2.
//
// En Fase 3 los renderers se migran a consumir JSON puro y este adapter
// se vuelve opcional. Por ahora es el puente que permite refactorizar los
// prompts sin romper main.
//
// Reglas:
//   - Las cifras se renderizan en PRESENTACIÓN COP colombiana con punto de
//     miles y coma decimal (helper `formatCopFromCents`).
//   - Valores absolutos cuando `isAbsolute === true` (regla NIIF Analyst para
//     Balance y P&G). Cuando false, negativos van entre paréntesis (convención
//     NIIF Markdown).
//   - El renderer es PURO — sin LLM, sin side-effects.
// ---------------------------------------------------------------------------

import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import type { NiifReportJson } from '../contracts/niif-report';
import type { StatementLineJson, StatementNoteJson } from '../contracts/base';
import type { NiifAnalysisResult } from '../types';

// ---------------------------------------------------------------------------
// Bloques internos
// ---------------------------------------------------------------------------

function renderLine(line: StatementLineJson): string {
  const indent = '  '.repeat(line.level);
  const cents = parseMoneyCop(line.amountPrimary);
  const primary = formatCopFromCents(cents, line.isAbsolute);
  const comparative = line.amountComparative !== null
    ? formatCopFromCents(parseMoneyCop(line.amountComparative), line.isAbsolute)
    : '';
  const label = line.account ? `${line.account} — ${line.label}` : line.label;
  // Emphasis para totales y subtotales
  const formattedLabel = line.level >= 3 ? `**${label}**` : label;
  const cols = comparative ? `${primary} | ${comparative}` : primary;
  return `${indent}${formattedLabel} : ${cols}`;
}

function renderLines(lines: readonly StatementLineJson[]): string {
  return lines.map(renderLine).join('\n');
}

function renderNote(note: StatementNoteJson, idx: number): string {
  const ref = note.ref ?? `Nota ${idx + 1}`;
  const norma = note.norma ? ` (${note.norma})` : '';
  return `- **${ref}${norma}** ${note.body}`;
}

function renderNotes(notes: readonly StatementNoteJson[], title = 'Notas'): string {
  if (notes.length === 0) return '';
  return [`\n#### ${title}\n`, ...notes.map((n, i) => renderNote(n, i))].join('\n');
}

// ---------------------------------------------------------------------------
// Renderers por estado financiero
// ---------------------------------------------------------------------------

export function renderBalanceSheet(json: NiifReportJson): string {
  const { balanceSheet: b, company } = json;
  const header = [
    `### Estado de Situación Financiera`,
    `**${company.name}** — NIT ${company.nit}`,
    `Al 31 de diciembre de ${company.fiscalPeriod}${company.comparativePeriod ? ` (comparativo ${company.comparativePeriod})` : ''}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  const totals = [
    '',
    `**TOTAL ACTIVOS** : ${formatCopFromCents(parseMoneyCop(b.totalAssetsPrimary), true)}${b.totalAssetsComparative !== null ? ` | ${formatCopFromCents(parseMoneyCop(b.totalAssetsComparative), true)}` : ''}`,
    `**TOTAL PASIVOS** : ${formatCopFromCents(parseMoneyCop(b.totalLiabilitiesPrimary), true)}${b.totalLiabilitiesComparative !== null ? ` | ${formatCopFromCents(parseMoneyCop(b.totalLiabilitiesComparative), true)}` : ''}`,
    `**TOTAL PATRIMONIO** : ${formatCopFromCents(parseMoneyCop(b.totalEquityPrimary), true)}${b.totalEquityComparative !== null ? ` | ${formatCopFromCents(parseMoneyCop(b.totalEquityComparative), true)}` : ''}`,
  ].join('\n');

  return [
    header,
    '#### ACTIVOS',
    renderLines(b.assets),
    '',
    '#### PASIVOS Y PATRIMONIO',
    renderLines(b.liabilities),
    '',
    renderLines(b.equity),
    totals,
    renderNotes(b.notes),
  ].join('\n');
}

export function renderIncomeStatement(json: NiifReportJson): string {
  const { incomeStatement: p, company } = json;
  const header = [
    `### Estado de Resultados Integral`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${company.fiscalPeriod}${company.comparativePeriod ? ` (comparativo ${company.comparativePeriod})` : ''}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  const totals = [
    '',
    `**UTILIDAD BRUTA** : ${formatCopFromCents(parseMoneyCop(p.grossProfitPrimary), true)}${p.grossProfitComparative !== null ? ` | ${formatCopFromCents(parseMoneyCop(p.grossProfitComparative), true)}` : ''}`,
    `**UTILIDAD OPERATIVA (EBIT)** : ${formatCopFromCents(parseMoneyCop(p.operatingProfitPrimary), true)}${p.operatingProfitComparative !== null ? ` | ${formatCopFromCents(parseMoneyCop(p.operatingProfitComparative), true)}` : ''}`,
    `**UTILIDAD NETA DEL PERÍODO** : ${formatCopFromCents(parseMoneyCop(p.netIncomePrimary), true)}${p.netIncomeComparative !== null ? ` | ${formatCopFromCents(parseMoneyCop(p.netIncomeComparative), true)}` : ''}`,
    `**OTRO RESULTADO INTEGRAL (ORI)** : ${formatCopFromCents(parseMoneyCop(p.oriPrimary), true)}${p.oriComparative !== null ? ` | ${formatCopFromCents(parseMoneyCop(p.oriComparative), true)}` : ''}`,
  ].join('\n');

  return [header, renderLines(p.lines), totals, renderNotes(p.notes)].join('\n');
}

export function renderCashFlowStatement(json: NiifReportJson): string {
  const { cashFlow: cf, company } = json;
  const sectionTitle: Record<typeof cf.sections[number]['section'], string> = {
    operating: 'ACTIVIDADES DE OPERACIÓN',
    investing: 'ACTIVIDADES DE INVERSIÓN',
    financing: 'ACTIVIDADES DE FINANCIAMIENTO',
  };

  const header = [
    `### Estado de Flujos de Efectivo (Método Indirecto — NIC 7 / Sec. 7 PYMES)`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${company.fiscalPeriod}`,
    `(Cifras en pesos colombianos)`,
    '',
  ].join('\n');

  const sections = cf.sections
    .map((s) => {
      const net = formatCopFromCents(parseMoneyCop(s.netFlow), false);
      return [
        `#### ${sectionTitle[s.section]}`,
        renderLines(s.lines),
        `**FLUJO NETO ${sectionTitle[s.section]}** : ${net}`,
      ].join('\n');
    })
    .join('\n\n');

  const closure = [
    '',
    `**AUMENTO (DISMINUCIÓN) NETO EN EFECTIVO** : ${formatCopFromCents(parseMoneyCop(cf.netChange), false)}`,
    `Efectivo al inicio del período : ${formatCopFromCents(parseMoneyCop(cf.cashOpening), true)}`,
    `**EFECTIVO AL FINAL DEL PERÍODO** : ${formatCopFromCents(parseMoneyCop(cf.cashClosing), true)}`,
  ].join('\n');

  return [header, sections, closure].join('\n');
}

export function renderEquityChanges(json: NiifReportJson): string {
  const { equityChanges: ec, company } = json;
  const header = [
    `### Estado de Cambios en el Patrimonio`,
    `**${company.name}** — NIT ${company.nit}`,
    `Por el año terminado el 31 de diciembre de ${company.fiscalPeriod}`,
    `(Cifras en pesos colombianos)`,
    '',
    `| Movimiento | Capital | Prima | Reserva Legal | Otras Reservas | Result. Acumulados | Result. Ejercicio | ORI | TOTAL |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|`,
  ].join('\n');

  const rows = ec.rows
    .map((r) => {
      const cells = [
        r.label,
        formatCopFromCents(parseMoneyCop(r.capitalSocial), true),
        formatCopFromCents(parseMoneyCop(r.primaColocacion), true),
        formatCopFromCents(parseMoneyCop(r.reservaLegal), true),
        formatCopFromCents(parseMoneyCop(r.otrasReservas), true),
        formatCopFromCents(parseMoneyCop(r.resultadosAcumulados), true),
        formatCopFromCents(parseMoneyCop(r.resultadoEjercicio), true),
        formatCopFromCents(parseMoneyCop(r.ori), true),
        formatCopFromCents(parseMoneyCop(r.total), true),
      ];
      const bold = r.kind === 'opening_balance' || r.kind === 'closing_balance';
      return bold
        ? `| **${cells[0]}** | ${cells.slice(1).map((c) => `**${c}**`).join(' | ')} |`
        : `| ${cells.join(' | ')} |`;
    })
    .join('\n');

  return [header, rows, renderNotes(ec.notes)].join('\n');
}

export function renderTechnicalNotes(json: NiifReportJson): string {
  if (json.technicalNotes.length === 0) return '### Notas Técnicas\n\n_Sin observaciones técnicas._';
  return [`### Notas Técnicas`, '', ...json.technicalNotes.map((n, i) => renderNote(n, i))].join('\n');
}

// ---------------------------------------------------------------------------
// Adapter principal: NiifReportJson -> NiifAnalysisResult legacy
// ---------------------------------------------------------------------------

/**
 * Convierte el JSON estricto del NIIF Analyst al `NiifAnalysisResult` legacy
 * que consumen Strategy Director, Governance Specialist, PDF Élite y Excel
 * mientras se completan las Fases 2 y 3. Adapter puro.
 */
export function toNiifAnalysisResult(json: NiifReportJson): NiifAnalysisResult {
  const balanceSheet = renderBalanceSheet(json);
  const incomeStatement = renderIncomeStatement(json);
  const cashFlowStatement = renderCashFlowStatement(json);
  const equityChangesStatement = renderEquityChanges(json);
  const technicalNotes = renderTechnicalNotes(json);
  const fullContent = [
    balanceSheet,
    '',
    incomeStatement,
    '',
    cashFlowStatement,
    '',
    equityChangesStatement,
    '',
    technicalNotes,
  ].join('\n');
  return {
    balanceSheet,
    incomeStatement,
    cashFlowStatement,
    equityChangesStatement,
    technicalNotes,
    fullContent,
    // Exposición del JSON estricto para los consumers post-Fase-3 (PDF Élite,
    // Excel, validators). Los consumers legacy ignoran este campo.
    json,
  };
}
