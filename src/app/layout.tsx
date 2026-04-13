import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import SmoothScroll from '@/components/layout/SmoothScroll';
import { LanguageProvider } from '@/context/LanguageContext';

export const metadata: Metadata = {
  title: 'UtopIA | Consultoría Contable & Tributaria Potenciada por IA',
  description: 'Consultoría contable y tributaria potenciada por inteligencia artificial para firmas contables en Colombia. Defensa DIAN, devoluciones, due diligence y análisis financiero.',
  metadataBase: new URL('https://utopia-ai.co'),
  alternates: {
    canonical: '/',
    languages: {
      'es-CO': '/',
      'en-US': '/',
    },
  },
  openGraph: {
    title: 'UtopIA | Consultoría Contable & Tributaria Potenciada por IA',
    description: 'Defensa tributaria, devoluciones, due diligence y análisis financiero — con la precisión de la IA y el criterio de un experto. Para firmas contables en Colombia.',
    url: 'https://utopia-ai.co',
    siteName: 'UtopIA',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
      },
    ],
    locale: 'es_CO',
    alternateLocale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'UtopIA | Consultoría Contable & Tributaria Potenciada por IA',
    description: 'Defensa tributaria, devoluciones, due diligence y análisis financiero para firmas contables en Colombia. Potenciado por inteligencia artificial.',
    images: ['/twitter-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`} suppressHydrationWarning>
      <body className="min-h-screen bg-white text-[#0a0a0a] font-[family-name:var(--font-geist-sans)]">
        <LanguageProvider>
          <SmoothScroll>
            {children}
          </SmoothScroll>
        </LanguageProvider>
      </body>
    </html>
  );
}
