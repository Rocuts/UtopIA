# Billing — Stripe vía `@better-auth/stripe` (Ola 4 / ADR-06)

> Estado: **implementado, phase-gated**. Sin `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
> el plugin no se monta y la app opera exactamente como antes (sin restricciones de plan).

## Decisión (resuelve ADR-06)

| Opción | Veredicto |
|---|---|
| **Stripe + plugin `@better-auth/stripe`** | ✅ Elegida — el plugin oficial elimina ~400 líneas de glue code: customer lifecycle, Checkout, webhook con verificación de firma HMAC, y tabla `subscription` gestionada por los webhooks. |
| Stripe SDK crudo | Descartada — reimplementa lo que el plugin ya hace (firma, upserts, race conditions). |
| Diferir | Descartada — el riesgo "billing ausente → sin revenue track" del TRD §12 es Alto. |

### ⚠️ Nota de riesgo — Colombia (decisión de negocio pendiente)

**Stripe NO acepta merchants colombianos** (verificado junio 2026, stripe.com/global):
recibir fondos requiere entidad legal en EE.UU. (LLC / C-Corp, p.ej. vía Stripe Atlas)
o en un país soportado. Alternativas si no hay entidad extranjera:

- **Paddle** (Merchant of Record): Paddle es el vendedor legal, maneja IVA global; comisión ~5%.
- **Wompi** (Bancolombia): settlement en COP, PSE/Nequi nativos; requiere integración propia.

La arquitectura lo contiene: si se cambia de pasarela, la tabla `subscription`,
el helper `src/lib/billing/plan.ts` (`requirePlan`, `getWorkspacePlan`) y la UI
de settings sobreviven — solo se reemplaza el plugin del proveedor.

## Arquitectura

```
signup → plugin crea Stripe Customer (user.stripe_customer_id)
UI settings (panel "Plan y facturación")
  └─ authClient.subscription.upgrade({plan}) → Stripe Checkout (precio vive en Stripe)
Stripe → POST /api/auth/stripe/webhook  (montado por el plugin bajo el catch-all BetterAuth)
  └─ verifica firma HMAC (STRIPE_WEBHOOK_SECRET) → upsert tabla "subscription"
Route handlers → requirePlan('pro') (src/lib/billing/plan.ts) → 402 {error:'plan_required'}
```

- **Suscripción por usuario** (`subscription.reference_id` = BetterAuth `user.id`).
  El plan del workspace se resuelve `workspaces.user_id → subscription.reference_id`
  (1 usuario = 1 workspace, ADR-05 Opción A). Workspaces anónimos = `free`.
- **Planes**: `free` (sin fila), `pro`, `enterprise`. Solo se ofrecen los planes
  cuyo `STRIPE_PRICE_ID_*` exista en el entorno.
- **Fase-gated** (mismo patrón que `BETTER_AUTH_SECRET`): billing OFF ⇒
  `getUserPlan()` devuelve `'enterprise'` (sin restricciones) y **no toca la DB**.
  Regresión fijada en `src/lib/billing/__tests__/plan.test.ts`.

## Archivos

| Pieza | Archivo |
|---|---|
| Plugin server (phase-gated) | `src/lib/auth/config.ts` (`buildBillingPlugins`) |
| Plugin client | `src/lib/auth/client.ts` (`stripeClient({ subscription: true })`) |
| Tabla subscription + user.stripe_customer_id | `src/lib/db/schema-auth.ts` + `src/lib/db/migrations/0015_billing_stripe.sql` |
| Gating por plan | `src/lib/billing/plan.ts` (`requirePlan`, `getWorkspacePlan`, `getUserPlan`) |
| CSRF exención del webhook + rate limit | `src/proxy.ts` (`CSRF_ALLOWLIST`, `RATE_LIMITS`) |
| Capability flag para la UI | `GET /api/system/capabilities` → `billing: boolean` |
| UI | `src/app/workspace/settings/page.tsx` (panel `PlanPanel`) |

## Activación (checklist de despliegue)

1. **Migración**: `npm run db:migrate` (aplica `0015_billing_stripe.sql` — seguro
   sin claves Stripe; solo crea la tabla y la columna).
2. **Stripe Dashboard** (modo test primero):
   - Products → crear `Pro` (precio mensual; opcional anual) y `Enterprise`.
   - Copiar los `price_...` → `STRIPE_PRICE_ID_PRO` (+ `_PRO_ANNUAL`, `_ENTERPRISE`).
   - Developers → Webhooks → endpoint
     `https://utopia-delta-bay.vercel.app/api/auth/stripe/webhook`
     con eventos: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`.
   - Copiar `whsec_...` → `STRIPE_WEBHOOK_SECRET`.
3. **Env vars en Vercel** (TODAS las variables corren en producción —
   `https://utopia-delta-bay.vercel.app`; no hay `.env.local`): añadir
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO` (mínimo)
   en Settings → Environment Variables (o `vercel env add`). Redeploy.
4. **Smoke test** (modo test de Stripe): settings → "Plan y facturación" →
   "Mejorar a Pro" → tarjeta `4242 4242 4242 4242` → volver → el panel muestra
   plan `Pro` y la fila existe en la tabla `subscription`.
5. **Local**: `stripe listen --forward-to localhost:3000/api/auth/stripe/webhook`
   (la CLI imprime el `whsec_...` temporal para `.env.local`).

## Aplicar gating a una ruta (patrón)

```ts
import { requirePlan } from '@/lib/billing/plan';

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const planGate = await requirePlan('pro');
  if (!planGate.ok) return planGate.response; // 402 { error: 'plan_required', ... }
  // ...
}
```

**Hoy ninguna ruta está gateada** — decisión deliberada: primero estabilizar el
ciclo de suscripción en producción, después decidir QUÉ features son Pro
(decisión de producto, no técnica). Candidatos naturales: pipelines financieros
(`/api/financial-report`), transfer pricing, escudo-survival.

## Telemetría / operación

- Los 402 emiten slug estable `plan_required` — la UI puede mapearlo a un CTA de upgrade.
- El webhook responde 4xx ante firma inválida (lo maneja el plugin); Stripe reintenta
  con backoff. Monitorear Developers → Webhooks → delivery attempts.
- La tabla `subscription` es propiedad de los webhooks — **nunca** editarla a mano.
