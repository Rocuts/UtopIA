// ---------------------------------------------------------------------------
// parsers/mt940.ts — SWIFT MT940 bank statement parser (WS3.1)
//
// Formato de extracto SWIFT usado por Banco de Bogotá y Davivienda (y banca
// corporativa en general). Campos relevantes:
//   :25:   cuenta            → accountNumber
//   :60F:  saldo de apertura → startingBalance  (C/D + YYMMDD + moneda + monto)
//   :61:   línea de movimiento:
//            YYMMDD[MMDD] (valor[+entrada]) + marca D/C/RD/RC + monto con
//            coma decimal + tipo (N|F + 3 chars) + referencia (//ref banco)
//   :86:   descripción del movimiento anterior (multilínea hasta el próximo :tag:)
//   :62F:  saldo de cierre   → endingBalance
//
// Signo: C (crédito) = abono al cliente (positivo); D (débito) = cargo
// (negativo); RC/RD son reversos y INVIERTEN el signo de su base.
//
// Convención del módulo: amountCop = toFixed(2), positivo = abono al cliente.
// Implements: BankStatementParser
// ---------------------------------------------------------------------------

import type {
  BankStatementParser,
  ParsedBankTransaction,
  ParsedStatement,
} from '../types';
import { BankingError, BANK_ERR } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toText(content: string | Buffer): string {
  if (typeof content === 'string') return content;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return new TextDecoder('latin1').decode(content);
  }
}

/** YYMMDD → Date UTC. Pivote de siglo SWIFT: 00-79 ⇒ 2000s, 80-99 ⇒ 1900s. */
function parseSwiftDate(yymmdd: string): Date | undefined {
  const m = yymmdd.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const yy = Number(m[1]);
  const year = yy <= 79 ? 2000 + yy : 1900 + yy;
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Monto SWIFT con coma decimal ("1234,56") → number positivo. */
function parseSwiftAmount(raw: string): number | undefined {
  const n = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Aplica la marca D/C/RD/RC al monto: positivo = abono al cliente. */
function signedAmount(mark: string, amount: number): number {
  switch (mark.toUpperCase()) {
    case 'C':
      return amount; // crédito → abono
    case 'D':
      return -amount; // débito → cargo
    case 'RC':
      return -amount; // reverso de crédito → neto cargo
    case 'RD':
      return amount; // reverso de débito → neto abono
    default:
      return amount;
  }
}

interface SwiftField {
  tag: string;
  value: string;
}

/**
 * Tokeniza el mensaje en campos :TAG:valor. El valor corre (multilínea)
 * hasta el próximo `:TAG:` al inicio de línea o el terminador `-`.
 */
function tokenizeFields(text: string): SwiftField[] {
  const fields: SwiftField[] = [];
  const re = /^:(\d{2}[A-Z]?):/gm;
  const matches = [...text.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    fields.push({
      tag: matches[i][1],
      value: text
        .slice(start, end)
        .replace(/\r?\n-\s*$/, '') // terminador de mensaje
        .trim(),
    });
  }
  return fields;
}

/** :60F:/:62F: → `C|D` + YYMMDD + ISO-moneda + monto. Devuelve saldo firmado. */
function parseBalanceField(value: string): number | undefined {
  const m = value.match(/^([CD])(\d{6})[A-Z]{3}([\d,.]+)/i);
  if (!m) return undefined;
  const amount = parseSwiftAmount(m[3]);
  if (amount === undefined) return undefined;
  return m[1].toUpperCase() === 'D' ? -amount : amount;
}

// :61: línea de movimiento — grupos: fecha valor, fecha entrada (opcional),
// marca D/C/RD/RC, código de moneda opcional (3.ª letra), monto, tipo+ref.
// Sin flag `s` (target pre-es2018): el caller ya colapsa los saltos de línea
// del valor antes de hacer match. El tail (tipo de transacción + referencias)
// se parsea aparte en parseLine61Tail — un grupo regex opcional de 4 chars
// para el tipo se comía "NONR" del placeholder estándar NONREF cuando el
// banco omite el código de tipo, dejando "EF" como referencia fragmento.
const LINE_61 = /^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,.]+)([\s\S]*)$/;

interface Line61Tail {
  txType: string | null;
  customerRef: string | undefined;
  bankRef: string | undefined;
}

