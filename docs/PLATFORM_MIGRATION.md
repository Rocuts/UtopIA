# Platform migration — Ola 0.F (mayo 2026)

Migración de la capa de plataforma Vercel + Next.js a las convenciones
canónicas de mayo 2026:

1. `src/middleware.ts` -> `src/proxy.ts` (Next.js 16).
2. `vercel.json` -> `vercel.ts` (Vercel SDK `@vercel/config`).
3. Rate-limit in-memory -> Vercel WAF `@vercel/firewall.checkRateLimit`,
   con backstop in-memory.

## 1. middleware.ts -> proxy.ts

### Por qué

Next.js 16.2 deprecó `middleware.ts`. El nuevo nombre es `proxy.ts` y el
runtime por defecto es Node.js completo (no Edge). La codemod oficial es
`npx @next/codemod@canary middleware-to-proxy .`, pero la hicimos a mano
para aprovechar y endurecer CSRF al mismo tiempo.

Docs: <https://nextjs.org/docs/app/api-reference/file-conventions/proxy>

### Cambios de comportamiento

| Antes (`middleware.ts`)                                  | Ahora (`proxy.ts`)                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Función exportada: `middleware(req)`                     | Función exportada: `proxy(req)` (named export)                                      |
| CSRF: `if (origin && host) { ... }` — pasaba si faltaban | CSRF: **fail-closed** en POST/PUT/PATCH/DELETE. 403 si falta `Origin` o `Host`      |
| Sin allowlist de server-to-server                        | Allowlist explícita: `/api/cron/*` (autenticados por bearer token)                  |
| `RATE_LIMITS` con 6 entradas, default 60/min             | `RATE_LIMITS` con ~30 entradas (todos los endpoints actuales + 3 de Ola 1 futura)   |
| Rate-limit key: `${ip}:${pathname}`                      | Rate-limit key: `workspaceId ?? ip` (cookie `utopia_workspace_id`, más estable)     |
| Solo in-memory (rompe en multi-instance Fluid Compute)   | Vercel WAF primero, in-memory como backstop                                         |
| Limites blandos para LLM routes                          | Limites estrictos para LLM routes ($ por invocación), 5/min para `pyme/reports/monthly` y `erp/connect` |

### Endpoints añadidos a RATE_LIMITS

Antes heredaban el default de 60/min:

- `/api/financial-report`, `/api/financial-audit`, `/api/financial-quality`
- `/api/tax-planning`, `/api/transfer-pricing`, `/api/business-valuation`
- `/api/fiscal-audit-opinion`, `/api/tax-reconciliation`, `/api/feasibility-study`
- `/api/repair-chat`, `/api/repair-session`
- `/api/erp/connect`, `/api/erp/disconnect`, `/api/erp/status`, `/api/erp/providers`, `/api/erp/sync`
- `/api/workspace`
- `/api/pyme/entries`, `/api/pyme/books`, `/api/pyme/reports/monthly`
- Futuras Ola 1: `/api/accounting/journal`, `/api/accounting/opening-balance`, `/api/accounting/accounts`

## 2. vercel.json -> vercel.ts

### Por qué

`vercel.ts` es la nueva forma recomendada de configurar proyectos Vercel
(GA en 2025). Permite typecheck del schema, lógica dinámica (env vars en
build time), y detecta typos en cron paths o globs de funciones.

> **No coexisten.** `vercel.ts` y `vercel.json` son mutuamente excluyentes.
> Dejar ambos hace que Vercel ignore uno (el comportamiento es indefinido
> entre versiones del runtime).

Docs: <https://vercel.com/docs/project-configuration/vercel-ts>

### Campos transferidos

| `vercel.json`                                                                    | `vercel.ts`                            |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| `crons: [{ path: '/api/cron/calendar-sync', schedule: '0 11 * * *' }]`          | mismo, dentro del `config` export      |
| (no había `functions`)                                                           | añadido per-route con `maxDuration`    |
| (no había `framework`)                                                           | `framework: 'nextjs'` explícito        |
| (no había `fluid`)                                                               | `fluid: true` explícito                |

### Beneficios concretos

- `maxDuration` por route ahora vive en código y no en el dashboard. Un PR
  que cambie una route que estaba a 300s se nota inmediatamente.
- TypeScript valida que el path del cron exista (vía glob match contra el
  filesystem, in editor).
- Listamos pre-emptivamente las routes de Ola 1 (núcleo contable) — cuando
  se creen, ya tienen budget asignado.

