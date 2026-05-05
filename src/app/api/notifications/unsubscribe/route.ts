import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken } from '@/lib/notifications/unsubscribe-token';
import * as repo from '@/lib/notifications/repository';

// ---------------------------------------------------------------------------
// GET /api/notifications/unsubscribe?token=X&id=subscriptionId
//
// Public route — no cookie auth needed. The token is clicked from an email
// link. We verify the HMAC signature via verifyUnsubscribeToken, then
// soft-delete the subscription.
//
// Returns HTML (text/html) in Spanish so the user sees a human-readable page.
// GET is not subject to CSRF protection (proxy.ts only checks mutating methods).
// ---------------------------------------------------------------------------

function htmlPage(title: string, body: string, success: boolean): NextResponse {
  const color = success ? '#166534' : '#991b1b';
  const bgColor = success ? '#f0fdf4' : '#fff1f2';
  const borderColor = success ? '#86efac' : '#fca5a5';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — UtopIA</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #fffbeb;
      color: #1c1917;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      background: ${bgColor};
      border: 1.5px solid ${borderColor};
      border-radius: 12px;
      padding: 2.5rem 3rem;
      max-width: 480px;
      width: 100%;
      text-align: center;
    }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 700; color: ${color}; margin-bottom: 0.75rem; }
    p { font-size: 0.95rem; color: #44403c; line-height: 1.6; }
    .brand {
      margin-top: 2rem;
      font-size: 0.8rem;
      color: #a8a29e;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✅' : '⚠️'}</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <p class="brand">UtopIA — Plataforma de asesoría contable y tributaria colombiana</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: success ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const token = searchParams.get('token');
  const subscriptionId = searchParams.get('id');

  if (!token || !subscriptionId) {
    return htmlPage(
      'Enlace inválido',
      'Este enlace de cancelación es inválido o está incompleto. Si crees que es un error, contacta a soporte.',
      false,
    );
  }

  // Verify HMAC signature.
  const valid = verifyUnsubscribeToken(subscriptionId, token);
  if (!valid) {
    return htmlPage(
      'Token inválido o expirado',
      'El enlace de cancelación no es válido o ya expiró. Si deseas cancelar tu suscripción, puedes hacerlo desde la configuración de tu cuenta en UtopIA.',
      false,
    );
  }

  try {
    // Soft-delete: set active=false. Pass a dummy workspaceId bypass — we trust
    // the HMAC signature as the ownership proof for one-click unsubscribe.
    const sub = await repo.findSubscriptionById(subscriptionId);
    if (!sub) {
      // Already deleted — treat as success (idempotent).
      return htmlPage(
        'Suscripción cancelada',
        'Ya no recibirás notificaciones de UtopIA en este correo.',
        true,
      );
    }

    await repo.updateSubscriptionActive(subscriptionId, sub.workspaceId, false);

    return htmlPage(
      'Suscripción cancelada',
      'Ya no recibirás notificaciones de UtopIA en este correo. Si cambias de opinión, puedes volver a suscribirte desde la plataforma.',
      true,
    );
  } catch (err) {
    console.error('[api/notifications/unsubscribe] error', err);
    return htmlPage(
      'Error al cancelar',
      'Ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo o contacta a soporte.',
      false,
    );
  }
}
