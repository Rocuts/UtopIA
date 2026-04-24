import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CommonJS / native modules that must NOT be bundled by webpack/turbopack.
  serverExternalPackages: ['hnswlib-node', 'pdf-parse', 'mammoth', 'exceljs', 'jspdf'],

  // Tree-shake barrel re-exports for heavy icon/markdown packages on the client.
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion', 'react-markdown', 'remark-gfm', 'rehype-sanitize'],
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  // File tracing hints for Vercel Fluid Compute.
  // - Includes: ensures native binaries of hnswlib-node ship with the function bundle.
  // - Excludes: keeps the 285 MB persisted vector index out of the bundle. In MVP the
  //   store is local-only (dev); on Vercel it falls back to MemoryVectorStore. When we
  //   move to a managed vector DB (Upstash Vector / Neon pgvector), these stay as is.
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/hnswlib-node/build/**/*'],
  },
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
              "default-src 'self' http: https: 'unsafe-inline' 'unsafe-eval'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.openai.com https://api.tavily.com wss://api.openai.com http://192.168.40.67:* ws://192.168.40.67:*",
              "media-src 'self' blob:",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
