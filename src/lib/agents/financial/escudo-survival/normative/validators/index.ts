// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Validators barrel
// ---------------------------------------------------------------------------

export {
  validateCitations,
  extractCitations,
  normalizeCitation,
} from './citation.validator';

export {
  checkBlacklist,
  summarizeBlacklistViolations,
  type BlacklistViolation,
} from './blacklist.validator';

export {
  validateNormativeResponse,
  type NormativeValidationReport,
} from './normative.validator';
