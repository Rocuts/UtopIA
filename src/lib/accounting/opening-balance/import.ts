// ---------------------------------------------------------------------------
// Opening Balance Importer — pipeline (Ola 1.D)
// ---------------------------------------------------------------------------
// Convierte un `OpeningBalanceImport` (lineas + metadata) en UN journal
// entry posteado, asegurando que sum(debit) == sum(credit).
//
// Auditoría ingesta-27 / contab-nomina-17: el descuadre BLOQUEA, no se
// absorbe. Antes las líneas con cuenta inexistente o no postable se omitían
// con un warning (mientras no superaran el 30 % de los CÓDIGOS, no del
// valor) y toda la diferencia se cuadraba contra 3705 y se posteaba: una PPE
// de $400M no mapeada terminaba como débito en patrimonio.
//
// Flujo:
//   1. Validar input: al menos una linea con saldo, fecha y periodo.
//   2. Resolver cada accountCode -> accountId via getAccount(workspaceId).
//      Una línea CON SALDO sin cuenta, o con cuenta no postable, bloquea.
//   3. Acumular sumDebit / sumCredit en BigInt-centavos para precision.
//   4. diferencia = sumDebit - sumCredit (en centavos):
//      - |diferencia| ≤ ROUNDING_TOLERANCE_COP → línea de redondeo en 370505.
//      - mayor → UNBALANCED (422) con el detalle; nada se postea.
//   5. Llamar createEntry con sourceType='opening', status='posted'.
//   6. Devolver ImportResult con counters + warnings.
//
// Errores criticos (todos antes de postear):
//   - PUC_MISMATCH: > 30 % de los códigos del archivo no existen.
//   - UNMAPPED_ACCOUNTS: alguna línea con saldo sin cuenta postable.
//   - UNBALANCED: descuadre mayor a la tolerancia de redondeo.
//   - NO_BALANCING_ACCOUNT: hay redondeo y no existe 370505 (ni 3705) postable.
//   - PERIOD_NOT_OPEN: re-emitido del double-entry service.
// ---------------------------------------------------------------------------

import { createEntry } from '@/lib/accounting/double-entry';
import { getAccount } from '@/lib/accounting/chart-of-accounts/queries';
import {
  type JournalLineInput,
  DoubleEntryError,
} from '@/lib/accounting/types';
import {
  OpeningBalanceError,
  OPENING_ERR,
  OPENING_BALANCING_ACCOUNT_CODE,
  OPENING_BALANCING_FALLBACK_CODES,
  PUC_MISMATCH_THRESHOLD,
  ROUNDING_TOLERANCE_COP,
  type ImportResult,
  type OpeningBalanceImport,
} from './types';

// ---------------------------------------------------------------------------
// BigInt constants — `0n` literal no compila bajo target=ES2017. Usamos
// `BigInt(N)` que es soportado universalmente y se inlinea bien por el JIT.
// ---------------------------------------------------------------------------

