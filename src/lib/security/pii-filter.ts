export function redactPII(text: string): string {
  let sanitized = text;

  // Redact NIT (Número de Identificación Tributaria): 9-10 digits optionally followed by hyphen and check digit
  const nitRegex = /\b\d{9,10}[-]?\d{1}\b/g;
  sanitized = sanitized.replace(nitRegex, '[NIT REDACTED]');

  // Redact Email
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;
  sanitized = sanitized.replace(emailRegex, '[EMAIL REDACTED]');

  // Redact Colombian Phone Numbers (+57 followed by 10 digits, or just 10 digits)
  const phoneRegex = /(\+?57[-. ]?)?\b\d{10}\b/g;
  sanitized = sanitized.replace(phoneRegex, '[PHONE REDACTED]');

  return sanitized;
}
