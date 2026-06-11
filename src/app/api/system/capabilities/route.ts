import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// GET /api/system/capabilities — capacidades operativas del despliegue.
// ---------------------------------------------------------------------------
// Pública y sin datos de tenant: solo booleanos de configuración que la UI
// necesita ANTES de prometer un flujo. Caso concreto: better-auth 1.6.x
// envuelve sendResetPassword en runInBackgroundOrAwait, que captura y NO
// re-lanza errores del hook — el endpoint de reset siempre responde
// status:true aunque el email jamás salga. La única forma de que
// /forgot-password sea honesto es saber de antemano si hay entrega de email.
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json(
    {
      emailDelivery: Boolean(process.env.RESEND_API_KEY),
      // Billing (@better-auth/stripe) — true solo cuando el plugin Stripe está
      // montado (ambas claves presentes). La UI de /workspace/settings usa
      // este booleano antes de ofrecer upgrade/cancel.
      billing: Boolean(
        process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
      ),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
