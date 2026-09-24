// ---------------------------------------------------------------------------
// Opening Balance Importer — domain types (Ola 1.D)
// ---------------------------------------------------------------------------
// Cliente PYME llega con un balance de prueba de su software anterior
// (ContaPyme, Siigo, Helisa, Excel hecho por su contador). Para "arrancar"
// 1+1 necesitamos convertir ese balance en UN asiento de apertura unico que
// establezca el "punto cero" del libro mayor.
//
// El asiento de apertura sigue el patron canonical del PUC colombiano
// (Decreto 2650/1993):
//   - Una linea por cada cuenta auxiliar con saldo.
//   - Saldos deudores (Activo, Gasto) -> debit.
//   - Saldos acreedores (Pasivo, Patrimonio, Ingreso) -> credit.
//   - El balance importado DEBE cuadrar. Sólo una diferencia de redondeo
//     (≤ ROUNDING_TOLERANCE_COP) se lleva a 370505 (Utilidades acumuladas);
//     un descuadre mayor BLOQUEA la importación (auditoría ingesta-27 /
//     contab-nomina-17: antes toda la diferencia —incluidas cuentas omitidas
//     como una PPE de $400M— se "cuadraba" contra patrimonio y se posteaba).
//   - Cualquier línea con saldo cuya cuenta no exista o no sea postable
//     BLOQUEA la importación (422 con la lista); antes se omitía con un
//     warning mientras no superara el 30 % de los códigos.
//
// Notas:
//   - Montos viajan como NUMERIC strings (no `number`) para no perder
//     precision (mismo contrato que `JournalLineInput` del double-entry).
//   - Una fila puede tener saldo en debit O en credit, NO en ambos. Si la
//     entrada trae ambos lados >0 (raro pero posible en exports de algunos
//     ERPs), `import.ts` calcula un neto y lo enruta al lado correcto.
// ---------------------------------------------------------------------------

/**
 * Una linea cruda del balance, ya parseada/normalizada.
 * Representa UNA cuenta auxiliar con su saldo neto al momento del corte.
 */
export interface OpeningBalanceLine {
  /** Codigo PUC (ej. "11050501"). Sin puntos ni espacios. */
  accountCode: string;
  /** Nombre tal como aparece en el archivo (informativo). */
  accountName?: string;
  /**
   * Saldo deudor en NUMERIC string (ej. "1234567.89"). "0" si no aplica.
   * Nunca debe coexistir con creditBalance > 0; el parser garantiza que
   * solo uno tenga valor positivo por linea.
   */
  debitBalance: string;
  /** Saldo acreedor en NUMERIC string. "0" si no aplica. */
  creditBalance: string;
  /** Documento del tercero asociado (NIT/CC) si la fila lo trae. */
  thirdPartyDocument?: string;
  /** Codigo de centro de costo si la fila lo trae. */
  costCenterCode?: string;
}

/**
 * Payload completo para `importOpeningBalance`. El caller arma esto a partir
 * de un archivo (via `parseOpeningBalanceFile`) o lo construye manualmente
 * desde un wizard frontend que ya parseo localmente.
 */
export interface OpeningBalanceImport {
  /** Workspace dueño del libro mayor. */
  workspaceId: string;
  /** UUID de un periodo abierto donde se posteara el asiento. */
  periodId: string;
  /**
   * Fecha del balance (tipicamente ultimo dia del periodo anterior o
   * primer dia del periodo actual). Debe caer dentro del rango del periodo.
   */
  entryDate: Date;
  /** Descripcion del asiento; default 'Saldos de apertura'. */
  description?: string;
  /** Lineas del balance. Al menos 1 con saldo distinto de cero. */
  lines: OpeningBalanceLine[];
  /** Razon social del cliente (informativo, va a metadata). */
  companyName?: string;
  /** Nombre original del archivo (informativo, va a metadata). */
  sourceFilename?: string;
}

