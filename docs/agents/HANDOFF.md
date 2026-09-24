# Continuidad — exactitud financiera y normativa del SaaS

Actualizado: 2026-09-24. Alcance: auditoría integral multiagente desde **main** `dea0329` (PR #14 fusionada), con foco en
el módulo NIIF (balance de prueba → estados → informe → exportaciones), métricas, tributario, laboral, valoración y
normativa. Informe y evidencia: [auditoría integral 2026-09-24](../reviews/auditoria-integral-niif-2026-09-24.md).

## Referencias

- Repo: `Rocuts/UtopIA`. Rama: `claude/auditoria-proyecto-niif-sdr3ia`; código verificado en `776ca97` (después sólo
  documentación). Sin PR, sin merge, sin despliegue.
- Resultado: 269 hallazgos confirmados (incluida la re-auditoría) → 259 corregidos, 10 en parte; índice en el
  [anexo](../reviews/auditoria-integral-niif-2026-09-24-anexo.md).
- Verificación final: vitest 397 archivos / 4.027 pruebas (20 omitidas, 0 fallos); `tsc`, lint (0 errores),
  strict-mode y `npm run build` (credenciales ficticias) correctos; recálculo independiente por la ruta real 738/750
  cifras al centavo (12 en balances descuadrados bloqueados con 422).
- Enmiendas de criterio: `docs/spec/financial-pipeline-v2.1.md` (enmiendas 1-11 del 2026-09-24, prevalecen sobre el cuerpo).

## Lo que ya se implementó (no rehacer sin regresión probada)

- Entrada NIIF: la UI envía `rawData` limpio; el servidor re-deriva el preprocesado (helper `raw-data.ts`), XLSX con
  RFC 4180, periodos por hoja, saldo inicial/final, `parseNumber` morfológico, cabeceras con tildes/Windows-1252.
- Curador: R8 ya no absorbe residuales (descuadre bloqueante con monto), R5 no reescribe patrimonio, R12 detecta P&G
  acumulado, EFE R2 completo; `curatorBlockingReasons`/`integrityReasons` no se degradan en el Bridge.
- Contrato NIIF: grupo 42/53 debajo de la utilidad operacional; E18 (EFE LLM vs determinista), E19/E20 (ECP), ECP exacto;
  impuesto sin grupo 54 no reconocido; exportaciones y HTML con el mismo JSON y preprocesado; paridad de signos en las
  cuatro superficies.
- Métricas: EBITDA único, ingresos operacionales netos como denominador, anualización y N/D con motivo; sin cifras de
  maqueta en el workspace; heurísticas fiscales retiradas.
- Tributario/normativo: TTD N/D sin ID/UD, regla única de crédito de renta, Art. 36-3 y Arts. 457-459 C.Co. derogados,
  reserva legal por tipo societario, calculadora de sanciones con contrato único, calendario sin fechas no verificadas
  como oficiales, retención 2/10 UVT.
- Contabilidad/ERP: reversos netean a cero, cierre anual en periodo 13, conciliación bancaria acumulada, PUC sembrado
  conforme al Decreto 2650 (migraciones 0022/0023), sesiones ERP aisladas por conexión y credencial.

## Operación pendiente antes de desplegar

1. `npm run db:migrate` (migraciones 0022 y 0023).
2. `npm run db:ingest` para reindexar el corpus RAG corregido.
3. Revisar consumidores externos del API v1 (`tb-2026-09-24`: `status` pre-R8, campos nuevos).

## Pendientes

Ver la sección *Pendientes* del informe. Los más relevantes: procedencia servidor de informes (tarea recomendada del
handoff anterior, sigue abierta), comparativos EFE/ECP en el contrato NIIF, clasificación corriente/no corriente por
vencimientos (decisión de negocio), saldos acumulados de ERPs que sólo entregan movimientos, confirmación primaria de
normas 2026 no verificables desde este entorno, y verificación visual del PDF/Excel.

## Próxima tarea recomendada

Procedencia servidor de informes (igual que el handoff anterior): que una exportación se obtenga de una versión
persistida y autorizada para la empresa/sesión, con referencia al balance y a las reglas aplicadas. Hoy el servidor
re-valida aritmética y fuente contra el `rawData`/`preprocessed` recibidos, pero no demuestra que correspondan a una
versión autorizada. Seguir la primera fila de `MAP.md`.

## Cómo ahorrar contexto al continuar

Lee `AGENTS.md`, este archivo y la fila pertinente de `MAP.md`. Los informes fechados describen su commit; verifica el
código antes de repetir conclusiones.
