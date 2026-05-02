// PII patterns for Colombian financial/tax context.
//
// Two surfaces:
//   1) Backward-compat one-way redaction:
//        redactPII(text) -> text with [NIT REDACTADO] etc.
//   2) Bidirectional tokenization (preferred for new code):
//        const ctx = createPIIContext();
//        const safe = ctx.tokenize(originalUserText);  // <NIT_001>, <CED_001> ...
//        const llmOutput = await callLLM(safe);
//        const final = ctx.rehydrate(llmOutput);       // restore real values to user
//
// Tokenization is REQUIRED for regulated workflows (Circular SIC 2025 / CONPES 4144 /
// Ley 1581) where the user must see their own real data back, but the LLM provider
// must NEVER see it. One-way redaction loses the values forever.

// ---------------------------------------------------------------------------
// Pattern catalogue
// ---------------------------------------------------------------------------

type PatternKind =
  | 'NIT'
  | 'CED'
  | 'CE'
  | 'PASSPORT'
  | 'CARD'
  | 'CUENTA'
  | 'IBAN'
  | 'RUT'
  | 'EMAIL'
  | 'TEL'
  | 'DOC';

interface PatternDef {
  kind: PatternKind;
  regex: RegExp;
  /** Legacy one-way replacement label. */
  legacyReplacement: string;
}

