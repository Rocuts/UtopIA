// ---------------------------------------------------------------------------
// parsers/index.ts — Parser registry
//
// Given a filename + raw content, returns the appropriate parser.
// Parsers are tried in order; first one that returns canParse=true wins.
//
// Current parsers (orden de detección — los formatos con firma fuerte van
// primero para que un .txt con contenido OFX/SWIFT no caiga al CSV genérico):
//   ofx   — OFX 1.x SGML / 2.x XML (.ofx/.qfx o sniff OFXHEADER/<OFX>)
//   mt940 — SWIFT MT940 (.sta/.mt940/.940 o sniff :20: + :61:) —
//           Banco de Bogotá, Davivienda
//   csv   — generic CSV/TXT parser (UTF-8 + latin-1)
// ---------------------------------------------------------------------------

import { BankingError, BANK_ERR, type BankStatementParser } from '../types';
import { csvParser } from './csv';
import { ofxParser } from './ofx';
import { mt940Parser } from './mt940';

const REGISTRY: Array<{ name: string; parser: BankStatementParser }> = [
  { name: 'OFX/QFX', parser: ofxParser },
  { name: 'MT940', parser: mt940Parser },
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
    `Formato no soportado: .${ext}. Formatos aceptados: CSV/TXT, OFX/QFX y MT940.`,
  );
}
