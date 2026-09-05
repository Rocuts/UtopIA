# Continuidad — integridad financiera del SaaS

Actualizado: 2026-09-05. Alcance: revisión y correcciones a partir de **main**, no revisión de la PR #7. Prioridad del usuario: lógica financiera, concordancia normativa, métricas reales, informes y exportaciones, con seguridad y funcionamiento bajo distinta carga/conexión.

## Referencias verificadas

- Repo: `Rocuts/UtopIA`.
- Main revisado: `4d0db2db6176c7d8bae73da209e765a45f6a9d5b`.
- Commit de correcciones funcionales: `fd77cc5357c3d6cc9bf76b274c0adfbc77bd4d22`.
- Rama: `fix/main-financial-integrity-20260905`.
- [PR #14](https://github.com/Rocuts/UtopIA/pull/14): abierta, borrador, sin fusionar en la última consulta. Esta documentación se añade después del commit funcional; consultar HEAD remoto antes de continuar.
- [Informe y fuentes oficiales](../reviews/main-financial-integrity-2026-09-05.md).

No se fusionó ni desplegó. No hay certificación integral de preparación del SaaS para producción.

## Lo que ya se implementó

- KPI sin bases verificadas → `null`/N/D con motivo; sin escenarios, curvas ni puntuaciones de relleno.
- TTD: retirada la aproximación basada en F09/UAI. Aplicabilidad, brecha e impuesto adicional quedan `null` sin ID, UD y ámbito fiscal verificado. Se preserva esa salida estructurada después del LLM en CCV/Supervivencia.
- ECP: suma exacta de componentes por fila (E17); corrección del falso positivo EBIT = utilidad neta; bloqueo explícito de integridad si falta JSON NIIF.
- Exportación: comprobación estructural y aritmética servidor en Excel/PDF; Excel incorpora EFE y cambios en patrimonio.
- ERP: periodo conservado en CSV y filas, serializador único, moneda COP validada, caché por conexión. Entradas y agregados fuera del rango seguro de centavos se rechazan.
- UVT: años desconocidos no reutilizan otro año. Proxy reconoce los mismos secretos de auth que el backend.

**No rehacer estos cambios sin encontrar una regresión.** Hay informes históricos sobre 4175, P&G y validadores que ya no describen main. Verifica el código y sus pruebas antes de repetir sus conclusiones.

## Evidencia y límites

Sobre el código funcional indicado: suite de 199 archivos con 2.352 pruebas aprobadas y 3 omitidas; después, 3 pruebas adicionales de alias de auth en otro archivo. Tipos, lint y build pasaron. Strict-mode pasó con aviso sobre un `schemaRef` de OpenAPI no verificable por ese script. Prueba con 10.000 auxiliares y orden invertido conservó totales.

No se usaron credenciales reales de ERP/DB/LLM. No se acreditó carga concurrente de producción, todas las conexiones, validación visual integral ni seguridad completa. La prueba de volumen no garantiza latencia ni capacidad ilimitada. La documentación añadida posteriormente no modifica esos resultados funcionales.

## Próxima tarea recomendada: procedencia servidor de informes

Objetivo: que una exportación se obtenga de una versión de informe persistida y autorizada para la empresa/sesión, con referencia a la fuente y a las reglas utilizadas. Validar cifras internamente no demuestra su procedencia.

1. Comprueba el estado remoto: si #14 sigue abierta, continúa desde su rama; si ya se fusionó, trabaja desde main actualizado. Preserva cambios ajenos y examina sólo el diff posterior al commit conocido.
2. Usa la primera fila de `MAP.md` para rastrear generación → persistencia → selección de informe → exportación. Busca almacenamiento y permisos existentes; reutilízalos antes de introducir otro mecanismo.
3. Define el cambio mínimo compatible y una prueba de integración con almacenamiento controlado: usuario autorizado obtiene su versión; acceso de otra empresa, versión ajena o referencia inválida se rechazan; contenido alterado no sustituye al informe persistido. No documentes detalles sensibles en público.
4. Implementa y prueba ese recorrido. Explica migración/compatibilidad de informes históricos y modo anónimo. Un mock de auth aislado no acredita aislamiento real.

## Pendientes siguientes

| Orden | Trabajo | Criterio de cierre |
|---|---|---|
| 2 | Completar bases fiscales y revisar narrativas/consumidores | ID/UD y ámbito con fuentes oficiales vigentes; casos válidos, exentos/no aplicables e incompletos; el texto no convierte N/D en una liquidación |
| 3 | Integrar métricas de eficiencia, valoración y ROI | Fórmula, unidad, periodo, fuente, supuestos y calidad explícitos; datos ausentes siguen ausentes; escenarios identificados como tales |
| 4 | Comprobar aislamiento y configuración real | Sesiones y permisos por empresa en entorno de integración; decidir modo de operación del SaaS sin asumir que el modo anónimo está aprobado |
| 5 | Probar fallos, carga y concurrencia | Límites medidos, datos parciales/caducados identificados, tiempos de espera y reintentos sin duplicación; sin ceros ni simulaciones de sustitución |

Consultar vigencia normativa en fuentes oficiales al implementar reglas; enlaces y fechas previos son evidencia histórica, no una actualización automática.

## Cómo ahorrar contexto al continuar

Lee `AGENTS.md`, este archivo y sólo la fila pertinente de `MAP.md`. Amplía a contratos y evidencia cuando haga falta. No repitas auditoría completa, inventario del repo ni todas las pruebas al iniciar. Registra resultados con commit y distingue los nuevos de los heredados. Al cerrar sustituye este estado por un resumen breve y conserva la evidencia detallada enlazada.
