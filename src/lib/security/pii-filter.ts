// PII patterns for Colombian financial/tax context

const PII_PATTERNS: { regex: RegExp; replacement: string }[] = [
  // NIT (Número de Identificación Tributaria): 9-10 digits + optional check digit
  // Matches: 900123456-1, NIT 900123456, NIT: 9001234561
  { regex: /\bNIT[:\s]*\d{9,10}[-–]?\d?\b/gi, replacement: '[NIT REDACTADO]' },
  { regex: /\b\d{9,10}[-–]\d{1}\b/g, replacement: '[NIT REDACTADO]' },

  // Cédula de Ciudadanía (CC): 6-10 digits, often prefixed with CC or C.C.
  { regex: /\b(?:CC|C\.?\s?C\.?)[:\s]*\d{6,10}\b/gi, replacement: '[CC REDACTADO]' },

  // Cédula de Extranjería (CE): typically 6-7 digits
  { regex: /\b(?:CE|C\.?\s?E\.?)[:\s]*\d{6,7}\b/gi, replacement: '[CE REDACTADO]' },

  // Passport (PA/PP): alphanumeric 6-9 chars
  // Require separator (space/colon) after PA/PP to avoid false positives (e.g., PATRIMONIO)
  { regex: /\b(?:PA|PP|pasaporte)[:\s]+[A-Z0-9]{6,9}\b/gi, replacement: '[PASAPORTE REDACTADO]' },

  // Credit/debit card numbers: 13-19 digits with optional separators
  { regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/g, replacement: '[TARJETA REDACTADA]' },

  // Colombian bank account numbers: 10-20 digits (Bancolombia, Davivienda, etc.)
  { regex: /\b(?:cuenta|cta)[:\s]*(?:de\s+ahorros?|corriente)?[:\s]*\d{10,20}\b/gi, replacement: '[CUENTA REDACTADA]' },

  // Email addresses
  { regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL REDACTADO]' },

  // Colombian phone numbers: +57, 57, or 10 digits starting with 3
  { regex: /(?:\+?57[-.\s]?)?(?:\(?\d{1,3}\)?[-.\s]?)?\b3\d{9}\b/g, replacement: '[TELÉFONO REDACTADO]' },
  // Landlines: (1) 1234567 or 601-1234567
  { regex: /\b(?:60[1-8]|0[1-8])[-.\s]?\d{7}\b/g, replacement: '[TELÉFONO REDACTADO]' },

  // Standalone 8-10 digit numbers that could be IDs (catch-all, more conservative)
  // Only match when preceded by words suggesting an ID context
  { regex: /\b(?:identificaci[oó]n|documento|c[eé]dula|n[uú]mero)[:\s]*\d{6,10}\b/gi, replacement: '[DOCUMENTO REDACTADO]' },
];

export function redactPII(text: string): string {
  let sanitized = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

// --- NIT context extraction (runs BEFORE PII redaction) ---

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
