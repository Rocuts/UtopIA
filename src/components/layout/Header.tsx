'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LayoutDashboard } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const pathname = usePathname();
  const isWorkspace = pathname.startsWith('/workspace');

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Workspace pages have their own layout with status bar — do not render the marketing header
  if (isWorkspace) return null;

  return (
    <header className={cn(
      "fixed top-0 w-full z-[var(--z-sticky)] transition-colors duration-100 border-b",
      {
        "bg-n-0/80 backdrop-blur-sm border-n-200": scrolled,
        "bg-transparent border-transparent": !scrolled,
      }
    )}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width)] h-16 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight text-n-900">
          1+1
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          <Link href="#services" className="text-sm text-n-600 hover:text-n-900 transition-colors">
            {t.nav.services}
          </Link>
          <Link href="#methodology" className="text-sm text-n-600 hover:text-n-900 transition-colors">
            {t.nav.methodology}
          </Link>
          <Link href="#metrics" className="text-sm text-n-600 hover:text-n-900 transition-colors">
            {t.nav.results}
          </Link>
          <Link href="#faq" className="text-sm text-n-600 hover:text-n-900 transition-colors">
            {t.nav.faq}
          </Link>
          <Link href="/dashboard" className="text-sm text-n-600 hover:text-n-900 transition-colors flex items-center gap-1.5">
            <LayoutDashboard className="w-4 h-4" />
            {t.nav.dashboard}
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <div className="flex items-center border border-n-200 rounded-sm p-0.5 relative">
            <button
              onClick={() => setLanguage('es')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
                language === 'es'
                  ? 'bg-n-900 text-n-0'
                  : 'text-n-400 hover:text-n-900'
              )}
            >
              ES
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
                language === 'en'
                  ? 'bg-n-900 text-n-0'
                  : 'text-n-400 hover:text-n-900'
              )}
            >
              EN
            </button>
          </div>

          <Link href="/workspace">
            <Button size="sm" className="hidden lg:inline-flex">
              {t.footer.talkToAi}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
