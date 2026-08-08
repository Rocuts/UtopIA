# docs/ — Índice de Documentación

Guía de navegación rápida. **Fuente de verdad es el código** — cuando este índice y el código difieren, el código gana.

---

## Núcleo

| Documento | Qué encontrarás |
|-----------|----------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mapa de la plataforma: orquestación, RAG, seguridad, estado, pipelines |
| [AI_SDK_MIGRATION.md](AI_SDK_MIGRATION.md) | Contrato de migración OpenAI SDK → AI SDK v6 (reglas de conversión) |
| [TELEMETRY.md](TELEMETRY.md) | `callFinancialAgent` telemetría, alertas, dashboard admin |
| [PLATFORM_MIGRATION.md](PLATFORM_MIGRATION.md) | WAF Vercel, rate-limit IDs, deployment config |

## Especificaciones Autorizadas

> En `spec/` vive la fuente de verdad para pipelines financieros y contratos de salida.

| Documento | Qué encontrarás |
|-----------|----------------|
| [spec/financial-pipeline-v2.1.md](spec/financial-pipeline-v2.1.md) | Pipeline NIIF → Strategy → Governance + Parte IV/V (dictámenes + meta-auditoría) |
| [spec/financial-report-v8.1.md](spec/financial-report-v10.1.md) | Editor Jefe HTML 12-slide — formato de salida autorizado |
| [spec/zod-strict-mode-2026.md](spec/zod-strict-mode-2026.md) | Reglas Zod para schemas LLM (`experimental_output`) |
| [ESCUDO_SURVIVAL_MODE_SPEC.md](ESCUDO_SURVIVAL_MODE_SPEC.md) | Spec modo supervivencia DIAN (Ola Escudo) |
| [DOCUMENT_PROCESSING_MODULE_SPEC.md](DOCUMENT_PROCESSING_MODULE_SPEC.md) | Pipeline OCR → extracción → vectorstore |
| [PYME_MODULE_SPEC.md](PYME_MODULE_SPEC.md) | Módulo Contabilidad Pyme — libros, entries, OCR-promote |
| [D5_3_FORENSIC_AUDIT.md](D5_3_FORENSIC_AUDIT.md) | Dictamen D5.3 Auditoría Forense — spec funcional |

## Auditorías (2026-08)

> Estado medido del producto. Todas midieron **ejecutando**, no leyendo, y sus hallazgos pasaron por
> escépticos adversariales con la consigna de refutarlos.

| Documento | Qué encontrarás |
|-----------|----------------|
| [AUDITORIA_CALCULOS_2026-08.md](AUDITORIA_CALCULOS_2026-08.md) | **Empieza aquí.** ¿Los cálculos dan los números reales? Veredicto por superficie, nota 3/10 global, lista priorizada |
| [AUDITORIA_CALCULOS_2026-08_ANEXO.md](AUDITORIA_CALCULOS_2026-08_ANEXO.md) | Inventario cifra por cifra (DETERMINISTA / ANCLADA / LIBRE) y los 91 hallazgos con su escenario numérico |
| [INSUMOS_REQUERIDOS_2026-08.md](INSUMOS_REQUERIDOS_2026-08.md) | Qué hace falta de fuera del repo: balances reales, 3 decisiones de negocio, 3 de infraestructura |
| [SESION_EXACTITUD_2026-08.md](SESION_EXACTITUD_2026-08.md) | La ola que hizo determinista el Balance primario: convención de signos, reconciliador, desglose, sello |
| [FASE0_MEDICION_2026-08.md](FASE0_MEDICION_2026-08.md) | La medición con LLM real que reordenó las prioridades. Registro pre-corrección |
| [AUDITORIA_INTEGRAL_2026-08.md](AUDITORIA_INTEGRAL_2026-08.md) | Auditoría de producto: 117 hallazgos, causas raíz, olas de remediación |
| [AUDITORIA_NORMATIVA_2026-08.md](AUDITORIA_NORMATIVA_2026-08.md) | Verificación de constantes fiscales contra fuente oficial |

## Seguridad

