// ---------------------------------------------------------------------------
// Webhooks salientes del API v1 — Standard Webhooks v1.0.0.
//
// Headers de cada entrega: webhook-id (msg_…, estable entre reintentos),
// webhook-timestamp (unix segundos), webhook-signature ("v1,<base64 hmac>").
// Firma v1: HMAC-SHA256(base64decode(secret sin 'whsec_'), "id.ts.payload")
// sobre los BYTES EXACTOS del body. Los clientes pueden verificar con la
// librería `standardwebhooks` de npm sin SDK propio.
//
// Anti-SSRF (OWASP API7): la URL del cliente se valida al registrar Y antes
// de cada entrega — https puro, puerto 443, sin credenciales, sin IPs
// privadas/loopback/link-local ni hosts internos.
// ---------------------------------------------------------------------------

import { createHmac, randomBytes } from 'node:crypto';

export const WEBHOOK_EVENT_TYPES = ['ping', 'trial_balance.processed'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

const WEBHOOK_SECRET_PREFIX = 'whsec_';
const WEBHOOK_SECRET_BYTES = 32; // spec: 24–64 bytes

/** Secreto por endpoint. Se muestra completo UNA vez; en DB va cifrado (vault). */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(WEBHOOK_SECRET_BYTES).toString('base64')}`;
}

/** Firma v1 de Standard Webhooks: `v1,` + base64(HMAC-SHA256). */
export function signWebhookPayload(
  secret: string,
  msgId: string,
  timestampSec: number,
  payload: string,
): string {
  const encoded = secret.startsWith(WEBHOOK_SECRET_PREFIX)
    ? secret.slice(WEBHOOK_SECRET_PREFIX.length)
    : secret;
  // La spec exige decodificar el base64 ANTES de usarlo como clave HMAC.
  const key = Buffer.from(encoded, 'base64');
  const signature = createHmac('sha256', key)
    .update(`${msgId}.${timestampSec}.${payload}`, 'utf8')
    .digest('base64');
  return `v1,${signature}`;
}

/** Envelope recomendado por la spec: {type, timestamp RFC3339, data}. */
export function buildEventEnvelope(
  eventType: string,
  data: unknown,
  nowIso: string,
): string {
  return JSON.stringify({ type: eventType, timestamp: nowIso, data });
}

// ---------------------------------------------------------------------------
// Validación de URL del endpoint (anti-SSRF)
// ---------------------------------------------------------------------------

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localdomain'];
const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0']);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / IMDS
  return false;
}

function isPrivateIpv6(host: string): boolean {
  // URL.hostname entrega IPv6 sin corchetes en Node; normalizamos por si acaso.
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true; // fe80::/10
  }
  return false;
}

export function validateWebhookUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'La URL no es válida.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'La URL debe usar https.' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'La URL no puede llevar credenciales embebidas.' };
  }
  if (url.port !== '' && url.port !== '443') {
    return { ok: false, reason: 'Solo se permite el puerto 443.' };
  }

  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTS.has(host) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    isPrivateIpv4(host) ||
    isPrivateIpv6(host)
  ) {
    return { ok: false, reason: 'El host apunta a una red privada o local.' };
  }

  return { ok: true, url };
}
