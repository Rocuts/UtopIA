'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createAuthClient } from 'better-auth/react';

const authClient = createAuthClient();

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Reject external URLs — parse with URL() so parser differentials can't bypass.
  // Control characters (\t \n \r \0) stripped first since they confuse URL parsers.
  const rawNext = (searchParams.get('next') ?? '/workspace').replace(/[\t\n\r\0]/g, '');
  let next = '/workspace';
  try {
    const parsed = new URL(rawNext, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (parsed.origin === (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')) {
      next = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    // malformed URL — keep default
  }

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: err } = await authClient.signIn.email({ email, password });
    if (err) {
      setError(err.message ?? 'Credenciales incorrectas.');
      setLoading(false);
      return;
    }
    router.push(next);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-n-50 dark:bg-n-0 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif-elite text-2xl text-n-1000">UtopIA</h1>
          <p className="mt-1 text-sm text-n-600">Ingrese a su cuenta</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-n-200 dark:border-n-800 bg-n-0 dark:bg-n-50/5 p-8 shadow-sm"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
              Correo electrónico
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="rounded-lg bg-n-50 dark:bg-n-900 border border-n-300 dark:border-n-700 px-3 py-2.5 text-sm text-n-1000 focus:outline-none focus:border-gold-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
              Contraseña
            </label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="rounded-lg bg-n-50 dark:bg-n-900 border border-n-300 dark:border-n-700 px-3 py-2.5 text-sm text-n-1000 focus:outline-none focus:border-gold-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-lg bg-gold-600 hover:bg-gold-700 disabled:opacity-60 px-4 py-2.5 text-sm font-medium text-n-0 transition-colors"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>

          <p className="text-center text-xs text-n-500">
            ¿No tiene cuenta?{' '}
            <Link href="/signup" className="text-gold-600 hover:underline">
              Regístrese
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
