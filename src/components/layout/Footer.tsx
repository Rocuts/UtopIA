'use client';

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { useLanguage } from '@/context/LanguageContext';

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { t } = useLanguage();

  return (
    <footer className="border-t border-[#e5e5e5] bg-white pt-16 pb-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">

          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="inline-block text-lg font-bold text-[#0a0a0a] mb-4 tracking-tight hover:opacity-70 transition-opacity">
              1+1
            </Link>
            <p className="text-[#525252] max-w-sm mb-6 text-sm leading-relaxed">
              {t.footer.tagline}
            </p>
            <Badge variant="outline">
              {t.footer.badge}
            </Badge>
          </div>

          <div>
            <h4 className="font-medium text-[#0a0a0a] mb-4 text-sm">{t.footer.coverage}</h4>
            <ul className="flex flex-col gap-3 text-sm text-[#525252]">
              <li><Link href="#services" className="hover:text-[#0a0a0a] transition-colors">{t.services.s1_title}</Link></li>
              <li><Link href="#services" className="hover:text-[#0a0a0a] transition-colors">{t.services.s2_title}</Link></li>
              <li><Link href="#services" className="hover:text-[#0a0a0a] transition-colors">{t.services.s3_title}</Link></li>
              <li><Link href="#services" className="hover:text-[#0a0a0a] transition-colors">{t.footer.compliance}</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-medium text-[#0a0a0a] mb-4 text-sm">{t.footer.support}</h4>
            <ul className="flex flex-col gap-3 text-sm text-[#525252]">
              <li><Link href="#methodology" className="hover:text-[#0a0a0a] transition-colors">{t.nav.methodology}</Link></li>
              <li><Link href="#faq" className="hover:text-[#0a0a0a] transition-colors">{t.nav.faq}</Link></li>
              <li><Link href="#" className="hover:text-[#0a0a0a] transition-colors">{t.footer.contact}</Link></li>
              <li><Link href="#" className="hover:text-[#0a0a0a] transition-colors">{t.footer.dataPrivacy}</Link></li>
            </ul>
          </div>

        </div>

        <div className="border-t border-[#e5e5e5] pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-[#a3a3a3]">
          <p>&copy; {currentYear} 1+1. {t.footer.rights}</p>
          <div className="flex gap-4">
            <Link href="#" className="hover:text-[#0a0a0a] transition-colors">{t.footer.privacy}</Link>
            <Link href="#" className="hover:text-[#0a0a0a] transition-colors">{t.footer.terms}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
