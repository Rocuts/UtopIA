# Continuidad — integridad financiera del SaaS

Actualizado: 2026-09-05. Objetivo: métricas reales, trazables y coherentes con normativa colombiana; informes autorizados y resultados fiables. No hay certificación integral de producción.

## Estado remoto y referencia de trabajo

- Repo: `Rocuts/UtopIA`; revisión sobre **main**, no PR #7.
- PR #14: fusionada el 2026-09-05. Main comprobado: `dea03294d798a279418f29af1de2f6dc00125c8e`.
- Nueva rama: `fix/persisted-report-exports-20260905`.
- Commit funcional: `b87724a24450a269afcb66afaff1b888fde8ee3e`. Esta actualización documental es posterior; no modifica el código verificado.
- Consultar HEAD remoto y PR de esta rama antes de continuar. No fusionar ni desplegar sin nueva instrucción.
- [Cambio, contrato, pruebas y límites](../reviews/persisted-report-exports-2026-09-05.md).
- [Evidencia anterior y fuentes históricas](../reviews/main-financial-integrity-2026-09-05.md); no repetirla como revisión actual.

## Implementado en esta continuación

- Versiones servidor por fase NIIF → estrategia → gobierno reutilizando `reports`; fuente sin truncar, contexto, opciones, referencia anterior y checksum de contenido/metadatos. Sin migración de esquema.
- Generación persistida vinculada a sesión y empresa del workspace. Espera la escritura antes del resultado JSON/SSE. Los siguientes tramos reciben referencias y cargan su contexto servidor.
- Excel/PDF únicamente desde una versión completa autorizada, con validación aritmética y referencia de versión en respuesta. La descarga no genera otro informe. Reintentar una descarga no vuelve a ejecutar los agentes.
- Resolver de workspace alineado con alias de auth; sin fallback anónimo cuando hay autenticación configurada.
- Eficiencia sin base referencial positiva/cobertura válida → `null`/N/D, preservado después del LLM. Esto no completa el modelo de eficiencia ni sus bases fiscales.

## Pruebas y límites

- Suite: **2.365 aprobadas, 3 omitidas, 200 archivos**.
- Persistencia: **21 aprobadas**, `npm run test:report-integrity`. PostgreSQL embebido y consultas reales; sesión, LLM y renderizadores controlados. Incluye acceso/empresa, alteración, JSONB, fallos, versiones concurrentes y reintento de descarga. Corre en CI sin secretos de staging.
- TypeScript, strict-mode y build local correctos. Lint: 0 errores, 197 advertencias. Strict-mode conserva aviso de OpenAPI. Build con credenciales ficticias.
- No se verificaron BetterAuth/Neon/ERP/LLM reales, migraciones completas, carga de producción ni UI integral. No confundir checksum con firma/autenticidad de la fuente.
- Informes históricos/localmente editados deben regenerarse para exportar. Exportaciones autenticadas requieren NIT del workspace configurado; modo anónimo no aprobado para este recorrido.
- Descarga actual: informe financiero base. Auditorías adicionales y meta-auditoría siguen en pantalla, pendientes de versión servidor; la interfaz lo indica. Historial/checkpoints del navegador continúan locales.

## Siguiente tarea concreta

Extender la procedencia a auditoría y meta-auditoría, usando las versiones existentes y asociando cada resultado al informe exacto que examinó. Comprobar empresa, versión, reanudación y exportación; no aceptar resultados arbitrarios enviados por el cliente. Entradas y pruebas: primera fila de `MAP.md`; seguir después los imports del flujo de auditoría desde `PipelineWorkspace.tsx`.

## Pendientes priorizados después

1. Bases ID/UD y aplicabilidad fiscal con fuentes oficiales vigentes; revisar consumidores y narrativas de riesgo. No se completó fiscalidad en esta sesión.
2. Eficiencia, valoración y ROI: fórmula, unidad, periodo, fuente, supuestos y calidad; datos ausentes siguen ausentes.
3. Sesiones/permisos reales por empresa y decisión operativa del SaaS.
4. Idempotencia de generación y recuperación de confirmaciones perdidas: reintentar generación aún puede duplicar ejecución/coste y crear otra versión. Catálogo servidor para recuperar historial.
5. Carga, concurrencia y conexiones remotas con límites medidos; las pruebas controladas no acreditan capacidad o latencia productiva.

Lee sólo el frente pertinente del mapa. Preserva cambios ajenos y reutiliza resultados para el código al que correspondan.
