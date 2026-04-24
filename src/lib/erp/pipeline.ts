// ---------------------------------------------------------------------------
// ERP Pipeline — bridge ERP data into the financial orchestrator
// ---------------------------------------------------------------------------
// Expone funciones de alto nivel que componen ERPService + la utilidad
// trialBalanceToCSV del connector, produciendo payloads listos para alimentar
// `parseTrialBalanceCSV` del preprocesador. Zero-regression: mismo header CSV
// que el resto del sistema (codigo,cuenta,debitos,creditos,saldo).
// ---------------------------------------------------------------------------

import { BaseERPConnector } from './connector';
import { getConnector } from './registry';
import { ERPService, type ERPServiceConnection } from './service';
import type { PeriodSpec } from './adapter';
import type { ERPTrialBalance, ERPProvider } from './types';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ERPPipelineError extends Error {
  readonly provider: ERPProvider | null;
  readonly warnings: string[];

  constructor(message: string, warnings: string[] = [], provider: ERPProvider | null = null) {
    super(message);
    this.name = 'ERPPipelineError';
    this.warnings = warnings;
    this.provider = provider;
  }
}

// ---------------------------------------------------------------------------
// Serializer — reuses BaseERPConnector.trialBalanceToCSV so el header y filtro
// quedan identicos al contrato del parser del preprocesador.
// ---------------------------------------------------------------------------

async function serializeTrialBalance(
  tb: ERPTrialBalance,
  provider: ERPProvider,
): Promise<string> {
  const connector = await getConnector(provider);
  if (connector instanceof BaseERPConnector) {
    return connector.trialBalanceToCSV(tb);
  }
  // WHY: fallback defensivo en caso de que un provider futuro no herede de
  // BaseERPConnector — replicamos el formato exacto.
  const header = 'codigo,cuenta,debitos,creditos,saldo';
  const rows = tb.accounts
    .filter((a) => a.isAuxiliary)
    .map(
      (a) =>
        `${a.code},${a.name.replace(/,/g, ';')},${a.debit},${a.credit},${a.balance}`,
    );
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pull the trial balance from the primary ERP connection and return it as a
 * CSV string whose header matches `parseTrialBalanceCSV`'s contract exactly:
 *   `codigo,cuenta,debitos,creditos,saldo`
 *
 * Downstream flow: financial orchestrator pipes the CSV into
 * `parseTrialBalanceCSV` → `preprocessTrialBalance`.
 */
export async function pullTrialBalanceForPeriod(
  connections: ERPServiceConnection[],
  period: PeriodSpec,
): Promise<string> {
  if (!connections || connections.length === 0) {
    throw new ERPPipelineError('No hay conexiones ERP configuradas para esta operacion.');
  }

  const service = new ERPService(connections);
  const result = await service.fetchTrialBalance(period);

  if (!result.data || !result.source) {
    const warnings = result.warnings.length > 0
      ? result.warnings
      : ['Ninguna conexion ERP devolvio datos.'];
    throw new ERPPipelineError(
      `No se pudo obtener el balance de prueba desde el ERP: ${warnings.join(' | ')}`,
      warnings,
    );
  }

  const provider = result.source.provider as ERPProvider;
  const csv = await serializeTrialBalance(result.data, provider);

  // WHY: validamos que el CSV tenga al menos una fila ademas del header —
  // si el ERP responde sin auxiliares, el preprocesador no podra calcular
  // nada y es mejor fallar aqui con un mensaje claro.
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new ERPPipelineError(
      `El balance de prueba del ERP (${provider}) no contiene cuentas auxiliares para el periodo solicitado.`,
      result.warnings,
      provider,
    );
  }

  return csv;
}
