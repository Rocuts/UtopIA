# Monthly Close Workflow — WS5

Workflow durable de cierre mensual usando **Vercel Workflow DevKit** (`workflow` + `@workflow/next`).

## Arquitectura

```
closeMonthWorkflow (index.ts)   — 'use workflow': orquestación pura
├── persistRunSnapshot           — 'use step': upsert monthly_close_runs
├── runHealthCheck               — 'use step': chequeos de integridad del período
│   ├── [pausa con createHook si blocking=true y override=false]
│   └── POST /api/accounting/close/resume → resumeHook → continúa
├── runAdjustments               — 'use step': llama AdjustmentsPort (WS4)
├── generateClosingEntry         — 'use step': asiento de cierre zero-out
├── lockPeriod                   — 'use step': accounting_periods.status = 'locked'
├── computePeriodHash            — 'use step': sha256 encadenado
├── generatePdfReport            — 'use step': PDF élite → Vercel Blob
└── sendLockNotification         — 'use step': email via NotificationsPort (WS6)
```

## Algoritmo del Period Hash

El `period_hash` garantiza integridad encadenada. Un auditor puede reproducirlo:

```
1. Cargar previous_period_hash:
   SELECT period_hash FROM monthly_close_runs
   WHERE workspace_id = X
     AND period_id = (período inmediatamente anterior cerrado/locked)
   Si no existe período anterior: usar '0'.repeat(64).

2. Cargar journal_entries posteadas del período (status='posted')
   + sus journal_lines, ordenadas por entry_number ASC.

3. Serialización canónica:
   Para cada entry (ordenado por entry_number ASC):
     header = entry.id|entryDate.toISOString()|entry_number|totalDebit|totalCredit
     lines  = line1_canonical\nline2_canonical\n...
       donde line_canonical = accountId|debit|credit|thirdPartyId|costCenterId|description

   entries separadas con '\n---\n'

4. Payload final:
   canonical + '\n||OVERRIDE=<true|false>' + '\n||PREVIOUS=<previousPeriodHash>'

5. period_hash = sha256_hex(payload, encoding='utf-8')
```

> **Nota**: el flag `OVERRIDE=true` aparece en el payload si el cierre fue forzado con salvedades. Esto queda registrado en la cadena de hashes y es visible para auditores.

## Smoke-test end-to-end

```bash
# 1. Activar flag
echo "UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW=true" >> .env.local

# 2. Arrancar el workflow manualmente
tsx scripts/close-month-cli.ts <workspaceId> 2026-04

# 3. Monitorear en el dashboard del Workflow DevKit
npx workflow web <runId>

# 4. Si el workflow está esperando aprobación (health_check falló):
curl -X POST http://localhost:3000/api/accounting/close/resume \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{
    "token": "close-approval:<periodId>",
    "payload": {
      "approved": true,
      "approvedBy": "Johan",
      "reason": "Revisado y aprobado con salvedades"
    }
  }'

# 5. Verificar estado
curl http://localhost:3000/api/accounting/close/status/<workflowRunId>
```

## Cron

Configurado en `vercel.ts`:
```
path:     /api/cron/monthly-close
schedule: 0 6 1 * *    → 1ro de cada mes, 06:00 UTC = 01:00 hora Colombia
```

El cron requiere `CRON_SECRET` (env var) si está configurado. En Vercel, el header `Authorization: Bearer <CRON_SECRET>` es enviado automáticamente.

## Monitoreo

```bash
# Dashboard web local
npx workflow web

# Dashboard web para un run específico
npx workflow web <runId>

# CLI
npx workflow inspect runs
npx workflow inspect run <runId>

# En producción (Vercel)
npx workflow inspect runs --backend vercel --project <project-name> --team <team-slug>
```

## Limitaciones MVP

| Decisión | MVP | Diferido |
|---|---|---|
| **D4** — Sello digital | SHA-256 encadenado | PKCS#7 + Certicámara |
| **D5** — Override RBAC | Flag boolean + audit log | Permiso `accounting:close:override` |
| **D3** — Notificaciones | Email Resend (si WS6 activo) | Web Push + WhatsApp |
| **KPIs pilares** | Ceros (pillar_kpis_view de WS6) | Datos reales tras WS6 |

## TODOs post-MVP

- [ ] `@workflow/vitest` para tests de integración del workflow (waitForHook, resumeHook).
- [ ] UI de "Forzar cierre con salvedades" en el dashboard de contabilidad.
- [ ] RBAC: permiso `accounting:close:override` antes de venta a clientes Élite.
- [ ] PKCS#7 con Certicámara cuando un cliente Élite lo exija.
- [ ] KPIs reales en el PDF cuando WS6 implemente `pillar_kpis_view`.
