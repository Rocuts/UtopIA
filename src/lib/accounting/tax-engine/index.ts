// ─── WS1 — Smart-Tax Engine: punto de entrada público ───────────────────────
//
// Implementa TaxEnginePort (contrato en ./types.ts).
// Expone también el validador de integridad.
//
// Uso desde WS2 (OCR Bridge) y la ruta preview:
//   import { taxEngine } from '@/lib/accounting/tax-engine';
//   const result = await taxEngine.evaluate(input);

import { matchRules } from './rules-engine';
import { generateLines, buildResult, parseCentavos, centavosToString } from './line-generator';
import { validateLines as validateLinesImpl } from './integrity-validator';
import { recordAudit } from './repository';
import type {
  TaxEnginePort,
  TaxEvaluationInput,
  TaxEvaluationResult,
  IntegrityValidationResult,
  TaxTransactionType,
} from './types';
import { TaxEngineError, TAX_ERR } from './types';
import type { JournalLineInput } from '@/lib/accounting/types';

// ---------------------------------------------------------------------------
// Implementación del Port
// ---------------------------------------------------------------------------

class TaxEngine implements TaxEnginePort {
  /**
   * Evalúa la transacción y devuelve propuestas de líneas + journalLines.
   * Persiste en tax_engine_audits (best-effort, no bloquea si falla).
   */
  async evaluate(input: TaxEvaluationInput): Promise<TaxEvaluationResult> {
    // Validación mínima del input
    if (!input.workspaceId) {
      throw new TaxEngineError(
        TAX_ERR.INVALID_INPUT,
        'workspaceId es requerido',
      );
    }
    if (!input.subtotalCop || isNaN(parseFloat(input.subtotalCop))) {
      throw new TaxEngineError(
        TAX_ERR.INVALID_INPUT,
        'subtotalCop debe ser un string numérico válido',
        { received: input.subtotalCop },
      );
    }
    if (parseFloat(input.subtotalCop) < 0) {
      throw new TaxEngineError(
        TAX_ERR.INVALID_INPUT,
        'subtotalCop no puede ser negativo',
      );
    }

    // 0. Si el valor viene con IVA incluido, obtener la base gravable
    //    (Art. 447 E.T.) antes de evaluar umbrales y tarifas.
    const { input: evalInput, warnings: baseWarnings } = await resolveTaxBase(input);

    // 1. Evaluar reglas
    const matched = await matchRules(evalInput);

    // 2. Generar líneas
    const generated = await generateLines(evalInput, matched);

    // 3. Construir resultado
    const result = buildResult(evalInput, generated);
    if (baseWarnings.length > 0) result.warnings.unshift(...baseWarnings);

    // 4. Persistir audit log (best-effort)
    recordAudit({
      workspaceId: input.workspaceId,
      matchedRuleIds: result.matchedRuleIds,
      inputContext: input,
      proposedLines: result.journalLines,
    }).catch((err) => {
      // No bloquear al caller si el audit log falla
      console.error('[tax-engine] audit log failed:', err);
    });

    return result;
  }

  /**
   * Valida integridad de líneas contables ya construidas.
   */
  async validateLines(input: {
    workspaceId: string;
    lines: JournalLineInput[];
    transactionType: TaxTransactionType;
  }): Promise<IntegrityValidationResult> {
    if (!input.workspaceId) {
      throw new TaxEngineError(
        TAX_ERR.INVALID_INPUT,
        'workspaceId es requerido para validar líneas',
      );
    }
    return validateLinesImpl(input);
  }
}

/**
 * `amountIncludesTax` — el caller envía el valor TOTAL con IVA incluido.
 * La base gravable del IVA es el valor de la operación sin el impuesto
 * (Art. 447 E.T.), y sobre esa base se comparan los umbrales en UVT y se
 * liquidan las retenciones. Se hace en dos pasadas: la primera sólo determina
 * la tarifa de IVA aplicable (las reglas de IVA no dependen del monto); la
 * segunda evalúa todo sobre base = total / (1 + tarifa), redondeada al centavo.
 *
 * Si la tarifa de IVA no es determinable (reglas en conflicto o que exigen
 * revisión), se rechaza: descontar una tarifa elegida al azar produciría una
 * base y un descontable equivocados.
 */
async function resolveTaxBase(
  input: TaxEvaluationInput,
): Promise<{ input: TaxEvaluationInput; warnings: string[] }> {
  if (!input.amountIncludesTax) return { input, warnings: [] };

  const probe = await matchRules({ ...input, amountIncludesTax: false });
  const iva = probe.filter((m) => m.rule.taxType === 'IVA');
  if (iva.some((m) => m.ambiguous || m.manualReview)) {
    throw new TaxEngineError(
      TAX_ERR.INVALID_INPUT,
      'No se puede descontar el IVA incluido: la tarifa de IVA aplicable es ambigua. ' +
        'Declare el tratamiento en `taxTreatments` o envíe la base sin IVA.',
    );
  }
  const rates = Array.from(
    new Set(iva.map((m) => Math.round(parseFloat(m.rule.rate) * 1_000_000))),
  );
  if (rates.length > 1) {
    throw new TaxEngineError(
      TAX_ERR.INVALID_INPUT,
      'No se puede descontar el IVA incluido: aplican varias tarifas de IVA a la vez.',
      { rates },
    );
  }

  const rateMillionths = BigInt(rates[0] ?? 0);
  const gross = parseCentavos(input.subtotalCop);
  const million = BigInt(1_000_000);
  const denom = million + rateMillionths;
  // base = gross / (1 + tarifa), redondeo half-up al centavo.
  const baseCentavos = (gross * million * BigInt(2) + denom) / (BigInt(2) * denom);
  const base = centavosToString(baseCentavos);
  const tarifa = Number(rateMillionths) / 10_000;

  return {
    input: { ...input, subtotalCop: base, amountIncludesTax: false },
    warnings: [
      `El valor recibido ($${centavosToString(gross)}) incluía IVA: base gravable = ` +
        `total / (1 + ${tarifa}%) = $${base} (Art. 447 E.T.). Umbrales y retenciones ` +
        'se liquidan sobre esa base.',
    ],
  };
}

// Singleton — reutilizar entre requests en Fluid Compute
export const taxEngine: TaxEnginePort = new TaxEngine();

// ---------------------------------------------------------------------------
// Convenience top-level functions — para consumidores que hacen import
// dinámico y comprueban `typeof mod.evaluate === 'function'` (WS2 bridge).
// Delegan al singleton sin duplicar lógica.
// ---------------------------------------------------------------------------

export async function evaluate(
  input: TaxEvaluationInput,
): Promise<TaxEvaluationResult> {
  return taxEngine.evaluate(input);
}

// Re-exports convenientes
export type {
  TaxEvaluationInput,
  TaxEvaluationResult,
  TaxLineProposal,
  IntegrityValidationResult,
  IntegrityViolation,
  TaxEnginePort,
  TaxTransactionType,
  TaxRegimeKind,
  TaxRuleRow,
  ThirdPartyTaxProfileRow,
} from './types';
export { TaxEngineError, TAX_ERR, isTaxEngineEnabled } from './types';
