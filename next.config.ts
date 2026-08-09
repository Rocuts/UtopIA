import { withWorkflow } from 'workflow/next';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CommonJS / native modules that must NOT be bundled by webpack/turbopack.
  // (`hnswlib-node` removido en Ola 0.D — el RAG ahora usa Neon pgvector.)
  serverExternalPackages: ['pdf-parse', 'mammoth', 'exceljs', 'jspdf', 'pg', 'pg-connection-string', 'pgpass', 'pg-native'],

  // Tree-shake barrel re-exports for heavy icon/markdown packages on the client.
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion', 'react-markdown', 'remark-gfm', 'rehype-sanitize'],
  },

  // Cache Components (Next 16): activación pendiente de Ola 4. Activar
  // `cacheComponents: true` requiere envolver Client Components con
  // initializers no-deterministas (`new Date()`, `Math.random()`) en
  // `<Suspense>` boundaries y mover el state init a useEffect. Los helpers
  // `src/lib/cache/{accounting-cache,ledger-queries}.ts` están listos para
  // activarse junto con esa migración por-página. Por ahora corren como
  // queries normales sin cache. Las Server Actions ya emiten `updateTag(...)`
  // listo para cuando el flag se prenda.
  // cacheComponents: true,

  // `X-Powered-By: Next.js` no aporta nada al cliente y sí ayuda al inventario
  // de un atacante que busca objetivos por framework. Higiene: se apaga aquí y
  // no en el proxy porque el matcher del proxy excluye _next/static y los
  // assets, que seguirían emitiéndola.
  poweredByHeader: false,

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  // File tracing hints for Vercel Fluid Compute.
  // - Excludes: legacy paths que ya no se bundlean (RAG migrado a Neon
  //   pgvector en Ola 0.D — el index 285 MB ya no vive en el filesystem).
  outputFileTracingExcludes: {
    '/api/**/*': [
      './src/data/vector_store/**/*',
      './src/data/uploads/**/*',
      './Documentacion/**/*',
    ],
  },

  allowedDevOrigins: ['localhost', '192.168.40.67'],
  // CSP se emite por request, con nonce, desde `src/proxy.ts` (reemplaza
  // 'unsafe-inline'). Aqui solo viven los headers estaticos que no necesitan
  // valores por request.
  //
  // OJO: Next 16.2 renombro el interceptor de request; el archivo con el nombre
  // legacy (pre-Next-16) fue ELIMINADO y recrearlo tumba el build de produccion
  // — tener los dos archivos a la vez aborta `next build`. Por eso este config
  // no debe volver a apuntar a esa ruta muerta: quien la lea va a buscarla, no
  // la va a encontrar, y el siguiente paso natural rompe prod.
  // Ver docs/PLATFORM_MIGRATION.md §1. Guard: src/__tests__/next-config-proxy.test.ts
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), geolocation=(), microphone=(self)',
          },
          // HSTS. Cierra la ventana de SSL-strip de la PRIMERA navegación en
          // claro (la CSP ya lleva `upgrade-insecure-requests`, pero eso sólo
          // aplica a subrecursos una vez cargada la página). Vive aquí y no en
          // el proxy porque este bloque cubre `/:path*` sin exclusiones,
          // mientras el matcher del proxy salta _next/static y las imágenes.
          // Sin `preload`: es de facto irreversible (salir de la lista tarda
          // meses) y el dominio propio aún no está en producción con todos sus
          // subdominios sirviendo HTTPS. Sólo en prod — en dev el servidor es
          // http://localhost y una respuesta HSTS ahí sólo estorba.
          ...(isProd
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains',
                },
              ]
            : []),
          // NOTE: el CSP se emite por request, con nonce, desde `src/proxy.ts`
          // (reemplaza el CSP estatico con 'unsafe-inline' que vivia aqui). Los
          // origins de Google Fonts + connect-src que necesita el reporte HTML
          // v10.1 viajan en ese CSP — ver `src/proxy.ts`.
        ],
      },
    ];
  },
};

export default withWorkflow(nextConfig);
