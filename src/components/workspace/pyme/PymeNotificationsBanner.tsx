'use client';

/**
 * PymeNotificationsBanner — solicita permiso de notificaciones y configura
 * recordatorios automáticos para los vencimientos DIAN próximos.
 *
 * Lógica:
 * - Si el permiso no ha sido solicitado → muestra el banner de activación.
 * - Si el permiso fue concedido → muestra chip verde "Activas" + botón probar.
 * - Si fue denegado → muestra chip rojo con instrucción de ajuste manual.
 * - Comprueba al montar si hay vencimientos dentro de 15 días y dispara
 *   una notificación de prueba/recordatorio inmediata.
 *
 * No requiere servidor push — usa setInterval local (se pierde al cerrar tab).
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePymeDeadlines } from '@/components/workspace/pyme/usePymeData';

type PermissionState = 'unknown' | 'granted' | 'denied' | 'default';

function getStoredPermission(): PermissionState {
  if (typeof window === 'undefined') return 'unknown';
  return (localStorage.getItem('pyme_notif_perm') as PermissionState | null) ?? 'unknown';
}

function savePermission(p: PermissionState) {
  localStorage.setItem('pyme_notif_perm', p);
}

function sendNotification(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: '/favicon.ico' });
}

export function PymeNotificationsBanner() {
  const [perm, setPerm] = useState<PermissionState>(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unknown';
    const real = Notification.permission as PermissionState;
    const stored = getStoredPermission();
    return real !== 'default' ? real : stored;
  });
  const [dismissed, setDismissed] = useState(false);
  const { upcoming: deadlines } = usePymeDeadlines(new Date().getFullYear());

  // Schedule reminders for deadlines ≤ 15 days away
  useEffect(() => {
    if (perm !== 'granted' || !deadlines.length) return;
    const urgent = deadlines.filter((d) => d.daysUntil >= 0 && d.daysUntil <= 15);
    if (urgent.length === 0) return;

    // Fire once immediately, then every 24 h
    const fire = () => {
      urgent.forEach((d) => {
        sendNotification(
          `Vencimiento en ${d.daysUntil === 0 ? 'hoy' : `${d.daysUntil} días`}`,
          `${d.obligation} — ${d.period}`,
        );
      });
    };

    const t = setInterval(fire, 24 * 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [perm, deadlines]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    const p = result as PermissionState;
    setPerm(p);
    savePermission(p);
    if (p === 'granted') {
      sendNotification('1+1 Contabilidad Pyme', 'Notificaciones activadas. Te avisaremos antes de cada vencimiento.');
    }
  }, []);

  const testNotification = useCallback(() => {
    sendNotification('Recordatorio de prueba', 'Las notificaciones de vencimientos están funcionando correctamente.');
  }, []);

  // Don't render if already granted (silent) or dismissed
  if (dismissed) return null;

  if (perm === 'granted') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-n-100 border border-n-200 text-xs text-n-700">
        <BellRing className="h-3.5 w-3.5 text-[#357A28] shrink-0" strokeWidth={2} aria-hidden />
        <span className="flex-1">Recordatorios de vencimientos activos</span>
        <button
          type="button"
          onClick={testNotification}
          className="text-[#357A28] font-medium hover:underline"
        >
          Probar
        </button>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar" className="text-n-500 hover:text-n-800">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    );
  }

  if (perm === 'denied') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-n-100 border border-n-200 text-xs text-n-600">
        <BellOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span>Notificaciones bloqueadas. Actívalas en Ajustes del navegador.</span>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar" className="text-n-500 hover:text-n-800 ml-auto">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    );
  }

  if (perm === 'unknown' || perm === 'default') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl',
          'border border-[rgba(53,122,40,.25)]',
        )}
        style={{ background: 'rgba(53,122,40,.06)' }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'rgba(53,122,40,.15)', color: '#357A28' }}
        >
          <Bell className="h-4 w-4" strokeWidth={2} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-n-1000 leading-tight">Activa los recordatorios</p>
          <p className="text-xs text-n-600 mt-0.5">
            Te avisamos 15 días antes de cada vencimiento DIAN.
          </p>
        </div>
        <button
          type="button"
          onClick={requestPermission}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#357A28]"
          style={{ background: '#357A28' }}
        >
          Activar
        </button>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar" className="text-n-500 hover:text-n-800">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return null;
}
