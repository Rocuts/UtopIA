# 1+1 — Decisiones MVP y diferidas

**Fecha de captura**: 2026-05-05
**Owner**: Johan (developer@basileasystems.com)
**Estado**: Vigente para Ola "1+1 Élite" — congelar antes de validar con clientes Élite.

Este documento registra las decisiones de alcance que tomamos para el MVP del módulo "1+1" (motor contable de élite + cierre mensual automatizado + alertas), con la versión MVP que ya está despachada a los Sonnet 4.6 y la versión completa que queda **diferida** para olas posteriores.

La regla maestra es: **MVP = lean, todo nuevo OFF por feature flag, no rompemos nada existente. Lo diferido se documenta con dueño, gatillo y archivo a tocar.**

---

## D1 — Modo de despliegue

| Aspecto | MVP | Diferido |
|---|---|---|
| Paralelismo | **6 streams en paralelo** sobre archivos disjuntos | — |
| Protección | **Feature flags `UTOPIA_ENABLE_*` OFF por defecto** | Encendido global tras smoke-test |
| Tests | `npx tsc --noEmit` + `npm run build` limpios por stream | Vitest + `@workflow/vitest` (WS-Tests futuro) |

---

## D2 — OCR → Libro mayor

**MVP**: Promote **explícito**. El usuario revisa los `pyme_entries` confirmados y pulsa "Promover a Libro Mayor". El bridge crea `journal_entries` en estado `draft` y opcionalmente aplica tax_engine si la categoría está marcada como factura.

**Diferido**:
- **Auto-promote** con confianza > 0.9 — requiere métricas de calidad del clasificador.
- **Aprendizaje**: el clasificador aprende del PUC final que el contador ratifica vs el `pucHint` sugerido.
- **Archivo**: `src/lib/agents/pyme/promote/auto-rules.ts` (futuro).

**Por qué diferimos**: los empresarios PYME no son contadores; pisarles un asiento mal contabilizado a 100M COP es un golpe de confianza letal. Promote manual hasta tener datos de precisión.

---

## D3 — Canales de notificación

**MVP**: **Email transaccional vía Resend** sobre evento `period.locked` (cierre mensual exitoso o cierre con anomalías). Una sola plantilla con cabecera + 4 KPIs (uno por pilar) + 3 CTAs (Ver Informe, Compartir, Explorar Anomalías).

**Diferido**:
- **Web Push (VAPID)**: requiere flujo de permisos del navegador + suscripción persistente. Tabla `notification_subscriptions` ya soporta el shape `endpoint/p256dhKey/authKey`. Encender el canal `web_push` cuando el usuario lo pida.
- **WhatsApp Business (Twilio o Meta directo)**: el empresario colombiano vive en WhatsApp. Requiere plantillas WABA aprobadas y proveedor configurado. Tabla ya soporta canal `whatsapp`.
- **SMS**: solo si Resend deja de servir (poco probable).
- **Archivos**: `src/lib/notifications/web-push.ts`, `src/lib/notifications/whatsapp.ts` (futuros, stubs hoy).

---

## D4 — Sello digital del cierre

**MVP**: **Hash SHA-256 encadenado** período-N → período-N+1.
- Cada `monthly_close_runs.period_hash` = `sha256(canonical_serialize(all_entries) || previous_period_hash)`.
- La columna `monthly_close_runs.previous_period_hash` apunta al hash del período anterior cerrado.
- Manipular un asiento posteado de un mes cerrado rompe la cadena y queda evidente al recalcular.

**Diferido**:
- **Firma PKCS#7 con certificado real** emitido por Certicámara / Andes SCD / GSE.
  - Trigger: cuando un cliente Élite (revisor fiscal) o auditor externo lo exija.
  - Costo: ~ COP $200K-400K/año por cert digital + integración con HSM o softoken.
  - Archivo: `src/lib/security/digital-signature.ts` (futuro).
