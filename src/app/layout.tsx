import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Fraunces } from 'next/font/google';
import './globals.css';
import SmoothScroll from '@/components/layout/SmoothScroll';
import { LanguageProvider } from '@/context/LanguageContext';
import { ThemeProvider, THEME_INIT_SCRIPT } from '@/components/providers/ThemeProvider';
import { DensityProvider, DENSITY_INIT_SCRIPT } from '@/components/providers/DensityProvider';

const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT', 'WONK'],
  variable: '--font-fraunces',
  display: 'swap',
});

const SITE_URL = 'https://utopia-ai.co';
const SITE_NAME = '1+1';
const BOGOTA_LAT = '4.7110';
const BOGOTA_LON = '-74.0721';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'var(--n-0)' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0907' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: '1+1 — Directorio Ejecutivo Digital',
    template: '%s · 1+1',
  },
  description:
    '1+1 es el Directorio Ejecutivo Digital impulsado por IA para empresas colombianas: protege tu caja, multiplica tu valor y audita tu cumplimiento NIIF/DIAN.',
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  generator: 'Next.js',
  referrer: 'origin-when-cross-origin',
  authors: [{ name: '1+1', url: SITE_URL }],
  creator: '1+1',
  publisher: '1+1',
  category: 'Business & Finance',
  classification: 'Directorio Ejecutivo Digital — Contabilidad, Tributaria, Financiera y Aseguramiento',
  keywords: [
    '1+1',
    'contabilidad IA',
    'NIIF',
    'DIAN',
    'Colombia',
    'asesoría tributaria',
    'planeación fiscal',
    'valoración empresarial',
    'Directorio Ejecutivo Digital',
    'defensa DIAN',
    'devolución saldos a favor',
    'precios de transferencia',
    'due diligence',
    'revisoría fiscal',
    'conciliación fiscal',
    'inteligencia artificial contabilidad',
    'Estatuto Tributario',
    'Bogotá',
    'Medellín',
    'Cali',
    'SuperSociedades',
    'CTCP',
    'UGPP',
  ],
  alternates: {
    canonical: '/',
    languages: {
      'es-CO': SITE_URL,
      'en-US': SITE_URL,
      'x-default': SITE_URL,
    },
  },
  openGraph: {
    title: '1+1 — Directorio Ejecutivo Digital',
    description:
      '1+1 es el Directorio Ejecutivo Digital impulsado por IA para empresas colombianas: protege tu caja, multiplica tu valor y audita tu cumplimiento NIIF/DIAN.',
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: '1+1 — Directorio Ejecutivo Digital impulsado por IA para empresas colombianas',
      },
    ],
    locale: 'es_CO',
    alternateLocale: 'en_US',
    type: 'website',
    countryName: 'Colombia',
  },
  twitter: {
    card: 'summary_large_image',
    title: '1+1 — Directorio Ejecutivo Digital',
    description:
      '1+1 es el Directorio Ejecutivo Digital impulsado por IA para empresas colombianas: protege tu caja, multiplica tu valor y audita tu cumplimiento NIIF/DIAN.',
    images: ['/twitter-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  other: {
    // GEO / regional SEO — Colombia (Bogotá como centroide)
    'geo.region': 'CO-DC',
    'geo.placename': 'Bogotá, Colombia',
    'geo.position': `${BOGOTA_LAT};${BOGOTA_LON}`,
    ICBM: `${BOGOTA_LAT}, ${BOGOTA_LON}`,
    'DC.language': 'es-CO',
    'DC.coverage': 'Colombia',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const softwareAppSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: '1+1',
    alternateName: 'UnoMasUno',
    description:
      '1+1 — Directorio Ejecutivo Digital impulsado por IA para empresas colombianas: defensa DIAN, devoluciones, NIIF, planeación tributaria, valoración y aseguramiento.',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Tax & Accounting Software',
    operatingSystem: 'Web',
    url: SITE_URL,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'COP',
      availability: 'https://schema.org/InStock',
    },
    provider: {
      '@type': 'Organization',
      name: '1+1',
      url: SITE_URL,
    },
    inLanguage: ['es-CO', 'en-US'],
    audience: {
      '@type': 'Audience',
      audienceType: 'Contadores, tributaristas y empresas colombianas',
      geographicArea: {
        '@type': 'Country',
        name: 'Colombia',
      },
    },
    featureList: [
      'Defensa ante requerimientos DIAN',
      'Devolución de saldos a favor (IVA, Renta, Retención)',
      'Reporte NIIF Integral (Grupos 1, 2, 3)',
      'Planeación tributaria',
      'Precios de transferencia',
      'Valoración empresarial (DCF, Multiplicadores, NIIF 13)',
      'Due Diligence contable',
      'Conciliación fiscal (NIIF — Estatuto Tributario)',
      'Dictamen de Revisoría Fiscal',
      'Estudio de factibilidad',
    ],
  };

  const professionalServiceSchema = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${SITE_URL}#service`,
    name: '1+1 — Directorio Ejecutivo Digital',
    alternateName: 'UnoMasUno',
    description:
      '1+1, Directorio Ejecutivo Digital colombiano con inteligencia artificial. Defensa DIAN, NIIF, devoluciones, due diligence, valoración, aseguramiento y análisis financiero.',
    url: SITE_URL,
    image: `${SITE_URL}/og-image.jpg`,
    priceRange: '$$',
    areaServed: [
      {
        '@type': 'Country',
        name: 'Colombia',
      },
      {
        '@type': 'City',
        name: 'Bogotá',
      },
      {
        '@type': 'City',
        name: 'Medellín',
      },
      {
        '@type': 'City',
        name: 'Cali',
      },
      {
        '@type': 'City',
        name: 'Barranquilla',
      },
      {
        '@type': 'City',
        name: 'Cartagena',
      },
    ],
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'CO',
      addressRegion: 'Bogotá D.C.',
      addressLocality: 'Bogotá',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: BOGOTA_LAT,
      longitude: BOGOTA_LON,
    },
    knowsLanguage: ['es-CO', 'en-US'],
    knowsAbout: [
      'Estatuto Tributario de Colombia',
      'Doctrina DIAN',
      'NIIF / IFRS',
      'NIIF para PYMES',
      'Revisoría Fiscal',
      'Planeación Tributaria',
      'Precios de Transferencia',
      'Valoración Empresarial',
      'Due Diligence',
      'Conciliación Fiscal',
      'Régimen SIMPLE',
      'Ley 43 de 1990',
      'Código de Comercio Colombiano',
    ],
    serviceType: [
      'Consultoría tributaria',
      'Consultoría contable',
      'Defensa ante la DIAN',
      'Estados financieros NIIF',
      'Valoración empresarial',
      'Due diligence',
    ],
  };

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}#organization`,
    name: '1+1',
    alternateName: 'UnoMasUno',
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/logo-modern.png`,
    },
    description:
      '1+1 — Directorio Ejecutivo Digital impulsado por IA para empresas colombianas.',
    foundingLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'CO',
        addressRegion: 'Bogotá D.C.',
      },
    },
    areaServed: {
      '@type': 'Country',
      name: 'Colombia',
    },
  };

  const webSiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}#website`,
    url: SITE_URL,
    name: SITE_NAME,
    inLanguage: 'es-CO',
    publisher: { '@id': `${SITE_URL}#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/workspace?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html
      lang="es-CO"
      className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans">
        {/* Pre-hydration theme resolver — must be the first <body> child so
            data-theme is set on <html> before any paint. Prevents FOUC. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Pre-hydration density resolver — sets data-density on <html> so
            compact-mode tokens apply before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: DENSITY_INIT_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(professionalServiceSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteSchema) }}
        />
        <ThemeProvider>
          <DensityProvider>
            <LanguageProvider>
              <SmoothScroll>{children}</SmoothScroll>
            </LanguageProvider>
          </DensityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
