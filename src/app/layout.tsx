import type { Metadata } from 'next';
import './globals.css';
import SmoothScroll from '@/components/layout/SmoothScroll';
import { LanguageProvider } from '@/context/LanguageContext';

// (Metadata remains unchanged, just layout component changes)
export const metadata: Metadata = {
  title: 'AiVocate | U.S. Labor Law Guidance for Every Worker',
  description: 'Confidential, AI-powered guidance on U.S. labor rights for all workers. Workplace injuries, wage disputes, discrimination, and wrongful termination — available 24/7 in English and Spanish.',
  metadataBase: new URL('https://aivocate.com'),
  alternates: {
    canonical: '/',
    languages: {
      'en-US': '/',
      'es-US': '/',
    },
  },
  openGraph: {
    title: 'AiVocate | U.S. Labor Law Guidance for Every Worker',
    description: 'Confidential, AI-powered guidance on U.S. labor rights for all workers. Workplace injuries, wage claims, discrimination, and more — available 24/7.',
    url: 'https://aivocate.com',
    siteName: 'AiVocate',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
      },
    ],
    locale: 'en_US',
    alternateLocale: 'es_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AiVocate | U.S. Labor Law Guidance for Every Worker',
    description: 'Confidential guidance on U.S. labor rights for all workers. Workers\' compensation, wage disputes, discrimination, and wrongful termination.',
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
    <html lang="en" className="antialiased font-sans" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] selection:bg-[var(--cyan-glow)] selection:text-[var(--cyan-primary)]">
        <LanguageProvider>
          <SmoothScroll>
            {children}
          </SmoothScroll>
        </LanguageProvider>
      </body>
    </html>
  );
}