- **Timestamp authority (TSA)** con sello de tiempo cualificado eIDAS o equivalente colombiano.

---

## D5 — Bloqueo del cierre frente a descuadres

**MVP**: **Bloqueo fuerte por defecto**. Si el health check detecta:
- Asientos descuadrados → bloquea cierre.
- Diferencia bancaria > tolerancia (1000 COP o 0.1% del saldo) → bloquea cierre.
- Documentos OCR pendientes de revisión > 0 → bloquea cierre.

Hay un **override**: el campo `monthly_close_runs.health_check_results` registra si fue cerrado con `override:true`, quién lo autorizó (`closed_by`), y la razón. El usuario debe pulsar explícitamente "Forzar cierre con salvedades" — el evento queda en el audit log y el `period_hash` incluye el flag de override.

**Diferido**:
- **Bloqueo soft con badge "with_warnings"** en el dashboard de pilares.
- **Workflow de aprobación dual**: Revisor Fiscal autenticado debe aprobar override antes de que el cierre proceda.
- **Roles y permisos**: hoy el override es una checkbox; mañana debe ser un permiso `accounting:close:override` en RBAC.
- **Archivo**: `src/lib/accounting/closing/override-policy.ts` (futuro).

---

## D6 — Tests automatizados

**MVP**: cada stream entrega código que pasa `npx tsc --noEmit` y `npm run build`. Lo crítico (validador de partida doble, parser de balance, tax engine, monthly close) tiene **tests manuales documentados** en su README correspondiente.

**Diferido a WS-Tests**:
- Instalar `vitest` + `@workflow/vitest` (este último es indispensable para WS5 — workflows con `sleep()` y `createHook()` requieren el plugin).
- Cobertura objetivo: ≥80% en `src/lib/accounting/**`, ≥60% en `src/lib/agents/pyme/**`, 100% en `src/lib/accounting/double-entry/validate.ts`.
- Tests de integración del workflow de cierre con `waitForHook`, `resumeHook`, `wakeUp`.
- Archivos: `vitest.config.ts`, `vitest.integration.config.ts`, `src/**/__tests__/`.

**Por qué diferimos**: el costo de configurar vitest + bundler config + paths + mocks vs el valor inmediato del MVP. Pero es bloqueante antes de venta a clientes Élite.

---

## Otras decisiones MVP que conviene recordar

### Schema split
Las tablas nuevas viven en archivos separados (`src/lib/db/schema-{tax,banking,adjustments,notifications}.ts`) re-exportados desde `schema.ts`. Esto permite trabajo paralelo. **Diferido**: cuando crezca, mover todo a `src/lib/db/schema/` con un barrel `index.ts`.

### Migrations split
Migraciones manuales `0005_smart_tax.sql` … `0008_notifications.sql` escritas a mano siguiendo formato Drizzle. **Diferido**: ejecutar `npm run db:generate` para regenerar y verificar paridad cuando el ciclo lo permita.

### Vercel Workflow
WS5 es la primera adopción. Si tras el MVP el equipo encuentra que el dashboard observable y el replay justifican la dependencia, se extienden a:
- Procesos de auditoría forense (anomaly detection con pause-resume cuando el contador deba decidir).
- Onboarding de empresa (multi-step con verificación DIAN).
- **Diferido**: `src/lib/workflows/onboarding/*`, `src/lib/workflows/forensic-audit/*`.

### UVT y umbrales
UVT 2026 = $52.374 hardcoded en `src/lib/accounting/tax-engine/constants.ts`. El campo `apply_threshold_uvt` en `tax_rules` permite expresar umbrales en UVT (resilientes a cambios anuales). **Diferido**: tabla `uvt_constants` con histórico para recalcular retenciones de períodos pasados; cron que valida UVT contra DIAN cada enero.

