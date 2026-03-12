export function redactPII(text: string): string {
  let sanitized = text;

  // Redact SSN (XXX-XX-XXXX or XXXXXXXXX)
  const ssnRegex = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g;
  sanitized = sanitized.replace(ssnRegex, '[SSN REDACTED]');

  // Redact Email
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;
  sanitized = sanitized.replace(emailRegex, '[EMAIL REDACTED]');

  // Redact Phone Numbers (US approx)
  const phoneRegex = /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g;
  sanitized = sanitized.replace(phoneRegex, '[PHONE REDACTED]');

  // Redact Credit Cards
  const ccRegex = /\b(?:\d[ -]*?){13,16}\b/g;
  sanitized = sanitized.replace(ccRegex, '[CREDIT CARD REDACTED]');

  return sanitized;
}
