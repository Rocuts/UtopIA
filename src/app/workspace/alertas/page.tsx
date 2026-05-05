/**
 * /workspace/alertas — panel de notificaciones y suscripciones (WS6.1).
 *
 * SSR shell delgado idéntico al patrón de `/workspace/contabilidad/page.tsx`:
 * el contenido vivo lo aporta `<AlertDashboard />`, un Client Component que
 * hace fetch a `/api/notifications/{subscriptions,log}` con la cookie
 * `utopia_workspace_id` que ya setea `getOrCreateWorkspace()` en los route
 * handlers.
 *
 * Cuando el feature flag `UTOPIA_ENABLE_NOTIFICATIONS` está OFF, el dashboard
 * sigue mostrándose (las suscripciones existentes se siguen pudiendo
 * gestionar) pero el dispatch silencia los envíos. Esa decisión vive en
 * `dispatch.ts` y no en este shell.
 */

import { AlertDashboard } from '@/components/workspace/AlertDashboard';

export default function AlertasPage() {
  return (
    <main className="min-h-screen bg-n-0 px-6 py-10 md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-n-700">
            Centro de notificaciones
          </p>
          <h1 className="text-3xl font-semibold text-n-1000 md:text-4xl">
            Alertas y suscripciones
          </h1>
          <p className="max-w-2xl text-base text-n-800">
            Configura quién recibe cada evento del 1+1 — cierres mensuales,
            descuadres bancarios, anomalías detectadas — y revisa el historial
            de notificaciones enviadas en los últimos 30 días.
          </p>
        </header>

        <AlertDashboard />
      </div>
    </main>
  );
}
