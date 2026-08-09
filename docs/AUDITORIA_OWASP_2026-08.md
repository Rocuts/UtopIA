# Auditoría OWASP — UtopIA

> **Fecha**: 2026-08-08 · **Marcos**: OWASP Top 10 (2021), OWASP API Security Top 10 (2023), OWASP Top 10 for LLM Applications
> **Método**: 11 auditores en paralelo (una dimensión OWASP cada uno) + un refutador adversarial por dimensión + 8 equipos de remediación sobre ficheros disjuntos.

> **Nota de alcance de este documento.** Este repositorio es público, así que aquí se documenta
> únicamente **lo ya corregido**, la postura de dependencias y la evidencia de verificación.
> El detalle de los hallazgos (evidencia con `archivo:línea`, rutas de explotación y los puntos que
> siguen pendientes) vive fuera del control de versiones, en `.security-private/` — ruta ignorada por
> git a propósito. Publicar el mapa de lo que aún no está cerrado sería regalar trabajo a un atacante.

---

## Resumen

| | |
|---|---|
| Hallazgos crudos | 50 |
| Confirmados tras refutación adversarial | 45 |
| Refutados como falsos positivos | 5 |
| **Corregidos en esta entrega** | **28**, incluidos **todos los de severidad alta** |
| Vulnerabilidades npm | **32 → 18** (16 *high* → 13, todas en un único cluster no explotable) |

La superficie más relevante no resultó ser la web clásica, sino la **específica de una plataforma
multiagente**: la validación de destinos en las integraciones ERP que el propio usuario configura, y
el tratamiento de la salida del modelo cuando se renderiza en el navegador.

---

## Método

Cada dimensión pasó por dos agentes con incentivos opuestos:

1. **Auditor** (Opus 5 `effort: max` en las 8 dimensiones críticas; Sonnet 5 en las 3 mecánicas),
   obligado a aportar evidencia leída del código y una ruta de explotación concreta. Sin eso, no
   contaba como hallazgo.
2. **Refutador** (Opus 5), instruido para **tumbar** cada hallazgo: abrir el fichero, comprobar que
   la evidencia es real, buscar el control compensatorio que el auditor pudiera haber pasado por
   alto y, ante la duda, refutar.

Ese segundo pase se pagó solo. Además de eliminar 5 falsos positivos, **corrigió remediaciones que
habrían causado daño si se aplicaban tal cual**:

- Una propuesta de añadir AAD al cifrado del vault habría dejado **indescifrables todas las filas
  existentes** en producción. La ruta correcta es incremental (leer v1, emitir v2, re-cifrar al leer).
- Una propuesta de endurecer la CSP del iframe del informe **no es implementable**: un `srcdoc`
  hereda la política del documento padre.
- Una propuesta tocaba un cuerpo `'use workflow'`, lo que **rompe el sandbox de determinismo** del
  Workflow DevKit.
- Otra pedía añadir una comprobación de autorización que **ya existía** en el handler.

---

## Correcciones aplicadas

### Dependencias

| Paquete | De → A | Motivo |
|---|---|---|
| `next` | 16.2.7 → **16.3.0** | 9 advisories acumuladas, entre ellas *middleware/proxy bypass*, SSRF en rewrites y *cache confusion* de respuestas |
| `better-auth` | 1.6.14 → **1.6.26** | Account takeover por *pre-account hijacking* (CVSS 8.3) |
| `@better-auth/stripe` | 1.6.14 → **1.6.26** | *Billing tampering* entre organizaciones (CVSS 7.1) |
| `sharp` | 0.34.5 → **0.35.3** | CVEs heredadas de libvips; es dependencia **directa**, no sólo transitiva de Next |
| transitivas | `npm audit fix` | `undici`, `brace-expansion`, `js-yaml`, `postcss` |

### Control de acceso (A01 / API1 / API5)

- Verificación de propiedad del periodo contable en el arranque y en la reanudación del **cierre
  mensual**, el flujo de negocio más sensible de la aplicación.
- Unificación de los dos resolutores de tenant: el que se saltaba las validaciones ahora aplica las
  mismas guardas que su hermano. Nueve rutas dependían del primero.
- Los identificadores internos de tenant dejan de viajar en rutas de almacenamiento público.

### SSRF (A10 / API7)

- Nuevo guard que valida **la URL final construida**, no sólo el campo de entrada: es lo único que
  descarta literales de IP interna, que un simple filtro de caracteres deja pasar.
- Las redirecciones se siguen con un bucle manual que **revalida cada salto** (tope de 3), replicando
  la semántica de método/cuerpo de la spec `fetch` para no romper los ERP que redirigen de forma
  legítima. Cubre el conector base y los tres proveedores con `fetch` propio.
- Los errores devueltos al cliente ya no incorporan la respuesta del servicio remoto; el detalle va
  al log con un identificador de correlación.
- Cerrado el esquema de credenciales abierto en la ruta de sincronización.

### Seguridad del modelo (LLM01 / LLM02)

- **Endurecido el saneado de markdown en los 8 renderers.** Pasar el plugin de sanitizado sin
  invocarlo aplica el esquema por defecto, más permisivo de lo que esta aplicación necesita. Se
  introduce un esquema compartido en `src/lib/security/markdown-sanitize-schema.ts`. Dos componentes
  no aplicaban sanitizado alguno.
- El contenido de terceros que entra al prompt (resultados de búsqueda web, documentos subidos,
  narrativa de negocio) se delimita y se marca explícitamente como no confiable.

