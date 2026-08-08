// ---------------------------------------------------------------------------
// parsers/ofx.ts — OFX / QFX bank statement parser (WS3.1)
//
// Soporta OFX 1.x (SGML — tags sin cerrar, el formato que exportan la mayoría
// de bancos) y OFX 2.x (XML). Extrae los bloques <STMTTRN> con:
//   DTPOSTED  → postedAt   (YYYYMMDD[HHMMSS][.mmm][zona] — solo se usa la fecha)
//   TRNAMT    → amountCop  (firmado; OFX usa '.' o ',' decimal según banco)
//   NAME/MEMO → description
//   FITID     → externalId (dedupe natural del banco)
//   CHECKNUM/REFNUM → reference
// Statement-level: ACCTID, ORG, DTSTART/DTEND, LEDGERBAL.
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
import { parseMoneyAmount } from './number';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toText(content: string | Buffer): string {
  if (typeof content === 'string') return content;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return new TextDecoder('latin1').decode(content);
  }
}

/**
 * Valor de un tag OFX dentro de un bloque. SGML no cierra tags: el valor
 * corre hasta el siguiente '<' o fin de línea. En XML el cierre </TAG>
 * también corta por el mismo '<'.
 */
function tagValue(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i');
  const m = block.match(re);
  const v = m?.[1]?.trim();
  return v ? v : undefined;
}

/** `YYYYMMDD[...]` → Date UTC (solo componente fecha). */
function parseOfxDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * TRNAMT → number. El estándar OFX exige punto decimal y prohíbe separador de
 * miles, pero los exportadores locales incumplen ambas cosas: se ven
 * `-1.234.567,89` (ES-CO) y `1,234,567.89` (EN-US) en archivos reales.
 *
 * La implementación anterior hacía `replace(',', '.')` (solo la PRIMERA coma) y
 * luego borraba el resto de caracteres no numéricos: `1.234.567,89` quedaba
 * como `1.234.567.89` → NaN → movimiento descartado; y `1,234,567.89` quedaba
 * como `1.234567.89` → NaN. Delegamos en el parser canónico compartido con el
 * CSV para que los tres formatos den el mismo número.
 */
function parseOfxAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  return parseMoneyAmount(raw) ?? undefined;
}

// ── Parser ───────────────────────────────────────────────────────────────────

export const ofxParser: BankStatementParser = {
  canParse(filename, content) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'ofx' || ext === 'qfx') return true;
    // Sniff: header SGML "OFXHEADER:" o XML "<OFX>" en los primeros bytes.
    const head = toText(content).slice(0, 512).toUpperCase();
    return head.includes('OFXHEADER') || head.includes('<OFX>');
  },

  async parse(filename, content) {
    const text = toText(content);
    const warnings: string[] = [];

    const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi) ?? [];
    if (blocks.length === 0) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        `OFX sin bloques <STMTTRN>: ${filename} no contiene movimientos legibles.`,
      );
    }

    const transactions: ParsedBankTransaction[] = [];
    for (const [i, block] of blocks.entries()) {
      const postedAt = parseOfxDate(tagValue(block, 'DTPOSTED'));
      const amount = parseOfxAmount(tagValue(block, 'TRNAMT'));
      if (!postedAt || amount === undefined) {
        warnings.push(
          `Movimiento ${i + 1} omitido: DTPOSTED o TRNAMT ilegible.`,
        );
        continue;
      }
      const name = tagValue(block, 'NAME');
      const memo = tagValue(block, 'MEMO');
      transactions.push({
        postedAt,
        description: [name, memo].filter(Boolean).join(' — ') || '(sin descripción)',
        amountCop: amount.toFixed(2),
        reference: tagValue(block, 'CHECKNUM') ?? tagValue(block, 'REFNUM'),
        externalId: tagValue(block, 'FITID'),
        rawPayload: { trntype: tagValue(block, 'TRNTYPE') ?? null },
      });
    }

    if (transactions.length === 0) {
      throw new BankingError(
        BANK_ERR.PARSE_FAILED,
        `OFX sin movimientos válidos en ${filename} (${warnings.length} bloques ilegibles).`,
      );
    }

    const ledgerBlock = text.match(/<LEDGERBAL>[\s\S]*?(?:<\/LEDGERBAL>|$)/i)?.[0];

    return {
      bankName: tagValue(text, 'ORG'),
      accountNumber: tagValue(text, 'ACCTID'),
      periodStart: parseOfxDate(tagValue(text, 'DTSTART')),
      periodEnd: parseOfxDate(tagValue(text, 'DTEND')),
      endingBalance: ledgerBlock
        ? parseOfxAmount(tagValue(ledgerBlock, 'BALAMT'))?.toFixed(2)
        : undefined,
      transactions,
      warnings,
    };
  },
};
