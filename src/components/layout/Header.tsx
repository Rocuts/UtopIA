'use client';

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LayoutDashboard } from "lucide-react";
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
      "fixed top-0 w-full z-[var(--z-sticky)] transition-colors duration-100 border-b",
      {
        "bg-white/80 backdrop-blur-sm border-[#e5e5e5]": scrolled,
        "bg-transparent border-transparent": !scrolled,
      }
    )}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl h-16 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight text-[#0a0a0a] flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#0a0a0a]" />
          UtopIA.
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          <Link href="#services" className="text-sm text-[#525252] hover:text-[#0a0a0a] transition-colors">
            {t.nav.services}
          </Link>
          <Link href="#methodology" className="text-sm text-[#525252] hover:text-[#0a0a0a] transition-colors">
            {t.nav.methodology}
          </Link>
          <Link href="#metrics" className="text-sm text-[#525252] hover:text-[#0a0a0a] transition-colors">
            {t.nav.results}
          </Link>
          <Link href="#faq" className="text-sm text-[#525252] hover:text-[#0a0a0a] transition-colors">
            {t.nav.faq}
          </Link>
          <Link href="/dashboard" className="text-sm text-[#525252] hover:text-[#0a0a0a] transition-colors flex items-center gap-1.5">
            <LayoutDashboard className="w-4 h-4" />
            {t.nav.dashboard}
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <div className="flex items-center border border-[#e5e5e5] rounded-sm p-0.5 relative">
            <button
              onClick={() => setLanguage('es')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
                language === 'es'
                  ? 'bg-[#0a0a0a] text-white'
                  : 'text-[#a3a3a3] hover:text-[#0a0a0a]'
              )}
            >
              ES
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
                language === 'en'
                  ? 'bg-[#0a0a0a] text-white'
                  : 'text-[#a3a3a3] hover:text-[#0a0a0a]'
              )}
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
