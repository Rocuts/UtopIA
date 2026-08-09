import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { checkRateLimit, getClientIp } from '@/lib/security/rate-limit';
import { uploadContextSchema, blobUploadSchema, ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/validation/schemas';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { requireAuthSession } from '@/lib/auth/require-session';
import { addDocumentsToStore, invalidateVectorStore, getStoragePath } from '@/lib/rag/vectorstore';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  detectYearFromString,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Vercel Fluid Compute: 300s ceiling for OCR-heavy uploads.
// `export const runtime = 'nodejs'` removido en Ola 2: incompatible con
// `nextConfig.cacheComponents: true` (nodejs es default).
export const maxDuration = 300;

const uploadsPath = getStoragePath('uploads');

// Magic byte signatures for validated file types
const MAGIC_BYTES: Record<string, number[]> = {
  '.pdf':  [0x25, 0x50, 0x44, 0x46],              // %PDF
  '.xlsx': [0x50, 0x4B, 0x03, 0x04],              // PK (ZIP archive)
  '.xls':  [0xD0, 0xCF, 0x11, 0xE0],              // MS Compound File (OLE2)
  '.doc':  [0xD0, 0xCF, 0x11, 0xE0],              // MS Compound File (OLE2)
  '.docx': [0x50, 0x4B, 0x03, 0x04],              // PK (ZIP archive, same as xlsx)
  '.jpg':  [0xFF, 0xD8, 0xFF],                     // JPEG SOI marker
  '.jpeg': [0xFF, 0xD8, 0xFF],                     // JPEG SOI marker
  '.png':  [0x89, 0x50, 0x4E, 0x47],              // PNG header
  '.gif':  [0x47, 0x49, 0x46],                     // GIF87a / GIF89a
  '.webp': [0x52, 0x49, 0x46, 0x46],              // RIFF (WebP container)
  '.bmp':  [0x42, 0x4D],                           // BM
  '.tiff': [0x49, 0x49],                           // II (little-endian TIFF)
  '.tif':  [0x49, 0x49],                           // II (little-endian TIFF)
};

function validateMagicBytes(buffer: Buffer, ext: string): boolean {
  const expected = MAGIC_BYTES[ext];
  if (!expected) return true; // text formats don't have magic bytes
  if (buffer.length < expected.length) return false;
  return expected.every((byte, i) => buffer[i] === byte);
}

// ---------------------------------------------------------------------------
// Anti zip-bomb para contenedores OOXML (.xlsx / .docx)
// ---------------------------------------------------------------------------
// El unico gate de contenido para ambos es el magic byte `PK\x03\x04`, es decir
// el header generico de ZIP: cualquier ZIP pasa. Despues exceljs y mammoth
// descomprimen el archivo entero en memoria y ninguno impone un tope propio,
// asi que unos pocos MB de deflate pueden convertirse en varios GB de XML y
// agotar la RAM de la Function (con `maxDuration = 300` hay tiempo de sobra
// para lograrlo, y el rate limit de 20/min basta para sostenerlo).
//
// El `uncompressedSize` del directorio central NO sirve como control por si
// solo: lo escribe quien construye el archivo y puede declarar 1KB mientras el
// stream entrega GB. Por eso hay dos capas: se rechaza lo declarado cuando ya
// se pasa, y ademas se inflan los streams contra un presupuesto duro de bytes
// REALMENTE producidos, abortando en cuanto se supera.
// ---------------------------------------------------------------------------

/** Tope de tamano comprimido para contenedores OOXML (el global es 100MB). */
const MAX_ZIP_CONTAINER_BYTES = 50 * 1024 * 1024;
/** Tope de entradas del ZIP. Un .xlsx/.docx real ronda las decenas. */
const MAX_ZIP_ENTRIES = 2048;
/** Presupuesto de bytes descomprimidos, declarados y reales. */
const MAX_ZIP_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
/** Techo de pared para el parseo, muy por debajo de `maxDuration`. */
const OOXML_PARSE_TIMEOUT_MS = 120_000;

/** Corta una promesa que no acepta AbortSignal (exceljs / mammoth no lo exponen). */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: el archivo tardo demasiado en procesarse (>${Math.round(ms / 1000)}s).`));
    }, ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Localiza el End Of Central Directory (puede llevar hasta 64KB de comentario). */
function findEndOfCentralDirectory(buf: Buffer): number {
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** Lee el extra field ZIP64 (id 0x0001) para los campos desbordados a 0xFFFFFFFF. */
function readZip64Extra(
  buf: Buffer,
  start: number,
  length: number,
  need: { compressed: boolean; uncompressed: boolean; localOffset: boolean },
): { compressedSize?: number; uncompressedSize?: number; localOffset?: number } {
  const out: { compressedSize?: number; uncompressedSize?: number; localOffset?: number } = {};
  const end = Math.min(start + length, buf.length);
  let p = start;
  while (p + 4 <= end) {
    const id = buf.readUInt16LE(p);
    const size = buf.readUInt16LE(p + 2);
    if (id === 0x0001) {
      // Orden fijo del spec: uncompressed, compressed, offset local, disco.
      let q = p + 4;
      if (need.uncompressed && q + 8 <= end) { out.uncompressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
      if (need.compressed && q + 8 <= end) { out.compressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
      if (need.localOffset && q + 8 <= end) { out.localOffset = Number(buf.readBigUInt64LE(q)); q += 8; }
      return out;
    }
    p += 4 + size;
  }
  return out;
}

/**
 * Infla un stream deflate contando SOLO los bytes que salen, sin retenerlos, y
 * aborta en cuanto se pasa de `limit`. Es la capa que no depende de lo que el
 * archivo declare de si mismo.
 */
function inflatedByteCount(slice: Buffer, limit: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const inflater = zlib.createInflateRaw({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
    let total = 0;
    let settled = false;
    inflater.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit && !settled) {
        settled = true;
        inflater.destroy();
        reject(new Error(
          'El archivo comprimido se expande por encima del limite permitido ' +
          `(${Math.round(MAX_ZIP_UNCOMPRESSED_BYTES / (1024 * 1024))}MB descomprimidos).`,
        ));
      }
    });
    inflater.on('end', () => { if (!settled) { settled = true; resolve(total); } });
    // Un stream corrupto no es una bomba: no lo tratamos como ataque y dejamos
    // que el parser real devuelva el mensaje de negocio que corresponda.
    inflater.on('error', () => { if (!settled) { settled = true; resolve(total); } });
    inflater.end(slice);
  });
}

/**
 * Verifica que un contenedor ZIP (.xlsx / .docx) no sea una bomba de
 * descompresion ANTES de entregarselo a exceljs o mammoth.
 */
async function assertZipContainerWithinLimits(buffer: Buffer): Promise<void> {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    throw new Error('El archivo no es un contenedor valido: falta el directorio central del ZIP.');
  }

  let entryCount = buffer.readUInt16LE(eocd + 10);
  let cdOffset = buffer.readUInt32LE(eocd + 16);

  // ZIP64: los campos desbordados viven en el registro extendido.
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || buffer.readUInt32LE(locator) !== 0x07064b50) {
      throw new Error('Contenedor ZIP64 sin localizador valido.');
    }
    const z64 = Number(buffer.readBigUInt64LE(locator + 8));
    if (z64 < 0 || z64 + 56 > buffer.length || buffer.readUInt32LE(z64) !== 0x06064b50) {
      throw new Error('Contenedor ZIP64 con directorio central invalido.');
    }
    entryCount = Number(buffer.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buffer.readBigUInt64LE(z64 + 48));
  }

  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error(`El archivo comprimido declara ${entryCount} entradas (maximo ${MAX_ZIP_ENTRIES}).`);
  }

  const entries: Array<{ method: number; localOffset: number; uncompressedSize: number }> = [];
  let declaredUncompressed = 0;
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('Directorio central del archivo comprimido corrupto.');
    }
    const method = buffer.readUInt16LE(p + 10);
    let compressedSize = buffer.readUInt32LE(p + 20);
    let uncompressedSize = buffer.readUInt32LE(p + 24);
    const fnLen = buffer.readUInt16LE(p + 28);
    const exLen = buffer.readUInt16LE(p + 30);
    const cmLen = buffer.readUInt16LE(p + 32);
    let localOffset = buffer.readUInt32LE(p + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      const z = readZip64Extra(buffer, p + 46 + fnLen, exLen, {
        compressed: compressedSize === 0xffffffff,
        uncompressed: uncompressedSize === 0xffffffff,
        localOffset: localOffset === 0xffffffff,
      });
      compressedSize = z.compressedSize ?? compressedSize;
      uncompressedSize = z.uncompressedSize ?? uncompressedSize;
      localOffset = z.localOffset ?? localOffset;
    }
    declaredUncompressed += uncompressedSize;
    entries.push({ method, localOffset, uncompressedSize });
    p += 46 + fnLen + exLen + cmLen;
  }

  if (declaredUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new Error(
      'El archivo comprimido declara mas de ' +
      `${Math.round(MAX_ZIP_UNCOMPRESSED_BYTES / (1024 * 1024))}MB descomprimidos.`,
    );
  }

  // Segunda capa: bytes reales. `budget` es compartido por todas las entradas.
  let budget = MAX_ZIP_UNCOMPRESSED_BYTES;
  for (const entry of entries) {
    const lh = entry.localOffset;
    if (lh < 0 || lh + 30 > buffer.length || buffer.readUInt32LE(lh) !== 0x04034b50) {
      throw new Error('Cabecera local del archivo comprimido corrupta.');
    }
    const fnLen = buffer.readUInt16LE(lh + 26);
    const exLen = buffer.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + fnLen + exLen;

    // Metodo 0 (stored) y cualquier otro que no sea deflate no pueden expandir
    // el contenido: basta con descontar lo declarado del presupuesto.
    if (entry.method !== 8) {
      budget -= entry.uncompressedSize;
      if (budget < 0) {
        throw new Error('El archivo comprimido excede el limite de descompresion permitido.');
      }
      continue;
    }
    if (dataStart >= cdOffset) continue;
    // Se infla hasta el inicio del directorio central: zlib se detiene solo al
    // final del stream, asi que no dependemos del tamano declarado (que puede
    // estar falseado a la baja para colarse por la primera capa).
    budget -= await inflatedByteCount(buffer.subarray(dataStart, cdOffset), budget);
  }
}

/**
 * Elimina el Byte Order Mark (U+FEFF) al inicio de archivos UTF-8.
 * Editores de Windows (Excel, Notepad) guardan con BOM y el caracter
 * contamina las primeras palabras cuando el LLM lee el texto literal.
 */
function stripBOM(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

/**
 * Convierte una celda de ExcelJS a string legible para el LLM.
 * ExcelJS devuelve distintos shapes por celda — sin mapeo explicito,
 * `String(v)` produce `"[object Object]"` para formulas, hyperlinks,
 * rich text y errores, y formatos de fecha inestables para Date.
 *
 * Mapeo:
 *  - null/undefined -> ''
 *  - string        -> as-is
 *  - number        -> solo si es finito (evita NaN/Infinity)
 *  - boolean       -> 'true' / 'false'
 *  - Date          -> YYYY-MM-DD (formato estable)
 *  - formula       -> .result (valor calculado)
 *  - hyperlink     -> .text (etiqueta visible)
 *  - rich text     -> concatenacion de .richText[].text
 *  - error         -> .error (ej. '#DIV/0!')
 *  - otros objetos -> '' (en lugar de '[object Object]')
 */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // Formula: { formula: '...', result: <valor> }
    if ('result' in obj) return cellToString(obj.result);
    // Rich text: { richText: [{ text: '...' }, ...] }
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((piece) => (piece && typeof piece === 'object' && 'text' in piece ? String((piece as { text: unknown }).text ?? '') : ''))
        .join('');
    }
    // Hyperlink: { text: '...', hyperlink: '...' }
    if (typeof obj.text === 'string') return obj.text;
    // Error: { error: '#DIV/0!' }
    if (typeof obj.error === 'string') return obj.error;
    return '';
  }
  return '';
}

/**
 * Extract text from a scanned (image-only) PDF.
 * Envia el PDF como file part al modelo multimodal via AI SDK con el provider
 * `@ai-sdk/openai` (auth con `OPENAI_API_KEY` directo, sin gateway). El modelo
 * configurado en MODELS.OCR (default `gpt-5.4`) acepta `application/pdf` como
 * file part nativo (ver docs AI SDK 02-foundations/03-prompts.mdx).
 *
 * `generateText` con file part hace OCR multipagina y devuelve texto plano. Sin
 * necesidad de la Responses API ni de fallback a Vision por pagina.
 *
 * @param buffer   - Raw PDF bytes.
 * @param filename - Original filename.
 * @returns Extracted text from all pages.
 */
async function extractTextFromScannedPDF(buffer: Buffer, filename: string): Promise<string> {
  const { text } = await generateText({
    model: MODELS.OCR,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Este es un documento PDF escaneado con informacion contable/tributaria colombiana. ' +
              'Extrae TODO el texto de TODAS las paginas. Preserva la estructura de tablas usando markdown tables. ' +
              'Incluye todos los numeros, fechas, NITs y referencias legales exactamente como aparecen. ' +
              'Si una pagina no tiene texto, omitela. Procesa TODAS las paginas del documento.',
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            data: buffer,
            filename, // opcional; algunos providers la usan como hint
          },
        ],
      },
    ],
    abortSignal: AbortSignal.timeout(120_000), // 2 min timeout para PDFs escaneados grandes
  });

  const extracted = text?.trim();
  if (!extracted) {
    throw new Error('No se pudo extraer texto del PDF escaneado.');
  }
  return extracted;
}

/**
 * Extract text from an image file using Vision OCR (AI SDK + @ai-sdk/openai).
 * Envia la imagen como data URL al modelo multimodal (MODELS.OCR, default
 * `gpt-5.4`) usando `OPENAI_API_KEY` directo (sin gateway).
 *
 * Nota: el shape `{ type: 'image', image: <data URL> }` esta documentado en
 * node_modules/ai/docs/02-foundations/03-prompts.mdx. `mediaType` es opcional
 * cuando se pasa un data URL (el MIME ya esta embebido). El default del modelo
 * `gpt-5.4` es razonable para OCR.
 *
 * @param buffer   - Raw image bytes.
 * @param filename - Original filename (used for logging / MIME detection).
 * @returns Extracted text from the image.
 */
async function extractTextFromImage(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.heic': 'image/heic',
  };
  const mime = mimeMap[ext] || 'image/png';
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  const { text } = await generateText({
    model: MODELS.OCR,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract ALL text from this scanned document. Preserve table structure using markdown tables. Include all numbers, dates, and legal references exactly as shown.',
          },
          {
            type: 'image',
            image: dataUrl,
          },
        ],
      },
    ],
    maxOutputTokens: 8192,
    abortSignal: AbortSignal.timeout(90_000), // 90s timeout para OCR de imagen
  });

  const extracted = text?.trim();
  if (!extracted) {
    throw new Error('Vision API returned no text for the image.');
  }
  return extracted;
}

// Supported file types and their text extractors
async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type. Supported: ${[...ALLOWED_UPLOAD_EXTENSIONS].join(', ')}`);
  }

  // Validate magic bytes for binary formats
  if (!validateMagicBytes(buffer, ext)) {
    throw new Error('File content does not match its extension.');
  }

  // Formatos que van a un parser que descomprime/desestructura el archivo
  // entero en memoria (exceljs, mammoth): tope de tamano por debajo del global
  // de 100MB, porque aqui el costo no es el binario sino lo que expande.
  if (ext === '.xlsx' || ext === '.docx' || ext === '.doc') {
    if (buffer.length > MAX_ZIP_CONTAINER_BYTES) {
      throw new Error(
        `Archivo de Office demasiado grande. Maximo ${Math.round(MAX_ZIP_CONTAINER_BYTES / (1024 * 1024))}MB.`,
      );
    }
    // .doc es OLE2, no ZIP: solo aplica el tope de tamano y el timeout.
    if (ext === '.xlsx' || ext === '.docx') {
      await assertZipContainerWithinLimits(buffer);
    }
  }

  // --- Image files: OCR via OpenAI Vision API ---
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic'].includes(ext)) {
    return extractTextFromImage(buffer, filename);
  }

  // --- Word documents (.docx) ---
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await withTimeout(
      mammoth.extractRawText({ buffer }),
      OOXML_PARSE_TIMEOUT_MS,
      'DOCX',
    );
    if (!result.value.trim()) {
      throw new Error('El documento Word esta vacio o no contiene texto extraible.');
    }
    return result.value;
  }

  // --- Old Word format (.doc) ---
  if (ext === '.doc') {
    try {
      const mammoth = await import('mammoth');
      const result = await withTimeout(
        mammoth.extractRawText({ buffer }),
        OOXML_PARSE_TIMEOUT_MS,
        'DOC',
      );
      if (result.value.trim()) return result.value;
    } catch {
      // mammoth has limited .doc support — fall through to error
    }
    throw new Error(
      'DOC_FORMAT: El formato .doc (Word 97-2003) tiene soporte limitado. ' +
      'Por favor guarde el archivo como .docx (Word moderno) e intentelo de nuevo.'
    );
  }

  // --- Old Excel format (.xls) ---
  if (ext === '.xls') {
    throw new Error(
      'XLS_FORMAT: El formato .xls (Excel 97-2003) no esta soportado. ' +
      'Por favor guarde el archivo como .xlsx (Excel moderno) e intentelo de nuevo.'
    );
  }

  if (ext === '.txt' || ext === '.md') {
    return stripBOM(buffer.toString('utf-8'));
  }

  if (['.csv', '.json', '.xml'].includes(ext)) {
    return stripBOM(buffer.toString('utf-8'));
  }

  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const text = result.text;

    // Detect scanned / image-only PDFs: if extracted text is suspiciously
    // short relative to file size, the PDF is likely image-based.
    // Instead of rejecting, try OCR via GPT-4o Responses API.
    const estimatedPages = Math.max(1, Math.ceil(buffer.length / 100_000));
    const charsPerPage = text.trim().length / estimatedPages;
    if (text.trim().length < 50 || charsPerPage < 50) {
      try {
        return await extractTextFromScannedPDF(buffer, filename);
      } catch (ocrError) {
        console.warn(
          '[upload] Scanned PDF OCR failed, falling back to error:',
          ocrError instanceof Error ? ocrError.message : ocrError,
        );
        throw new Error(
          'SCANNED_PDF: Este PDF parece ser una imagen escaneada. ' +
          'No fue posible extraer el texto automaticamente. ' +
          'Intente subir capturas de cada pagina como imagenes (.jpg o .png) ' +
          'para que 1+1 las procese con OCR.'
        );
      }
    }

    return text;
  }

  if (ext === '.xlsx') {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    await withTimeout(
      workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer),
      OOXML_PARSE_TIMEOUT_MS,
      'XLSX',
    );
    const blocks: string[] = [];
    workbook.eachSheet((worksheet) => {
      const rows: string[] = [];
      let header: string | null = null;
      worksheet.eachRow((row, rowNumber) => {
        // row.values es un array sparse con shapes heterogeneos por celda
        // (formulas, hyperlinks, rich text, errores, Date). cellToString
        // maneja cada variante y evita basura tipo "[object Object]".
        const values = row.values as unknown[];
        const csv = values.slice(1).map(cellToString).join(',');
        if (rowNumber === 1) header = csv;
        rows.push(csv);
      });
      if (rows.length === 0) return;
      // Detectar año a partir del nombre de hoja (e.g. "2024", "Balance 2025").
      // Si la hoja se llama explicitamente con un año, lo usamos como
      // etiqueta de periodo y forzamos toda esa hoja al mismo periodo.
      const sheetYear = detectYearFromString(worksheet.name);
      const periodLabel = sheetYear ?? worksheet.name;
      // Re-emitimos el header en cada bloque para que parseTrialBalanceCSV
      // pueda procesarlo de forma independiente. Si la primera fila ya es el
      // header, no hace falta agregarlo otra vez (rows[0] === header).
      const body = header ? rows.join('\n') : rows.join('\n');
      blocks.push(`[period=${periodLabel}]\n${body}\n[/period]`);
    });
    return blocks.join('\n\n');
  }

  throw new Error('Unsupported file type.');
}

