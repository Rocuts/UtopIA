// ---------------------------------------------------------------------------
// Preprocessor de imagen para OCR de handwriting — Modulo Pyme.
// ---------------------------------------------------------------------------
// Pipeline canonico SOTA mayo 2026 (arXiv 1509.03456):
//   1. Resize a 2048px long edge  → ahorra ~75% en imagen-tokens sin perdida
//      de accuracy (OpenAI/Mistral degradan internamente >2048px de todos modos)
//   2. Grayscale                  → +22.68% accuracy en handwriting (bench. 2025);
//      elimina ruido del papel amarillento sin afectar VLMs
//   3. Normalize (auto-contraste) → equivalente ligero de CLAHE; mejora
//      handwriting con tinta tenue
//   4. Re-encode JPEG q90         → mozjpeg para balancear calidad y tamaño
//
// Skip resize si la imagen ya es <=2048px en ambos ejes; siempre aplica
// grayscale + normalize (a menos que se deshabiliten via opts).
// ---------------------------------------------------------------------------

import 'server-only';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreprocessOptions {
  /** Max pixels del lado largo. Default: 2048. */
  maxLongEdge?: number;
  /** Convertir a escala de grises. Default: true. */
  enableGrayscale?: boolean;
  /** Auto-contraste (normalize). Default: true. */
  enableNormalize?: boolean;
  /** Formato de salida. Default: 'jpeg'. */
  outputFormat?: 'jpeg' | 'png' | 'webp';
}

// ---------------------------------------------------------------------------
// Guardas de decodificacion (endurecimiento del decoder nativo)
// ---------------------------------------------------------------------------
// Los bytes que llegan aqui son 100% del usuario y libvips los decodifica en el
// mismo proceso que tiene OPENAI_API_KEY, DATABASE_URL y la llave del vault ERP
// en el entorno. El gate de /api/pyme/uploads valida el MIME *declarado*, pero
// libvips ignora ese MIME y elige el loader sniffeando el contenido: para
// HEIC/HEIF aguas arriba solo se comprueba 'ftyp' en los bytes 4-7 y los bytes
// 0-3 quedan libres, que es justo donde caben 'GIF8' o 'II*\0' y donde el
// sniffer decide abrir el loader de GIF o TIFF. De ahi las tres guardas:
//   1. firma fijada en los bytes 0-3 ANTES de que sharp toque el buffer;
//   2. tope de raster (limitInputPixels): el default de sharp (~268MP) deja
//      pasar un PNG de 16000x16000 que son ~768MB de raster crudo;
//   3. rechazo del formato sniffeado que no este entre los que el modulo Pyme
//      acepta aguas arriba, para no alimentar loaders que no usamos.
// `failOn` NO se toca a proposito: su default es 'warning', el nivel MAS
// estricto de la escala (none < truncated < error < warning); fijarlo en
// 'error' relajaria la validacion en lugar de endurecerla.
// ---------------------------------------------------------------------------

/** Tope de pixeles del raster de entrada. Default de sharp = ~268MP. */
const MAX_INPUT_PIXELS = 25_000_000;

/** Formatos sniffeados aceptables — espejo de ALLOWED_MIMES en /api/pyme/uploads. */
const ALLOWED_SNIFFED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

