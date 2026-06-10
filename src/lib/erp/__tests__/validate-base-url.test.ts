// ---------------------------------------------------------------------------
// Regresión seguridad — guard anti-SSRF de baseUrl de conectores ERP (F-04).
//
// /api/erp/sync y /api/erp/connect aceptan `baseUrl` del cliente; los
// providers hacen fetch contra ella. Sin el guard, el servidor es un proxy
// SSRF hacia redes internas. Estos tests fijan la política: https-only +
// bloqueo de IPs privadas/loopback/link-local/metadata y hostnames internos.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { assertSafeBaseUrl } from '../validate-base-url';

describe('assertSafeBaseUrl — URLs externas legítimas pasan', () => {
  it.each([
    'https://api.siigo.com',
    'https://helisa.cloud/api/v2',
    'https://app.contapyme.com:8443/ws',
    'https://my-erp.example.co/path?q=1',
  ])('acepta %s', (url) => {
    expect(() => assertSafeBaseUrl(url)).not.toThrow();
  });
});

describe('assertSafeBaseUrl — SSRF: bloquea redes internas y reservadas', () => {
  it.each([
    ['http no permitido', 'http://api.siigo.com'],
    ['loopback v4', 'https://127.0.0.1/admin'],
    ['loopback nombre', 'https://localhost:9000'],
    ['RFC1918 10/8', 'https://10.0.0.5'],
    ['RFC1918 172.16/12', 'https://172.16.10.1'],
    ['RFC1918 172.31 borde', 'https://172.31.255.254'],
    ['RFC1918 192.168/16', 'https://192.168.40.67'],
    ['link-local / metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['this network 0/8', 'https://0.0.0.0'],
    ['CGNAT 100.64/10', 'https://100.64.1.1'],
    ['IPv6 loopback', 'https://[::1]/x'],
    ['IPv6 ULA fd00', 'https://[fd00::1]'],
    ['IPv6 link-local fe80', 'https://[fe80::1]'],
    ['IPv4-mapped privada', 'https://[::ffff:10.0.0.1]'],
    ['hostname .internal', 'https://db.internal/api'],
    ['hostname .local', 'https://nas.local'],
    ['GCP metadata', 'https://metadata.google.internal/computeMetadata/v1/'],
    ['URL basura', 'not-a-url'],
  ])('bloquea %s', (_label, url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow();
  });

  it('172.32 (fuera de RFC1918) sí pasa — el rango es 16-31', () => {
    expect(() => assertSafeBaseUrl('https://172.32.0.1')).not.toThrow();
  });

  it('100.128 (fuera de CGNAT) sí pasa — el rango es 64-127', () => {
    expect(() => assertSafeBaseUrl('https://100.128.0.1')).not.toThrow();
  });
});