const BI_0 = BigInt(0);
const BI_100 = BigInt(100);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function importOpeningBalance(
  input: OpeningBalanceImport,
): Promise<ImportResult> {
  // ---------------------------------------------------------------------
  // 1. Validar input basico.
  // ---------------------------------------------------------------------
  if (!input.workspaceId) {
    throw new OpeningBalanceError(
      OPENING_ERR.INVALID_INPUT,
      'workspaceId es requerido.',
    );
  }
  if (!input.periodId) {
    throw new OpeningBalanceError(
      OPENING_ERR.INVALID_INPUT,
      'periodId es requerido.',
    );
  }
  if (!(input.entryDate instanceof Date) || Number.isNaN(input.entryDate.getTime())) {
    throw new OpeningBalanceError(
      OPENING_ERR.INVALID_INPUT,
      'entryDate debe ser una fecha valida.',
    );
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new OpeningBalanceError(
      OPENING_ERR.EMPTY_INPUT,
      'El balance no contiene lineas. No hay nada para importar.',
    );
  }

  const warnings: string[] = [];
  let skippedRows = 0;

  // ---------------------------------------------------------------------
  // 2. Resolver accountId para cada linea + acumular en BigInt centavos.
  // ---------------------------------------------------------------------
  const lines: JournalLineInput[] = [];
  let sumDebitCents = BI_0;
  let sumCreditCents = BI_0;

  // Cache de cuentas: muchos archivos repiten el mismo codigo en varias
  // hojas (multiperiodo). Cacheamos en memoria para ahorrar SELECTs.
  const accountCache = new Map<
    string,
    { id: string; isPostable: boolean } | null
  >();

  let codesAttempted = 0;
  let codesNotFound = 0;
  /** Líneas con saldo que no pueden postearse: bloquean la importación. */
  const unmapped: Array<{
    accountCode: string;
    accountName: string | null;
    reason: 'not_found' | 'not_postable' | 'lookup_error';
    debit: string;
    credit: string;
  }> = [];

  for (const rawLine of input.lines) {
    codesAttempted++;

    const rawDebitCents = numericStringToCents(rawLine.debitBalance);
    const rawCreditCents = numericStringToCents(rawLine.creditBalance);

    // ---------------------------------------------------------------
    // Normalizar a UN solo lado por linea. Calculamos centavos netos.
    // ---------------------------------------------------------------
    let lineDebitCents = BI_0;
    let lineCreditCents = BI_0;

    if (rawDebitCents > BI_0 && rawCreditCents > BI_0) {
      // Doble-saldo (raro, pero lo manejamos): netea al lado mayor.
      if (rawDebitCents > rawCreditCents) {
        lineDebitCents = rawDebitCents - rawCreditCents;
        warnings.push(
          `Linea ${rawLine.accountCode}: saldo doble (debit ${centsToNumericString(rawDebitCents)} y credit ${centsToNumericString(rawCreditCents)}). Se uso neto debit ${centsToNumericString(lineDebitCents)}.`,
        );
      } else if (rawCreditCents > rawDebitCents) {
        lineCreditCents = rawCreditCents - rawDebitCents;
        warnings.push(
          `Linea ${rawLine.accountCode}: saldo doble (debit ${centsToNumericString(rawDebitCents)} y credit ${centsToNumericString(rawCreditCents)}). Se uso neto credit ${centsToNumericString(lineCreditCents)}.`,
        );
      } else {
        warnings.push(
          `Linea ${rawLine.accountCode}: debit y credit iguales (neto cero). Omitida.`,
        );
        skippedRows++;
        continue;
      }
    } else if (rawDebitCents === BI_0 && rawCreditCents === BI_0) {
      // Saldo cero — no aporta al asiento.
      skippedRows++;
      continue;
    } else {
      lineDebitCents = rawDebitCents;
      lineCreditCents = rawCreditCents;
    }

    // ---------------------------------------------------------------
    // Resolver accountId.
    // ---------------------------------------------------------------
    let cached = accountCache.get(rawLine.accountCode);
    if (cached === undefined) {
      try {
        const acc = await getAccount(input.workspaceId, rawLine.accountCode);
        cached = acc
          ? { id: acc.id, isPostable: acc.isPostable }
          : null;
      } catch (err) {
        cached = null;
        warnings.push(
          `Linea ${rawLine.accountCode}: error al consultar plan de cuentas (${err instanceof Error ? err.message : 'desconocido'}).`,
        );
        accountCache.set(rawLine.accountCode, null);
        codesNotFound++;
        unmapped.push({
          accountCode: rawLine.accountCode,
          accountName: rawLine.accountName ?? null,
          reason: 'lookup_error',
          debit: centsToNumericString(lineDebitCents),
          credit: centsToNumericString(lineCreditCents),
        });
        continue;
      }
      accountCache.set(rawLine.accountCode, cached);
    }

    if (!cached) {
      codesNotFound++;
      unmapped.push({
        accountCode: rawLine.accountCode,
        accountName: rawLine.accountName ?? null,
        reason: 'not_found',
        debit: centsToNumericString(lineDebitCents),
        credit: centsToNumericString(lineCreditCents),
      });
      continue;
    }

    if (!cached.isPostable) {
      unmapped.push({
        accountCode: rawLine.accountCode,
        accountName: rawLine.accountName ?? null,
        reason: 'not_postable',
        debit: centsToNumericString(lineDebitCents),
        credit: centsToNumericString(lineCreditCents),
      });
      continue;
    }

    // ---------------------------------------------------------------
    // Acumular y agregar al array de lineas.
    // ---------------------------------------------------------------
    sumDebitCents += lineDebitCents;
    sumCreditCents += lineCreditCents;

    lines.push({
      accountId: cached.id,
      debit: centsToNumericString(lineDebitCents),
      credit: centsToNumericString(lineCreditCents),
      description: rawLine.accountName ?? null,
      // thirdPartyId / costCenterId quedan null en este Ola — Ola 2.X
      // resolvera el documento del tercero a un ID via lookup.
    });
  }

  // ---------------------------------------------------------------------
  // 3. Detectar PUC mismatch critico antes de seguir.
  // ---------------------------------------------------------------------
  if (codesAttempted > 0) {
    const ratio = codesNotFound / codesAttempted;
    if (ratio > PUC_MISMATCH_THRESHOLD) {
      throw new OpeningBalanceError(
        OPENING_ERR.PUC_MISMATCH,
        `${codesNotFound} de ${codesAttempted} cuentas (${(ratio * 100).toFixed(1)}%) ` +
          `del archivo NO existen en el plan de cuentas del workspace. ` +
          `Verifique que el archivo corresponda al PUC seleccionado o ejecute la siembra del PUC primero.`,
        { codesAttempted, codesNotFound, ratio, threshold: PUC_MISMATCH_THRESHOLD },
      );
    }
  }

  if (unmapped.length > 0) {
    // Cualquier línea con saldo que no puede postearse bloquea: cuadrarla
    // contra patrimonio escondería activos/pasivos reales.
    const unmappedValue = unmapped.reduce(
      (acc, u) => acc + numericStringToCents(u.debit) + numericStringToCents(u.credit),
      BI_0,
    );
    throw new OpeningBalanceError(
      OPENING_ERR.UNMAPPED_ACCOUNTS,
      `${unmapped.length} línea(s) con saldo (valor ${centsToNumericString(unmappedValue)}) no tienen ` +
        `una cuenta postable en el plan de cuentas del workspace. Cree o mapee esas cuentas ` +
        `(o registre el saldo en sus auxiliares) antes de importar; no se cuadran contra patrimonio.`,
      { unmapped, unmappedValue: centsToNumericString(unmappedValue), warnings },
    );
  }

  if (lines.length === 0) {
    throw new OpeningBalanceError(
      OPENING_ERR.EMPTY_INPUT,
      'Despues del filtrado no quedo ninguna linea valida para postear el asiento de apertura.',
      { skippedRows, warnings },
    );
  }

  // ---------------------------------------------------------------------
  // 4. Diferencia: sólo el redondeo va a la cuenta balanceadora.
  // ---------------------------------------------------------------------
  const diffCents = sumDebitCents - sumCreditCents;
  if (diffCents !== BI_0) {
    const absDiff = diffCents > BI_0 ? diffCents : -diffCents;
    const absDiffStr = centsToNumericString(absDiff);
    const toleranceCents = numericStringToCents(ROUNDING_TOLERANCE_COP);
    if (absDiff > toleranceCents) {
      throw new OpeningBalanceError(
        OPENING_ERR.UNBALANCED,
        `El balance de apertura no cuadra: débitos ${centsToNumericString(sumDebitCents)} vs ` +
          `créditos ${centsToNumericString(sumCreditCents)} (diferencia ${absDiffStr}). ` +
          `Sólo un redondeo de hasta ${ROUNDING_TOLERANCE_COP} peso(s) se ajusta automáticamente. ` +
          `Verifique que el archivo incluya todas las cuentas y el resultado del ejercicio (3605/3610).`,
        {
          totalDebit: centsToNumericString(sumDebitCents),
          totalCredit: centsToNumericString(sumCreditCents),
          difference: centsToNumericString(diffCents),
          warnings,
        },
      );
    }

    let balancingAccount: { id: string; isPostable: boolean; code: string } | null = null;
    for (const code of [OPENING_BALANCING_ACCOUNT_CODE, ...OPENING_BALANCING_FALLBACK_CODES]) {
      const acc = await getAccount(input.workspaceId, code);
      if (acc && acc.isPostable) {
        balancingAccount = { id: acc.id, isPostable: acc.isPostable, code };
        break;
      }
    }
    if (!balancingAccount) {
      throw new OpeningBalanceError(
        OPENING_ERR.NO_BALANCING_ACCOUNT,
        `Hay una diferencia de redondeo de ${absDiffStr} y no existe una cuenta postable ` +
          `${OPENING_BALANCING_ACCOUNT_CODE} (Utilidades acumuladas) en el plan de cuentas del ` +
          `workspace. Ejecute la siembra del PUC.`,
      );
    }

    if (diffCents > BI_0) {
      // sum(debit) > sum(credit) -> falta credit.
      lines.push({
        accountId: balancingAccount.id,
        debit: '0',
        credit: absDiffStr,
        description: `Redondeo saldos de apertura (${balancingAccount.code})`,
      });
      sumCreditCents += absDiff;
    } else {
      lines.push({
        accountId: balancingAccount.id,
        debit: absDiffStr,
        credit: '0',
        description: `Redondeo saldos de apertura (${balancingAccount.code})`,
      });
      sumDebitCents += absDiff;
    }

    warnings.push(
      `Diferencia de redondeo de ${absDiffStr} registrada en ${balancingAccount.code} ` +
        `(tolerancia ${ROUNDING_TOLERANCE_COP}).`,
    );
  }

  // ---------------------------------------------------------------------
  // 5. Llamar createEntry con status='posted' (asiento de apertura va
  //    directo al libro mayor — no es un draft).
  // ---------------------------------------------------------------------
  let entryWithLines;
  try {
    entryWithLines = await createEntry({
      workspaceId: input.workspaceId,
      periodId: input.periodId,
      entryDate: input.entryDate,
      description: input.description ?? 'Saldos de apertura',
      sourceType: 'opening',
      sourceRef: input.sourceFilename ?? null,
      status: 'posted',
      lines,
      metadata: {
        kind: 'opening_balance',
        companyName: input.companyName ?? null,
        sourceFilename: input.sourceFilename ?? null,
        importedAt: new Date().toISOString(),
        warningsCount: warnings.length,
        skippedRows,
        sourceLineCount: input.lines.length,
      },
    });
  } catch (err) {
    if (err instanceof DoubleEntryError) {
      // Re-emitir errores conocidos como OpeningBalanceError con codigo
      // adecuado para que el route handler los mapee a HTTP correcto.
      if (err.code === 'PERIOD_NOT_OPEN') {
        throw new OpeningBalanceError(
          OPENING_ERR.PERIOD_NOT_OPEN,
          'El periodo destino esta cerrado o bloqueado. Reabra el periodo o seleccione otro.',
          err.details,
        );
      }
      throw new OpeningBalanceError(
        OPENING_ERR.DOWNSTREAM,
        `Error del servicio contable al crear el asiento: ${err.message}`,
        { code: err.code, details: err.details },
      );
    }
    throw err;
  }

  // ---------------------------------------------------------------------
  // 6. Devolver resultado.
  // ---------------------------------------------------------------------
  return {
    entryId: entryWithLines.entry.id,
    entryNumber: entryWithLines.entry.entryNumber,
    totalDebit: entryWithLines.entry.totalDebit,
    totalCredit: entryWithLines.entry.totalCredit,
    linesInserted: entryWithLines.lines.length,
    warnings,
    skippedRows,
  };
}

