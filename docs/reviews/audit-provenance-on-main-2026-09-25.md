# Procedencia de las Partes IV y V sobre el modelo de main — 2026-09-25

Base: `main` en `b2ec2b8c` (PR #17 fusionada). Rama `claude/audit-provenance-reports-gmtj5v`.
Sustituye a la PR #16, que perseguía el mismo objetivo sobre un almacén de versiones
(`financial-report-versions.ts`, `reportVersionId`) que main no adoptó: PR #17 construyó
su propia procedencia en `src/lib/reports/`, y #15 y #16 quedaron en conflicto con main en
17 archivos. No se fusionó ni se desplegó. No certifica preparación para producción.

## Estado de main antes del cambio

- Las Partes I–III tenían procedencia servidor: `/consolidate` persiste la versión y `/export`,
  `/html` y `/api/escudo/fiscal-anchor` la cargan por `reportRef = {reportId, reportHash}`.
- Las Partes IV (dictámenes) y V (meta-auditoría) **no se persistían** (pendiente declarado en
  el HANDOFF de main). `/export` las recibía en el cuerpo y el composer del PDF, con razón, se
  negaba a imprimirlas sin procedencia de servidor (`reportes-export-11`: exige
  `assuranceProvenance === 'server-persisted'`, que nada establecía). El Excel no las incluía.
  Resultado: **ninguna descarga contenía las Partes IV/V**.
- La UI conservaba la auditoría del informe anterior tras recargar la página: la limpieza sólo
  ocurría en un re-run (`if (isRerun)`).

**Corrección de una afirmación hecha durante el trabajo.** En un punto afirmé que el PDF
verificado de main imprimía los dictámenes enviados por el cliente. Es falso: la ruta los
pasaba al composer y el composer los descartaba. La prueba que parecía demostrarlo usaba un
composer simulado y sólo probaba que la ruta los *pasaba*. Con el composer real, lo que main
hacía era no imprimir nunca las Partes IV/V. El mismo mock ocultó un defecto propio (ver
Verificación).

## Resultado implementado

- **Resultado persistido.** Con `reportRef`, `/financial-audit` y `/financial-quality` corren
  los agentes sobre la versión persistida (con su balance) y guardan la salida **antes de
  responder**, en `reports` con `kind = 'financial_audit_result'`, en el workspace de la
  sesión. El sobre guarda el resultado canónico, el `reportRef` exacto sobre el que se produjo,
  en la Parte V el `auditRef` de la Parte IV que leyó, la marca `complete` y una huella SHA-256
  del sobre completo. La respuesta añade `auditRef`/`qualityRef = {resultId, resultHash}`, la
  completitud y `persistence`. El informe y los dictámenes del cuerpo se ignoran.
- **Completitud.** Un auditor caído o una salida sin contenido dejan `complete: false`: el
  resultado se ve en pantalla pero no entra en una descarga. La Parte V que leyó una Parte IV
  parcial hereda esa condición. El informe base sigue descargable.
- **Fallo de almacenamiento.** El resultado se devuelve marcado `not_persisted` y sin
  referencia, como hace `/consolidate`; no puede entrar en una descarga verificada.
- **Exportación verificada.** Los dictámenes del cuerpo ya no llegan al composer. `auditRef` y
  `qualityRef` se cargan y se prueba: mismo workspace; mismo id y huella; sobre íntegro; Parte
  correcta; producido sobre exactamente el `{reportId, reportHash}` exportado; completo; y la
  Parte V emparejada con exactamente la Parte IV enviada, en ambos sentidos. Sólo entonces se
  establece `assuranceProvenance: 'server-persisted'`. El Excel gana las hojas `Auditoria` y
  `Meta-auditoria`.
- **Sello.** Nombra cada resultado incluido (id, fecha, huella) y dice que acredita su
  procedencia, **no su contenido** (los generaron agentes de IA). Si el cuerpo traía dictámenes,
  declara que no se publicaron. Cabeceras `X-Audit-Result-*`, `X-Quality-Result-*`,
  `X-Report-Audit-Content-Dropped`.
- **Cliente.** Con versión persistida envía referencias; en las descargas sólo nombra
  resultados persistidos y completos; un aviso dice qué entra en el archivo y qué queda en
  pantalla. Un informe nuevo ya no hereda la auditoría del anterior.
- El camino sin referencia (informes históricos, sin base de datos o sin workspace) no cambia.

La vinculación es por igualdad exacta de `{reportId, reportHash}`: en main la auditoría corre
después de `/consolidate`, sobre el informe completo, así que no hace falta recorrer una cadena
de versiones como en la PR #16, ni la nota de "sólo contenido NIIF" que aquella necesitaba.

## Verificación ejecutada

| Comprobación | Resultado |
|---|---|
| `npx vitest run` | 537 archivos / 5.430 aprobadas, 26 omitidas: la línea base de main (535 / 5.404 / 23) más 26 nuevas; las 3 pruebas de Postgres nuevas se omiten sin base, como las de main |
| `audit-results.route.test.ts` | 13 pruebas con el fake de `reports` de main (evalúa las condiciones SQL reales del store) y **el composer PDF real**; sólo el render binario está controlado |
| `audit-result-store.db.test.ts` y el de main | 6 aprobadas contra PostgreSQL 16 local con todas las migraciones (sólo fallan las líneas de pgvector de 0004, como documenta el harness) |
| `audit-sheets.test.ts` | 8 pruebas contra ExcelJS real y el composer real |
| `pipeline-procedencia.test.ts` | 5 pruebas nuevas de los cuerpos del cliente, el aviso y la limpieza |
| Mutaciones | 14 del servidor y 5 del cliente: cada protección retirada hace fallar la prueba que la nombra; el filtro por workspace también se comprobó contra Postgres real |
| `tsc`, `lint:strict-mode`, `npm run build` | Correctos (build con las credenciales ficticias del CI) |
| `npm run lint` | 0 errores; ningún aviso nuevo en los archivos tocados (los dos de `PipelineWorkspace.tsx` ya estaban en main) |

**Un defecto que el mock ocultaba.** La primera versión pasaba los resultados vinculados al
composer pero no establecía `assuranceProvenance`: con el composer real se habrían descartado
igualmente y el PDF habría salido sin las Partes IV/V. Todas las pruebas de ruta pasaban porque
simulaban el composer. Se detectó al probar el render con el composer real; ahora las pruebas
de ruta lo usan y una mutación que retira esa línea hace fallar dos pruebas.

## Límites

- Fake de la tabla y Postgres local no acreditan Neon, BetterAuth real, RLS, carga ni latencia.
  Los agentes están simulados: no se midió la tasa real de resultados completos.
- `/api/fiscal-audit-opinion` sigue recibiendo la Parte IV como texto del cliente.
- Reintentar la **generación** vuelve a correr los agentes y crea otra fila; `fetchJSONWithRetry`
  puede duplicar la meta-auditoría si se pierde la respuesta tras guardar. No hay catálogo
  servidor para recuperar resultados si se pierde el índice del navegador.
- Las rutas de auditoría no envuelven los agentes en `runWithTelemetryContext`; `maxDuration`
  sigue en 300 s (decisión de capacidad y coste no tomada aquí).
- Operación: sin migración (reutiliza `reports`). Los consumidores de `/financial-audit`,
  `/financial-quality` y `/export` que envíen dictámenes en el cuerpo junto con `reportRef`
  dejarán de verlos en el PDF hasta pasar referencias; antes tampoco se imprimían.