/**
 * Separa el tail de :61: en tipo de transacción (N|F + 3 alfanum, mandatorio
 * según SWIFT pero omitido por extractos abreviados), referencia de cliente
 * y referencia de banco (tras `//`).
 *
 * Desambiguación: "NONREF" arranca con N + 3 alfanum, así que un consumo
 * ciego de 4 chars lo partiría en "NONR" + "EF". Si el tail empieza
 * exactamente con el placeholder NONREF, NO hay código de tipo.
 */
function parseLine61Tail(tail: string): Line61Tail {
  let rest = tail.trim();
  let txType: string | null = null;

  if (!rest.startsWith('NONREF') && /^[NF][A-Z0-9]{3}/.test(rest)) {
    txType = rest.slice(0, 4);
    rest = rest.slice(4);
  }

  const [customerPart, bankPart] = rest.split('//');
  const customerRef = customerPart?.trim() || undefined;
  const bankRef = bankPart?.trim() || undefined;
  return { txType, customerRef, bankRef };
}

// ── Parser ───────────────────────────────────────────────────────────────────

export const mt940Parser: BankStatementParser = {
  canParse(filename, content) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'sta' || ext === 'mt940' || ext === '940') return true;
    // Sniff: presencia de los tags obligatorios :20: y :61: al inicio de línea.
    const head = toText(content).slice(0, 2048);
    return /^:20:/m.test(head) && /^:61:/m.test(head);
  },

  async parse(filename, content) {
    const text = toText(content);
    const fields = tokenizeFields(text);
    if (fields.length === 0) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        `MT940 sin campos :TAG: legibles en ${filename}.`,
      );
    }

    const warnings: string[] = [];
    const transactions: ParsedBankTransaction[] = [];
    let accountNumber: string | undefined;
    let startingBalance: string | undefined;
    let endingBalance: string | undefined;
    let firstDate: Date | undefined;
    let lastDate: Date | undefined;
    let pendingTx: ParsedBankTransaction | null = null;

    const flush = () => {
      if (pendingTx) {
        transactions.push(pendingTx);
        pendingTx = null;
      }
    };

    for (const field of fields) {
      switch (field.tag) {
        case '25':
          accountNumber = field.value.split('\n')[0]?.trim();
          break;
        case '60F':
        case '60M': {
          const bal = parseBalanceField(field.value);
          if (bal !== undefined && startingBalance === undefined) {
            startingBalance = bal.toFixed(2);
          }
          break;
        }
        case '62F':
        case '62M': {
          const bal = parseBalanceField(field.value);
          if (bal !== undefined) endingBalance = bal.toFixed(2);
          break;
        }
        case '61': {
          flush();
          const m = field.value.replace(/\r?\n/g, '').match(LINE_61);
          if (!m) {
            warnings.push(`Línea :61: ilegible omitida: "${field.value.slice(0, 60)}"`);
            break;
          }
          const valueDate = parseSwiftDate(m[1]);
          const amount = parseSwiftAmount(m[5]);
          if (!valueDate || amount === undefined) {
            warnings.push(`Línea :61: con fecha/monto inválido omitida.`);
            break;
          }
          // Fecha de entrada MMDD hereda el año de la fecha valor.
          let postedAt = valueDate;
          if (m[2]) {
            const entry = new Date(
              Date.UTC(valueDate.getUTCFullYear(), Number(m[2].slice(0, 2)) - 1, Number(m[2].slice(2))),
            );
            if (!Number.isNaN(entry.getTime())) postedAt = entry;
          }
          const { txType, customerRef, bankRef } = parseLine61Tail(m[6] ?? '');
          pendingTx = {
            postedAt,
            valueDate,
            description: '(sin descripción)',
            amountCop: signedAmount(m[3], amount).toFixed(2),
            reference: customerRef && customerRef !== 'NONREF' ? customerRef : bankRef,
            externalId: bankRef,
            rawPayload: { mark: m[3], txType },
          };
          if (!firstDate || postedAt < firstDate) firstDate = postedAt;
          if (!lastDate || postedAt > lastDate) lastDate = postedAt;
          break;
        }
        case '86':
          // Descripción del :61: inmediatamente anterior.
          if (pendingTx) {
            pendingTx.description =
              field.value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim() ||
              '(sin descripción)';
          }
          break;
        default:
          break;
      }
    }
    flush();

    if (transactions.length === 0) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        `MT940 sin movimientos :61: válidos en ${filename}.`,
      );
    }

    return {
      accountNumber,
      periodStart: firstDate,
      periodEnd: lastDate,
      startingBalance,
      endingBalance,
      transactions,
      warnings,
    };
  },
};
