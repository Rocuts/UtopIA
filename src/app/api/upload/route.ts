import { NextResponse } from 'next/server';
import { uploadContextSchema, ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/validation/schemas';
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

// Vercel Fluid Compute: explicit runtime + 300s ceiling for OCR-heavy uploads
export const runtime = 'nodejs';
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
 * configurado en MODELS.OCR (default `gpt-4o`) acepta `application/pdf` como
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
 * `gpt-4o`) usando `OPENAI_API_KEY` directo (sin gateway).
 *
 * Nota: el shape `{ type: 'image', image: <data URL> }` esta documentado en
 * node_modules/ai/docs/02-foundations/03-prompts.mdx. `mediaType` es opcional
 * cuando se pasa un data URL (el MIME ya esta embebido). El default del modelo
 * `gpt-4o` es razonable para OCR.
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

  // --- Image files: OCR via OpenAI Vision API ---
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic'].includes(ext)) {
    return extractTextFromImage(buffer, filename);
  }

  // --- Word documents (.docx) ---
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    if (!result.value.trim()) {
      throw new Error('El documento Word esta vacio o no contiene texto extraible.');
    }
    return result.value;
  }

  // --- Old Word format (.doc) ---
  if (ext === '.doc') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
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
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
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

export async function POST(req: Request) {
  try {
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
      return NextResponse.json({ error: 'File too large. Max 4MB.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text: string;

    try {
      text = await extractText(buffer, file.name);
    } catch (extractError) {
      // Return the specific error message so the frontend can display actionable feedback
      const message = extractError instanceof Error
        ? extractError.message
        : 'Could not process file.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: `File "${file.name}" is empty or could not be read. Verify the file contains readable content.` },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------
    // Vectorization (RAG) — uses centralized store with automatic
    // HNSWLib → MemoryVectorStore fallback. Non-critical: if it fails
    // entirely, the extracted text still reaches agents via documentContext.
    // -----------------------------------------------------------------
    const chunksCount = await addDocumentsToStore([text], {
      source: file.name,
      context: contextLabel,
    });
    if (chunksCount > 0) {
      invalidateVectorStore();
    }

    // Save file copy (best-effort, non-critical)
    try {
      if (!fs.existsSync(uploadsPath)) {
        fs.mkdirSync(uploadsPath, { recursive: true });
      }
      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
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
    const detectedCaseType = classifyDocument(text, file.name, ext);

    return NextResponse.json({
      success: true,
      filename: file.name,
      chunks: chunksCount,
      extractedText: text,
      validationReport,
      detectedCaseType,
      isTrialBalance: !!validationReport,
      /**
       * PreprocessedBalance completo: el cliente lo puede re-enviar a
       * /api/financial-report como `preprocessed` para que el orchestrator
       * reuse los totales vinculantes sin re-parsear el CSV. `null` si
       * el archivo no es un balance de prueba.
       */
      preprocessed,
      /**
       * Periodos fiscales detectados en el archivo (e.g. ["2024","2025"]).
       * El cliente debe propagar este valor a los endpoints financieros via
       * `company.detectedPeriods` para que los pipelines sepan que generar
       * comparativos sin volver a inspeccionar el CSV.
       */
      detectedPeriods,
      message: chunksCount > 0
        ? `Documento "${file.name}" procesado en ${chunksCount} fragmentos e indexado.`
        : `Documento "${file.name}" procesado exitosamente. Texto extraido disponible para consulta.`,
    });
  } catch (error) {
    console.error('[upload] Unhandled error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Internal server error processing file upload. Please try again or use a different file format.' },
      { status: 500 }
    );
  }
}