// ---------------------------------------------------------------------------
// Smart Document Classifier — zero LLM, keyword heuristics
// ---------------------------------------------------------------------------

type DetectedCaseType =
  | 'niif_report'
  | 'dian_defense'
  | 'tax_refund'
  | 'due_diligence'
  | 'tax_planning'
  | 'transfer_pricing'
  | 'business_valuation'
  | 'fiscal_audit_opinion'
  | 'tax_reconciliation'
  | 'feasibility_study'
  | 'financial_intel'
  | null;

function classifyDocument(text: string, filename: string, ext: string): DetectedCaseType {
  const lower = text.toLowerCase();
  const fname = filename.toLowerCase();

  // Trial balance / balance de prueba → NIIF Report
  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
    const accountPatterns = /\b(1[0-9]{3}|2[0-9]{3}|3[0-9]{3}|4[0-9]{3}|5[0-9]{3}|6[0-9]{3}|7[0-9]{3})\b/g;
    const matches = lower.match(accountPatterns);
    if (matches && matches.length > 10) return 'niif_report';
    if (fname.includes('balance') || fname.includes('prueba') || fname.includes('trial')) return 'niif_report';
    if (fname.includes('puc') || fname.includes('auxiliar')) return 'niif_report';
  }

  // DIAN acts
  if (lower.includes('requerimiento ordinario') || lower.includes('requerimiento especial')
      || lower.includes('liquidacion oficial') || lower.includes('pliego de cargos')
      || lower.includes('emplazamiento para declarar')
      || (lower.includes('dian') && lower.includes('requerimiento'))) {
    return 'dian_defense';
  }

  // Tax refund
  if ((lower.includes('saldo a favor') || lower.includes('devolucion'))
      && (lower.includes('iva') || lower.includes('renta') || lower.includes('retencion'))) {
    return 'tax_refund';
  }

  // Transfer pricing
  if (lower.includes('precios de transferencia') || lower.includes('plena competencia')
      || lower.includes('arm') || lower.includes('vinculado economico')
      || lower.includes('formato 1125') || lower.includes('art. 260')) {
    return 'transfer_pricing';
  }

  // Tax reconciliation
  if (lower.includes('conciliacion fiscal') || lower.includes('formato 2516')
      || lower.includes('impuesto diferido') || lower.includes('diferencias temporarias')
      || lower.includes('art. 772')) {
    return 'tax_reconciliation';
  }

  // Fiscal audit / revisoria
  if (lower.includes('dictamen') || lower.includes('revisoria fiscal')
      || lower.includes('revisor fiscal') || lower.includes('nia 700')
      || lower.includes('empresa en marcha') || lower.includes('going concern')) {
    return 'fiscal_audit_opinion';
  }

  // Valuation
  if (lower.includes('valoracion') || lower.includes('valuation')
      || lower.includes('flujo descontado') || lower.includes('dcf')
      || lower.includes('multiplos') || lower.includes('ebitda')) {
    return 'business_valuation';
  }

  // Due diligence
  if (lower.includes('due diligence') || lower.includes('debida diligencia')
      || (lower.includes('diagnostico') && lower.includes('financiero'))) {
    return 'due_diligence';
  }

  // Feasibility
  if (lower.includes('factibilidad') || lower.includes('feasibility')
      || lower.includes('estudio de mercado') || lower.includes('vpn')
      || (lower.includes('tir') && lower.includes('inversion'))) {
    return 'feasibility_study';
  }

  // Tax planning
  if (lower.includes('planeacion tributaria') || lower.includes('optimizacion fiscal')
      || lower.includes('regimen simple') || lower.includes('zona franca')
      || lower.includes('zomac') || lower.includes('beneficio tributario')) {
    return 'tax_planning';
  }

  // Financial statements / EEFF → could be NIIF report or financial intel
  if (lower.includes('estado de situacion financiera') || lower.includes('estado de resultados')
      || lower.includes('balance general') || lower.includes('flujo de efectivo')
      || (lower.includes('activo') && lower.includes('pasivo') && lower.includes('patrimonio'))) {
    return 'niif_report';
  }

  return null;
}

