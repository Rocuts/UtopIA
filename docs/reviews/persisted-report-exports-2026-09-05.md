# Versiones servidor de informes — 2026-09-05

Base: `main` en `dea03294d798a279418f29af1de2f6dc00125c8e`, que ya incorpora la PR #14. Cambio funcional: `b87724a24450a269afcb66afaff1b888fde8ee3e`, rama `fix/persisted-report-exports-20260905`. Continúa la revisión de main; no revisa la PR #7 ni certifica producción.

## Resultado implementado

El pipeline dividido puede guardar versiones por fase en la tabla existente `reports`, con un tipo de registro propio. No requiere migración de esquema. Guarda fuente completa, contexto preprocesado, empresa, periodo, opciones de generación, resultados, referencia a la fase anterior y metadatos de procedencia. El checksum canónico tolera el orden de claves de JSONB y cubre contenido y metadatos. Es una comprobación de integridad, no una firma digital ni una acreditación de autenticidad de la fuente contable.

El workspace se resuelve desde la sesión y se comprueba su empresa configurada. Las versiones se añaden sin reemplazar las anteriores. La siguiente fase consume el contexto guardado; el navegador envía únicamente la referencia. La generación persistida vuelve a preprocesar la fuente en servidor. Cada fase espera a que la escritura termine antes de comunicar su resultado exitoso, tanto en JSON como en SSE.

Excel y PDF recuperan la versión seleccionada, vuelven a aplicar los controles aritméticos existentes y devuelven su referencia en `X-Report-Version-Id`. La descarga no ejecuta agentes. Un reintento de descarga usa la misma versión, aunque exista otra más reciente. Un informe provisional o incompleto no se presenta como exportación financiera terminada.

Se alineó el resolver de workspace con los alias de configuración de autenticación ya reconocidos por el backend. Si la autenticación está configurada y no hay sesión válida, no se recurre al workspace anónimo.

En el pendiente de métricas se corrigió un caso concreto de clasificación ficticia: eficiencia fiscal sin base referencial positiva o cobertura válida devuelve `null`, se conserva después del LLM y se presenta como N/D. No se completó un modelo de eficiencia fiscal validado; los umbrales de cobertura preexistentes no se han certificado como medición de eficiencia tributaria.

## Contrato y compatibilidad

- `/financial-report/niif`: el cliente del workspace solicita `persist: true`; devuelve `reportVersionId`. Requiere autenticación configurada, sesión y NIT del workspace coherente con la empresa solicitada.
- `/financial-report/strategy` y `/governance`: aceptan `reportVersionId`; resuelven los demás datos en servidor. Gobierno devuelve además el informe consolidado guardado.
- `/financial-report/export`: acepta exclusivamente `{ reportVersionId, format }`, con `excel` o `pdf-elite`. Se retiran la exportación de contenido enviado por el navegador y la generación implícita durante la descarga.
- Las variantes históricas de generación siguen disponibles sin referencia exportable. Los informes del navegador deben regenerarse. Un cambio local del texto invalida su referencia de exportación en la interfaz.
- El modo anónimo no está aprobado para estas exportaciones. No se modificaron secretos ni configuración del entorno.
- Las auditorías adicionales y la meta-auditoría continúan disponibles en pantalla. Su persistencia servidor está pendiente: esta descarga incluye el informe financiero base y lo indica en la interfaz. No incorpora resultados adicionales enviados por el cliente.
- El índice de historial y los checkpoints del navegador siguen siendo locales. Falta un catálogo servidor para recuperar versiones cuando se pierde ese índice.

El árbol funcional publicado es `10b715e277b977c962bcab0ef6c08c68ee53fe08`, idéntico al árbol local verificado. La conexión de GitHub creó el commit remoto con sus propios metadatos; no cambió el contenido.

## Verificación ejecutada

| Comprobación | Resultado y alcance |
|---|---|
| `npm test` | 200 archivos, 2.365 aprobadas, 3 omitidas; incluye la corrección de clasificación sin base y el PDF real |
| `npm run test:report-integrity` | 21 aprobadas con PostgreSQL embebido (PGlite): recorrido JSON/SSE, acceso, empresa, referencias, alteración, integridad JSONB, versiones concurrentes, fuente sin truncar, fallos de escritura y reintento de descarga |
| `npx tsc --noEmit` | Correcto, incluido el cambio final de solicitudes del navegador por referencia |
| `npm run lint` | Sin errores; 197 advertencias |
| `npm run lint:strict-mode` | Correcto; aviso preexistente de `schemaRef` de OpenAPI no verificable por el script |
| `npm run build` | Build local correcto con credenciales ficticias, sin usar servicios reales |

La prueba de PostgreSQL usa consultas y filtros reales de Drizzle sobre un esquema mínimo controlado. Simula la frontera de sesión, los agentes y los renderizadores; no acredita BetterAuth real, Neon remoto, todas las migraciones ni RLS del entorno. Una prueba separada renderiza un PDF real. Se añadió la prueba de persistencia al job normal de CI para que no dependa de secretos de staging.

## Límites y siguiente trabajo

1. Extender estas versiones a auditoría y meta-auditoría antes de incluirlas en la descarga, conservando su asociación exacta al informe base.
2. Completar el contrato de ID/UD y aplicabilidad fiscal con fuentes oficiales vigentes y pruebas. Revisar consumidores y narrativas de riesgo; la revisión de esos módulos está pendiente. Esta sesión no implementó nuevas reglas tributarias ni revalidó normativa.
3. Completar métricas de eficiencia, valoración y ROI con fórmula, periodo, fuente, supuestos y calidad explícitos. N/D describe un dato ausente, no una función terminada.
4. Verificar sesiones y permisos con servicios reales. Medir carga y latencia remotas y fallos de conexión. Las ocho escrituras concurrentes controladas sólo prueban conservación de versiones.
5. Añadir idempotencia de **generación** y recuperación tras pérdida del evento de confirmación: un reintento de generación aún puede ejecutar el agente de nuevo y crear otra versión. La descarga ya reutiliza la existente.

No se fusionó ni se ejecutó despliegue.
