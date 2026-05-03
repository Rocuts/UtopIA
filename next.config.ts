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
  async headers() {
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
          {
            key: 'Content-Security-Policy',
            value: [
              // default-src restricted to self only — no http:/https: wildcards
              "default-src 'self'",
              // 'unsafe-inline' kept ONLY for Next.js inline bootstrap scripts (no nonce yet);
              // 'unsafe-eval' is required by some dev/HMR paths but should be removed in prod.
              process.env.NODE_ENV === 'production'
                ? "script-src 'self' 'unsafe-inline'"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // style-src must keep 'unsafe-inline' — Next.js + Tailwind inject inline styles.
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              [
                "connect-src 'self'",
                'https://api.openai.com',
                'wss://api.openai.com',
                'https://api.tavily.com',
                'https://api.cohere.com',
                'https://*.neon.tech',
                'wss://*.neon.tech',
                'https://*.public.blob.vercel-storage.com',
                process.env.NODE_ENV === 'production' ? '' : 'http://192.168.40.67:*',
                process.env.NODE_ENV === 'production' ? '' : 'ws://192.168.40.67:*',
              ].filter(Boolean).join(' '),
              "media-src 'self' blob:",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
