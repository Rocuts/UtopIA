# Plan: App Funcional — UtopIA 1+1

**Branch**: `feat/app-funcional`
**Base**: `main` @ `7432bb4c` (merge PR #3: rediseño handoff + production-ready)
**Fecha**: 2026-06-10
**Fuente**: Auditoría paralela de 6 dimensiones (65 hallazgos consolidados: 10 P0 · 24 P1 · 22 P2 · 9 P3) + PRODUCTION_READY_REPORT §5-6 + TRD §14 + validaciones locales.

## Estado de partida (verificado en esta máquina)

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errores |
| `npx vitest run` | ✅ 1185 pass / 3 skip (95 archivos) |
| `npm run build` (stubs CI) | ✅ compila |
| `npm run lint` | ⚠️ 2 errores React Compiler + ~190 warnings |

## Hallazgo desmentido (no ejecutar)

- ~~"src/proxy.ts nunca se ejecuta — renombrar a middleware.ts"~~ **FALSO POSITIVO.** En Next.js 16 `proxy.ts` es la convención canónica. Evidencia: el código del proxy está compilado en el grafo de `.next/server/middleware.js` (chunk `__1j0trko`), el build imprime "ƒ Proxy (Middleware)", y en esta sesión se observó el redirect a `/login?next=…` funcionando con `BETTER_AUTH_SECRET` seteado y el timing `proxy.ts: NNNms` en cada request dev. El `middleware-manifest.json` vacío es un artefacto legacy del formato v3. **NO renombrar.**

## Principio rector

"Funcional" = cada superficie visible consume datos reales donde el backend existe, degrada a **estado vacío honesto** donde no existe (nunca datos inventados presentados como reales), y ningún control visible es un no-op. Lo que requiere infraestructura/secretos de producción se documenta como acción humana (§Infra), no se simula.

---

## Ola 0 — Correcciones quirúrgicas (lint, CSP, links rotos, no-ops visibles)

**Validación**: `npm run lint` 0 errores · tsc · vitest verde.

1. **Lint React Compiler ×2**
   - `src/app/workspace/contabilidad/mayor/page.tsx:73-79` — sustituir el `.map()` que reasigna `running` por un `for` con acumulador local dentro del `useMemo`.
   - `src/components/workspace/areas/VerdadArea.tsx:156` — eliminar el `useMemo` de `gaugeScore` (cálculo barato; el compiler memoiza solo) extrayendo primero `view.hasData`/`view.derived.scoreNiif`.
2. **CSP vs tabler-icons** — `src/app/layout.tsx:321` carga tabler-icons desde cdnjs y la CSP lo bloquea (`style-src`/`font-src` sin cdnjs). Determinar si algo usa clases `ti-*`; si nada las usa (lucide-react es la librería del proyecto), **eliminar el `<link>`**; si se usa, whitelistear cdnjs en `style-src` y `font-src`.
3. **Links rotos / huérfanos**
   - `Footer.tsx` — cablear los 7 links de Servicios/Producto a sus rutas reales; quitar "Sistema de diseño" (`href='#'`).
   - `WorkspaceTeaser.tsx` — 4 tarjetas de área → `/workspace/{escudo,valor,verdad,futuro}`.
   - `PymeCockpit/mockData.ts` — tiles `fechas`/`empleados` con `href:null` → rutas nuevas ya existentes.
   - `/workspace/contabilidad` sin entrada de navegación → añadir tile auxiliar en `ExecutiveDashboard`.
   - `/signup` sin link entrante → link "Crear cuenta" en `/login`.
   - `login/page.tsx` "¿Olvidó su contraseña?" `href='#'` → ocultar hasta Ola 4 (o implementar en Ola 4 y enlazar).
   - `MiLibroView` "Bajar a Excel" → endpoint real `/api/pyme/books/{bookId}/export.xlsx` (requiere prop bookId — ver Ola 1).
   - `/workspace/comando` y `/workspace/alertas` huérfanas → entrada en CommandPalette y/o icono campana navega a alertas.
4. **Datos falsos visibles**
   - `EscudoArea` MOCK_DEADLINES (fechas pasadas) → fetch a `GET /api/calendar/verified` con mapeo a `EscudoDeadline[]`; mock solo como skeleton de carga.
   - `municipal-2026.ts` `dueDate='pendiente'` ×2 → guard en lógica de alertas ("Fecha por confirmar"), nunca NaN.
   - `PhotoUploader` éxito forzado en 2º reintento con datos "Bavaria" → eliminar el forced-success; error honesto con opciones (rehacer foto / manual / saltar).
   - `MisPagosView` tarifas ilustrativas → disclaimer visible "Cálculo estimado — tarifas de referencia" hasta que se carguen tablas DIAN oficiales (las constantes ya están marcadas en código).

## Ola 1 — Wiring Pyme a APIs reales

**Validación**: páginas Pyme con `?bookId` real renderizan datos de DB; sin datos → empty-state honesto; vitest verde.

1. `MiLibroView` — aceptar `bookId` (de query param o primer book), fetch `GET /api/pyme/entries?bookId=`, mapear a la lista (mantener visual); export real; CTA foto → `/workspace/pyme/{bookId}/subir`.
2. `PymeHub` — métricas del hero desde entries del mes (`/api/pyme/reports/monthly` ya existe); semáforo IVA con ventas acumuladas reales + `topeRST()` del tax module.
3. `MisFechasView` — obligaciones desde `GET /api/calendar/verified` (+ tax-engine preview si flag activo); contador/mes-bar derivados de datos reales.
4. `MisEmpleadosView` — **no existe modelo de nómina**: empty-state honesto "Aún no ha registrado empleados" + CTA deshabilitada documentada; mock solo detrás de `?demo=1`.
5. `PymeCockpit` i18n ES/EN de mockData (mientras viva).
6. `processUpload` transaccional (insert entries + status en `db.transaction`).

## Ola 2 — Intake real

**Validación**: crear caso desde `/workspace/intake` deja al usuario dentro del flujo real del área.

1. `IntakeCasesPage` — al submit, en vez de número aleatorio: invocar el flujo real vía `WorkspaceContext` (`openIntakeForType`/`startNewConsultation`) para los tipos que tienen pipeline (niif, defensa, devolución, due, inteligencia, planeación, precios, valoración, dictamen, conciliación, factibilidad → mapping a `CaseType`); el formulario de la página precarga el intake real.
2. Número de caso: derivado del id real de conversación/caso creado (no `Math.random`).

## Ola 3 — SSE + runtime hardening

**Validación**: tests existentes + nuevos de las rutas migradas.

1. Migrar a `createSafeSse` las 8 rutas de dictámenes (`financial-audit`, `fiscal-audit-opinion`, `tax-planning`, `tax-reconciliation`, `business-valuation`, `feasibility-study`, `transfer-pricing`, `escudo-survival`) + `/api/chat` y `/api/repair-chat`.
2. `runtime.ts:267` — `safeParse` en vez de cast ciego (`AgentSchemaError` accionable).
3. `uvtToCopByYear` — consulta `uvt_constants` por año con cache en memoria (fallback constante solo si DB indisponible).
4. Export `format='pdf'` rama vacía → 400 explícito o redirect a pdf-elite.

## Ola 4 — Auth UX completa (cliente)

**Validación**: con `BETTER_AUTH_SECRET` local + DB, ciclo completo login→sesión→logout.

1. `EliteHeader` — `authClient.signOut()` real; quitar `disabled`.
2. `settings/page.tsx` — leer sesión real (`authClient.useSession`); eliminar sesiones inventadas; sección de cuenta honesta en fase 1 (anónimo).
3. Forgot password — página `/forgot-password` + flujo BetterAuth reset (operativo solo con RESEND; sin key → mensaje honesto).
4. `/signup` — unificar con login o diferenciar y enlazar.

## Ola 5 — Cobertura de auth en API + seguridad

**Validación**: test de matriz de rutas (fase 1 no-op / fase 2 401 sin sesión).

1. `requireAuthSession` en `/api/accounting/**` y demás endpoints sin gate (auditoría listó 40+; generar matriz y cablear).
2. Sentinel cron `preprocessed=null` → pilares en "critical" permanente: corregir el contrato (skip honesto o cálculo con último snapshot).
3. `VerdadOverviewPage` compliance idénticos hardcoded → derivar de datos reales o etiquetar "sin datos".

## Ola 6 — Config, scripts y onboarding

**Validación**: `npm run bootstrap` en clon limpio llega a dev server.

1. `.env.example` completo: `UTOPIA_VAULT_KEY`, `DB_HMAC_KEY`, `UTOPIA_ADMIN_TOKEN`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `UTOPIA_AGENT_MODE=orchestrated`, flags `UTOPIA_ENABLE_*` (incl. `ANOMALY_DETECTION`), observabilidad (`UTOPIA_ACTIVITY_LOG`, `UTOPIA_AGENT_TELEMETRY`), RAG (`CONTEXTUAL_RETRIEVAL`, `PURGE_BEFORE_INGEST` ⚠️ destructiva, `SKIP_EXISTING`) — cada una con one-liner de generación/obtención.
2. `package.json`: `db:seed-tax-rules`, `db:setup` (migrate→seed-calendar→seed-tax-rules), `bootstrap`; `db:ingest` con prefix dotenv.
3. README sección "DB Setup" con orden canónico; documentar `db:push` (dev) vs `db:migrate` (CI).
4. Drizzle snapshots faltantes (0003-0013): documentar el riesgo de `db:generate` y el procedimiento de regeneración (ejecución real requiere DB — §Infra).

## Ola 7 — Deuda declarada (si el tiempo de sesión alcanza)

1. Migrar 7 agentes con `generateText` directo a `callFinancialAgent`.
2. Wave-8: F01 = UAI (test con Clase 54 ≠ 0); migración 0014 `defensa_dian_tareas` (+ `tax_calculations` si se decide persistir la calculadora).
3. Conciliación OFX/MT940 (parsers).
4. `--color-acento-vino` token + PymeBooksClassic.
5. CI: jobs coverage + integration.

---

## §Infra — Acciones humanas (NO ejecutables desde esta máquina; checklist para el operador)

1. **Activar auth fase 2**: `openssl rand -base64 32` → `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` en Vercel; `npm run db:migrate` contra Neon **con backup previo**.
2. **Feature flags en Vercel**: `UTOPIA_ENABLE_{TAX_ENGINE,OCR_PROMOTE,BANK_RECON,AUTO_ADJUSTMENTS,MONTHLY_CLOSE_WORKFLOW,NOTIFICATIONS,ANOMALY_DETECTION}` — activar de menor a mayor riesgo.
3. **RESEND_API_KEY** (+ dominio verificado) y **Upstash** (`vercel integration add upstash`) para rate-limit multi-instancia.
4. **Validar IDs de modelos** (`gpt-5.4-mini`/`gpt-5.5`/`gpt-5.4-nano`) con llamada real; overrides `OPENAI_MODEL_*` listos si alguno falla.
5. **Smoke test staging**: `npm run smoke` con credenciales reales antes del primer deploy.
6. **Fixture NIT real 901714014-6**: autorización del cliente o anonimizar; repo privado mientras tanto.
7. **Decisiones de producto**: ADR-05 (workspace 1:1 vs N:M → `user_id NOT NULL`), ADR-06 (billing Stripe/Paddle), CSP nonces, Blob privado (espera GA), migración a Workflow DevKit (post-auth).

## Protocolo de ejecución

- Rama `feat/app-funcional` desde `main`; 1 commit por ola (o por sub-bloque grande), mensaje `feat(ola-N): …` citando hallazgos.
- Gate por ola: `npx tsc --noEmit` + `npm run lint` + `npx vitest run` verdes antes de commit.
- Al final: build de producción con stubs + revisión visual Playwright de superficies tocadas.