// ---------------------------------------------------------------------------
// processDocument — pipeline comun de extraccion + RAG + preprocessing +
// clasificacion. Ambos caminos de POST (JSON via Vercel Blob, multipart legado)
// lo invocan despues de obtener el buffer. Lanza un `UploadError` con `status`
// para los fallos esperables (400) y deja que los inesperados burbujeen (500).
// ---------------------------------------------------------------------------

class UploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

/** Forma de la respuesta JSON — identica para ambos caminos. */
interface ProcessDocumentResult {
  success: true;
  filename: string;
  chunks: number;
  extractedText: string;
  validationReport: string | undefined;
  detectedCaseType: DetectedCaseType;
  isTrialBalance: boolean;
  preprocessed: PreprocessedBalance | null;
  detectedPeriods: string[];
  message: string;
}

async function processDocument(
  buffer: Buffer,
  filename: string,
  contextLabel: string,
): Promise<ProcessDocumentResult> {
  // Validate extension before any processing
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new UploadError('Unsupported file type.');
  }

  if (buffer.length > MAX_UPLOAD_SIZE) {
    throw new UploadError('Archivo demasiado grande. Máximo 100MB.');
  }

  let text: string;
  try {
    text = await extractText(buffer, filename);
  } catch (extractError) {
    // Return the specific error message so the frontend can display actionable feedback
    const message = extractError instanceof Error
      ? extractError.message
      : 'Could not process file.';
    throw new UploadError(message);
  }

  if (!text.trim()) {
    throw new UploadError(
      `File "${filename}" is empty or could not be read. Verify the file contains readable content.`,
    );
  }

  // -----------------------------------------------------------------
  // Vectorization (RAG) — Neon pgvector. Hybrid BM25+cosine search.
  // Non-critical: si falla la insercion, el texto extraido sigue llegando
  // a los agentes via documentContext. Los uploads de usuario SIEMPRE se
  // scopean a un workspace (getOrCreateWorkspace garantiza uno): un chunk
  // con workspace_id NULL entra al pool global y seria recuperable por
  // CUALQUIER tenant via search_docs (leak cross-tenant). Si no se puede
  // resolver workspace, NO indexamos en el RAG global — el texto sigue
  // disponible para el agente via documentContext (per-conversacion).
  // -----------------------------------------------------------------
  let workspaceId: string | undefined;
  try {
    workspaceId = (await getOrCreateWorkspace()).id;
  } catch {
    workspaceId = undefined;
  }
  const chunksCount = workspaceId
    ? await addDocumentsToStore([text], {
        source: filename,
        context: contextLabel,
        docType: 'user_upload',
        workspaceId,
      })
    : 0;
  if (chunksCount > 0) {
    invalidateVectorStore();
  }

  // Save file copy (best-effort, non-critical)
  try {
    if (!fs.existsSync(uploadsPath)) {
      fs.mkdirSync(uploadsPath, { recursive: true });
    }
    const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fs.writeFileSync(path.join(uploadsPath, safeName), buffer);
  } catch {
    // Non-critical on Vercel's read-only filesystem
  }

  // -----------------------------------------------------------------
  // Trial balance preprocessing — if the file looks like accounting
  // data (CSV/Excel with account codes), run arithmetic validation
  // and prepend the validation report to the extracted text.
  //
  // Tambien devolvemos el objeto PreprocessedBalance completo en la
  // respuesta para que el cliente pueda re-enviarlo a /api/financial-report
  // sin re-parsear — asi el orchestrator reusa los totales vinculantes.
  // -----------------------------------------------------------------
  let validationReport: string | undefined;
  let preprocessed: PreprocessedBalance | null = null;
  let detectedPeriods: string[] = [];
  if (['.csv', '.xlsx', '.xls'].includes(ext)) {
    try {
      // Si el texto ya viene segmentado en bloques `[period=YYYY]...[/period]`
      // (caso Excel con multiples hojas etiquetadas con año), parseamos cada
      // bloque por separado forzando su periodo y consolidamos las filas.
      const blockRegex = /\[period=([^\]]+)\]\n([\s\S]*?)\n\[\/period\]/g;
      const blocks: Array<{ period: string; csv: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = blockRegex.exec(text)) !== null) {
        blocks.push({ period: m[1].trim(), csv: m[2] });
      }

      const allRows: ReturnType<typeof parseTrialBalanceCSV> = [];
      if (blocks.length > 0) {
        for (const b of blocks) {
          const yr = detectYearFromString(b.period) ?? b.period;
          const parsed = parseTrialBalanceCSV(b.csv, { forcePeriod: yr });
          // Merge balances by code: si el mismo codigo aparece en varios
          // bloques, fusionamos balancesByPeriod en una sola fila.
          for (const row of parsed) {
            const existing = allRows.find((r) => r.code === row.code);
            if (existing) {
              Object.assign(existing.balancesByPeriod, row.balancesByPeriod);
            } else {
              allRows.push(row);
            }
          }
        }
      } else {
        // CSV sin segmentacion explicita: parser detecta columnas multi-año.
        const parsed = parseTrialBalanceCSV(text);
        allRows.push(...parsed);
      }

      if (allRows.length > 10) {
        const pp = preprocessTrialBalance(allRows);
        if (pp.auxiliaryCount > 0) {
          preprocessed = pp;
          validationReport = pp.validationReport;
          detectedPeriods = pp.periods.map((p) => p.period);
          // Prepend validation report so agents receive validated data
          text = `${pp.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${text}`;
          // Invalidate workspace-balance tag so ERP sync consumers and
          // cached dashboard queries pick up the freshly uploaded balance.
          // 'default' profile: 5 min stale / 15 min revalidate (same as
          // invalidatePillarKpis — sufficient for manual upload cadence).
          revalidateTag('workspace-balance', 'default');
        }
      }
    } catch {
      // Non-critical: if preprocessing fails, the raw text still works
    }
  }

  // -----------------------------------------------------------------
  // Smart document classification — detect what case type this file
  // is best suited for so the frontend can auto-suggest the right flow.
  // Uses keyword heuristics (zero LLM) for instant detection.
  // -----------------------------------------------------------------
  const detectedCaseType = classifyDocument(text, filename, ext);

  return {
    success: true,
    filename,
    chunks: chunksCount,
    extractedText: text,
    validationReport,
    detectedCaseType,
    isTrialBalance: !!validationReport,
    preprocessed,
    detectedPeriods,
    message: chunksCount > 0
      ? `Documento "${filename}" procesado en ${chunksCount} fragmentos e indexado.`
      : `Documento "${filename}" procesado exitosamente. Texto extraido disponible para consulta.`,
  };
}

