// ─── WS1 — Smart-Tax Engine: generador de líneas contables ──────────────────
//
// Recibe las reglas matched + el input y produce:
//   - TaxLineProposal[] (legible para la UI)
//   - JournalLineInput[] (listo para createEntry())
//
// Aritmética en BigInt-centavos para evitar pérdida de precisión IEEE-754.
// Patrón tomado de src/lib/accounting/double-entry/validate.ts.
//
// NOTA IMPORTANTE — IVA_0_EXEMPT:
//   Cuando la regla tiene rate=0 (operación excluida/exenta), NO se emite
//   ninguna JournalLineInput. La regla aparece en TaxLineProposal con
//   taxAmountCop="0.00" para que la UI muestre "Exento/Excluido" pero no
//   contamina el asiento contable.

import type { JournalLineInput } from '@/lib/accounting/types';
import type {
  TaxEvaluationInput,
  TaxLineProposal,
  TaxEvaluationResult,
} from './types';
import type { MatchedRule } from './rules-engine';
import { getAccountByCode } from './repository';

const SCALE = BigInt(100); // centavos

function parseCentavos(raw: string): bigint {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf('.');
  let intPart: string;
  let fracPart: string;
  if (dot < 0) {
    intPart = trimmed;
    fracPart = '';
  } else {
    intPart = trimmed.slice(0, dot) || '0';
    fracPart = trimmed.slice(dot + 1);
  }
  fracPart = fracPart.padEnd(2, '0').slice(0, 2);
  return BigInt(intPart || '0') * SCALE + BigInt(fracPart || '0');
}

