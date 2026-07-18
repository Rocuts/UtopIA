'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const { language, setLanguage } = useLanguage();
  const pathname = usePathname();
  const isWorkspace = pathname.startsWith('/workspace');

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (isWorkspace) return null;

  return (
    <header
      className={cn(
        'fixed top-0 w-full z-[var(--z-sticky)] transition-colors duration-100',
        scrolled ? 'bg-n-0/90 backdrop-blur-md border-b border-n-200' : 'bg-transparent border-b border-transparent',
      )}
      style={{ height: '72px' }}
    >
      <div
        className="mx-auto flex items-center justify-between h-full"
        style={{ padding: '0 clamp(22px, 4vw, 56px)' }}
      >
        {/* Brandmark */}
        <Link href="/" aria-label="1+1 inicio">
          <span
            className="font-serif-elite font-semibold inline-flex items-baseline"
            style={{ fontSize: '24px', letterSpacing: '-0.01em' }}
          >
            1
            <span
              style={{
                background: 'linear-gradient(135deg, var(--color-gold-500) 0%, var(--color-gold-400) 50%, var(--color-gold-500) 100%)',
                backgroundSize: '200% 100%',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                animation: 'gold-shimmer 4.5s ease-in-out infinite alternate',
                padding: '0 0.04em',
              }}
            >
              +
            </span>
            1
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center" style={{ gap: '34px' }}>
          <Link href="#services" className="text-[0.8125rem] text-n-600 hover:text-n-1000 transition-colors duration-200">
            Servicios
          </Link>
          <Link href="#methodology" className="text-[0.8125rem] text-n-600 hover:text-n-1000 transition-colors duration-200">
            Metodología
          </Link>
          <Link href="#metrics" className="text-[0.8125rem] text-n-600 hover:text-n-1000 transition-colors duration-200">
            Resultados
          </Link>
          <Link href="#faq" className="text-[0.8125rem] text-n-600 hover:text-n-1000 transition-colors duration-200">
            FAQ
          </Link>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {/* Language selector */}
          <div className="inline-flex border border-n-300 rounded-[6px] p-0.5">
            <button
              onClick={() => setLanguage('es')}
              className={cn(
                'px-2.5 py-[5px] text-[0.625rem] font-semibold rounded-[4px] transition-colors',
                language === 'es' ? 'bg-n-900 text-n-0' : 'bg-transparent text-n-600',
              )}
            >
              ES
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={cn(
                'px-2.5 py-[5px] text-[0.625rem] font-semibold rounded-[4px] transition-colors',
                language === 'en' ? 'bg-n-900 text-n-0' : 'bg-transparent text-n-600',
              )}
            >
              EN
            </button>
          </div>

          {/* Acceder button */}
          <Link href="/workspace">
            <button
              className="inline-flex items-center justify-center h-8 px-3 rounded-md text-xs font-medium transition-all duration-200 border hover:text-gold-600 hover:bg-gold-500/10 hover:-translate-y-px active:scale-[0.98]"
              style={{
                background: 'transparent',
                color: 'var(--color-gold-500)',
                borderColor: 'rgb(212 184 118 / .4)',
              }}
            >
              Acceder
            </button>
          </Link>
        </div>
      </div>
    </header>
  );
}
