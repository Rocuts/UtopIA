// ─── WS5 — Step: health-check ────────────────────────────────────────────────
// Valida que el período está listo para cierre. Consulta:
//   1. Asientos descuadrados (no debería haber por el CHECK constraint, pero
//      se verifica por defensa).
//   2. Diferencias bancarias mayores a la tolerancia (via BankReconciliationPort).
//   3. Documentos OCR pendientes de revisión.
//   4. Asientos draft olvidados.
//
// blocking = true  → el workflow pausa con createHook esperando aprobación.
// blocking = false → el workflow continúa.

import type { CloseMonthInput, HealthCheckResult } from '@/lib/accounting/closing/types';
import type { BankReconciliationPort } from '@/lib/accounting/banking/types';
import { isReconciliationBlocking } from '@/lib/accounting/banking/types';
import {
  getDraftEntriesCount,
  getPendingDocsCount,
  getUnbalancedPostedEntriesCount,
} from '../repository';

export async function runHealthCheck(input: CloseMonthInput): Promise<HealthCheckResult> {
  'use step';

  const { workspaceId, periodId } = input;

  // 1. Asientos descuadrados
  const unbalancedEntries = await getUnbalancedPostedEntriesCount(workspaceId, periodId);

  // 2. Diferencias bancarias — importación dinámica para no romper si WS3 no está activo
  let reconciliationStatuses: import('@/lib/accounting/banking/types').ReconciliationStatus[] = [];
  const bankReconciliationGaps: HealthCheckResult['bankReconciliationGaps'] = [];

  try {
    const bankModule = await import('@/lib/accounting/banking/services/status');
    if (bankModule && typeof bankModule.bankReconciliationPort?.getReconciliationStatus === 'function') {
      const port: BankReconciliationPort = bankModule.bankReconciliationPort;
      reconciliationStatuses = await port.getReconciliationStatus({ workspaceId, periodId });

      for (const status of reconciliationStatuses) {
        if (status.blocking || isReconciliationBlocking(status.differenceCop, status.ledgerBalanceCop)) {
          bankReconciliationGaps.push({
            bankAccountId: status.bankAccountId,
            bankAccountLabel: status.bankAccountLabel,
            differenceCop: status.differenceCop,
            ledgerBalanceCop: status.ledgerBalanceCop,
            bankBalanceCop: status.bankBalanceCop,
          });
        }
      }
    }
  } catch {
    // WS3 no activo o no implementado — se registra como warning, no bloquea
  }

  // 3. Documentos OCR pendientes
  const pendingDocs = await getPendingDocsCount(workspaceId);

  // 4. Asientos draft pendientes de postear
  const draftEntries = await getDraftEntriesCount(workspaceId, periodId);

  // Warnings (no bloquean)
  const warnings: string[] = [];
  if (pendingDocs > 0) {
    warnings.push(`${pendingDocs} documento(s) OCR pendientes de revisión (no bloquea).`);
  }

  // Bloqueo: descuadres, diferencias bancarias, o drafts pendientes
  const blocking =
    unbalancedEntries > 0 ||
    bankReconciliationGaps.length > 0 ||
    draftEntries > 0;

  if (unbalancedEntries > 0) {
    warnings.push(`${unbalancedEntries} asiento(s) con descuadre detectado (BLOQUEA).`);
  }
  if (bankReconciliationGaps.length > 0) {
    warnings.push(`${bankReconciliationGaps.length} cuenta(s) bancaria(s) con diferencia mayor a la tolerancia (BLOQUEA).`);
  }
  if (draftEntries > 0) {
    warnings.push(`${draftEntries} asiento(s) en estado draft sin postear (BLOQUEA).`);
  }

  return {
    unbalancedEntries,
    bankReconciliationGaps,
    pendingDocs,
    draftEntries,
    warnings,
    blocking,
    reconciliationStatuses,
  };
}
