// ─── GET /.well-known/api-catalog — descubrimiento RFC 9727 ─────────────────
// Linkset (RFC 9264) en application/linkset+json apuntando al contrato
// OpenAPI y a la documentación del API v1.

export const maxDuration = 15;

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const linkset = {
    linkset: [
      {
        anchor: `${baseUrl}/api/v1`,
        'service-desc': [
          { href: `${baseUrl}/api/v1/openapi.json`, type: 'application/json' },
        ],
        'service-doc': [{ href: `${baseUrl}/api/v1/docs`, type: 'text/html' }],
      },
    ],
  };

  return new Response(JSON.stringify(linkset), {
    headers: {
      'Content-Type': 'application/linkset+json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
