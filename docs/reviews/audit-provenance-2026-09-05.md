# Procedencia de auditoría y meta-auditoría — 2026-09-05

Continúa la revisión sobre **main**; no revisa la PR #7. Base: HEAD de la PR #15,
`7bffef011944956eed31142a4c9fc628638af99b` (rama `fix/persisted-report-exports-20260905`),
cuyo CI remoto estaba en verde al iniciar esta sesión: `Type + Tests + Build`,
`Coverage report`, `Integration tests (Neon staging)` y `Vercel Preview Comments`
en `success`. El trabajo nuevo se publica en `claude/audit-trail-persistence-gmtj5v`.

No se fusionó ni se desplegó. No hay certificación integral de producción.

## Defecto de procedencia que se corrige

`/api/financial-audit` y `/api/financial-quality` recibían el **contenido** a
examinar en el cuerpo de la petición. Comprobaban que existiera una sesión, pero
no resolvían workspace ni empresa: cualquier usuario autenticado podía auditar un
NIT ajeno, y el resultado se evaluaba sobre lo que enviara el navegador, no sobre
un artefacto del servidor. Ningún resultado se guardaba: vivían en `localStorage`
y desaparecían al limpiar el navegador. Como la exportación sólo acepta una
versión persistida, las páginas de auditoría y meta-auditoría quedaban fuera de
toda descarga.

## Resultado implementado

**Versiones de auditoría.** Los resultados se guardan en la tabla `reports` ya
existente bajo `financial_audit_version_v1`, sin migración de esquema. Cada fila
registra el resultado, la empresa, el idioma, la referencia a la versión
financiera examinada, el **estado de esa versión en el momento del examen**
(`examinedSha256`) y la fase que se leyó (`examinedStage`). El sobre lleva su
propio checksum canónico, tolerante al orden de claves de JSONB. Es una
comprobación de integridad, no una firma digital.

**Generación.** Ambas rutas aceptan exclusivamente referencias
(`reportVersionId`, y `auditVersionId` en la meta-auditoría). El servidor carga
la versión, comprueba sesión, workspace y NIT, reconstruye desde ella el material
examinado y guarda el resultado **antes** de comunicar éxito, en JSON y en SSE.
Un fallo de escritura no produce un `event: result`.

**Vinculación.** Una auditoría es utilizable con la versión exportada si examinó
esa versión o un ascendiente de su misma cadena `parentId`. La auditoría corre en
paralelo con Estrategia y Gobierno, así que normalmente examina la versión de la
fase NIIF; esa versión es ascendiente de la versión completa, y el documento lo
declara (ver «Alcance»). Cualquier resultado fuera de esa cadena se rechaza con
409, igual que un resultado cuya versión examinada ya no coincide con su
`examinedSha256`.

**Resultados incompletos.** Si un auditor falla, la fila queda marcada
`complete: false`: se conserva y se muestra en pantalla, pero no entra en la
descarga. La meta-auditoría hereda esa condición cuando leyó una auditoría
parcial, de modo que nunca resulta exportable un dictamen de calidad cuya
auditoría base no lo es. Las rutas devuelven `auditComplete` / `qualityComplete`
para que la interfaz sepa qué puede pedir; el informe financiero base sigue
siendo descargable sin las auditorías.

**Exportación.** `/api/financial-report/export` acepta `auditVersionId` y
`qualityVersionId` opcionales, comprueba cadena, empresa, integridad y
completitud, y rechaza con 409 una meta-auditoría que nombra una auditoría
distinta de la enviada. Devuelve `X-Audit-Version-Id` y `X-Quality-Version-Id`
con lo que el archivo realmente contiene. La descarga no ejecuta agentes.

**Alcance examinado.** Excel y PDF declaran qué fase leyeron los auditores
(«Auditoría realizada sobre la fase NIIF de esta versión del informe…»), para que
una auditoría de la fase NIIF no se lea como revisión del informe completo. Un
auditor que falló se declara como no disponible en vez de puntuarse.

**Excel.** Se añaden las hojas `Auditoria` (opinión, auditores, hallazgos
consolidados) y `Meta-auditoria` (12 dimensiones, IFRS 18, ISO 25012, ISO 42001).
El PDF editorial ya tenía `AuditFindingsPage` y `QualityMetaAuditPage`; sólo
faltaba que la ruta les pasara los resultados persistidos.

**Cliente.** `PipelineWorkspace` envía referencias en las tres llamadas y sólo
adjunta a la descarga los identificadores marcados como completos. El
identificador viaja dentro del propio resultado, así que sobrevive a una recarga
por la misma vía que ya conservaba el informe. El aviso de descarga enumera qué
contiene el archivo y qué queda solamente en pantalla.

