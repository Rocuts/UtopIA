// ─── GET /api/v1/docs — referencia HTML server-rendered ──────────────────────
// Sin scripts externos ni CDNs: la CSP del proxy solo permite script-src
// 'self' + nonce, así que la referencia se renderiza en el servidor desde el
// MISMO documento OpenAPI (cero drift). Estilos inline (style-src permite
// 'unsafe-inline').

import { buildOpenApiDocument } from '@/lib/api/openapi';

export const maxDuration = 15;

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface Operation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
}

const METHOD_ORDER = ['get', 'post', 'patch', 'put', 'delete'] as const;

export async function GET() {
  const doc = buildOpenApiDocument() as {
    info: { title: string; version: string; description?: string };
    servers: { url: string }[];
    paths: Record<string, Record<string, Operation>>;
    webhooks: Record<string, unknown>;
  };

  const rows: string[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHOD_ORDER) {
      const op = item[method];
      if (!op) continue;
      rows.push(`
        <tr>
          <td><span class="m m-${method}">${method.toUpperCase()}</span></td>
          <td><code>${esc(path)}</code></td>
          <td>${esc(op.summary)}${op.description ? `<p class="d">${esc(op.description)}</p>` : ''}</td>
        </tr>`);
    }
  }

  const webhookRows = Object.keys(doc.webhooks)
    .map((name) => `<li><code>${esc(name)}</code></li>`)
    .join('');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.info.title)} — Referencia</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; margin: 0 auto; max-width: 960px; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  .sub { opacity: .7; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
  td, th { border-top: 1px solid rgba(128,128,128,.3); padding: .6rem .5rem; text-align: left; vertical-align: top; }
  code { font: 13px ui-monospace, monospace; background: rgba(128,128,128,.12); padding: .1rem .35rem; border-radius: 4px; }
  .m { font: 700 11px ui-monospace, monospace; padding: .15rem .45rem; border-radius: 4px; color: #fff; }
  .m-get { background: #0d7d4d; } .m-post { background: #1f6feb; } .m-patch { background: #b07c00; } .m-delete { background: #b62324; } .m-put { background: #6e40c9; }
  .d { margin: .35rem 0 0; font-size: .85rem; opacity: .75; }
  section { margin-top: 2.5rem; }
  a { color: inherit; }
</style>
</head>
<body>
  <h1>${esc(doc.info.title)}</h1>
  <p class="sub">Versión <code>${esc(doc.info.version)}</code> · Base <code>${esc(doc.servers[0]?.url)}</code> · <a href="/api/v1/openapi.json">openapi.json</a></p>
  <p>${esc(doc.info.description)}</p>
  <section>
    <h2>Autenticación</h2>
    <p>Todas las rutas (salvo esta documentación) exigen <code>Authorization: Bearer utop_sk_live_…</code>. Los errores llegan como <code>application/problem+json</code> (RFC 9457) — matchee por el campo <code>code</code>. Cada respuesta trae <code>X-Request-Id</code> para soporte.</p>
  </section>
  <section>
    <h2>Endpoints</h2>
    <table>
      <tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr>
      ${rows.join('\n')}
    </table>
  </section>
  <section>
    <h2>Webhooks (Standard Webhooks v1)</h2>
    <p>Eventos firmados con HMAC-SHA256 (headers <code>webhook-id</code>, <code>webhook-timestamp</code>, <code>webhook-signature</code>). Verifique con la librería <code>standardwebhooks</code> y tolerancia de 5 minutos. Reintentos con backoff hasta ~28 h; responda <code>2xx</code> rápido.</p>
    <ul>${webhookRows}</ul>
  </section>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
