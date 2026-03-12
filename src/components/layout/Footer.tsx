'use client';

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { useLanguage } from '@/context/LanguageContext';

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { t } = useLanguage();

  return (
    <footer className="border-t border-[var(--surface-border-solid)]/40 bg-[var(--background)] pt-16 pb-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">

          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="inline-block text-2xl font-bold text-foreground mb-4 tracking-tighter hover:text-cyan-400 transition-colors">
              AiVocate.
            </Link>
            <p className="text-foreground/60 max-w-sm mb-6 text-sm leading-relaxed">
              {t.footer.tagline}
            </p>
            <Badge variant="outline" className="opacity-70">
              {t.footer.badge}
            </Badge>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">{t.footer.coverage}</h4>
            <ul className="flex flex-col gap-3 text-sm text-foreground/60">
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.services.s3_title}</Link></li>
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.services.s2_title}</Link></li>
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.services.s1_title}</Link></li>
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.footer.compliance}</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">{t.footer.support}</h4>
            <ul className="flex flex-col gap-3 text-sm text-foreground/60">
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.nav.methodology}</Link></li>
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.footer.disclaimer}</Link></li>
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.footer.attorneys}</Link></li>
              <li><Link href="#" className="hover:text-[#00e5ff] transition-colors">{t.footer.dataPrivacy}</Link></li>
            </ul>
          </div>

        </div>

        <div className="border-t border-[var(--surface-border-solid)]/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-foreground/40">
          <p>&copy; {currentYear} Advocate Legal AI. {t.footer.rights}</p>
          <div className="flex gap-4">
            <Link href="#" className="hover:text-foreground transition-colors">{t.footer.privacy}</Link>
            <Link href="#" className="hover:text-foreground transition-colors">{t.footer.terms}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