// Order matters: longer / more specific patterns first.
const PATTERNS: PatternDef[] = [
  // NIT (Número de Identificación Tributaria): 9-10 digits + optional check digit
  { kind: 'NIT', regex: /\bNIT[:\s]*\d{9,10}[-–]?\d?\b/gi, legacyReplacement: '[NIT REDACTADO]' },
  { kind: 'NIT', regex: /\b\d{9,10}[-–]\d{1}\b/g, legacyReplacement: '[NIT REDACTADO]' },

  // RUT (Colombia: same number as NIT but explicitly labeled as RUT)
  { kind: 'RUT', regex: /\bRUT[:\s]*\d{9,10}[-–]?\d?\b/gi, legacyReplacement: '[RUT REDACTADO]' },

  // Cédula de Ciudadanía (CC)
  { kind: 'CED', regex: /\b(?:CC|C\.?\s?C\.?)[:\s]*\d{6,10}\b/gi, legacyReplacement: '[CC REDACTADO]' },

  // Cédula de Extranjería (CE)
  { kind: 'CE', regex: /\b(?:CE|C\.?\s?E\.?)[:\s]*\d{6,7}\b/gi, legacyReplacement: '[CE REDACTADO]' },

  // Passport
  { kind: 'PASSPORT', regex: /\b(?:PA|PP|pasaporte)[:\s]+[A-Z0-9]{6,9}\b/gi, legacyReplacement: '[PASAPORTE REDACTADO]' },

  // Credit / debit card numbers (13-19 digits with optional separators)
  { kind: 'CARD', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/g, legacyReplacement: '[TARJETA REDACTADA]' },

  // IBAN (international, sometimes used by Colombian fintechs / cross-border accounts)
  // CC + 2 digits + up to 30 alphanumeric (4-char groups separated by space allowed).
  { kind: 'IBAN', regex: /\b[A-Z]{2}\d{2}(?:[ \-]?[A-Z0-9]{4}){3,7}[A-Z0-9]{0,4}\b/g, legacyReplacement: '[IBAN REDACTADO]' },

  // Colombian bank account numbers, contextual (Bancolombia, Davivienda, BBVA, etc.)
  // "cuenta de ahorros 12345678901", "cta corriente 1234567890"
  {
    kind: 'CUENTA',
    regex: /\b(?:cuenta|cta\.?|c\/c)[:\s]*(?:de\s+)?(?:ahorros?|corriente|nómina|nomina)?[:\s#]*\d{8,20}\b/gi,
    legacyReplacement: '[CUENTA REDACTADA]',
  },
  // Bare 10-20 digit account hint when bank name precedes
  {
    kind: 'CUENTA',
    regex: /\b(?:bancolombia|davivienda|bbva|bogot[áa]|av\s*villas|colpatria|popular|nequi|daviplata)[:\s#]*\d{8,20}\b/gi,
    legacyReplacement: '[CUENTA REDACTADA]',
  },

  // Email addresses
  { kind: 'EMAIL', regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, legacyReplacement: '[EMAIL REDACTADO]' },

  // Colombian mobile (+57 / 57 / 10 digits starting with 3)
  { kind: 'TEL', regex: /(?:\+?57[-.\s]?)?(?:\(?\d{1,3}\)?[-.\s]?)?\b3\d{9}\b/g, legacyReplacement: '[TELÉFONO REDACTADO]' },
  // Landlines
  { kind: 'TEL', regex: /\b(?:60[1-8]|0[1-8])[-.\s]?\d{7}\b/g, legacyReplacement: '[TELÉFONO REDACTADO]' },

  // Generic ID context catch-all
  {
    kind: 'DOC',
    regex: /\b(?:identificaci[oó]n|documento|c[eé]dula|n[uú]mero)[:\s]*\d{6,10}\b/gi,
    legacyReplacement: '[DOCUMENTO REDACTADO]',
  },
];

// ---------------------------------------------------------------------------
// Bidirectional tokenization
// ---------------------------------------------------------------------------

const TOKEN_OPEN = '<';
const TOKEN_CLOSE = '>';
// Token regex used for rehydration. Must match what `mintToken` produces.
const TOKEN_RE = /<(NIT|CED|CE|PASSPORT|CARD|CUENTA|IBAN|RUT|EMAIL|TEL|DOC)_(\d{3,})>/g;

export interface PIIContext {
  /** token string -> original raw value */
  readonly map: Map<string, string>;
  /** Replace every detected PII span with a unique reversible token. */
  tokenize(text: string): string;
  /** Replace any token previously minted by this context with its real value. */
  rehydrate(text: string): string;
  /** Snapshot useful for debug/logging (no real values exposed). */
  size(): number;
}

export function createPIIContext(): PIIContext {
  const map = new Map<string, string>();
  // value -> token, so identical PII reuses the same token (helps the LLM).
  const inverse = new Map<string, string>();
  const counters: Record<PatternKind, number> = {
    NIT: 0, CED: 0, CE: 0, PASSPORT: 0, CARD: 0, CUENTA: 0,
    IBAN: 0, RUT: 0, EMAIL: 0, TEL: 0, DOC: 0,
  };

  function mintToken(kind: PatternKind, value: string): string {
    const existing = inverse.get(value);
    if (existing) return existing;
    counters[kind] += 1;
    const token = `${TOKEN_OPEN}${kind}_${String(counters[kind]).padStart(3, '0')}${TOKEN_CLOSE}`;
    map.set(token, value);
    inverse.set(value, token);
    return token;
  }

  return {
    map,
    tokenize(text: string): string {
      let out = text;
      for (const { kind, regex } of PATTERNS) {
        // Reset lastIndex between iterations (regexes are global).
        out = out.replace(regex, (match) => mintToken(kind, match));
      }
      return out;
    },
    rehydrate(text: string): string {
      // Replace tokens we minted; ignore any that look like tokens but aren't ours
      // (the LLM might hallucinate <NIT_999>; leaving it as-is is safer than
      // substituting the wrong real value).
      return text.replace(TOKEN_RE, (full) => map.get(full) ?? full);
    },
    size(): number {
      return map.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible one-way API
// ---------------------------------------------------------------------------

/**
 * Legacy one-way redaction. Used by call sites that don't need to show the
 * original PII back to the user (e.g. PDF export sanitization, log scrubbing).
 *
 * For chat/LLM workflows where the user expects to see their own NIT/cédula
 * back in the response, prefer `createPIIContext()` + `tokenize/rehydrate`.
 */
export function redactPII(text: string): string {
  let sanitized = text;
  for (const { regex, legacyReplacement } of PATTERNS) {
    sanitized = sanitized.replace(regex, legacyReplacement);
  }
  return sanitized;
}

/**
 * Wrapper that uses an explicit context. Equivalent to ctx.tokenize(text).
 * Provided for symmetry with `redactPII` so call sites can migrate gradually:
 *   const ctx = createPIIContext();
 *   const safe = redactPIIWithContext(userText, ctx);
 *   // ...call LLM...
 *   const final = ctx.rehydrate(llmOut);
 */
export function redactPIIWithContext(text: string, ctx: PIIContext): string {
  return ctx.tokenize(text);
}

// ---------------------------------------------------------------------------
// NIT context extraction (runs BEFORE tokenization/redaction)
// ---------------------------------------------------------------------------

export interface NITContext {
  lastDigit: number;
  lastTwoDigits: number;
  checkDigit: number | null;
  presumedType: 'persona_juridica' | 'persona_natural';
}

/**
 * Extract NIT metadata from text BEFORE PII redaction.
 * Returns the last digit and taxpayer type without exposing the full NIT to the LLM.
 * Colombian NIT structure: 9-10 digits + optional check digit (e.g., 860001317-4).
 * The "último dígito del NIT" for tax calendars is the LAST digit of the main number (7),
 * NOT the check digit (4).
 */
export function extractNITContext(text: string): NITContext | null {
  // Priority 1: NIT with explicit label and check digit (most reliable)
  const fullMatch = text.match(/\bNIT[:\s]*(\d{9,10})[-–](\d)\b/i);
  if (fullMatch) return buildNITContext(fullMatch[1], fullMatch[2]);

  // Priority 2: NIT with label, no check digit
  const partialMatch = text.match(/\bNIT[:\s]*(\d{9,10})\b/i);
  if (partialMatch) return buildNITContext(partialMatch[1], null);

  // Priority 3: Standalone 9-10 digits + hyphen + check digit (common NIT format)
  const standaloneMatch = text.match(/\b(\d{9,10})[-–](\d)\b/);
  if (standaloneMatch) return buildNITContext(standaloneMatch[1], standaloneMatch[2]);

  return null;
}

function buildNITContext(numberStr: string, checkDigitStr: string | null): NITContext {
  const firstDigit = numberStr[0];
  return {
    lastDigit: parseInt(numberStr[numberStr.length - 1]),
    lastTwoDigits: parseInt(numberStr.slice(-2)),
    checkDigit: checkDigitStr ? parseInt(checkDigitStr) : null,
    // NITs starting with 8 or 9 are typically persona jurídica (empresas)
    presumedType: firstDigit === '8' || firstDigit === '9' ? 'persona_juridica' : 'persona_natural',
  };
}
