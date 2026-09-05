# Guía de entrada para agentes

UtopIA es una plataforma contable, tributaria y financiera para Colombia. El objetivo es producir métricas trazables, coherentes y reproducibles; un build correcto no certifica preparación del SaaS para producción.

## Lectura inicial acotada

1. Lee `docs/agents/HANDOFF.md` para conocer objetivo, commit verificado, decisiones y siguiente tarea.
2. Usa `docs/agents/MAP.md` para abrir solamente el código, contratos y pruebas del frente activo.
3. Consulta las convenciones aplicables de `CLAUDE.md` y las especificaciones del dominio antes de editar. Los informes fechados describen un momento concreto; no son el estado actual del código.

## Forma de trabajar

- Comprueba `git status`, HEAD, main remoto y el estado de la PR indicada en el handoff. No supongas que una corrección propuesta ya está en main. Preserva cambios ajenos.
- Busca primero con `rg` y limita rutas y salida. No cargues el árbol completo, archivos generados, cachés ni todos los informes históricos para orientarte.
- Reutiliza evidencia para el commit al que corresponde. Repite pruebas si cambió el código relacionado, para reproducir un defecto o para satisfacer una puerta de validación; no atribuyas resultados antiguos a código nuevo.
- Distingue: implementado, probado, pendiente y dependiente de acceso externo. Una especificación expresa el contrato esperado; comprueba su implementación. Ante discrepancias, documenta y corrige con evidencia.
- Primero reproduce el defecto relevante; después corrige y verifica. No debilites pruebas ni sustituyas cifras por supuestos para conseguir un resultado verde.
- Dinero: contrato MoneyCop en centavos como strings y cálculo entero. `null`/N/D no es cero. Coherencia aritmética no acredita procedencia ni cumplimiento fiscal.
- Toda nueva regla tributaria necesita fuente oficial, periodo de vigencia, ámbito y pruebas. No extrapoles tarifas ni confundas indicadores contables con bases fiscales.
- No publiques secretos, datos financieros reales de clientes ni detalles de vulnerabilidades abiertas en documentos públicos. Respeta el alcance autorizado para cambios remotos; este handoff no autoriza merge ni despliegue.

## Cierre de sesión

Actualiza `docs/agents/HANDOFF.md` con commit verificado, cambios, pruebas reales, límites y una siguiente tarea concreta. Mantén ese archivo breve: sustituye el estado anterior y enlaza evidencia durable en vez de añadir una transcripción. Actualiza el mapa si cambian las rutas. No dupliques instrucciones entre herramientas.