## 3. Vercel WAF rate-limit

### Estado del SDK

`@vercel/firewall@1.2.0` existe en npm. Export principal:
`checkRateLimit(rateLimitId: string, { request, rateLimitKey? })` -> 
`{ rateLimited: boolean }`.

Docs: <https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk>

### Comportamiento

1. **WAF first** — si el package está disponible y el `rateLimitId`
   tiene una regla configurada en el dashboard, WAF decide. WAF es
   global a todas las instancias Fluid Compute, lo que el in-memory
   anterior NO era.
2. **In-memory backstop** — siempre se ejecuta después de WAF. Cubre
   dev local, escenarios donde el rule del WAF no esté configurado, y
   fallos transientes de la API del WAF.
3. **Defense-in-depth** — los dos rate-limits se aplican en cascada;
   un cliente debe pasar AMBOS para que la request siga.

### Acción manual requerida del usuario

Para que el WAF tenga efecto en producción, **Johan debe configurar
las reglas de rate limit en el dashboard de Vercel**:

1. Vercel Dashboard -> Project -> Firewall -> Rate Limit Rules.
2. Crear una rule por cada `rateLimitId` que el proxy emite. Los IDs
   se derivan del path: `/api/financial-audit` -> `api_financial_audit`.
3. Para cada rule, configurar:
   - Window: 60s (alinear con el in-memory).
   - Limit: igual al valor de `RATE_LIMITS` en `src/proxy.ts`.
   - Key: `request.header.x-rate-limit-key` o usar el `rateLimitKey`
     parameter si la dashboard lo soporta directamente.
4. (Opcional) Activar `Vercel BotID` para protección adicional contra
   bots no humanos. Ver Ola 0.E.

Mientras estas reglas no estén creadas, **el rate-limit del WAF es
no-op** y solo aplica el backstop in-memory (que sigue funcionando
igual que antes).

### IDs de rate-limit que el proxy emite

Generados por `getRateLimitConfig()` en `src/proxy.ts`. Crear una rule
por cada uno en el dashboard:

```
api_chat                            (30/min)
api_realtime                        (30/min)
api_repair_chat                     (10/min)
api_repair_session                  (30/min)
api_rag                             (30/min)
api_web_search                      (20/min)
api_tools_sanction                  (30/min)
api_tools_calendar                  (30/min)
api_financial_report                (10/min)
api_financial_audit                 (10/min)
api_financial_quality               (10/min)
api_tax_planning                    (10/min)
api_transfer_pricing                (10/min)
api_business_valuation              (10/min)
api_fiscal_audit_opinion            (10/min)
api_tax_reconciliation              (10/min)
api_feasibility_study               (10/min)
api_upload                          (20/min)
api_pyme_uploads                    (20/min)
api_pyme_entries                    (60/min)
api_pyme_books                      (60/min)
api_pyme_reports_monthly            ( 5/min)
api_erp_connect                     ( 5/min)
api_erp_disconnect                  (10/min)
api_erp_status                      (60/min)
api_erp_providers                   (60/min)
api_erp_sync                        (10/min)
api_workspace                       (60/min)
api_default                         (60/min)  ← catch-all
api_accounting_journal              (30/min)  ← Ola 1 futura
api_accounting_opening_balance      ( 5/min)  ← Ola 1 futura
api_accounting_accounts             (60/min)  ← Ola 1 futura
```

## Archivos creados / eliminados

- Creado: `src/proxy.ts`
- Creado: `vercel.ts`
- Creado: `docs/PLATFORM_MIGRATION.md` (este archivo)
- Eliminado: `src/middleware.ts`
- Eliminado: `vercel.json`
- Editado: `package.json` (añadido `@vercel/firewall` en deps,
  `@vercel/config` en devDeps)

## Validación post-deploy

1. `npx tsc --noEmit` — debe pasar limpio.
2. `npm run build` — debe pasar limpio. Verificar en build log que el
   matcher del proxy está activo (`Proxy compiled in ...`).
3. Smoke-test: `curl -X POST https://app.utopia.../api/chat \
   -H 'Origin: https://malicious.com' -d '{}'` debe retornar 403.
4. Smoke-test: `curl -X POST https://app.utopia.../api/chat \
   -d '{}'` (sin Origin) debe retornar 403.
5. Confirmar en Vercel logs que `Proxy` se ejecuta para cada request a
   `/api/*`.
