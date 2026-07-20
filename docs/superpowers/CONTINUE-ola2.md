# Prompt de continuación — Hechos del negocio · Ola 2

> Copia/pega este bloque para arrancar la próxima sesión. Refleja el estado real al 2026-07-20 (Ola 1 completa; solo queda Ola 2 + merge).

---

Continúa el desarrollo de "Hechos del negocio" (memoria de contexto empresarial) en UtopIA. OLA 1 ESTÁ COMPLETA — NO empieces de cero ni rehagas B/C/D/E.

## Lee primero (en orden)
1. docs/superpowers/specs/2026-07-18-hechos-del-negocio-design.md   (spec autoritativo, 6 secciones aprobadas)
2. .superpowers/sdd/progress.md   (LEDGER — estado completo Ola 0 + Ola 1 A/B/C/D/E, decisiones, follow-ups, minors diferidos)
3. La memoria del proyecto se auto-carga (project_hechos_del_negocio_ola0.md — resumen de toda Ola 1).
4. Planes (referencia, ya ejecutados): docs/superpowers/plans/2026-07-{18,19,20}-hechos-del-negocio-*.md

## Estado (2026-07-20)
- Rama activa: `feat/hechos-del-negocio-ola1` (apilada sobre `feat/hechos-del-negocio` = Ola 0, PR #9 a main). ~22 commits sobre c541c489. Merge-ready, NO mergeada.
- Ola 0 (cimientos) COMPLETA. Tablas facts + índice `uq_active_fact` YA aplicadas a la DB. NINGUNA migración nueva en Ola 1.
- **OLA 1 COMPLETA + reviewed (todos merge-ready):**
  - Team A (Captura): tool `registrar_hecho_negocio` + guard + guardrails en prompts.
  - Team B (Navegación/chip): `computeSuggestedRoute` (tabla determinista) + chip en `ChatSidebar.tsx` + intents de nav enseñados al classifier.
  - Team D (Panel): ruta `/workspace/contexto` (lista/filtros/registrar/editar=SUPERSEDE/revocar/historial) + Server Actions + helpers puros. **i18n INLINE** (NO tocó dictionaries.ts).
  - E (Refinamientos Ola-0): `assertFactInputValid` rechaza donación monto<=0; **narrativos ahora COEXISTEN** (atemporales, período=null; editar por id explícito) — SIN migración.
  - Team C (Financiero): donation → descuento Art.257 → **TOTAL VINCULANTE** en /api/tax-planning. Crédito atómico con el hecho (cierra gap de atomicidad Ola-0); tope en report-time.
- **FALTA SOLO: Ola 2 (integración de NARRATIVOS a reportes + confirmación pre-reporte) + la decisión de MERGE de la rama.**

## Cómo trabajar (igual que hasta ahora)
- Multiagente: subagentes Opus (effort max), UN equipo/tarea a la vez, review independiente por tarea, TDD, commits frecuentes con trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Skills: writing-plans (plan concreto SIN placeholders, contra el código real) → subagent-driven-development (ejecución + review por tarea + review final de rama). Archivos disjuntos. Actualiza el ledger.
- Verifica siempre: `npx tsc --noEmit` · `npm run lint:strict-mode` · `npx vitest run src/lib/facts src/lib/normativa src/lib/agents/financial/contracts` · `npm run build`.

## Interfaces congeladas (Ola 0 + Ola 1) que consume Ola 2
- @/lib/db/facts (server-only): **getActiveFacts(workspaceId, fiscalPeriod|null)** ← el pilar de Ola 2 (narrativos tienen período null → matchean cualquier período); listFacts; revokeFact; reconcileFact (delega a reconcileFactCore(tx)); **confirmFactWithDecision** (reconcile+crédito+decision record atómico para donation); persistDecisionRecord.
- @/lib/facts/contracts: registrarHechoInputSchema, RegistrarHechoInput, FactContent, DonationStructured, FactKind ; @/lib/facts/dto: toFactDTO, FactDTO ; @/lib/facts/tool-guards: assertFactInputValid (materiales exigen período; donation exige monto>0).
- @/lib/normativa/rules-registry: resolveRule(key, period) fail-loud ; regla `descuento_donaciones_257` tiene {tasaDescuentoPct:25, limitePctImpuesto:25, uvt2026}.
- @/lib/normativa/descuento-donaciones-257: art257Params, computeCredito257, computeDescuentoAplicado257 (números deterministas).
- @/lib/agents/financial/contracts/money: pctFloorMoneyCop, minMoneyCop (+ parse/serialize/format/sum/sub/equals).
- Tax-planning: TaxPlanningReport.donationDiscount: DonationDiscountBlock|null ; orchestrateTaxPlanning recibe workspaceId ; patrón del bloque determinista "TOTAL VINCULANTE" ya inyectado (orchestrator.ts `computeDonationDiscount`). La route ya resuelve workspaceId vía getCurrentWorkspaceId().
- Panel: /workspace/contexto + @/lib/facts/actions/contexto-actions (registerManualFactAction con supersedesId, revokeFactAction).

## GOTCHAS CRÍTICOS (no obvios)
1. **Narrativos son ATEMPORALES** (reconcileFactCore normaliza su período a null) y COEXISTEN (decideReconciliation es kind-aware: narrativos NUNCA SUPERSEDE, NOOP-idéntico/ADD-distinto). getActiveFacts(ws, period) los devuelve porque período null matchea cualquier período. Ola 2 los inyecta como PROSA en <hechos_empresa>.
2. **Materiales** (donation/leasing/loss) exigen fiscalPeriod no-nulo + (donation) monto>0 → assertFactInputValid. El índice uq_active_fact trata NULL como distinto (por eso narrativos null coexisten; donaciones con período NO doblan). Art. 647.
3. DB: NUNCA corras `npm run db:migrate` a ciegas (tracking __drizzle_migrations desalineado). Ola 1 no necesitó migración; Ola 2 tampoco debería. Si algo requiere DB, valida CONMIGO (opción sin-migración primero, como en E2).
4. **WIP ajeno sigue en el working tree SIN commitear** (login/page.tsx, page.tsx, Header.tsx, Hero.tsx, Metrics.tsx borrado, src/lib/i18n/dictionaries.ts, scripts/cleanup-auth-dryrun.mjs, src/modules/): NO lo toques ni commitees. Usa `git add <rutas exactas>` SIEMPRE. **i18n va INLINE** (ternarios `language==='es'?…:…`), NO en dictionaries.ts (así lo hizo Team D/B).
5. Números salen de cálculo determinista + registro normativo (Protocolo Élite), NUNCA de la LLM. El descuento de donation ya está deterministic (Team C); Ola 2 para ESTRUCTURADOS es mínimo. Lo grande de Ola 2 es NARRATIVOS→prosa.
6. **fiscalPeriod:** el `company.fiscalPeriod` de un reporte es texto libre (max 20); el período de un hecho es 'YYYY'. Al casar con getActiveFacts, normaliza extrayendo el año de 4 dígitos (Team C lo hace con `fiscalPeriod.match(/\d{4}/)`). Para narrativos (período null) no importa — matchean siempre.
7. La route NIIF (`/api/financial-report/niif`) NO resuelve workspaceId hoy; Ola 2 debe añadir getCurrentWorkspaceId() ahí (como hizo Team C en /api/tax-planning) para poder leer hechos.

## Trabajo restante

### Ola 2 — Integración de hechos a reportes (writing-plans → SDD; valida el approach conmigo antes de tocar prompts de reportes)
- **Narrativos → PROSA:** getActiveFacts(workspaceId, period) → los narrativos activos se inyectan como un bloque etiquetado `<hechos_empresa>` DENTRO del `<context>` dinámico (abajo, cache-friendly) de los prompts de reporte. Afecta la redacción, NO los números. Reportes: /api/financial-report/{niif,strategy,governance,html} y /api/tax-planning (tax-optimizer). Añade getCurrentWorkspaceId() donde falte (NIIF).
- **Estructurados → NÚMEROS:** ya cableado para donation en /api/tax-planning (Team C). Para NIIF, la donación es a lo sumo una NOTA de revelación narrativa (no cambia números NIIF). No re-computes números NIIF.
- **Confirmación pre-reporte:** antes de generar, mostrar "N hechos se incluirán en este reporte" con la lista y un toggle para excluir alguno SOLO para esa corrida (no muta la DB).
- **Follow-up Team C (incluir aquí):** el prompt del optimizador (tax-optimizer.prompt.ts:45) puede narrar su PROPIO descuento 257 → un documento mostraría DOS cifras. Instruir al optimizador a DIFERIR el descuento 257 al bloque determinista TOTAL VINCULANTE.
- **Follow-up (opcional):** mapear el fail-loud del panel de INTERNAL a un code 'RULE'; chips "Aparece en: [Reporte NIIF][Planeación]" reales en el panel (dependían de que los reportes leyeran hechos — ahora sí).

### Merge de la rama (cuando lo decidas)
- `finishing-a-development-branch`: la rama está apilada sobre Ola 0 (PR #9) y arrastra historia de prod-hardening. Decidir estrategia de PR (¿mergear Ola 0 primero? ¿rebase? ¿PR único?).

Orden sugerido: Ola 2 → merge. writing-plans → subagent-driven-development (Opus, review) → actualiza .superpowers/sdd/progress.md.
