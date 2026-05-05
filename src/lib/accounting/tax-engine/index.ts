// ─── WS1 — Smart-Tax Engine: punto de entrada público ───────────────────────
//
// Implementa TaxEnginePort (contrato en ./types.ts).
// Expone también el validador de integridad.
//
// Uso desde WS2 (OCR Bridge) y la ruta preview:
//   import { taxEngine } from '@/lib/accounting/tax-engine';
//   const result = await taxEngine.evaluate(input);

import { matchRules } from './rules-engine';
import { generateLines, buildResult } from './line-generator';
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

    // 1. Evaluar reglas
    const matched = await matchRules(input);

    // 2. Generar líneas
    const generated = await generateLines(input, matched);

    // 3. Construir resultado
    const result = buildResult(input, generated);

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