### Secretos, configuración y fugas (A02 / A05 / A09)

- **Eliminado el comportamiento *fail-open*** en dos rutas programadas que dejaban pasar la petición
  cuando el secreto no estaba configurado. Estas rutas están exentas del gate de autenticación en el
  borde, así que su autodefensa es lo único que las protege.
- Nuevo `src/lib/security/cron-auth.ts` con comparación en tiempo constante, replicando el patrón ya
  existente en `admin-auth.ts`, adoptado en las seis rutas programadas y en el dispatcher interno.
- Las respuestas de operación dejan de enumerar identificadores de tenant; devuelven agregados.
- **Normalización de errores**: el camino de fallback devolvía el mensaje de excepción en crudo a
  quien llamara. Ahora emite un mensaje genérico con identificador de correlación y registra el
  detalle en el servidor. Las 8 rutas SSE que construían su propia respuesta de error pasan por él.
- `trustedOrigins` deja de aceptar coincidencias por subcadena sobre un espacio de nombres que la
  organización no controla.
- La clave de *rate limit* deja de incluir un componente que el propio cliente elige y podía rotar.
- Añadidos HSTS y `poweredByHeader: false`.

### Recursos y ficheros (A04 / A08)

- Tope de expansión al descomprimir `.xlsx` / `.docx`.
- `sharp` con `limitInputPixels` y `failOn`; comprobación de *magic bytes* anclada.
- La firma de subida directa rechaza escrituras fuera del espacio del propio tenant, sin romper el
  flujo actual del cliente.

---

## Riesgos aceptados

**Cluster `@workflow/*` — 13 *high* que no se pueden parchear.** Las alertas son circulares entre los
paquetes de la familia; sus raíces reales son `nanoid` (bucle infinito con `size` negativo o cero) y
`esbuild` (sólo build-time). En `@workflow/core`, `nanoid` genera identificadores de tamaño fijo, no
influido por entrada externa. No existe una 4.x parcheada — `workflow@4.8.1` es la última estable y
el advisory cubre `>=4.0.1`; la 5.x está en beta. La corrección que propone npm es **bajar a 2.0.6**,
un downgrade mayor que rompería el workflow de cierre mensual y el orquestador de Sentinel. Decisión:
no romper el cierre contable por un DoS no alcanzable.

**`echarts` <6.1.0 (moderate, XSS).** El salto a 6.x es *major* con cambios de API en los gráficos.
Pendiente de una ventana con verificación visual.

**`drizzle-kit` / `esbuild` (moderate).** Sólo `devDependencies`; fuera del runtime de producción.

---

## Falsos positivos descartados

Se dejan anotados para que no se vuelvan a levantar en futuras auditorías:

| Hallazgo | Por qué se cae |
|---|---|
| El *rate limit* confía en el primer hop de `X-Forwarded-For` | Vercel **sobrescribe** esa cabecera y no reenvía IPs externas. El defecto real estaba en otro componente de la clave, y ése sí se corrigió. |
| Comprobación de longitud antes de `timingSafeEqual` | Es el patrón **correcto** en Node: `timingSafeEqual` lanza `RangeError` con buffers de distinta longitud. Toda implementación correcta compara longitudes fuera del comparador. |
| El filtro de PII no cubre todas las superficies de entrada | El campo señalado no cruza ninguna frontera que los campos **obligatorios** de la misma petición no crucen ya por diseño. Es una decisión de tratamiento de datos (Ley 1581), no un defecto de implementación. |

---

## Verificación

Las cuatro puertas, sobre el árbol final entregado:

```
npx tsc --noEmit         → 0 errores
npm run lint             → 0 errores (197 warnings, todos preexistentes)
npm run lint:strict-mode → 36 archivos, todos pasan
npx vitest run           → 169 archivos · 2134 pasando · 3 skipped · 0 fallos
npm run build            → exit 0
```

**Una regresión introducida y corregida durante el trabajo.** El primer build tras la remediación
falló: al pasar los conectores ERP a autovalidar sus destinos, empezaron a importar un módulo marcado
con `import 'server-only'`, y esos conectores están en el grafo del cliente por la cadena
`registry → adapter → service → kpis/live → ExecutiveDashboard`. **`tsc` no detecta esto** — es una
restricción de Next, no de tipos. Se retiró el marcador: el módulo no lee `process.env` ni contiene
secretos, es aritmética de rangos IP y parsing de URL.

Eso dejó al descubierto una deuda arquitectónica **preexistente y no resuelta aquí**: los conectores
ERP no deberían formar parte del bundle del navegador. Mientras esa cadena no se corte, cualquier
`server-only` que se añada bajo `src/lib/erp/` volverá a romper el build de producción.

**Naturaleza de la verificación**: estática y de compilación. No se ejecutaron pruebas dinámicas
contra un despliegue; ninguna ruta de explotación se disparó contra la aplicación corriendo. Las
conclusiones están razonadas y contrastadas contra el código, no reproducidas en runtime.

---

## Trabajo pendiente

Quedan **17 puntos identificados y priorizados**, ninguno de severidad alta. Dos de ellos están
condicionados a una decisión de producto todavía abierta (la activación de la Fase 2 de
autenticación) y aplicarlos a medias sería cosmético; otros requieren infraestructura nueva
(almacenamiento compartido de cuotas, resolución DNS con *pinning*) o implican cambios de
comportamiento visibles en el producto.

El detalle, con evidencia y remediación validada para cada uno, está en `.security-private/` —
deliberadamente fuera del control de versiones.
