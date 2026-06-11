'use client';

/**
 * /reset-password — crea la nueva contraseña con el token del enlace.
 *
 * BetterAuth redirige aquí con ?token=… (redirectTo del request). Sin token
 * válido la página lo dice claramente. El submit llama
 * authClient.resetPassword({ newPassword, token }).
 *
 * useSearchParams exige un boundary de Suspense en Next 16 (mismo patrón
 * que /login).
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth/client';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="font-serif-elite text-2xl font-medium text-n-1000">
          Enlace inválido o vencido
        </h1>
        <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-relaxed text-n-600">
          Este enlace no trae un token de restablecimiento. Solicite uno nuevo
          desde &ldquo;¿Olvidó su contraseña?&rdquo;.
        </p>
        <Link
          href="/forgot-password"
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-gold-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-gold-600"
        >
          Solicitar enlace nuevo
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/12 text-success">
          <ShieldCheck className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="font-serif-elite text-2xl font-medium text-n-1000">
          Contraseña actualizada
        </h1>
        <p className="mt-2 text-sm text-n-600">
          Ya puede iniciar sesión con su nueva contraseña.
        </p>
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="mt-5 h-11 rounded-lg bg-gold-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-gold-600"
        >
          Ir a iniciar sesión
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setLoading(false);
    if (err) {
      setError(err.message ?? 'No se pudo restablecer la contraseña. El enlace puede haber vencido.');
      return;
    }
    setDone(true);
  };

  return (
    <>
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold-500/12 text-gold-600">
        <LockKeyhole className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="font-serif-elite text-2xl font-medium text-n-1000">
        Nueva contraseña
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-n-600">
        Mínimo 8 caracteres. Use una que no repita en otros servicios.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="rp-password"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-n-700"
          >
            Nueva contraseña
          </label>
          <input
            id="rp-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-11 w-full rounded-lg border border-n-200 bg-n-0 px-3.5 text-sm text-n-900 placeholder:text-n-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/15"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="rp-confirm"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-n-700"
          >
            Confirmar contraseña
          </label>
          <input
            id="rp-confirm"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="h-11 w-full rounded-lg border border-n-200 bg-n-0 px-3.5 text-sm text-n-900 placeholder:text-n-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/15"
          />
        </div>

        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="h-11 rounded-lg bg-gold-500 text-sm font-semibold text-white transition-colors hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-n-0 px-4">
      <div className="w-full max-w-md rounded-2xl border border-n-200 bg-n-50 p-8">
        <Link
          href="/login"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-n-600 transition-colors hover:text-n-1000"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver a iniciar sesión
        </Link>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
