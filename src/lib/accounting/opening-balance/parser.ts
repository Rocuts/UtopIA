// ---------------------------------------------------------------------------
// Opening Balance Importer — file parser (Ola 1.D)
// ---------------------------------------------------------------------------
// Wrapper sobre `src/lib/preprocessing/trial-balance.ts` que adapta su salida
// al shape `OpeningBalanceLine[]` consumido por el pipeline de import.
//
// Soporta:
//   - .csv  (cualquier separador: coma, punto y coma, tab)
//   - .xlsx (via exceljs, mismo patron que /api/upload/route.ts)
//   - .xls  (NO soportado: el formato OLE2 binario requiere parser nativo;
//            se rechaza con un mensaje claro pidiendo "guardar como xlsx")
//
// Filtra automaticamente las cuentas NO transaccionales (Clase, Grupo,
// Cuenta, Subcuenta sin auxiliares debajo) — solo las hojas (`Auxiliar` o
// transaccionales) generan lineas en el asiento. Esto evita doble-conteo
// porque el balance reportado en niveles agregados ya esta incluido en sus
// auxiliares.
// ---------------------------------------------------------------------------

import {
  isDebitNaturePuc,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type RawAccountRow,
} from '@/lib/preprocessing/trial-balance';
import { xlsxRowToCsvLine } from '@/lib/upload/xlsx-csv';
import {
  OpeningBalanceError,
  OPENING_ERR,
  type OpeningBalanceLine,
} from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseFileResult {
  lines: OpeningBalanceLine[];
  /** Razon social inferida (nombre de hoja, primera linea, etc.). */
  companyName?: string;
  /**
   * Mensajes informativos del parser: filas descartadas, formatos raros
   * detectados, ambiguedad de columnas, etc. NO bloquean.
   */
  warnings: string[];
}

/**
 * Detecta el formato del archivo segun extension y delega al parser
 * adecuado. Devuelve siempre `OpeningBalanceLine[]` listo para
 * `importOpeningBalance`.
 */
export async function parseOpeningBalanceFile(
  content: string | Buffer,
  filename: string,
): Promise<ParseFileResult> {
  const ext = extractExtension(filename);

  if (ext === '.csv' || ext === '.txt') {
    const text =
      typeof content === 'string' ? content : content.toString('utf-8');
    return parseCSVContent(stripBOM(text));
  }

  if (ext === '.xlsx') {
    if (!Buffer.isBuffer(content)) {
      throw new OpeningBalanceError(
        OPENING_ERR.PARSE_FAILED,
        'Archivos .xlsx deben llegar como Buffer al parser.',
      );
    }
    return parseXLSXContent(content);
  }

  if (ext === '.xls') {
    throw new OpeningBalanceError(
      OPENING_ERR.PARSE_FAILED,
      'Formato .xls (Excel 97-2003) no soportado. Por favor guarde el archivo ' +
        'como .xlsx (Excel moderno) e intentelo de nuevo.',
    );
  }

  throw new OpeningBalanceError(
    OPENING_ERR.PARSE_FAILED,
    `Extension de archivo no soportada: ${ext}. Use .csv o .xlsx.`,
  );
}

// ---------------------------------------------------------------------------
// CSV path
// ---------------------------------------------------------------------------

function parseCSVContent(csvText: string): ParseFileResult {
  const warnings: string[] = [];

  const rows = parseTrialBalanceCSV(csvText);
  if (rows.length === 0) {
    throw new OpeningBalanceError(
      OPENING_ERR.PARSE_FAILED,
      'No se detectaron filas de balance en el archivo CSV. ' +
        'Verifique que la primera linea contenga encabezados validos ' +
        '(codigo, nombre, saldo o debito/credito).',
    );
  }

  // Usamos preprocessTrialBalance para clasificar niveles (Clase/Grupo/...).
  // Solo nos interesan las hojas (Auxiliar o transaccionales) del periodo
  // mas reciente disponible.
  const preprocessed = preprocessTrialBalance(rows);
  assertNoParseIssues(rows, preprocessed.primary.period);
  const lines = rowsToOpeningLines(rows, preprocessed.primary.period, warnings);

  return { lines, warnings };
}

// ---------------------------------------------------------------------------
// XLSX path — UNA sola hoja (auditoría ingesta-28)
// ---------------------------------------------------------------------------
// Antes se concatenaban las filas de TODAS las hojas: una copia ("Balance" y
// "Balance (2)") o un comparativo sin año en el encabezado duplicaba el
// asiento de apertura sin error, porque cada copia cuadra por sí sola. Ahora
// se usa la PRIMERA hoja con filas de balance reconocibles y se advierte qué
// hojas se ignoraron; si otra hoja repite códigos de la elegida, se avisa
// expresamente que es una copia/comparativo.