/**
 * Resultado del import. Si `warnings` tiene elementos, el import fue
 * parcial — el caller debe mostrar la lista al usuario.
 */
export interface ImportResult {
  /** UUID del journal entry creado. */
  entryId: string;
  /** Numero secuencial asignado por el service (workspace+periodo). */
  entryNumber: number;
  /** Total debit del asiento (NUMERIC string). */
  totalDebit: string;
  /** Total credit del asiento (NUMERIC string). */
  totalCredit: string;
  /** Lineas efectivamente insertadas en journal_lines. */
  linesInserted: number;
  /**
   * Mensajes informativos: cuentas no encontradas, lineas con saldos
   * netos en cero (skipped), redondeo aplicado a la cuenta balanceadora,
   * etc. NO bloquean el import.
   */
  warnings: string[];
  /**
   * Filas del input que se omitieron (saldo neto cero, codigo invalido,
   * cuenta no postable, etc.). El caller suele mostrarlo como subtotal.
   */
  skippedRows: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error tipado del importer. El route handler mapea `code` a HTTP:
 *   - PARSE_FAILED                -> 400
 *   - INVALID_INPUT               -> 400
 *   - PUC_MISMATCH                -> 422 (mas del threshold de cuentas no encontradas)
 *   - UNMAPPED_ACCOUNTS           -> 422 (lineas con saldo sin cuenta postable)
 *   - UNBALANCED                  -> 422 (descuadre mayor a la tolerancia de redondeo)
 *   - PERIOD_NOT_OPEN             -> 409 (re-emitido desde DoubleEntryError)
 *   - NO_BALANCING_ACCOUNT        -> 422 (no existe 370505/3705 postable)
 *   - EMPTY_INPUT                 -> 400
 *   - DOWNSTREAM (re-wrap)        -> 500
 */
export class OpeningBalanceError extends Error {
  public readonly code: OpeningBalanceErrorCode;
  public readonly details?: unknown;

  constructor(
    code: OpeningBalanceErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'OpeningBalanceError';
    this.code = code;
    this.details = details;
  }
}

export const OPENING_ERR = {
  PARSE_FAILED: 'PARSE_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  EMPTY_INPUT: 'EMPTY_INPUT',
  PUC_MISMATCH: 'PUC_MISMATCH',
  UNMAPPED_ACCOUNTS: 'UNMAPPED_ACCOUNTS',
  UNBALANCED: 'UNBALANCED',
  NO_BALANCING_ACCOUNT: 'NO_BALANCING_ACCOUNT',
  PERIOD_NOT_OPEN: 'PERIOD_NOT_OPEN',
  DOWNSTREAM: 'DOWNSTREAM',
} as const;

export type OpeningBalanceErrorCode =
  (typeof OPENING_ERR)[keyof typeof OPENING_ERR];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cuenta para la diferencia de REDONDEO del asiento de apertura (≤
 * ROUNDING_TOLERANCE_COP). 370505 "Utilidades acumuladas" es la subcuenta
 * postable del PUC sembrado; 3705 (nivel 3) no es postable (contab-nomina-17).
 * Si el workspace tiene un PUC propio donde 3705 sí es postable, se usa como
 * alternativa.
 */
export const OPENING_BALANCING_ACCOUNT_CODE = '370505';
export const OPENING_BALANCING_FALLBACK_CODES = ['3705'] as const;

/**
 * Si mas de este porcentaje de codigos PUC del archivo NO existe en el
 * chart_of_accounts del workspace, abortamos con 422. Se asume que el
 * archivo no corresponde al PUC del cliente.
 */
export const PUC_MISMATCH_THRESHOLD = 0.3;

/**
 * Tolerancia (en pesos absolutos, NUMERIC) de redondeo que puede llevarse a
 * la cuenta balanceadora. Por encima, el descuadre bloquea la importación.
 */
export const ROUNDING_TOLERANCE_COP = '1';
