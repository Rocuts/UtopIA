'use client';

/**
 * AdminGate — entrada del token de administrador.
 *
 * Verifica el token contra el endpoint real (`/api/admin/activity`) antes de
 * dejar pasar, de modo que un token inválido nunca llega al visor.
 *   - 200 → onAuth(token)
 *   - 401 → token inválido
 *   - 503 → UTOPIA_ADMIN_TOKEN no configurado en el servidor
 */

import { useState, type FormEvent } from 'react';
import { ShieldCheck, Loader2, KeyRound } from 'lucide-react';

export function AdminGate({ onAuth }: { onAuth: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'error' | 'disabled'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setStatus('checking');
    setMessage('');
    try {
      const res = await fetch('/api/admin/activity?hours=1&limit=1', {
        headers: { 'x-admin-token': token },
        cache: 'no-store',
      });
      if (res.ok) {
        onAuth(token);
        return;
      }
      if (res.status === 503) {
        setStatus('disabled');
        setMessage(
          'El endpoint admin está deshabilitado: falta configurar UTOPIA_ADMIN_TOKEN en el servidor.',
        );
        return;
      }
      setStatus('error');
      setMessage('Token inválido. Verifica el valor de UTOPIA_ADMIN_TOKEN.');
    } catch {
      setStatus('error');
      setMessage('No se pudo contactar el servidor. Reintenta.');
    }
  }

  const checking = status === 'checking';

  return (
    <main className="min-h-screen bg-n-0 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6 text-gold-500" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-n-1000">Consola de Actividad</h1>
          <p className="text-sm text-n-700 mt-1">
            Acceso restringido. Ingresa el token de administrador.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <KeyRound
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-n-500"
              aria-hidden="true"
            />
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="UTOPIA_ADMIN_TOKEN"
              autoFocus
              autoComplete="off"
              aria-label="Token de administrador"
              className="w-full h-11 pl-9 pr-3 rounded-lg bg-n-50 border border-n-300 text-n-1000 text-sm placeholder:text-n-400 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={checking || !value.trim()}
            className="w-full h-11 rounded-lg bg-gold-500 hover:bg-gold-600 text-n-0 text-sm font-semibold transition-colors disabled:opacity-50 disabled:text-n-0 inline-flex items-center justify-center gap-2"
          >
            {checking && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {checking ? 'Verificando…' : 'Entrar'}
          </button>
        </form>

        {message && (
          <p
            role="alert"
            className={`mt-4 text-sm text-center ${
              status === 'disabled' ? 'text-warning' : 'text-danger'
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
