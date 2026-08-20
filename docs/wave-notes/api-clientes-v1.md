# Wave note — API de Clientes v1 (2026-08-19)

Contexto histórico de la entrega del API público `/api/v1`. Los documentos vivos son otros:
la **spec** ([docs/spec/api-clientes-v1.md](../spec/api-clientes-v1.md)) manda sobre el
diseño, y la **guía operativa** ([docs/API_CLIENTES.md](../API_CLIENTES.md)) sobre el día a
día. Esto registra el *por qué* de la ola.

## Origen

`/goal crear un api para conectarnos con los clientes basado en las best practices en 2026
(investiga en internet como hacerlo de la mejor forma cumpliendo los estandares globales)`.
Sesión autónoma: las decisiones se tomaron sin aprobación interactiva y quedaron documentadas
con racional + fuentes en la spec para revisión posterior de Johan.

## Investigación (verificada contra fuentes primarias, no de memoria)

Tres agentes en paralelo — REST/HTTP, seguridad, webhooks/DX — verificaron el estado a
agosto 2026 en IETF Datatracker/RFC Editor, spec.openapis.org, OWASP, NIST, OpenID
Foundation, SIC/normativa colombiana y docs oficiales de Stripe/GitHub/Svix/OpenAI.
Hallazgos que movieron el diseño:

- OpenAPI **3.2.0** existe (2025-09-19) pero el contrato se declara **3.1.2** (superset,
  máxima compatibilidad de tooling de clientes).
- Los headers `RateLimit` siguen en **draft-11** (no RFC) → se emiten pero el contrato firme
  es `429 + Retry-After`. El draft de `Idempotency-Key` **expiró** → el canon es Stripe.
- **RFC 9745** (Deprecation, mar-2025), **RFC 9727** (api-catalog, jun-2025) y **RFC 9700**
  (OAuth BCP, ene-2025) son nuevos y quedaron adoptados/reservados.
- **NIST SP 800-63B-4** (jul-2025) respalda hash rápido + pepper para tokens ≥112 bits
  (argon2 es para secretos de baja entropía — no aplica).
- **Standard Webhooks v1.0.0** ganó la industria (OpenAI/Anthropic/Gemini la usan).
- Mercado de SDKs 2026: Stainless → Anthropic (productos hosted apagándose), Fern → Postman;
  el independiente vivo es Speakeasy (roadmap).
- Ley 1581: UtopIA actúa como **Encargado**; incidentes → SIC en 15 días hábiles; la reforma
  (PL 214/274 de 2025) no consta aprobada.

## Decisiones con tensión (registradas)

- **snake_case vs camelCase:** el brief REST prefería camelCase (consistencia de stack);
  ganó snake_case (convención fintech que esperan los integradores; el contrato vive en UN
  solo lugar — schemas Zod — así que no hay capa dual que desincronizar).
- **UUIDv7 público:** RFC 9562 sugiere v4 para "operaciones de seguridad"; aquí la
  autorización jamás depende del secreto del ID (BOLA por tenant en cada query) y el único
  observador del ID es el dueño del recurso → TypeID/v7 por localidad de índice. Caveat en
  la spec §2 Q5.
- **No persistir `PreprocessedBalance`:** se respeta la filosofía anti-desync del repo
  (`preprocessed-balance.ts`) — raw cifrado + recompute-on-read.
- **Entrega de webhooks con Workflow DevKit** (patrón monthly-close) en vez de
  waitUntil/cron: los reintentos de ~28 h exigen sleeps durables.
- **Migración renumerada 0020→0021** durante la ola: en main convive
  `0020_workspaces_user_id_uq.sql` escrita a mano y fuera del journal a propósito
  (`CREATE INDEX CONCURRENTLY`, INSUMOS §C3); dos `0020_*` eran una trampa humana aunque el
  migrador (journal-driven) no chocara.

## Qué quedó fuera de v1 (a propósito)

Disparar pipelines LLM (v1.1 = `202 + /v1/jobs/{id}`, exige decidir facturación por
corrida), OAuth (v1.2, RFC 9700), FAPI 2.0/DPoP (v2), SDK generado. El API v1 expone solo la
capacidad 100 % determinista — coherente con el estado medido de exactitud del repo.

## Entrega

17 commits (spec + plan + 15 de código TDD) sobre `origin/main` d83306f7. Verificación:
suite 2.319 ✓ (102 nuevos), build ✓, tsc 0, lint completo 0 errores, strict-mode ✓.
Plan ejecutado: [docs/superpowers/plans/2026-08-19-api-clientes-v1.md](../superpowers/plans/2026-08-19-api-clientes-v1.md).
