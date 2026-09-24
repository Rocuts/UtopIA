# Continuidad — exactitud financiera y normativa del SaaS

Actualizado: 2026-09-24. Alcance: auditoría integral multiagente desde **main** `dea0329` (PR #14 fusionada), con foco en
el módulo NIIF (balance de prueba → estados → informe → exportaciones), métricas, tributario, laboral, valoración y
normativa; fase 1 (hallazgos y correcciones) y fase 2 (cierre de pendientes y re-auditoría final). Informe y evidencia:
[auditoría integral 2026-09-24](../reviews/auditoria-integral-niif-2026-09-24.md).

## Referencias

- Repo: `Rocuts/UtopIA`. Rama: `claude/auditoria-proyecto-niif-sdr3ia`; código final verificado en `54802609` (después
  sólo documentación). No está fusionada en `main` ni desplegada.
- Resultado: fase 1, 269 hallazgos confirmados (264 corregidos y 5 en parte tras la fase 2); fase 2, los pendientes
  #1–#4, #8 y #9 de la fase 1 atendidos por los paquetes P1–P6 y las integraciones I1–I5 (sus remanentes siguen en
  *Pendientes* del informe); re-auditoría final, 55 hallazgos: 54 corregidos y 1 residual documentado. Índice en el
  [anexo](../reviews/auditoria-integral-niif-2026-09-24-anexo.md).
- Verificación final en `54802609`: vitest 535 archivos / 5.404 pruebas (23 omitidas: 20 en los 6 archivos
  que requieren Postgres y 3 marcadores `describe.skip` preexistentes), `tsc` sin errores, eslint 0 errores (158 avisos preexistentes, 1 de ellos en un archivo generado por la
  compilación), strict-mode y `npm run build`
  (credenciales ficticias) correctos. Re-auditoría final: 879/900 cifras al centavo por la ruta real (12 en balances
  descuadrados bloqueados con 422 y 9 N/D por diseño), 3.401/3.401 en 32 variantes honestas nuevas, 814/814 mutaciones
  de 1 centavo del cliente bloqueadas y 0/89.238 pares compensados que pasan.
- Enmiendas de criterio: `docs/spec/financial-pipeline-v2.1.md`, enmiendas 1–14 del 2026-09-24 (prevalecen sobre el
  cuerpo).

## Lo que ya se implementó (no rehacer sin regresión probada)

- Entrada NIIF: `rawData` limpio y preprocesado re-derivado en el servidor; XLSX con RFC 4180, periodos por hoja,
  saldo inicial/final, `parseNumber` morfológico. Unidad "en miles/millones" sólo con la confirmación de la solicitud,
  en centavos exactos (un importe ambiguo de tres decimales bloquea); vencimientos declarados por cuenta; fecha de corte
  del título o del encabezado de la columna → periodo `AAAA-MM`.
- Curador: R8 no absorbe residuales, R5 no reescribe patrimonio, R12 detecta P&G acumulado (también con columna de
  saldo inicial), EFE R2 completo; motivos persistentes no se degradan en el Bridge.
- Contrato NIIF: grupo 42/53 debajo de la utilidad operacional; E18–E27 (EFE contra el determinista, ECP, un código
  por renglón, subtotales por plazo con sustitución por la proyección determinista); comparativos del EFE/ECP
  calculados por el código con tres cortes o nota que pide el corte; ORI = Δ grupo 38; revaluación fuera de operación.
- Procedencia servidor (`src/lib/reports`): versión persistida por workspace con huellas (formato v2), `reportRef` en
  `/export`, `/html` y `/api/escudo/fiscal-anchor`; sello verificado / no verificado / BORRADOR; Markdown de las
  Partes I–III re-renderizado desde el JSON; veredictos del servidor que sólo endurecen; preprocesado re-derivado en
  todas las rutas de análisis; Partes IV/V sobre el consolidado del servidor.
- Narrativa: validador de prosa en notas, acta y Parte II (corpus de 89 frases honestas y 58 falsas); KPIs sin ancla
  N/D; R6–R8 del HTML con ORI y comparativos fila por fila.
- Métricas: EBITDA único, ingresos operacionales netos como denominador, anualización y N/D con motivo; formato es-CO.
- Tributario/normativo: TTD N/D sin ID/UD y "no aplica" en el SIMPLE; regla única de crédito de renta; derogatorias;
  reserva legal por tipo societario; sanciones y mora (usura del mes − 2 pp o N/D); retención 2/10 UVT; 35 % desde el
  AG 2022; M3/M5/M6 conectados; ajuste de precios de transferencia N/D sin base; tope del Art. 258 por escenario;
  Capa 2 catalogada desde el corpus.
- Contabilidad/ERP: reversos netean a cero, cierre anual en periodo 13, periodos sin solapamiento y dentro del mes,
  PUC sembrado conforme al Decreto 2650, sesiones ERP aisladas; Escudo con el mismo gate de balance que `/niif`.

## Operación pendiente antes de desplegar

1. `npm run db:migrate` (0022 y 0023 de la fase 1; la fase 2 no añadió migraciones).
2. `npm run db:ingest` para reindexar el corpus RAG corregido (6 archivos de `src/data/tax_docs` en la fase 2).
3. Avisar a consumidores del API v1 (`tb-2026-09-24.3`) y de las rutas internas (`reportRef`, 422 nuevos, contrato
   `informe-niif-2026-09-24.4`, versión v2): lista en *Operación* del informe.
4. Registrar cada mes la usura certificada en `TASA_USURA_CERTIFICADA` (hoy sólo 2026-08; sin ella la mora es N/D).
5. Revisión visual de un PDF y un Excel reales.

## Pendientes

Ver la sección *Pendientes* del informe (cada uno con motivo y dueño). Los más relevantes: filas de dinero del
dashboard de la Parte II sin ancla (exigen N/D en el contrato), límites del validador de prosa (inglés, redacciones
fuera de sus listas), Partes IV/V no persistidas con la versión, aislamiento probado sin sesión real, saldos acumulados
de ERPs que sólo entregan movimientos, nómina de independientes, normas 2026 sin fuente primaria, y verificación con el
LLM real y visual del PDF/Excel.

## Próxima tarea recomendada

Medición con el LLM real (requiere `OPENAI_API_KEY` y autorización para su costo) sobre el balance real del repo y los
fixtures de tres cortes: correr `/niif` → `/strategy` → `/governance` → `/consolidate` → `/export` y `/html`, medir la
tasa de sellos y de falsos positivos del validador de prosa, E21 y E27 sobre salidas reales, y revisar visualmente el
PDF y el Excel producidos. Todo lo anterior se probó con salidas simuladas y un corpus sintético. Empezar por las filas
"Validador de prosa" y "Aritmética y contrato NIIF" de `MAP.md`.

## Cómo ahorrar contexto al continuar

Lee `AGENTS.md`, este archivo y la fila pertinente de `MAP.md`. La sección *Fase 2* del informe resume qué se hizo por
paquete; `docs/ARCHITECTURE.md` (procedencia) describe los contratos de las rutas. Los informes fechados describen su
commit; verifica el código antes de repetir conclusiones. Con worktrees en paralelo no uses `git stash` (la pila es
compartida); comprueba el fallo de una prueba con copias de archivos.
