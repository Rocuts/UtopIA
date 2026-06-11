'use client';

/**
 * /forgot-password — solicitud de restablecimiento de contraseña.
 *
 * Flujo BetterAuth: authClient.requestPasswordReset({ email, redirectTo })
 * → el servidor envía el enlace vía Resend (config.ts sendResetPassword).
 *
 * Honestidad: better-auth 1.6.x TRAGA los errores del hook sendResetPassword
 * (runInBackgroundOrAwait hace catch sin re-throw) y responde status:true
 * aunque el email nunca salga — el `if (err)` del cliente jamás se entera.
 * Por eso la página consulta GET /api/system/capabilities ANTES de mostrar
 * el formulario: sin entrega de email configurada se muestra el estado
 * "no disponible" en vez de un "Revise su correo" falso.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, MailCheck, MailX } from 'lucide-react';
import { authClient } from '@/lib/auth/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** null = consultando; true/false = capacidad real de entrega de email. */
  const [emailDelivery, setEmailDelivery] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/system/capabilities');
        const json = (await res.json()) as { emailDelivery?: boolean };
        if (!cancelled) setEmailDelivery(Boolean(json.emailDelivery));
      } catch {
        // Si ni la consulta funciona, no prometemos nada.
        if (!cancelled) setEmailDelivery(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/reset-password',
    });
    setLoading(false);
    if (err) {
      setError(
        err.message?.includes('email_delivery')
          ? 'El envío de correos no está configurado en este ambiente. Contacte al administrador.'
          : err.message ?? 'No se pudo procesar la solicitud.',
      );
      return;
    }
    setSent(true);
  };

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

        {emailDelivery === false ? (
          <div className="text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/12 text-warning">
              <MailX className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h1 className="font-serif-elite text-2xl font-medium text-n-1000">
              Restablecimiento no disponible
            </h1>
            <p className="mx-auto mt-2 max-w-[42ch] text-sm leading-relaxed text-n-600">
              Este ambiente no tiene configurado el envío de correos, así que
              no podemos mandarle el enlace de restablecimiento. Contacte al
              administrador de la plataforma.
            </p>
          </div>
        ) : sent ? (
          <div className="text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gold-500/12 text-gold-600">
              <MailCheck className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h1 className="font-serif-elite text-2xl font-medium text-n-1000">
              Revise su correo
            </h1>
            <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-relaxed text-n-600">
              Si existe una cuenta para <b>{email}</b>, le enviamos un enlace
              para crear una nueva contraseña. El enlace expira pronto.
            </p>
          </div>
        ) : (
          <>
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold-500/12 text-gold-600">
              <KeyRound className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h1 className="font-serif-elite text-2xl font-medium text-n-1000">
              ¿Olvidó su contraseña?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-n-600">
              Escriba el correo de su cuenta y le enviamos un enlace para crear
              una nueva.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="fp-email"
                  className="text-xs font-semibold uppercase tracking-[0.08em] text-n-700"
                >
                  Correo electrónico
                </label>
                <input
                  id="fp-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usted@suempresa.com"
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
                disabled={loading || emailDelivery !== true}
                className="h-11 rounded-lg bg-gold-500 text-sm font-semibold text-white transition-colors hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? 'Enviando…'
                  : emailDelivery === null
                    ? 'Verificando…'
                    : 'Enviar enlace'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