## Contrato y compatibilidad

- `/api/financial-audit`: `{ reportVersionId, language?, auditFocus? }` con
  `.strict()`. Devuelve el `AuditReport` más `auditVersionId`, `auditComplete` y
  `examinedStage`. **Cambio incompatible**: se retiró la variante que aceptaba
  `report`. Se eliminó `financialAuditRequestSchema`, que ya no tenía usuarios.
- `/api/financial-quality`: `{ reportVersionId, auditVersionId?, language? }` con
  `.strict()`. Exige una versión en fase `complete`. Devuelve el
  `QualityAssessment` más `qualityVersionId` y `qualityComplete`. **Cambio
  incompatible**: se retiró la variante que aceptaba `report` / `auditReport`.
- `/api/financial-report/export`: acepta además `auditVersionId` y
  `qualityVersionId`; sigue rechazando cualquier contenido financiero del cliente.
- Ambas rutas dependen ahora de `requireReportWorkspace()`: 401 sin sesión, 409
  sin NIT configurado, 403 si la empresa no es la del workspace, 503 si la
  autenticación no está configurada. **En un despliegue sin autenticación
  configurada la auditoría y la meta-auditoría dejan de funcionar**, igual que ya
  ocurría con la generación persistida del informe.
- Los informes históricos o editados en el navegador no tienen versión: hay que
  regenerarlos para auditarlos o exportarlos.
- Las auditorías guardadas antes de este cambio no existen: no hay ninguna.

## Verificación ejecutada

| Comprobación | Resultado y alcance |
|---|---|
| `npm run test:report-integrity` | 35 aprobadas en 2 archivos con PostgreSQL embebido (PGlite). El script se amplió al directorio para que el nuevo archivo entre en el mismo job de CI, sin secretos de staging |
| `audit-versions.integration.test.ts` | 14 pruebas: guardado antes de anunciar (JSON y SSE), rechazo de contenido del cliente, acceso de otra empresa, referencias mal formadas/ausentes/de otro tipo, auditoría de otro informe, meta-auditoría con otra auditoría, fila alterada, versión examinada sustituida, resultado incompleto dentro y fuera de la descarga, meta-auditoría sobre versión en curso, fallo de persistencia y reintento de descarga sin reejecutar agentes |
| `persisted-versions.integration.test.ts` | 21 aprobadas; se amplió el caso de claves rechazadas con referencias de auditoría falsificadas |
| `npm test` | Ver HANDOFF: resultado de esta sesión sobre este árbol |
| `npx tsc --noEmit` | Correcto |
| `npm run lint` | Sin errores |

Las pruebas usan consultas y filtros reales de Drizzle sobre un esquema mínimo
controlado. Simulan la frontera de sesión, los agentes y los renderizadores; no
acreditan BetterAuth real, Neon remoto, todas las migraciones ni RLS.

## Límites y siguiente trabajo

1. `/api/financial-report/html` sigue recibiendo del navegador el `auditReport`
   para `metadata.alertsCounts`. Es el último punto donde contenido de auditoría
   cruza desde el cliente; no alcanza la exportación, pero conviene cerrarlo
   leyendo la auditoría persistida por referencia.
2. Sin catálogo servidor de resultados: si se pierde el índice del navegador no
   hay forma de reencontrar las versiones de auditoría de una empresa. Pendiente
   junto con la recuperación de historial (FASE 4).
3. Idempotencia de **generación**: un reintento de auditoría o meta-auditoría
   vuelve a ejecutar los agentes y crea otra fila. La descarga ya reutiliza la
   existente. `fetchJSONWithRetry` puede duplicar la meta-auditoría si se pierde
   la respuesta después de la escritura.
4. Telemetría: ninguna de las dos rutas envuelve la ejecución en
   `runWithTelemetryContext`, así que el coste de los 4 auditores y del
   meta-auditor sigue sin atribuirse al workspace.
5. `maxDuration` sigue en 300 s en ambas rutas (y 120 s para calidad en
   `vercel.ts`, incoherencia previa), frente a 800 s en las fases del informe.
   Cambiarlo es una decisión de capacidad y coste que no se tomó aquí.
6. `resolveVersionLineage` carga versiones completas para recorrer la cadena; en
   cadenas largas es trabajo medible en la ruta de descarga.
7. Un documento sin sección de auditoría sigue siendo indistinguible de «se
   auditó y no hubo hallazgos» para quien lo lee sin contexto; la interfaz sí lo
   distingue. Declararlo dentro del propio documento queda pendiente.
8. No se implementaron reglas fiscales nuevas ni se revalidó normativa: FASES 2 y
   3 siguen abiertas.
