import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import SmoothScroll from '@/components/layout/SmoothScroll';
import { LanguageProvider } from '@/context/LanguageContext';

const SITE_URL = 'https://utopia-ai.co';
const SITE_NAME = 'UtopIA';
const BOGOTA_LAT = '4.7110';
const BOGOTA_LON = '-74.0721';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: 'UtopIA | Consultoría Contable & Tributaria Potenciada por IA en Colombia',
    template: '%s | UtopIA',
  },
  description:
    'Consultoría contable y tributaria colombiana potenciada por inteligencia artificial. Defensa DIAN, devoluciones IVA/Renta, NIIF, planeación tributaria, precios de transferencia, valoración empresarial y due diligence. Basada en el Estatuto Tributario, doctrina DIAN y NIIF.',
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  generator: 'Next.js',
  referrer: 'origin-when-cross-origin',
  authors: [{ name: 'UtopIA', url: SITE_URL }],
  creator: 'UtopIA',
  publisher: 'UtopIA',
  category: 'Business & Finance',
  classification: 'Consultoría Contable, Tributaria y Financiera',
  keywords: [
    'consultoría contable Colombia',
    'consultoría tributaria Colombia',
    'defensa DIAN',
    'devolución saldos a favor',
    'IVA Colombia',
    'renta Colombia',
    'NIIF Colombia',
    'Estatuto Tributario',
    'planeación tributaria',
    'precios de transferencia',
    'valoración empresarial',
    'due diligence',
    'revisoría fiscal',
    'conciliación fiscal',
    'inteligencia artificial contabilidad',
    'IA tributaria',
    'firma contable Colombia',
    'contador público Colombia',
    'Bogotá',
    'Medellín',
    'Cali',
    'DIAN',
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
    title: 'UtopIA | Consultoría Contable & Tributaria Potenciada por IA',
    description:
      'Defensa tributaria, devoluciones, due diligence y análisis financiero — con la precisión de la IA y el criterio de un experto. Para firmas contables en Colombia.',
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'UtopIA — Consultoría Contable y Tributaria potenciada por IA en Colombia',
      },
    ],
    locale: 'es_CO',
    alternateLocale: 'en_US',
    type: 'website',
    countryName: 'Colombia',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'UtopIA | Consultoría Contable & Tributaria Potenciada por IA',
    description:
      'Defensa tributaria, devoluciones, due diligence y análisis financiero para firmas contables en Colombia. Potenciado por inteligencia artificial.',
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
    name: 'UtopIA',
    description:
      'Consultoría contable y tributaria colombiana potenciada por IA. Defensa DIAN, devoluciones, NIIF, planeación tributaria y más.',
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
      name: 'UtopIA',
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
    name: 'UtopIA — Consultoría Contable y Tributaria',
    description:
      'Firma de consultoría contable y tributaria colombiana con inteligencia artificial. Defensa DIAN, NIIF, devoluciones, due diligence y análisis financiero.',
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
    name: 'UtopIA',
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/logo-modern.png`,
    },
    description:
      'Plataforma de consultoría contable y tributaria colombiana potenciada por inteligencia artificial.',
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
      className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-white text-[#0a0a0a] font-[family-name:var(--font-geist-sans)]">
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
        <LanguageProvider>
          <SmoothScroll>{children}</SmoothScroll>
        </LanguageProvider>
      </body>
    </html>
  );
}
