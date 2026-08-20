// ---------------------------------------------------------------------------
// webhooks.ts — Standard Webhooks v1.0.0: secreto, firma y anti-SSRF.
// ---------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildEventEnvelope,
  generateWebhookSecret,
  signWebhookPayload,
  validateWebhookUrl,
  WEBHOOK_EVENT_TYPES,
} from '../webhooks';

describe('generateWebhookSecret', () => {
  it('produce whsec_ + base64 de 32 bytes', () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith('whsec_')).toBe(true);
    const raw = Buffer.from(secret.slice('whsec_'.length), 'base64');
    expect(raw.length).toBe(32); // spec: 24–64 bytes
  });
});

describe('signWebhookPayload (firma v1 de la spec)', () => {
  it('coincide con HMAC-SHA256(base64decode(secret), "id.ts.payload") recomputado a mano', () => {
    const secret = generateWebhookSecret();
    const msgId = 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W';
    const timestamp = 1755616245;
    const payload = '{"type":"ping","timestamp":"2026-08-19T15:04:05Z","data":{}}';

    const signature = signWebhookPayload(secret, msgId, timestamp, payload);
    expect(signature).toMatch(/^v1,[A-Za-z0-9+/=]+$/);

    const rawKey = Buffer.from(secret.slice('whsec_'.length), 'base64');
    const expected = createHmac('sha256', rawKey)
      .update(`${msgId}.${timestamp}.${payload}`, 'utf8')
      .digest('base64');
    expect(signature).toBe(`v1,${expected}`);
  });

  it('cambia si cambia cualquier componente firmado', () => {
    const secret = generateWebhookSecret();
    const base = signWebhookPayload(secret, 'msg_1', 1000, '{"a":1}');
    expect(signWebhookPayload(secret, 'msg_2', 1000, '{"a":1}')).not.toBe(base);
    expect(signWebhookPayload(secret, 'msg_1', 1001, '{"a":1}')).not.toBe(base);
    expect(signWebhookPayload(secret, 'msg_1', 1000, '{"a":2}')).not.toBe(base);
  });
});

describe('buildEventEnvelope', () => {
  it('produce {type, timestamp, data} exactos', () => {
    const envelope = buildEventEnvelope('ping', { hola: 1 }, '2026-08-19T15:04:05Z');
    expect(JSON.parse(envelope)).toEqual({
      type: 'ping',
      timestamp: '2026-08-19T15:04:05Z',
      data: { hola: 1 },
    });
  });

  it('el catálogo de eventos v1 está cerrado', () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual(['ping', 'trial_balance.processed']);
  });
});

describe('validateWebhookUrl (anti-SSRF, OWASP API7)', () => {
  const bad = [
    'http://hooks.cliente.com/utopia', // sin TLS
    'https://10.0.0.1/x',
    'https://172.16.5.5/x',
    'https://192.168.1.10/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data', // IMDS
    'https://0.0.0.0/x',
    'https://[::1]/x',
    'https://[fc00::1]/x',
    'https://[fe80::1]/x',
    'https://localhost/x',
    'https://api.local/x',
    'https://mi.internal/x',
    'https://user:pass@hooks.cliente.com/x', // credenciales embebidas
    'https://hooks.cliente.com:8443/x', // puerto no estándar
    'no-es-url',
  ];
  it.each(bad)('rechaza %s', (url) => {
    expect(validateWebhookUrl(url).ok).toBe(false);
  });

  const good = [
    'https://hooks.cliente.com/utopia',
    'https://erp.empresa.com.co:443/webhooks/utopia',
  ];
  it.each(good)('acepta %s', (url) => {
    expect(validateWebhookUrl(url).ok).toBe(true);
  });
});
