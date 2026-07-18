'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Reject external URLs — parse with URL() so parser differentials can't bypass.
  // Control characters stripped first since they confuse URL parsers.
  const rawNext = (searchParams.get('next') ?? '/workspace').replace(/[\t\n\r]/g, '');
  let next = '/workspace';
  try {
    const parsed = new URL(rawNext, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (parsed.origin === (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')) {
      next = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    // malformed URL — keep default
  }

  // ?mode=signup abre directo en "Crear cuenta" (p. ej. desde /signup).
  const [mode, setMode] = useState<'login' | 'signup'>(
    searchParams.get('mode') === 'signup' ? 'signup' : 'login',
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (mode === 'signup') {
      const { error: err } = await authClient.signUp.email({ email, password, name });
      if (err) {
        setError(err.message ?? 'No se pudo crear la cuenta.');
        setLoading(false);
        return;
      }
      router.push(next);
      return;
    }

    const { error: err } = await authClient.signIn.email({ email, password });
    if (err) {
      setError(err.message ?? 'Credenciales incorrectas.');
      setLoading(false);
      return;
    }
    router.push(next);
  }

  const isLogin = mode === 'login';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.05fr 0.95fr',
        minHeight: '100vh',
      }}
    >
      {/* ── BRAND SIDE ── */}
      <aside
        style={{
          position: 'relative',
          overflow: 'hidden',
          padding: '56px clamp(36px, 5vw, 72px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(160deg, #1A1611, #2F2A20)',
          color: '#FCFBF8',
        }}
        className="max-[860px]:hidden"
      >
        {/* floating blob */}
        <div
          style={{
            position: 'absolute',
            width: '60vmax',
            height: '60vmax',
            borderRadius: '50%',
            top: '-24vmax',
            right: '-20vmax',
            background: 'radial-gradient(circle, rgba(184,147,74,0.22), transparent 66%)',
            filter: 'blur(30px)',
            animation: 'blobFloat 22s ease-in-out infinite alternate',
            pointerEvents: 'none',
          }}
        />

        <style>{`
          @keyframes blobFloat {
            from { transform: translate(0, 0) scale(1); }
            to   { transform: translate(-6vmax, 5vmax) scale(1.15); }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-blob] { animation: none !important; }
          }
          @keyframes goldShimmer {
            0%   { background-position: 200% center; }
            100% { background-position: -200% center; }
          }
          .gold-shimmer {
            background: linear-gradient(90deg, #B8934A 0%, #E8C97A 40%, #F5E09A 50%, #E8C97A 60%, #B8934A 100%);
            background-size: 200% 100%;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: goldShimmer 4.5s ease-in-out infinite;
          }
        `}</style>

        {/* back link */}
        <Link
          href="/"
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13,
            color: 'rgba(196,187,165,0.85)',
            textDecoration: 'none',
            marginTop: 24,
          }}
          className="hover:text-[#FCFBF8] transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Volver al inicio
        </Link>

        {/* wordmark */}
        <div style={{ position: 'relative', zIndex: 1, marginTop: 8 }}>
          <span
            style={{
              fontFamily: 'var(--font-serif-elite, serif)',
              fontWeight: 600,
              fontSize: 34,
              color: '#FCFBF8',
            }}
          >
            1<span className="gold-shimmer">+</span>1
          </span>
        </div>

        {/* tagline quote */}
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '18ch' }}>
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              color: 'rgba(212,184,118,0.9)',
              fontWeight: 600,
            }}
          >
            UtopIA · Workspace Elite
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-serif-elite, serif)',
              fontWeight: 400,
              fontSize: 'clamp(2rem, 3.4vw, 3rem)',
              color: '#FCFBF8',
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              marginTop: 18,
              marginBottom: 0,
            }}
          >
            Claridad financiera para el empresario colombiano.
          </h2>
          <div
            style={{
              fontFamily: 'var(--font-serif-elite, serif)',
              fontStyle: 'italic',
              color: 'rgba(230,209,154,0.92)',
              marginTop: 18,
              fontSize: 'var(--text-lg, 1.125rem)',
            }}
          >
            Tan sencillo como 1+1.
          </div>
        </div>

        {/* credential stats */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 22, flexWrap: 'wrap', color: 'rgba(196,187,165,0.8)' }}>
          {[
            { value: '+500', label: 'Casos resueltos' },
            { value: '$2,4B', label: 'Ahorro generado' },
            { value: '98,7%', label: 'Precisión' },
          ].map((stat) => (
            <div key={stat.label}>
              <div style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, fontSize: 'var(--text-xl, 1.25rem)', color: '#FCFBF8' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 'var(--text-xs, 0.75rem)' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── FORM SIDE ── */}
      <main
        className="flex items-center justify-center px-6 py-12"
        style={{ background: 'radial-gradient(900px 600px at 80% 110%, rgba(184,147,74,0.08), transparent 60%), var(--color-n-0, #FDFCF8)' }}
      >
        <div className="w-full max-w-[400px]">
          {/* mini wordmark */}
          <div className="flex items-center gap-3 mb-7">
            <span
              style={{ fontFamily: 'var(--font-serif-elite, serif)', fontWeight: 600, fontSize: 24 }}
              className="text-n-1000"
            >
              1<span className="gold-shimmer">+</span>1
            </span>
          </div>

          {/* segmented tabs */}
          <div className="flex p-[3px] rounded-xl bg-n-100 border border-n-200 mb-7">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-all ${
                isLogin
                  ? 'bg-n-0 text-n-1000 shadow-sm'
                  : 'bg-transparent text-n-600 hover:text-n-800'
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-all ${
                !isLogin
                  ? 'bg-n-0 text-n-1000 shadow-sm'
                  : 'bg-transparent text-n-600 hover:text-n-800'
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <h1
            style={{ fontFamily: 'var(--font-serif-elite, serif)', fontWeight: 500, letterSpacing: '-0.02em' }}
            className="text-3xl text-n-1000"
          >
            {isLogin ? 'Bienvenido de vuelta' : 'Cree su cuenta'}
          </h1>
          <p className="text-sm text-n-600 mt-1.5 mb-7">
            {isLogin ? 'Acceda a su workspace financiero.' : 'Empiece su claridad financiera hoy.'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* name field — signup only */}
            {!isLogin && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.08em] text-n-700">
                  Nombre completo
                </label>
                <div className="flex items-center gap-2.5 h-[46px] px-3.5 bg-n-0 border border-n-200 rounded-xl focus-within:border-gold-500 focus-within:ring-[3px] focus-within:ring-gold-500/15 transition-all">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-n-500 shrink-0">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder="Carlos Restrepo"
                    className="flex-1 border-none outline-none bg-transparent text-sm text-n-900 placeholder:text-n-500"
                  />
                </div>
              </div>
            )}

            {/* email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.08em] text-n-700">
                Correo electrónico
              </label>
              <div className="flex items-center gap-2.5 h-[46px] px-3.5 bg-n-0 border border-n-200 rounded-xl focus-within:border-gold-500 focus-within:ring-[3px] focus-within:ring-gold-500/15 transition-all">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-n-500 shrink-0">
                  <rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="nombre@empresa.com"
                  className="flex-1 border-none outline-none bg-transparent text-sm text-n-900 placeholder:text-n-500"
                />
              </div>
            </div>

            {/* password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.08em] text-n-700">
                Contraseña
              </label>
              <div className="flex items-center gap-2.5 h-[46px] px-3.5 bg-n-0 border border-n-200 rounded-xl focus-within:border-gold-500 focus-within:ring-[3px] focus-within:ring-gold-500/15 transition-all">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-n-500 shrink-0">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  className="flex-1 border-none outline-none bg-transparent text-sm text-n-900 placeholder:text-n-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-n-500 hover:text-n-800 transition-colors p-0 bg-transparent border-none cursor-pointer"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* remember me + forgot password — login only */}
            {isLogin && (
              <div className="flex items-center justify-between mt-[-4px]">
                <label className="flex items-center gap-2 text-sm text-n-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="accent-gold-500 w-[15px] h-[15px]"
                  />
                  Recordarme
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-gold-600 font-medium hover:text-gold-700 transition-colors"
                >
                  ¿Olvidó su contraseña?
                </Link>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
            )}

            {/* submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-60 flex items-center justify-center gap-2 text-sm font-semibold text-n-0 transition-colors mt-1"
            >
              {!loading && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              )}
              {loading
                ? (isLogin ? 'Ingresando…' : 'Creando cuenta…')
                : (isLogin ? 'Entrar al workspace' : 'Crear cuenta y entrar')}
            </button>
          </form>

          {/* divider */}
          <div className="flex items-center gap-3.5 my-6 text-n-500 text-xs">
            <span className="flex-1 h-px bg-n-200" />
            o continúe con
            <span className="flex-1 h-px bg-n-200" />
          </div>

          {/* SSO buttons — visual only */}
          <div className="flex gap-3">
            <button
              type="button"
              className="flex-1 h-11 border border-n-200 bg-n-0 rounded-xl flex items-center justify-center gap-2 text-sm font-medium text-n-800 hover:border-n-300 hover:bg-n-50 transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
              </svg>
              SSO empresarial
            </button>
            <button
              type="button"
              className="flex-1 h-11 border border-n-200 bg-n-0 rounded-xl flex items-center justify-center gap-2 text-sm font-medium text-n-800 hover:border-n-300 hover:bg-n-50 transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 9.33-2.5"/>
              </svg>
              Llave de acceso
            </button>
          </div>

          {/* footer link */}
          <p className="text-center text-sm text-n-600 mt-6">
            {isLogin ? (
              <>
                ¿No tiene cuenta?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('signup'); setError(null); }}
                  className="text-gold-600 font-medium hover:text-gold-700 transition-colors bg-transparent border-none cursor-pointer p-0"
                >
                  Cree una
                </button>
              </>
            ) : (
              <>
                ¿Ya tiene cuenta?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); }}
                  className="text-gold-600 font-medium hover:text-gold-700 transition-colors bg-transparent border-none cursor-pointer p-0"
                >
                  Inicie sesión
                </button>
              </>
            )}
          </p>

          {!isLogin && (
            <p className="text-xs text-n-500 mt-4 leading-snug">
              Al crear una cuenta acepta nuestros Términos y la Política de Tratamiento de Datos (Ley 1581 de 2012).
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
