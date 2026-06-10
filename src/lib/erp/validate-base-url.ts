import 'server-only';

// ---------------------------------------------------------------------------
// SSRF guard for client-supplied ERP base URLs.
//
// `credentials.baseUrl` travels from the client to ERP connectors that fetch()
// it server-side. Without validation an attacker can point it at internal
// services (cloud metadata, localhost, VPC ranges) and exfiltrate responses.
//
// Throws when:
//   - scheme is not https
//   - hostname is 'localhost' or ends in '.local' / '.internal'
//   - hostname is a literal IP in private / loopback / link-local / metadata
//     ranges: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
//     169.254.0.0/16, ::1, fc00::/7, fe80::/10 (incl. IPv4-mapped IPv6).
// ---------------------------------------------------------------------------

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isPrivateIPv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o > 255)) {
    return true; // malformed IP literal — fail closed
  }
  const [a, b] = octets;
  return (
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local / cloud metadata
    a === 0 // "this network"
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 (ULA)
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 (link-local)
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — validate the embedded IPv4.
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Validates a client-supplied ERP base URL against SSRF targets.
 * Throws an Error with a clear (safe-to-return) message when unsafe.
 */
export function assertSafeBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('baseUrl inválida: no es una URL bien formada.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('baseUrl inválida: solo se permiten URLs https.');
  }

  // URL.hostname wraps IPv6 literals in brackets — strip them.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('baseUrl inválida: hosts internos no están permitidos.');
  }

  if (IPV4_RE.test(hostname) && isPrivateIPv4(hostname)) {
    throw new Error(
      'baseUrl inválida: direcciones IP privadas o de loopback no están permitidas.',
    );
  }

  if (hostname.includes(':') && isPrivateIPv6(hostname)) {
    throw new Error(
      'baseUrl inválida: direcciones IPv6 privadas o de loopback no están permitidas.',
    );
  }
}