// ---------------------------------------------------------------------------
// BigInt centavos helpers — preserva precision exacta de NUMERIC(20,2).
// ---------------------------------------------------------------------------

/**
 * Convierte un NUMERIC string ("1234567.89", "1.5", "0", "100") a centavos
 * en BigInt. Acepta hasta 2 decimales; mas decimales se truncan.
 *
 * Throws OpeningBalanceError(INVALID_INPUT) si el string no es parseable.
 */
function numericStringToCents(value: string): bigint {
  if (value === undefined || value === null) return BI_0;
  const trimmed = String(value).trim();
  if (trimmed.length === 0 || trimmed === '0' || trimmed === '0.0' || trimmed === '0.00') {
    return BI_0;
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new OpeningBalanceError(
      OPENING_ERR.INVALID_INPUT,
      `Saldo invalido: "${value}". Debe ser NUMERIC string (ej. "1234.56").`,
    );
  }
  const negative = trimmed.startsWith('-');
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPartRaw = ''] = abs.split('.');
  const fracPart = (fracPartRaw + '00').slice(0, 2); // pad o truncate a 2 decimales
  const cents = BigInt(intPart) * BI_100 + BigInt(fracPart);
  return negative ? -cents : cents;
}

function centsToNumericString(cents: bigint): string {
  const negative = cents < BI_0;
  const abs = negative ? -cents : cents;
  const intPart = abs / BI_100;
  const fracPart = abs % BI_100;
  const fracStr = fracPart.toString().padStart(2, '0');
  return (negative ? '-' : '') + intPart.toString() + '.' + fracStr;
}