async function parseXLSXContent(buffer: Buffer): Promise<ParseFileResult> {
  const warnings: string[] = [];
  let companyName: string | undefined;

  // Dynamic import — exceljs es pesado, solo lo cargamos cuando llega .xlsx.
  // Mismo patron que /api/upload/route.ts.
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();

  try {
    await workbook.xlsx.load(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    );
  } catch (err) {
    throw new OpeningBalanceError(
      OPENING_ERR.PARSE_FAILED,
      'No fue posible abrir el archivo .xlsx. Puede estar corrupto o protegido con clave.',
      err,
    );
  }

  let aggregated: RawAccountRow[] = [];
  let chosenSheet: string | null = null;
  const ignoredSheets: Array<{ name: string; overlapping: number }> = [];

  workbook.eachSheet((worksheet) => {

    const csvRows: string[] = [];
    worksheet.eachRow((row) => {
      // Mismo serializador que /api/upload (ingesta-02): enteros tal cual, no
      // enteros redondeados a centavos (sin ruido IEEE-754 que el parser de
      // texto leería como miles) y escape RFC 4180 también para ';'.
      const csv = xlsxRowToCsvLine(row.values as unknown[], csvRows.length === 0);
      if (csv.replace(/,/g, '').trim().length > 0) csvRows.push(csv);
    });

    if (csvRows.length < 2) return; // Hoja vacia o solo header.

    const csvText = csvRows.join('\n');
    const sheetRows = parseTrialBalanceCSV(csvText);
    if (sheetRows.length === 0) {
      warnings.push(
        `Hoja "${worksheet.name}" no contiene filas validas de balance. Se omitio.`,
      );
      return;
    }
    if (chosenSheet === null) {
      chosenSheet = worksheet.name;
      // Heuristica suave: nombre de la hoja usada como "companyName"
      // tentativo; el frontend puede sobreescribirlo.
      companyName = worksheet.name || undefined;
      aggregated = sheetRows;
      return;
    }
    const chosenCodes = new Set(aggregated.map((r) => r.code));
    const overlapping = sheetRows.filter((r) => chosenCodes.has(r.code)).length;
    ignoredSheets.push({ name: worksheet.name, overlapping });
  });

  for (const ig of ignoredSheets) {
    warnings.push(
      ig.overlapping > 0
        ? `Hoja "${ig.name}" ignorada: repite ${ig.overlapping} código(s) de la hoja "${chosenSheet}" ` +
            `(copia o comparativo). Sólo se importa una hoja para no duplicar saldos.`
        : `Hoja "${ig.name}" ignorada: sólo se importa la primera hoja con balance ("${chosenSheet}"). ` +
            `Si el balance está repartido en varias hojas, consolídelo en una.`,
    );
  }

  if (aggregated.length === 0) {
    throw new OpeningBalanceError(
      OPENING_ERR.PARSE_FAILED,
      'El archivo .xlsx no contiene hojas con balances reconocibles. ' +
        'Verifique que al menos una hoja tenga columnas codigo/nombre/saldo.',
    );
  }

  const preprocessed = preprocessTrialBalance(aggregated);
  assertNoParseIssues(aggregated, preprocessed.primary.period);
  const lines = rowsToOpeningLines(
    aggregated,
    preprocessed.primary.period,
    warnings,
  );

  return { lines, companyName, warnings };
}

// ---------------------------------------------------------------------------
// Adapter: RawAccountRow -> OpeningBalanceLine
// ---------------------------------------------------------------------------

/**
 * Naturaleza PUC por clase y grupo (ingesta-29). La regla vive en el
 * preprocesador para que el parser de balances y este importador usen la
 * misma; se reexporta por compatibilidad con los consumidores existentes.
 */
export { isDebitNaturePuc };

/**
 * Filtra hojas (transactional o level === 'Auxiliar') y enruta el saldo
 * neto al lado correcto segun la naturaleza PUC (`isDebitNaturePuc`):
 *   - Deudoras -> saldo positivo va a debit.
 *   - Acreedoras -> saldo positivo va a credit.
 *
 * Cuando el balance preprocessed ya viene con la convencion "saldo neto
 * positivo = saldo natural" (asi lo emite el preprocessor), basta con
 * routear segun la clase. Si llegara un valor negativo, lo invertimos al
 * lado contrario (significa saldo invertido, ej. cliente con anticipo).
 */
