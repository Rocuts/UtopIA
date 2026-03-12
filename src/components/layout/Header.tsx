'use client';

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/LanguageContext";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const { language, setLanguage, t } = useLanguage();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={cn(
      "fixed top-0 w-full z-[var(--z-sticky)] transition-all duration-300 border-b",
      {
        "bg-[var(--background)]/80 backdrop-blur-md border-[var(--surface-border)]": scrolled,
        "bg-transparent border-transparent": !scrolled,
      }
    )}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl h-20 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tighter text-foreground flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-[#00e5ff] shadow-[0_0_10px_#00e5ff]" />
          AiVocate.
        </Link>
        
        <nav className="hidden md:flex items-center gap-8">
          <Link href="#ai-consult" className="text-sm font-medium text-foreground/80 hover:text-[#00e5ff] transition-colors">
            {t.nav.services}
          </Link>
          <Link href="#methodology" className="text-sm font-medium text-foreground/80 hover:text-[#00e5ff] transition-colors">
            {t.nav.methodology}
          </Link>
          <Link href="#metrics" className="text-sm font-medium text-foreground/80 hover:text-[#00e5ff] transition-colors">
            {t.nav.results}
          </Link>
          <Link href="#faq" className="text-sm font-medium text-foreground/80 hover:text-[#00e5ff] transition-colors">
            {t.nav.faq}
          </Link>
        </nav>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-[#0f172a]/80 border border-[var(--surface-border-solid)] rounded-full p-1 w-24 relative shadow-inner">
            <div 
              className="absolute h-[calc(100%-8px)] w-[41px] bg-[#00e5ff] rounded-full top-[4px] shadow-[0_0_10px_rgba(0,229,255,0.4)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ left: language === 'es' ? '4px' : '48px' }}
            />
            <button 
              onClick={() => setLanguage('es')}
              className={`flex-1 flex items-center justify-center z-10 text-xs font-semibold py-1 transition-colors ${language === 'es' ? 'text-[#0f172a]' : 'text-foreground/60 hover:text-foreground'}`}
            >
              ES
            </button>
            <button 
              onClick={() => setLanguage('en')}
              className={`flex-1 flex items-center justify-center z-10 text-xs font-semibold py-1 transition-colors ${language === 'en' ? 'text-[#0f172a]' : 'text-foreground/60 hover:text-foreground'}`}
            >
              EN
            </button>
          </div>

          <Button size="sm" className="hidden lg:inline-flex" onClick={() => {
              document.getElementById('ai-consult')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            {t.footer.talkToAi}
          </Button>
        </div>
      </div>
    </header>
  );
}
