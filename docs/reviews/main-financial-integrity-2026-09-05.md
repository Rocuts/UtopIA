# Revisión de integridad financiera de main — 2026-09-05

Base revisada: `4d0db2db6176c7d8bae73da209e765a45f6a9d5b` de `Rocuts/UtopIA/main`. Esta revisión no evalúa la PR #7. Los cambios propuestos parten de main y no despliegan ni modifican producción.

**Decisión: todavía no aprobar el lanzamiento del SaaS con la promesa de que todas las métricas son reales y normativamente determinadas.** Esta entrega corrige defectos reproducidos de cálculos, importación, exportación y configuración de autenticación. Compilar y cuadrar estados no demuestra la autenticidad de los datos ni el cumplimiento integral de cada contribuyente.

## Hallazgos corregidos

| Prioridad | Problema observado en main | Corrección y evidencia |
|---|---|---|
| Alta | El dashboard completaba métricas con márgenes, factores, escenarios y puntuaciones supuestos. | Valores no disponibles son `null`/N/D con motivo; no se fabrican curvas. Salud regulatoria exige auditoría completa y sigue siendo un índice interno, no un certificado legal. Pruebas `live-integrity`. |
| Alta | La alerta TTD usaba F09 y UAI como sustitutos de ID y UD. Además F09 llega redondeado. | Se elimina la liquidación aproximada. Aplicabilidad, brecha e impuesto quedan `null`; se explica la información faltante. Los agentes CCV y Supervivencia preservan estos valores después de generar su respuesta. Pruebas `ccv-tasa-minima`, incluido un resultado del modelo que intenta introducir cifras distintas. |
| Alta | Una fila del estado de cambios en patrimonio podía tener componentes que no sumaban su total. | Regla E17 exacta en centavos para cada fila. Se verifica una diferencia de un centavo y movimientos con signo. |
| Alta | Exportar aceptaba indicadores de validación del informe sin volver a comprobar su aritmética. | Validación estructural y contable en el servidor para las rutas Excel/PDF, incluidos EFE y detalle de balance; HTTP 422 ante inconsistencias. Se conserva el PDF diagnóstico del flujo bloqueado. Pruebas de ambas rutas, flags manipulados y formatos inválidos. |
| Alta | La caché ERP distinguía proveedor y periodo, pero no conexión. | La identidad de conexión integra ambas claves de caché. Prueba de cambio de empresa usando el mismo proveedor. Esto no sustituye una auditoría de aislamiento multitenant completa. |
| Alta | CSV y filas ERP perdían el periodo, y una moneda distinta podía entrar al pipeline COP. | Serializador único, periodo explícito, preservación de nombres y rechazo de moneda sin conversión documentada. Pruebas anual, mensual, trimestral y rango. |
| Alta | Los importes `number` podían llegar sin precisión suficiente antes de convertirse a BigInt. | Rechazo de importes y agregados fuera del rango seguro en centavos. No se promete volumen o magnitud ilimitados. |
| Media | Ausencia de JSON NIIF no añadía el bloqueo explícito de integridad aritmética. | Se sella el informe con salvedades y se impide la exportación numérica sin estructura válida. |
| Media | EBIT igual a utilidad neta generaba un falso error incluso si la fuente confirmaba esa igualdad. | Se consulta la evidencia contable; sin evidencia adicional se advierte, no se inventan gastos. |
| Media | Una UVT de otro año se reutilizaba para años no soportados. | Año no registrado, entradas inválidas o resultado fuera del rango seguro producen error. |
| Media | Excel omitía EFE y cambios en patrimonio. | Se añaden ambas hojas desde el mismo JSON, preservando signos. Se abre el archivo generado con ExcelJS y se verifican las cuatro hojas y cifras. |
| Media | Proxy y backend reconocían conjuntos diferentes de variables de autenticación. | Ambos consultan `isAuthConfigured`; pruebas verifican 401 sin sesión para las tres variables admitidas. |

## Contraste normativo efectuado

| Regla | Fuente oficial consultada | Resultado en esta entrega |
|---|---|---|
| UVT 2026: COP 52.374, aplicable a ese año | [Resolución DIAN 000238 de 2025, art. 1](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0238_2025.htm) | El valor existente coincide. Se corrige la extrapolación silenciosa a años desconocidos. |
| TTD = ID / UD; UD requiere depuración específica | [Concepto DIAN 4228 de 2026, numeral 4](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_4228_2026.htm) | UAI y F09 no bastan. Se deja el cálculo no determinable hasta contar con bases y ámbito legal verificados. UAI no positiva tampoco prueba UD no positiva ni pérdida fiscal. |

Estas comprobaciones no equivalen a certificar todas las tarifas, excepciones, municipios, regímenes, grupos NIIF ni cambios de vigencia. La conciliación fiscal, el régimen y las fuentes aplicables deben quedar vinculados al periodo de cada cálculo. La presentación de cuatro estados tampoco determina por sí sola el marco de información financiera exigible a cada empresa.

## Verificación ejecutada

- Suite completa después de los cambios funcionales: **199 archivos; 2.352 pruebas aprobadas, 3 omitidas**.
- Prueba adicional de alias de autenticación: **1 archivo; 3 pruebas aprobadas**.
- `npx tsc --noEmit`: correcto.
- `npm run lint`: correcto.
- `npm run lint:strict-mode`: correcto, con aviso del script sobre `schemaRef` en OpenAPI que no pudo verificar.
- `npm run build`: correcto con credenciales ficticias de compilación. No prueba acceso a servicios reales.
- `git diff --check`: correcto.
- Prueba determinista con 10.000 auxiliares y orden invertido: mismos totales. Es una prueba de integridad, no un benchmark de concurrencia ni una garantía de latencia en producción.

Las pruebas nuevas cubren regresiones concretas. No representan una auditoría de penetración completa, verificación visual integral del dashboard ni integración con todos los proveedores ERP reales.

## Condiciones pendientes para liberar el SaaS

1. **Procedencia verificable:** vincular cada informe exportable a su empresa, fuente y versión inmutables en el servidor. Coherencia interna no demuestra que las cifras correspondan a una fuente autorizada.
2. **Fiscalidad completa:** incorporar ID, UD, ajustes y verificación del régimen antes de habilitar TTD. Revisar los demás escenarios y narrativas fiscales; el texto generado por IA todavía requiere controles contra afirmaciones no sustentadas. Los valores ausentes deben permanecer ausentes, también en consumidores externos.
3. **Métricas disponibles de verdad:** integrar bases verificadas para eficiencia fiscal, valoración y ROI. N/D es el comportamiento correcto actual; esas funciones no están completadas por retirar los supuestos.
4. **Despliegue y aislamiento:** verificar sesiones, permisos y separación de empresas con la configuración y el almacén reales. La app conserva un modo anónimo configurable; esta revisión no lo certifica como configuración válida de un SaaS financiero de producción.
5. **Escala y conexión:** medir cargas y concurrencia reales, tiempos de espera, reintentos, datos parciales y caducidad. Un corte no puede convertirse en un cero, una cifra simulada o una afirmación de actualidad.
6. **Compatibilidad:** revisar consumidores de los nuevos `null` fiscales y KPI; regenerar informes históricos sin estructura válida. Monedas no COP requieren conversión explícita antes de importar, y años no registrados requieren actualización normativa.

La rama es una propuesta de corrección revisable. Mantenerla en borrador hasta revisar las consecuencias funcionales —especialmente N/D— y resolver las condiciones necesarias para el alcance de lanzamiento elegido. No se fusionó ni desplegó ningún cambio.
