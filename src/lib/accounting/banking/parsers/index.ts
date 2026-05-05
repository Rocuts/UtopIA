// ---------------------------------------------------------------------------
// parsers/index.ts — Parser registry
//
// Given a filename + raw content, returns the appropriate parser.
// Parsers are tried in order; first one that returns canParse=true wins.
//
// Current parsers:
//   csv — generic CSV/TXT parser (UTF-8 + latin-1)
//
// TODO WS3.1 — add OFX parser:
//   import { ofxParser } from './ofx';
//   { name: 'OFX/QFX', parser: ofxParser },
//
// TODO WS3.1 — add MT940 parser (SWIFT format — Banco de Bogotá, Davivienda):
//   import { mt940Parser } from './mt940';
//   { name: 'MT940', parser: mt940Parser },
// ---------------------------------------------------------------------------

import { BankingError, BANK_ERR, type BankStatementParser } from '../types';
import { csvParser } from './csv';

const REGISTRY: Array<{ name: string; parser: BankStatementParser }> = [
  { name: 'CSV/TXT', parser: csvParser },
];

/**
 * Detect and return the appropriate parser for the given file.
 * Throws BANK_ERR.PARSE_FAILED if no parser can handle the file.
 */
export function detectParser(
  filename: string,
  content: string | Buffer,
): BankStatementParser {
  for (const { parser } of REGISTRY) {
    if (parser.canParse(filename, content)) return parser;
  }
  const ext = filename.split('.').pop()?.toLowerCase() ?? '(sin extensión)';
  throw new BankingError(
    BANK_ERR.PARSE_FAILED,
    `Formato no soportado: .${ext}. Formatos aceptados en MVP: CSV. ` +
      `OFX y MT940 están pendientes (WS3.1).`,
  );
}