function hasSignature(buf: Buffer, offset: number, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Verifica la firma del contenedor incluyendo los bytes 0-3, que es donde
 * libvips decide el loader. Se corre antes de instanciar sharp.
 */
function assertDecodableSignature(buf: Buffer): void {
  if (buf.length < 12) {
    throw new Error('preprocessImage: archivo demasiado corto para ser una imagen');
  }
  // JPEG — SOI
  if (hasSignature(buf, 0, [0xff, 0xd8, 0xff])) return;
  // PNG
  if (hasSignature(buf, 0, [0x89, 0x50, 0x4e, 0x47])) return;
  // WebP — 'RIFF' en 0-3 y 'WEBP' en 8-11 (RIFF a secas tambien envuelve AVI/WAV)
  if (
    hasSignature(buf, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasSignature(buf, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return;
  }
  // HEIC/HEIF (ISO BMFF) — 'ftyp' en 4-7 Y tamano de box plausible en 0-3.
  if (hasSignature(buf, 4, [0x66, 0x74, 0x79, 0x70])) {
    const boxSize = buf.readUInt32BE(0);
    if (boxSize >= 8 && boxSize <= buf.length) return;
  }
  throw new Error('preprocessImage: firma de archivo no soportada');
}

export interface PreprocessResult {
  /** Data URL preprocesado listo para enviar al modelo de vision. */
  dataUrl: string;
  format: 'jpeg' | 'png' | 'webp';
  width: number;
  height: number;
  bytesIn: number;
  bytesOut: number;
  /** Pasos aplicados, e.g. ['resize:2048', 'grayscale', 'normalize']. */
  appliedSteps: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// preprocessImage
// ---------------------------------------------------------------------------

/**
 * Preprocesa una imagen para mejorar la accuracy del OCR Vision sobre
 * handwriting contable. Acepta data URL o Buffer crudo.
 *
 * @param input  data URL (`data:image/...;base64,...`) o Buffer crudo.
 * @param opts   Opciones de preprocesado (ver {@link PreprocessOptions}).
 * @returns      {@link PreprocessResult} con nuevo data URL y metadatos.
 */
export async function preprocessImage(
  input: string | Buffer,
  opts: PreprocessOptions = {},
): Promise<PreprocessResult> {
  const startMs = Date.now();
  const maxLongEdge  = opts.maxLongEdge    ?? 2048;
  const doGrayscale  = opts.enableGrayscale ?? true;
  const doNormalize  = opts.enableNormalize ?? true;
  const outputFormat = opts.outputFormat   ?? 'jpeg';

  // --- Convertir data URL → Buffer -------------------------------------------
  let buffer: Buffer;
  if (typeof input === 'string') {
    const m = input.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!m) throw new Error('preprocessImage: input debe ser data URL o Buffer');
    buffer = Buffer.from(m[2], 'base64');
  } else {
    buffer = input;
  }
  const bytesIn = buffer.byteLength;

  // Firma en 0-3 antes de que el decoder nativo vea el buffer (ver arriba).
  assertDecodableSignature(buffer);

  // --- Pipeline sharp --------------------------------------------------------
  let pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });
  const meta = await pipeline.metadata();
  // El MIME declarado aguas arriba no manda: aqui vale el formato sniffeado.
  if (!meta.format || !ALLOWED_SNIFFED_FORMATS.has(meta.format)) {
    throw new Error(
      `preprocessImage: formato no soportado (${meta.format ?? 'desconocido'})`,
    );
  }
  const w = meta.width  ?? 0;
  const h = meta.height ?? 0;
  if (w * h > MAX_INPUT_PIXELS) {
    throw new Error(
      `preprocessImage: imagen de ${w}x${h} excede el limite de ${MAX_INPUT_PIXELS} pixeles`,
    );
  }
  const longEdge = Math.max(w, h);

  const appliedSteps: string[] = [];

  // Paso 1: resize si excede maxLongEdge
  if (longEdge > maxLongEdge) {
    pipeline = pipeline.resize({
      width:  w >= h ? maxLongEdge : undefined,
      height: h >  w ? maxLongEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
    appliedSteps.push(`resize:${maxLongEdge}`);
  }

  // Paso 2: grayscale
  if (doGrayscale) {
    pipeline = pipeline.grayscale();
    appliedSteps.push('grayscale');
  }

  // Paso 3: normalize (auto-contraste)
  if (doNormalize) {
    pipeline = pipeline.normalize();
    appliedSteps.push('normalize');
  }

  // Paso 4: re-encode
  if (outputFormat === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
  } else if (outputFormat === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else {
    pipeline = pipeline.webp({ quality: 90 });
  }

  const out = await pipeline.toBuffer({ resolveWithObject: true });
  const dataUrl = `data:image/${outputFormat};base64,${out.data.toString('base64')}`;

  return {
    dataUrl,
    format: outputFormat,
    width:    out.info.width,
    height:   out.info.height,
    bytesIn,
    bytesOut: out.data.byteLength,
    appliedSteps,
    durationMs: Date.now() - startMs,
  };
}

// ---------------------------------------------------------------------------
// normalizedLevenshtein
// ---------------------------------------------------------------------------

/**
 * Distancia de Levenshtein normalizada entre dos strings (es-CO).
 *
 * Devuelve ratio 0-1: 0 = identicos, 1 = totalmente distintos.
 * Se usa como guard post-OCR: si `description` vs `rawText` divergen >0.3,
 * el modelo "corrigio" en lugar de transcribir literal → bajar confidence.
 *
 * Complejidad O(m*n) — adecuado para strings <500 chars (tipico en renglones
 * contables).
 */
export function normalizedLevenshtein(a: string, b: string): number {
  const sa = a.toLowerCase().trim().replace(/\s+/g, ' ');
  const sb = b.toLowerCase().trim().replace(/\s+/g, ' ');
  if (sa === sb) return 0;
  if (sa.length === 0 || sb.length === 0) return 1;

  const m = sa.length;
  const n = sb.length;

  // Matriz DP compacta (single-row rolling)
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = new Array(n + 1).fill(0);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (sa[i - 1] === sb[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      }
    }
    prev = curr;
  }

  return prev[n] / Math.max(m, n);
}
