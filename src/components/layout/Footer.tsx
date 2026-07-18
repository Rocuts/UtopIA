'use client';

import Link from 'next/link';

const NAV = [
  {
    heading: 'Servicios',
    links: [
      { label: 'Defensa DIAN', href: '/workspace/escudo/defensa-dian' },
      { label: 'Devoluciones', href: '/workspace/escudo/devoluciones' },
      { label: 'Due diligence', href: '/workspace/valor/due-diligence' },
      { label: 'NIIF Elite', href: '/workspace' },
    ],
  },
  {
    heading: 'Producto',
    links: [
      { label: 'Centro de Comando', href: '/workspace' },
      { label: 'Contabilidad Pyme', href: '/workspace/pyme' },
      { label: 'Contabilidad', href: '/workspace/contabilidad' },
      { label: 'Abrir un caso', href: '/workspace/intake' },
    ],
  },
  {
    heading: 'Soporte',
    links: [
      { label: 'Preguntas frecuentes', href: '#faq' },
      { label: 'Iniciar sesión', href: '/login' },
      { label: 'Configuración', href: '/workspace/settings' },
      { label: 'Admin', href: '/admin' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-n-50 border-t border-n-200">
      <div
        className="max-w-[1180px] mx-auto"
        style={{ padding: '60px clamp(22px, 5vw, 56px) 40px' }}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <Link href="/" aria-label="1+1 inicio">
              <span
                className="font-serif-elite font-semibold inline-flex items-baseline"
                style={{ fontSize: '28px', letterSpacing: '-0.01em' }}
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
            <p
              className="font-serif-elite italic text-n-600 mt-3 leading-snug"
              style={{ fontSize: '0.8125rem', maxWidth: '30ch' }}
            >
              Tan sencillo como 1+1.
            </p>
          </div>

          {/* Link groups */}
          {NAV.map((group) => (
            <div key={group.heading}>
              <h5
                className="text-n-500 font-bold uppercase mb-3.5"
                style={{ fontSize: '0.625rem', letterSpacing: '0.2em' }}
              >
                {group.heading}
              </h5>
              <ul className="space-y-0">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="block text-n-600 hover:text-gold-600 transition-colors duration-200 py-[5px]"
                      style={{ fontSize: '0.8125rem' }}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Footer bottom */}
      <div className="border-t border-n-200">
        <div
          className="max-w-[1180px] mx-auto flex flex-wrap justify-between items-center gap-3 text-xs text-n-500"
          style={{ padding: '20px clamp(22px, 5vw, 56px)' }}
        >
          <span>© 2026 UtopIA · 1+1 — Claridad financiera para el empresario colombiano.</span>
          <span>Bogotá · Colombia</span>
        </div>
      </div>
    </footer>
  );
}
