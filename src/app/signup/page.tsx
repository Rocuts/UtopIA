'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createAuthClient } from 'better-auth/react';

const authClient = createAuthClient();

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: err } = await authClient.signUp.email({ name, email, password });
    if (err) {
      setError(err.message ?? 'No se pudo crear la cuenta.');
      setLoading(false);
      return;
    }
    router.push('/workspace');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-n-50 dark:bg-n-0 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif-elite text-2xl text-n-1000">UtopIA</h1>
          <p className="mt-1 text-sm text-n-600">Cree su cuenta</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-n-200 dark:border-n-800 bg-n-0 dark:bg-n-50/5 p-8 shadow-sm"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
              Nombre completo
            </label>
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="rounded-lg bg-n-50 dark:bg-n-900 border border-n-300 dark:border-n-700 px-3 py-2.5 text-sm text-n-1000 focus:outline-none focus:border-gold-500"
            />
          </div>

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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
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
            {loading ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>

          <p className="text-center text-xs text-n-500">
            ¿Ya tiene cuenta?{' '}
            <Link href="/login" className="text-gold-600 hover:underline">
              Ingresar
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
