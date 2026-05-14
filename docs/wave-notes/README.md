# Wave Notes

Historical context, runbooks, and decision records for migrations / refactors that have already shipped. Each file is a snapshot in time — the **code** is the source of truth for current behavior. Read these when you need to understand **why** something is the way it is, or when something breaks and the runbook lives here.

Authoritative current contracts live in `docs/spec/`, not here. If a wave note conflicts with a spec, the spec wins.

## Index

| File | Topic | Date |
|---|---|---|
| [chunked-niif-analyst.md](chunked-niif-analyst.md) | NIIF Analyst split into 3 sequential `callFinancialAgent` passes (Fase 3) | 2026-05-12 |
| [wave-2-spec-v2.md](wave-2-spec-v2.md) | Spec v2.0 — anti-dup Grupo 53, deterministic KPIs, validators E7/E8, Governance v2.0 | 2026-05-12 |
| [wave-3-split-endpoints.md](wave-3-split-endpoints.md) | `/api/financial-report` split into `/niif`, `/strategy`, `/governance` (timeout fix on Vercel) | 2026-05-13 |
| [wave-4-spec-v8.1-html.md](wave-4-spec-v8.1-html.md) | Spec v8.1 editorial rules + Editor Jefe HTML 12-slide agent | 2026-05-13 |
| [wave-6-spec-v2.1.md](wave-6-spec-v2.1.md) | Spec v2.1 — 9 auditor-external corrections (3 critical + 4 moderate + 2 presentation) | 2026-05-13 |

## When something breaks

Each wave-note has a "Runbook / cuando rompa" section near the end. Start there if the symptom matches the wave's scope.