| Documento | Qué encontrarás |
|-----------|----------------|
| [SECURITY_ENCRYPTION.md](SECURITY_ENCRYPTION.md) | Vault AES-256-GCM para credenciales ERP |
| [SECURITY_BOTID.md](SECURITY_BOTID.md) | Vercel BotID — detección bots en endpoints públicos |
| [sprint-3-vault-architecture.md](sprint-3-vault-architecture.md) | Diseño arquitectural del vault (Sprint 3) |

## Historial de Waves (contexto cronológico)

> En `wave-notes/` vive el historial de decisiones de implementación. Leer antes de tocar un área.

| Documento | Área |
|-----------|------|
| [wave-notes/README.md](wave-notes/README.md) | Índice de waves |
| [wave-notes/wave-2-spec-v2.md](wave-notes/wave-2-spec-v2.md) | Wave 2 |
| [wave-notes/wave-3-split-endpoints.md](wave-notes/wave-3-split-endpoints.md) | Wave 3 — split de endpoints `/api/financial-report/*` |
| [wave-notes/wave-4-spec-v8.1-html.md](wave-notes/wave-4-spec-v8.1-html.md) | Wave 4 — Editor Jefe HTML |
| [wave-notes/wave-6-spec-v2.1.md](wave-notes/wave-6-spec-v2.1.md) | Wave 6 — pipeline v2.1 |
| [wave-notes/wave-7-parte-iv-v.md](wave-notes/wave-7-parte-iv-v.md) | Wave 7 — Parte IV/V dictámenes |
| [wave-notes/wave-8-capa-1-escudo-fiscal-dictamen.md](wave-notes/wave-8-capa-1-escudo-fiscal-dictamen.md) | Wave 8 — Escudo fiscal |

## Guías Operacionales

| Documento | Qué encontrarás |
|-----------|----------------|
| [SMOKE_TEST_GUIDE.md](SMOKE_TEST_GUIDE.md) | Checklist smoke-test manual antes de deploy |
| [RAG_PGVECTOR.md](RAG_PGVECTOR.md) | Setup Neon pgvector, embeddings, fallback HNSWLib |
| [MULTI_AGENT_PLAYBOOK_2026.md](MULTI_AGENT_PLAYBOOK_2026.md) | Patrones de orquestación multi-agente |
| [repo-analysis-agents.md](repo-analysis-agents.md) | Agentes de análisis de repo (graphify, semantic search) |

## Decisiones de Producto

| Documento | Qué encontrarás |
|-----------|----------------|
| [1PLUS1_ROADMAP.md](1PLUS1_ROADMAP.md) | Roadmap del producto 1+1 |
| [MVP_DECISIONS_DEFERRED.md](MVP_DECISIONS_DEFERRED.md) | Decisiones diferidas del MVP y sus motivaciones |
| [ESCUDO_NORMATIVA_TRIBUTARIA_CO_2026.md](ESCUDO_NORMATIVA_TRIBUTARIA_CO_2026.md) | Marco normativo tributario Colombia 2026 |

## Migraciones y Refactors

| Documento | Qué encontrarás |
|-----------|----------------|
| [MIGRATION_DRIVER.md](MIGRATION_DRIVER.md) | Migración DB driver (pg → Drizzle + Neon) |
| [MIGRATION_PYME_RECOVERY.md](MIGRATION_PYME_RECOVERY.md) | Recovery de datos módulo Pyme |
| [MULTIPERIOD_REFACTOR.md](MULTIPERIOD_REFACTOR.md) | Refactor multi-período contable |
| [POST_MVP_WORKFLOW_MIGRATION.md](POST_MVP_WORKFLOW_MIGRATION.md) | Migración workflow post-MVP |
| [PIPELINE_MIGRATION_RECIPE.md](PIPELINE_MIGRATION_RECIPE.md) | Recipe de migración de pipelines |
| [REPAIR_CHAT.md](REPAIR_CHAT.md) | Guía de reparación de bugs en ChatWorkspace |
| [PYME_MODULE_TODO.md](PYME_MODULE_TODO.md) | TODOs pendientes módulo Pyme (ver también BACKLOG.md) |
