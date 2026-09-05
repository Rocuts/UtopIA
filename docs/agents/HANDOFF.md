# Continuidad — integridad financiera del SaaS

Actualizado: 2026-09-05. Objetivo: métricas reales, trazables y coherentes con normativa colombiana; informes autorizados y resultados fiables. No hay certificación integral de producción.

## Estado remoto y referencia de trabajo

- Repo: `Rocuts/UtopIA`; revisión sobre **main**, no PR #7.
- PR #14: fusionada. PR #15 (`fix/persisted-report-exports-20260905`, HEAD `7bffef011944956eed31142a4c9fc628638af99b`): **abierta, borrador, CI en verde** al comprobarla en esta sesión (Type + Tests + Build, Coverage, Integration Neon, Vercel Preview).
- Rama de esta continuación: `claude/audit-trail-persistence-gmtj5v`, partiendo del HEAD de #15.
- [Cambio, contrato, pruebas y límites de esta sesión](../reviews/audit-provenance-2026-09-05.md).
- [Sesión anterior: versiones servidor de informes](../reviews/persisted-report-exports-2026-09-05.md). [Evidencia previa](../reviews/main-financial-integrity-2026-09-05.md); no repetirlas como revisión actual.

No se fusionó ni se desplegó.

## Implementado antes de esta sesión — no rehacer sin encontrar una regresión

Versiones servidor por fase NIIF → estrategia → gobierno sobre `reports`; fuente, contexto, opciones, referencia anterior y checksum. Excel/PDF sólo desde una versión completa autorizada por empresa. Cada fase espera la escritura antes de comunicar éxito. Resolver de workspace alineado con los alias de auth. Eficiencia sin base referencial → `null`/N/D.

## Implementado en esta continuación (FASE 1 — procedencia de auditorías)

- Auditoría y meta-auditoría se guardan en `reports` bajo `financial_audit_version_v1`, sin migración. Cada fila registra la versión examinada, su digest en ese momento (`examinedSha256`), la fase leída (`examinedStage`) y, en la meta-auditoría, la auditoría que consumió.
- `/api/financial-audit` y `/api/financial-quality` sólo aceptan referencias; el servidor reconstruye el material desde la versión, comprueba sesión, workspace y NIT, y **guarda antes de anunciar éxito** en JSON y SSE.
- Una auditoría vale para la versión exportada o para un ascendiente de su cadena `parentId`; cualquier otra combinación se rechaza. Se rechaza también una meta-auditoría que nombra una auditoría distinta de la enviada.
- Resultado con un auditor caído → `complete: false`: se conserva y se ve en pantalla, no entra en la descarga; la meta-auditoría hereda esa condición. El informe base sigue descargable.
- La exportación acepta `auditVersionId`/`qualityVersionId`, comprueba cadena, empresa, integridad y completitud, y devuelve `X-Audit-Version-Id`/`X-Quality-Version-Id`.
- Excel gana las hojas `Auditoria` y `Meta-auditoria`; el PDF ya tenía sus páginas. Ambos declaran qué fase examinó la auditoría, para que una auditoría de la fase NIIF no se lea como revisión del informe completo.
- El cliente envía referencias y sólo adjunta identificadores completos; el aviso de descarga enumera qué contiene el archivo y qué queda en pantalla.

## Pruebas y límites

- Suite: **200 archivos, 2.365 aprobadas, 3 omitidas**.
- Procedencia: **35 aprobadas** con PostgreSQL embebido (`npm run test:report-integrity`, ampliado al directorio para que corra en el mismo job de CI sin secretos). 14 nuevas cubren guardado previo al anuncio, rechazo de contenido del cliente, acceso de otra empresa, referencias mal formadas/ausentes/de otro tipo, auditoría de otro informe, meta-auditoría con otra auditoría, fila alterada, versión examinada sustituida, resultado incompleto, meta-auditoría sobre versión en curso, fallo de persistencia y reintento de descarga sin reejecutar agentes.
- `npx tsc --noEmit` correcto. `npm run lint`: 0 errores, 197 advertencias. `lint:strict-mode` correcto con el aviso previo de OpenAPI. `npm run build` local correcto con credenciales ficticias.
- PGlite y fronteras simuladas no acreditan BetterAuth/Neon/ERP/LLM reales, migraciones completas, RLS, carga ni latencia productiva. Checksum ≠ firma ni autenticidad de la fuente contable.
- **Cambio incompatible**: ambas rutas de auditoría dejaron de aceptar `report` en el cuerpo y ahora exigen sesión, NIT del workspace y versión guardada; en un despliegue sin autenticación configurada devuelven 503. Los informes históricos o editados en el navegador deben regenerarse.

## Siguiente tarea concreta

Cerrar el último punto donde contenido de auditoría cruza desde el cliente: `/api/financial-report/html` recibe el `auditReport` del navegador para `metadata.alertsCounts` (`PipelineWorkspace.tsx`, búsqueda `countAlertsBySeverity`). Debe leer la auditoría persistida por `auditVersionId`, comprobando cadena y empresa como hace la exportación, y no aceptar conteos calculados en el navegador. Entradas y pruebas: primera fila de `MAP.md`.

## Pendientes priorizados después

1. Bases ID/UD y aplicabilidad fiscal con fuentes oficiales vigentes; revisar consumidores y narrativas de riesgo (FASE 2, sin avance).
2. Eficiencia, valoración y ROI: fórmula, unidad, periodo, fuente, supuestos y calidad (FASE 3, sin avance).
3. Idempotencia de **generación** y recuperación de confirmaciones perdidas: reintentar una auditoría o meta-auditoría vuelve a ejecutar agentes y crea otra fila; `fetchJSONWithRetry` puede duplicar la meta-auditoría. Falta un catálogo servidor para recuperar versiones y auditorías cuando se pierde el índice del navegador.
4. Sesiones, permisos y conexiones con servicios reales; decidir el modo de operación del SaaS.
5. Carga, concurrencia y límites medidos. Anexos conocidos: ninguna ruta de auditoría envuelve la ejecución en `runWithTelemetryContext` (coste sin atribuir); `maxDuration` sigue en 300 s en ambas rutas y 120 s para calidad en `vercel.ts`, frente a 800 s en las fases del informe; `resolveVersionLineage` carga versiones completas para recorrer la cadena.

Lee sólo el frente pertinente del mapa. Preserva cambios ajenos y reutiliza resultados para el código al que correspondan.