function rowsToOpeningLines(
  rows: RawAccountRow[],
  period: string,
  warnings: string[],
): OpeningBalanceLine[] {
  const out: OpeningBalanceLine[] = [];

  // Construimos un mapa codigo -> children para detectar hojas reales.
  // Una "hoja" es: transactional=true OR level=='Auxiliar' OR no tiene
  // descendientes en el set de transactional/auxiliar.
  const transOrAux = rows.filter(
    (r) => r.transactional || r.level === 'Auxiliar',
  );
  const transCodes = new Set(transOrAux.map((r) => r.code));

  let doubleSidedCount = 0;
  let zeroSkipped = 0;
  let invalidCodeSkipped = 0;

  for (const r of rows) {
    // Solo hojas pasan al asiento.
    const isLeaf =
      r.transactional ||
      r.level === 'Auxiliar' ||
      // Subcuenta sin auxiliares debajo: tambien es hoja.
      (r.level === 'Subcuenta' &&
        ![...transCodes].some(
          (code) => code !== r.code && code.startsWith(r.code),
        ));
    if (!isLeaf) continue;

    // Codigo PUC valido: solo digitos.
    if (!/^\d+$/.test(r.code)) {
      invalidCodeSkipped++;
      continue;
    }

    const balance = r.balancesByPeriod[period] ?? 0;
    if (!Number.isFinite(balance) || Math.abs(balance) < 0.005) {
      zeroSkipped++;
      continue;
    }

    const isDebitNature = isDebitNaturePuc(r.code);

    // El preprocesor entrega un saldo "natural" firmado. Si es positivo,
    // va al lado de la naturaleza. Si es negativo, invertimos el lado
    // (saldo invertido — cliente con saldo acreedor por anticipo, etc.).
    let debit = '0';
    let credit = '0';
    const abs = roundCop(Math.abs(balance));
    if (balance >= 0) {
      if (isDebitNature) debit = abs;
      else credit = abs;
    } else {
      // Saldo invertido: la cuenta esta del "otro lado" de su naturaleza.
      if (isDebitNature) credit = abs;
      else debit = abs;
      doubleSidedCount++;
    }

    out.push({
      accountCode: r.code,
      accountName: r.name || undefined,
      debitBalance: debit,
      creditBalance: credit,
    });
  }

  if (zeroSkipped > 0) {
    warnings.push(
      `Se omitieron ${zeroSkipped} cuentas con saldo cero (no aportan al asiento de apertura).`,
    );
  }
  if (invalidCodeSkipped > 0) {
    warnings.push(
      `Se omitieron ${invalidCodeSkipped} filas con codigos de cuenta no numericos.`,
    );
  }
  if (doubleSidedCount > 0) {
    warnings.push(
      `Se invirtieron ${doubleSidedCount} saldos por estar en sentido contrario a la naturaleza PUC ` +
        `(ej. clientes con anticipo, proveedores con saldo a favor). Verifique en el reporte.`,
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx).toLowerCase();
}

function stripBOM(text: string): string {
  return text.replace(/^﻿/, '');
}

/** Máximo de problemas de lectura citados en el mensaje de error. */
const MAX_PARSE_ISSUES_SHOWN = 10;

/**
 * Los problemas de lectura del parser (celda de saldo ilegible, fila con
 * columnas desplazadas, columnas de saldo ambiguas) bloquean la importación
 * (ingesta-02). Antes se ignoraban: la fila quedaba sin saldo y se omitía
 * como "saldo cero", así que el asiento de apertura perdía la cuenta en
 * silencio.
 */
function assertNoParseIssues(rows: RawAccountRow[], period: string): void {
  const messages = new Set<string>();
  for (const row of rows) {
    for (const issue of row.parseIssues ?? []) {
      if (issue.period === null || issue.period === period) messages.add(issue.message);
    }
  }
  if (messages.size === 0) return;
  const all = [...messages];
  const shown = all.slice(0, MAX_PARSE_ISSUES_SHOWN);
  const rest = all.length - shown.length;
  throw new OpeningBalanceError(
    OPENING_ERR.PARSE_FAILED,
    'El balance tiene valores que no se pudieron leer sin adivinar; corrija el archivo y ' +
      'vuelva a importarlo. ' +
      shown.join(' ') +
      (rest > 0 ? ` … y ${rest} problema(s) de lectura más.` : ''),
    { parseIssues: all },
  );
}

/**
 * Redondea un monto a 2 decimales y devuelve NUMERIC string. La precision
 * de Postgres es NUMERIC(20,2); cualquier centavo extra lo descartamos
 * aqui antes de mandar al double-entry validator.
 */
function roundCop(value: number): string {
  return value.toFixed(2);
}
