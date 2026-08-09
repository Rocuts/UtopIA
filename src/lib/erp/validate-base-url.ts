// NOTA (auditoría OWASP 2026-08): este módulo tenía `import 'server-only'`. Hubo
// que retirarlo cuando los conectores ERP pasaron a auto-validar sus destinos:
// `sap-s4hana.ts` (y sus hermanos) entran en el grafo de cliente por la cadena
// registry → adapter → service → kpis/live → ExecutiveDashboard, así que el
// marcador rompía el build del bundle de navegador.
//
// Retirarlo es seguro AQUÍ: el módulo no lee `process.env`, no toca la DB y no
// contiene secretos — es aritmética de rangos IP y parsing de URL. Lo que sí
// señala es un problema de fondo preexistente: los conectores ERP no deberían
// estar en el bundle del cliente. Mientras esa cadena no se corte, cualquier
// `server-only` que se añada bajo `src/lib/erp/` volverá a romper el build.
// ---------------------------------------------------------------------------

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
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10 (RFC 6598)
    a === 0 // "this network"
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 (ULA)
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 (link-local)
  // IPv4-mapped IPv6 — validate the embedded IPv4. `new URL()` normaliza el
  // sufijo a hex comprimido (`::ffff:10.0.0.1` → `::ffff:a00:1`), así que
  // cubrimos ambas formas: dotted-quad y dos grupos hex.
  const mappedDotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateIPv4(dotted);
  }
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

// ---------------------------------------------------------------------------
// SSRF: `tenantId` interpolado como AUTORIDAD de la URL.
//
// Oracle / SAP / World Office arman el endpoint con `https://${tenantId}...`.
// Un valor como `x@169.254.169.254/latest/meta-data/?a` hace que el parser
// WHATWG resuelva el host al servicio interno y empuje el resto a path/query,
// de modo que el guard de `baseUrl` —que mira otro campo— nunca lo ve.
//
// Por eso hacen falta las dos capas: rechazar los caracteres que permiten
// reescribir la autoridad NO basta, porque un tenantId «limpio» como
// `169.254.169.254` sigue siendo un literal de IP interna. Quien descarta eso
// es `assertSafeBaseUrl` sobre la URL YA construida.
// ---------------------------------------------------------------------------

const TENANT_AUTHORITY_CHARS_RE = /[/:@?#%\\`\s]/;

/**
 * Valida un `tenantId` que se interpola como autoridad y la URL resultante.
 * Lanza con un mensaje seguro de devolver (no revela el host resuelto).
 */
export function assertSafeTenantUrl(
  tenantId: string,
  builtUrl: string,
  provider: string,
): void {
  if (!tenantId || TENANT_AUTHORITY_CHARS_RE.test(tenantId)) {
    throw new Error(
      `${provider}: tenantId inválido — no puede contener espacios ni los caracteres / : @ ? # % \\ \``,
    );
  }

  try {
    assertSafeBaseUrl(builtUrl);
  } catch {
    throw new Error(
      `${provider}: tenantId inválido — el host resultante no es un destino público permitido.`,
    );
  }
}

// ---------------------------------------------------------------------------
// SSRF: la redirección también es un salto de red.
//
// `assertSafeBaseUrl` valida un string antes de volar, o sea sólo cubre el
// PRIMER salto. Con el `redirect: 'follow'` por defecto, un host público
// permitido puede contestar `302 Location: http://169.254.169.254/...` y undici
// lo sigue —incluso degradando https→http, que el guard prohíbe explícitamente—,
// con lo que el guard queda decorativo para los 13 conectores.
//
// Poner `redirect: 'manual'` a secas NO es una opción: devolvería el 3xx tal
// cual y el `if (!res.ok)` de los conectores empezaría a lanzar sobre cualquier
// ERP que redirija de forma legítima (normalización de trailing slash). De ahí
// que el bucle manual sea obligatorio: se sigue la cadena a mano, validando
// cada destino y con tope de saltos.
// ---------------------------------------------------------------------------

const MAX_REDIRECT_HOPS = 3;

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * Replica la semántica de método/cuerpo que aplica `redirect: 'follow'`:
 * 303 siempre pasa a GET; 301/302 degradan POST a GET; 307/308 conservan
 * método y cuerpo. Sin esto el bucle manual cambiaría el comportamiento
 * observable de los ERP que hoy redirigen bien.
 */
function initForRedirect(init: RequestInit, status: number): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  const dropsBody =
    status === 303 || ((status === 301 || status === 302) && method === 'POST');
  return dropsBody ? { ...init, method: 'GET', body: undefined } : init;
}

/**
 * `fetch` que sigue redirecciones pasando cada destino por `assertSafeBaseUrl`.
 * Úsalo en todo fetch de conector ERP hacia una URL derivada de input del cliente.
 */
export async function fetchWithSafeRedirects(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = url;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; ; hop++) {
    const res = await fetch(currentUrl, currentInit);

    const location = isRedirectStatus(res.status)
      ? res.headers.get('location')
      : null;
    if (!location) return res;

    if (hop >= MAX_REDIRECT_HOPS) {
      throw new Error(
        'ERP: demasiadas redirecciones en la respuesta del proveedor.',
      );
    }

    let next: string;
    try {
      next = new URL(location, currentUrl).toString();
      assertSafeBaseUrl(next);
    } catch {
      // Sin detalle del destino: el mensaje llega al cliente y sería un oráculo.
      throw new Error(
        'ERP: redirección bloqueada — el destino no es un host público https permitido.',
      );
    }

    currentInit = initForRedirect(currentInit, res.status);
    currentUrl = next;
  }
}
