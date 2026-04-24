'use client';

import type { ERPProvider } from '@/lib/erp/types';

type LogoProps = {
  className?: string;
  size?: number;
};

function AlegraLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="8" fill="#00B388" />
      <path
        d="M25.5 14h-2.7v1.8c-1-1.3-2.5-2.1-4.4-2.1-3.8 0-6.8 3.1-6.8 7s3 7 6.8 7c1.9 0 3.4-0.8 4.4-2.1V27h2.7V14zm-6.7 10.9c-2.3 0-4.1-1.8-4.1-4.2s1.8-4.2 4.1-4.2 4.1 1.8 4.1 4.2-1.8 4.2-4.1 4.2z"
        fill="#ffffff"
      />
    </svg>
  );
}

function SiigoLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="8" fill="#16A34A" />
      <text
        x="20"
        y="26"
        textAnchor="middle"
        fontSize="14"
        fontWeight="800"
        fill="#ffffff"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="-0.5"
      >
        siigo
      </text>
    </svg>
  );
}

function HelisaLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="8" fill="#7C3AED" />
      <path
        d="M13 12h3v6.5h8V12h3v16h-3v-6.7h-8V28h-3z"
        fill="#ffffff"
      />
      <circle cx="30" cy="13" r="1.8" fill="var(--gold-400)" />
    </svg>
  );
}

function WorldOfficeLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="8" fill="#4F46E5" />
      <circle cx="20" cy="20" r="9" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.4" />
      <path
        d="M9.5 13.5L12.2 26.5h2.3l2-8.2 2 8.2h2.3l2-8.2 2 8.2h2.3l2.7-13h-2.6l-1.5 8.5-2-8.5h-1.8l-2 8.5-1.5-8.5z"
        fill="#ffffff"
      />
    </svg>
  );
}

function ContaPymeLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="8" fill="#0D9488" />
      <rect x="11" y="11" width="18" height="18" rx="2" fill="none" stroke="#ffffff" strokeWidth="1.5" />
      <path d="M14 15h12M14 18h8M14 21h12M14 24h6" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="25" cy="24" r="2.5" fill="var(--gold-400)" />
    </svg>
  );
}

function SapLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sap-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#008FD3" />
          <stop offset="1" stopColor="#0070F2" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="4" fill="url(#sap-grad)" />
      <text
        x="20"
        y="26"
        textAnchor="middle"
        fontSize="13"
        fontWeight="900"
        fill="#ffffff"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="0.5"
      >
        SAP
      </text>
    </svg>
  );
}

function Dynamics365Logo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="8" fill="#0078D4" />
      <rect x="9" y="9" width="8" height="8" fill="#F25022" />
      <rect x="19" y="9" width="8" height="8" fill="#7FBA00" />
      <rect x="9" y="19" width="8" height="8" fill="#00A4EF" />
      <rect x="19" y="19" width="8" height="8" fill="#FFB900" />
      <text
        x="20"
        y="35"
        textAnchor="middle"
        fontSize="6"
        fontWeight="700"
        fill="#ffffff"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        D365
      </text>
    </svg>
  );
}

function QuickBooksLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="20" fill="#2CA01C" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#ffffff" strokeWidth="2.5" />
      <path
        d="M15 17v6c0 1.6 1.4 3 3 3h4M25 23v-6c0-1.6-1.4-3-3-3h-4"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function XeroLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="20" fill="#13B5EA" />
      <path
        d="M13.5 13.5L20 20l-6.5 6.5M26.5 13.5L20 20l6.5 6.5"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function OdooLogo({ className, size = 36 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="8" fill="#714B67" />
      <circle cx="15" cy="20" r="5" fill="none" stroke="#ffffff" strokeWidth="2.5" />
      <circle cx="25" cy="20" r="5" fill="#A24689" />
    </svg>
  );
}

const LOGOS: Record<ERPProvider, React.FC<LogoProps>> = {
  alegra: AlegraLogo,
  siigo: SiigoLogo,
  helisa: HelisaLogo,
  world_office: WorldOfficeLogo,
  contapyme: ContaPymeLogo,
  sap_b1: SapLogo,
  dynamics_365: Dynamics365Logo,
  quickbooks: QuickBooksLogo,
  xero: XeroLogo,
  odoo: OdooLogo,
};

export function ERPLogo({
  provider,
  className,
  size,
}: {
  provider: ERPProvider;
  className?: string;
  size?: number;
}) {
  const Logo = LOGOS[provider];
  if (!Logo) return null;
  return <Logo className={className} size={size} />;
}