/**
 * Deriva un nombre de archivo legible del pathname de una URL de Vercel Blob.
 * `addRandomSuffix: true` inserta un sufijo aleatorio antes de la extension
 * (e.g. `balance-Xa9Kp2.csv`). Intentamos quitarlo; si el patron no calza,
 * devolvemos el basename tal cual.
 */
function deriveFilenameFromBlobUrl(blobUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(blobUrl).pathname;
  } catch {
    return 'documento';
  }
  const base = decodeURIComponent(pathname.split('/').pop() ?? '') || 'documento';
  // Vercel Blob random suffix: `<name>-<22 chars alfanum>.<ext>`
  const stripped = base.replace(/-[A-Za-z0-9]{20,}(\.[^.]+)$/, '$1');
  return stripped || base;
}

export async function POST(req: Request) {
  // Validación REAL de sesión (fase 2): OCR con visión es facturable. Fase 1
  // (sin BETTER_AUTH_SECRET) es no-op y preserva el flujo anónimo.
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const { allowed, remaining, limit } = await checkRateLimit(getClientIp(req), 'upload');
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', message: 'Demasiadas subidas. Intenta de nuevo en 1 minuto.' },
      { status: 429, headers: { 'X-RateLimit-Limit': String(limit), 'X-RateLimit-Remaining': '0' } },
    );
  }

  try {
    const contentType = req.headers.get('content-type') ?? '';
    void remaining; // disponible para logs si se necesita

    // -----------------------------------------------------------------
    // Camino JSON (NUEVO, principal) — el cliente ya subio el archivo a
    // Vercel Blob y nos envia solo la URL. Descargamos el binario desde
    // Blob (no desde el body de la Function) — esto evita el 413 de
    // plataforma y habilita archivos hasta 100MB.
    // -----------------------------------------------------------------
    if (contentType.includes('application/json')) {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: 'Cuerpo JSON invalido.' }, { status: 400 });
      }

      const parsed = blobUploadSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? 'Cuerpo de la solicitud invalido.' },
          { status: 400 },
        );
      }
      const { blobUrl, context, filename: bodyFilename } = parsed.data;

      // Anti-SSRF: solo aceptamos URLs de Vercel Blob. El host debe terminar
      // en `.vercel-storage.com` (cubre tambien `.blob.vercel-storage.com`).
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(blobUrl);
      } catch {
        return NextResponse.json({ error: 'blobUrl no es una URL valida.' }, { status: 400 });
      }
      const host = parsedUrl.hostname.toLowerCase();
      const isVercelBlob =
        parsedUrl.protocol === 'https:' &&
        (host.endsWith('.vercel-storage.com') || host.endsWith('.blob.vercel-storage.com'));
      if (!isVercelBlob) {
        return NextResponse.json(
          { error: 'blobUrl debe apuntar a Vercel Blob (*.vercel-storage.com).' },
          { status: 400 },
        );
      }

      // Resolver nombre de archivo y validar extension antes de descargar.
      const filename = (bodyFilename && bodyFilename.trim())
        ? bodyFilename.trim()
        : deriveFilenameFromBlobUrl(blobUrl);
      const ext = path.extname(filename).toLowerCase();
      if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
        return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 });
      }

      // Sanitizar la etiqueta de contexto.
      const contextParsed = uploadContextSchema.safeParse(context ?? 'Documento cargado por el usuario');
      const contextLabel = contextParsed.success ? contextParsed.data : 'Documento cargado por el usuario';

      // Descargar el binario desde Vercel Blob.
      let res: Response;
      try {
        res = await fetch(blobUrl);
      } catch {
        return NextResponse.json(
          { error: 'No fue posible descargar el archivo desde Vercel Blob.' },
          { status: 400 },
        );
      }
      if (!res.ok) {
        return NextResponse.json(
          { error: `No fue posible descargar el archivo desde Vercel Blob (HTTP ${res.status}).` },
          { status: 400 },
        );
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_UPLOAD_SIZE) {
        return NextResponse.json(
          { error: 'Archivo demasiado grande. Máximo 100MB.' },
          { status: 400 },
        );
      }

      try {
        const result = await processDocument(buffer, filename, contextLabel);
        // toJsonSafe: `preprocessed.controlTotals.cents` es BigInt — sin la
        // conversion, JSON.stringify lanza y todo balance real devolvia 500.
        return NextResponse.json(toJsonSafe(result));
      } catch (err) {
        if (err instanceof UploadError) {
          return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
      }
    }

    // -----------------------------------------------------------------
    // Camino multipart/form-data (LEGADO) — se conserva intacto para
    // compatibilidad con archivos pequenos que aun suben por el body.
    // -----------------------------------------------------------------
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const rawContext = (formData.get('context') as string) || 'Documento cargado por el usuario';

    // Validate and sanitize context label
    const contextParsed = uploadContextSchema.safeParse(rawContext);
    const contextLabel = contextParsed.success ? contextParsed.data : 'Documento cargado por el usuario';

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    // Validate extension before any processing
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 100MB.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      const result = await processDocument(buffer, file.name, contextLabel);
      return NextResponse.json(toJsonSafe(result));
    } catch (err) {
      if (err instanceof UploadError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (error) {
    console.error('[upload] Unhandled error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Internal server error processing file upload. Please try again or use a different file format.' },
      { status: 500 }
    );
  }
}