function centavosToString(c: bigint): string {
  const neg = c < BigInt(0);
  const abs = neg ? -c : c;
  const intPart = abs / SCALE;
  const fracPart = abs % SCALE;
  return `${neg ? '-' : ''}${intPart}.${fracPart.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Generador principal
// ---------------------------------------------------------------------------

export interface GeneratedLines {
  proposals: TaxLineProposal[];
  journalLines: JournalLineInput[];
  /** CxP / CxC neto (subtotal + IVA – ReteFuente – ICA) */
  totalPayableCentavos: bigint;
  matchedRuleIds: string[];
  warnings: string[];
}

/**
 * Dada la lista de reglas matched y el input, genera las líneas contables.
 * Para cada regla:
 *   - Calcula taxAmount = floor(subtotal_centavos * rate_millionths / 1_000_000).
 *     (Multiplicamos primero y luego dividimos para preservar enteros.)
 *   - Resuelve el accountId en BD por el taxAccountCode de la regla.
 *   - Si taxAmount == 0 (regla exenta o umbral), emite proposal pero NO línea.
 */
export async function generateLines(
  input: TaxEvaluationInput,
  matched: MatchedRule[],
): Promise<GeneratedLines> {
  const subtotalCentavos = parseCentavos(input.subtotalCop);

  const proposals: TaxLineProposal[] = [];
  const journalLines: JournalLineInput[] = [];
  const matchedRuleIds: string[] = [];
  const warnings: string[] = [];

  // El total a pagar parte del subtotal y se ajusta con IVA (suma) y
  // ReteFuente/ICA (resta, porque el comprador retiene antes de pagar).
  let totalPayableCentavos = subtotalCentavos;

  for (const { rule, warnings: ruleWarnings } of matched) {
    warnings.push(...ruleWarnings);
    matchedRuleIds.push(rule.id);

    // rate viene como NUMERIC string "0.190000"
    const rateFloat = parseFloat(rule.rate);
    // Convertimos rate a millonésimas para operar en enteros:
    //   rate=0.19 → 190_000 / 1_000_000
    // Usamos Math.round para evitar drift de floating point en la conversión.
    const rateMillionths = BigInt(Math.round(rateFloat * 1_000_000));

    // taxAmount en centavos (floor — sin redondeo, máximo conservador)
    const taxCentavos = (subtotalCentavos * rateMillionths) / BigInt(1_000_000);
    const taxAmountStr = centavosToString(taxCentavos);

    // accountSide del taxAccountCode
    const side = (rule.accountSide === 'debit' ? 'debit' : 'credit') as
      | 'debit'
      | 'credit';

    // Construir proposal (siempre, incluso para rate=0)
    const proposal: TaxLineProposal = {
      ruleId: rule.id,
      ruleCode: rule.code,
      taxType: rule.taxType,
      baseAmountCop: input.subtotalCop,
      taxAmountCop: taxAmountStr,
      rate: rule.rate,
      side,
      accountCode: rule.taxAccountCode ?? '',
      description: rule.description,
      confidence: 1.0,
      warnings: [...ruleWarnings],
    };

    // Si el tercero no tiene perfil, bajar confianza
    if (ruleWarnings.some((w) => w.includes('sin perfil tributario'))) {
      proposal.confidence = 0.7;
    }

    proposals.push(proposal);

    // Si rate=0 (IVA_0_EXEMPT) — NO emitir línea contable
    if (taxCentavos === BigInt(0)) {
      // Marcamos para la UI pero no contabilizamos
      continue;
    }

    // Resolver accountId del taxAccountCode en el PUC del workspace
    if (!rule.taxAccountCode) {
      warnings.push(
        `Regla ${rule.code}: sin taxAccountCode configurado — línea omitida.`,
      );
      continue;
    }

    const account = await getAccountByCode(
      input.workspaceId,
      rule.taxAccountCode,
    );
    if (!account) {
      warnings.push(
        `Regla ${rule.code}: cuenta ${rule.taxAccountCode} no encontrada en el ` +
          `PUC del workspace — línea omitida. Verifique que el PUC esté sembrado.`,
      );
      // Bajamos confianza en el proposal correspondiente
      proposal.confidence = 0;
      continue;
    }

    if (!account.isPostable) {
      warnings.push(
        `Regla ${rule.code}: cuenta ${rule.taxAccountCode} no es postable ` +
          `(es cabecera). Línea omitida.`,
      );
      proposal.confidence = 0;
      continue;
    }

    // Construir JournalLineInput
    const journalLine: JournalLineInput = {
      accountId: account.id,
      debit: side === 'debit' ? taxAmountStr : '0.00',
      credit: side === 'credit' ? taxAmountStr : '0.00',
      description: rule.description,
      dimensions: {
        taxRuleId: rule.id,
        taxRuleCode: rule.code,
        taxType: rule.taxType,
      },
    };
    journalLines.push(journalLine);

    // Ajustar total pagable:
    //   IVA descontable (comprador lo paga al vendedor): SUMA al pagable
    //   IVA generado (vendedor lo cobra): SUMA al cobrable
    //   ReteFuente practicada (comprador retiene): RESTA al pagable
    //   ICA practicada: RESTA al pagable
    if (rule.taxType === 'IVA') {
      if (side === 'debit') {
        // IVA descontable en compras: el comprador paga subtotal + IVA
        totalPayableCentavos += taxCentavos;
      } else {
        // IVA generado en ventas: vendedor cobra subtotal + IVA
        totalPayableCentavos += taxCentavos;
      }
    } else if (rule.taxType === 'RETEFUENTE' || rule.taxType === 'ICA' || rule.taxType === 'RETEIVA') {
      // Retenciones: reducen el neto a pagar/recibir
      totalPayableCentavos -= taxCentavos;
    }
  }

  return {
    proposals,
    journalLines,
    totalPayableCentavos,
    matchedRuleIds,
    warnings,
  };
}

/**
 * Construye el TaxEvaluationResult final a partir de las líneas generadas.
 */
export function buildResult(
  input: TaxEvaluationInput,
  generated: GeneratedLines,
): TaxEvaluationResult {
  const { proposals, journalLines, totalPayableCentavos, matchedRuleIds, warnings } =
    generated;

  const summary = buildSummary(input, proposals, totalPayableCentavos);

  return {
    proposedLines: proposals,
    journalLines,
    totalPayableCop: centavosToString(totalPayableCentavos),
    matchedRuleIds,
    summary,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(
  input: TaxEvaluationInput,
  proposals: TaxLineProposal[],
  totalPayableCentavos: bigint,
): string {
  if (proposals.length === 0) {
    return `Sin impuestos aplicables para ${input.transactionType} de $${formatCop(input.subtotalCop)}.`;
  }
  const parts = proposals.map(
    (p) =>
      `${p.ruleCode} (${p.taxType}): $${formatCop(p.taxAmountCop)}`,
  );
  return (
    `Transacción $${formatCop(input.subtotalCop)} — ` +
    parts.join(', ') +
    ` — Total neto: $${centavosToString(totalPayableCentavos)}`
  );
}

/** Formatea un string NUMERIC en formato COP legible: "1234567.89" → "1.234.567,89" */
function formatCop(numeric: string): string {
  const [intPart, fracPart] = numeric.split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fracPart ? `${formatted},${fracPart}` : formatted;
}

// Re-exportar tipos usados por index.ts
export type { TaxEvaluationResult };
