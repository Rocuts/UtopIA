import { NextResponse } from 'next/server';
import { uploadContextSchema, ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/validation/schemas';
import { addDocumentsToStore, invalidateVectorStore, getStoragePath } from '@/lib/rag/vectorstore';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

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
 * Extract text from a scanned (image-only) PDF using OpenAI Responses API.
 * Sends the PDF as a file input to gpt-4o for OCR across all pages.
 *
 * @param buffer   - Raw PDF bytes.
 * @param filename - Original filename.
 * @returns Extracted text from all pages.
 */
async function extractTextFromScannedPDF(buffer: Buffer, filename: string): Promise<string> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 120_000, // 2 min timeout for large scanned PDFs
  });
  const base64 = buffer.toString('base64');

  const response = await openai.responses.create({
    model: 'gpt-4o',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              'Este es un documento PDF escaneado con informacion contable/tributaria colombiana. ' +
              'Extrae TODO el texto de TODAS las paginas. Preserva la estructura de tablas usando markdown tables. ' +
              'Incluye todos los numeros, fechas, NITs y referencias legales exactamente como aparecen. ' +
              'Si una pagina no tiene texto, omitela. Procesa TODAS las paginas del documento.',
          },
          {
            type: 'input_file',
            filename: filename,
            file_data: `data:application/pdf;base64,${base64}`,
          },
        ],
      },
    ],
  });

  const extracted = response.output_text?.trim();
  if (!extracted) {
    throw new Error('No se pudo extraer texto del PDF escaneado.');
  }
  return extracted;
}

/**
 * Extract text from an image file using OpenAI Vision API (OCR).
 * Sends the image as base64 to gpt-4o for high-quality text extraction.
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

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 90_000, // 90s timeout for image OCR
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract ALL text from this scanned document. Preserve table structure using markdown tables. Include all numbers, dates, and legal references exactly as shown.',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
        ],
      },
    ],
    max_tokens: 8192,
  });

  const extracted = response.choices[0]?.message?.content?.trim();
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
    return buffer.toString('utf-8');
  }

  if (['.csv', '.json', '.xml'].includes(ext)) {
    return buffer.toString('utf-8');
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
          'para que UtopIA las procese con OCR.'
        );
      }
    }

    return text;
  }

  if (ext === '.xlsx') {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const sheets: string[] = [];
    workbook.eachSheet((worksheet) => {
      const rows: string[] = [];
      worksheet.eachRow((row) => {
        const values = row.values as (string | number | boolean | Date | null | undefined)[];
        rows.push(values.slice(1).map(v => String(v ?? '')).join(','));
      });
      sheets.push(`--- Sheet: ${worksheet.name} ---\n${rows.join('\n')}`);
    });
    return sheets.join('\n\n');
  }

  throw new Error('Unsupported file type.');
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
      return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 });
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

    return NextResponse.json({
      success: true,
      filename: file.name,
      chunks: chunksCount,
      extractedText: text,
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
