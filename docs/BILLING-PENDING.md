# Billing — Pasos pendientes para activar en producción

> Estado actual (2026-06-11): implementación mergeada a `main` (PR #6, commit `c8269948`).
> El billing está **dormido** hasta que se completen los pasos de abajo.
> Sin las claves Stripe en Vercel, todo el flujo devuelve `plan: 'enterprise'` sin restricciones (fail-open).

---

## 1. Decisión de entidad legal (bloqueante)

**Stripe no acepta merchants colombianos** sin entidad jurídica en EE.UU. o la UE.

| Opción | Pros | Contras |
|---|---|---|
| **Stripe** (actual) | Plugin ya integrado, ecosistema rico | Requiere LLC en EE.UU. o EU entity |
| **Paddle** (MoR) | Merchant of Record, sin entidad propia, cubre Colombia | Requiere migrar `@better-auth/stripe` → `@better-auth/paddle` |
| **Wompi** | Local colombiano, sin entidad extranjera | Sin plugin BetterAuth oficial — integración manual |

Si Sequal no tiene entidad en EE.UU., el camino más rápido es **Paddle**.
La tabla DB (`subscription`), el gating (`requirePlan`) y la UI de settings **no cambian** — solo la capa del plugin de auth.

**Acción:** Confirmar estructura legal → elegir proveedor → continuar con los pasos siguientes para ese proveedor.

---

## 2. Stripe Dashboard (si se elige Stripe)

### 2a. Crear productos y precios

En [dashboard.stripe.com/products](https://dashboard.stripe.com/products):

| Producto | Price ID (anota estos) | Intervalo |
|---|---|---|
| UtopIA Pro | `price_XXXX` | mensual o anual |
| UtopIA Enterprise | `price_YYYY` | mensual o anual |

### 2b. Registrar el webhook

En **Developers → Webhooks → Add endpoint**:

- **URL**: `https://utopia-delta-bay.vercel.app/api/auth/stripe/webhook`
- **Eventos mínimos** que debe escuchar:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `checkout.session.completed`

Guarda el **Webhook Signing Secret** (`whsec_...`) — lo necesitas en el paso 3.

---

## 3. Variables de entorno en Vercel

Ir a [vercel.com/dashboard](https://vercel.com/dashboard) → proyecto `utopia-delta-bay` → **Settings → Environment Variables**.

Agregar (scope: **Production**):

| Variable | Valor | Dónde obtenerlo |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Webhook endpoint creado en paso 2b |
| `STRIPE_PRICE_ID_PRO` | `price_XXXX` | Producto Pro creado en paso 2a |
| `STRIPE_PRICE_ID_ENTERPRISE` | `price_YYYY` (opcional) | Producto Enterprise en paso 2a |

> Para testing usa `sk_test_...` y `whsec_...` del webhook de test.
> El plugin se activa automáticamente cuando `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` están presentes.

Después de agregar las variables: **redeploy** (Settings → Deployments → Redeploy latest).

---

## 4. Migración de base de datos

La migración `0015_billing_stripe.sql` ya está en el repo pero **no se ha ejecutado** contra Neon producción.

```bash
# Desde la máquina local con DATABASE_URL apuntando a Neon producción:
npm run db:migrate
```

La migración es **segura sin las claves Stripe** — solo agrega columnas/tablas, no toca datos existentes.

Tablas que crea:
- Columna `stripe_customer_id` en `user`
- Tabla `subscription` con todos los campos del plugin

---

## 5. Decisión de producto: qué gatear

Actualmente **ninguna ruta está gateada** con `requirePlan`. El billing está activo pero sin efectos de acceso.

Usar el helper en `src/lib/billing/plan.ts`:

```ts
import { requirePlan } from '@/lib/billing/plan';

// Al inicio de un route handler:
const gate = await requirePlan('pro');
if (!gate.ok) return gate.response; // 402 con { error: 'plan_required', requiredPlan, currentPlan }
```

Rutas candidatas para gatear (decisión de producto pendiente):

| Ruta / Feature | Plan mínimo sugerido |
|---|---|
| `/api/financial-report` | `pro` |
| `/api/financial-audit` | `pro` |
| `/api/tax-planning` | `pro` |
| `/api/transfer-pricing` | `enterprise` |
| `/api/business-valuation` | `enterprise` |
| `/api/escudo-survival` | `pro` |
| Exportación PDF élite | `pro` |

---

## 6. UI de upgrade (opcional pero recomendado)

La página `Settings → Plan` ya existe en `src/app/workspace/settings/page.tsx` con tres estados:
1. **Billing no configurado** — muestra mensaje informativo
2. **Plan free** — botón "Actualizar a Pro" (llama a `authClient.subscription.upgrade(...)`)
3. **Plan activo** — muestra plan actual con opción de cancelar

Una vez activadas las claves en Vercel, este panel funciona automáticamente.

---

## 7. Testing antes de go-live

1. Usar Stripe CLI localmente para simular webhooks:
   ```bash
   stripe listen --forward-to localhost:3000/api/auth/stripe/webhook
   stripe trigger customer.subscription.created
   ```
2. Verificar que `GET /api/system/capabilities` devuelve `{ billing: true }` en producción tras el redeploy.
3. Crear una cuenta de prueba, completar checkout con tarjeta `4242 4242 4242 4242`, verificar que `subscription.status = 'active'` aparece en Neon.
4. Gatear una ruta de prueba con `requirePlan('pro')` y verificar que devuelve 402 para usuarios free.

---

## Resumen de archivos relevantes

| Archivo | Propósito |
|---|---|
| `src/lib/billing/plan.ts` | Helper `requirePlan`, `getUserPlan`, `isBillingEnabled` |
| `src/lib/auth/config.ts` | Plugin `@better-auth/stripe` (phase-gated) |
| `src/lib/auth/client.ts` | Cliente `stripeClient` para el frontend |
| `src/lib/db/schema-auth.ts` | Tabla `subscription` (Drizzle) |
| `src/lib/db/migrations/0015_billing_stripe.sql` | Migración pendiente contra Neon |
| `src/proxy.ts` | Webhook en CSRF allowlist + rate limit |
| `src/app/workspace/settings/page.tsx` | UI del panel de plan |
| `docs/BILLING.md` | Runbook completo de arquitectura |
| `.env.example` | Variables documentadas |