### Régimen tributario del tercero
MVP: tabla `third_party_tax_profile` con flags booleanos (`is_gran_contribuyente`, `is_autorretenedor`, `is_responsable_iva`, `regimen_simple`). Se llena manual o por el tooltip del clasificador NIT.

**Diferido**:
- **Verificación automática contra el RUT DIAN**: usa el servicio público (formulario consulta NIT) + scraping/parsing del PDF descargado.
- Archivo: `src/lib/scrapers/dian-rut-scraper.ts` (futuro).

### Conciliación bancaria
MVP: importador **CSV** + matcher heurístico (exact amount + ±3 días + cuenta mapeada). UI manual para resolver no-matches.

**Diferido**:
- Importadores OFX, MT940 (formatos estándar para Banco de Bogotá, Bancolombia internacional).
- Matcher LLM para descripciones ambiguas (cuando los heurísticos no encuentran nada).
- **Open banking real**: APIs de bancos colombianos vía Mercado Pago/Bold/Trii/Truora — todavía es bastante manual en CO en 2026.
- Archivos: `src/lib/accounting/banking/parsers/{ofx,mt940}.ts`, `src/lib/accounting/banking/matchers/llm-matcher.ts` (futuros).

### Detección de anomalías
MVP: el audit pipeline existente (`src/lib/agents/financial/audit/`) sigue funcionando sobre uploads. **No** se ejecuta automáticamente sobre journal_entries en este MVP.

**Diferido**:
- **Cron nocturno** que corre el audit pipeline sobre el último período abierto.
- **Reglas deterministas** complementarias: Benford's law, gaps de numeración, asientos en domingo, montos repetidos, terceros nuevos sin verificar.
- Archivo: `src/lib/agents/financial/audit/forensic-rules.ts` (futuro).

### Cascada real-time hacia los 4 pilares
MVP: `src/lib/kpis/cache.ts` con view materializada Postgres + Vercel Runtime Cache (TTL 60s) invalidada con tag por workspace. El `postEntry()` invalida el tag tras `COMMIT`.

**Diferido**:
- **Streaming real-time** vía SSE o websockets para que el dashboard se actualice sin reload.
- **Postgres LISTEN/NOTIFY** en lugar de cache invalidation.
- Archivo: `src/lib/kpis/realtime-stream.ts` (futuro).

---

## Cómo encender un feature flag

Cada flag se lee en el código vía `process.env.UTOPIA_ENABLE_<FEATURE> === 'true'`. Para encenderlo:

```bash
# Desarrollo
echo 'UTOPIA_ENABLE_TAX_ENGINE=true' >> .env.local

# Vercel preview/prod
vercel env add UTOPIA_ENABLE_TAX_ENGINE preview
vercel env add UTOPIA_ENABLE_TAX_ENGINE production
```

Lista de flags en este Ola:
- `UTOPIA_ENABLE_TAX_ENGINE` (WS1)
- `UTOPIA_ENABLE_OCR_PROMOTE` (WS2)
- `UTOPIA_ENABLE_BANK_RECON` (WS3)
- `UTOPIA_ENABLE_AUTO_ADJUSTMENTS` (WS4)
- `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW` (WS5)
- `UTOPIA_ENABLE_NOTIFICATIONS` (WS6)

---

## Checklist antes de venta a clientes Élite (post-MVP)

- [ ] Encender los 6 flags en producción y monitorear 2 ciclos mensuales completos.
- [ ] Implementar **D6** (vitest + cobertura).
- [ ] Implementar **D4** (PKCS#7 si lo pide el cliente).
- [ ] Implementar verificación RUT DIAN automática (D5).
- [ ] Implementar conciliación bancaria con OFX/MT940 (D5).
- [ ] Implementar Web Push (D3) para notificaciones in-app.
- [ ] Implementar cron de detección de anomalías nocturno (D5).
- [ ] Implementar override workflow con permisos RBAC (D5).
- [ ] Validar con un Revisor Fiscal real un cierre completo (prueba de fuego).
