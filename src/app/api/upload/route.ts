import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { invalidateVectorStore, getStoragePath } from '@/lib/rag/vectorstore';
import { uploadContextSchema, ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/validation/schemas';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const vectorStorePath = getStoragePath('vector_store');
const uploadsPath = getStoragePath('uploads');

// Magic byte signatures for validated file types
const MAGIC_BYTES: Record<string, number[]> = {
  '.pdf':  [0x25, 0x50, 0x44, 0x46],              // %PDF
  '.xlsx': [0x50, 0x4B, 0x03, 0x04],              // PK (ZIP archive)
  '.jpg':  [0xFF, 0xD8, 0xFF],                     // JPEG SOI marker
  '.jpeg': [0xFF, 0xD8, 0xFF],                     // JPEG SOI marker
  '.png':  [0x89, 0x50, 0x4E, 0x47],              // PNG header
};

function validateMagicBytes(buffer: Buffer, ext: string): boolean {
  const expected = MAGIC_BYTES[ext];
  if (!expected) return true; // text formats don't have magic bytes
  if (buffer.length < expected.length) return false;
  return expected.every((byte, i) => buffer[i] === byte);
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
  };
  const mime = mimeMap[ext] || 'image/png';
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    max_tokens: 4096,
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
  if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    return extractTextFromImage(buffer, filename);
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
    // short relative to file size, warn the user.
    // Heuristic: a typical text page yields ~2000+ chars; if we get < 50
    // chars per estimated page (assuming ~100KB/page for scanned PDFs),
    // the PDF is likely image-based.
    const estimatedPages = Math.max(1, Math.ceil(buffer.length / 100_000));
    const charsPerPage = text.trim().length / estimatedPages;
    if (text.trim().length < 50 || charsPerPage < 50) {
      throw new Error(
        'SCANNED_PDF: Este PDF parece ser una imagen escaneada y no contiene texto extraible. ' +
        'Para analizarlo, sube capturas de pantalla de cada pagina como imagenes (.jpg o .png) ' +
        'y UtopIA extraera el texto automaticamente con OCR.'
      );
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

    // Split into chunks with contextual prefix
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 250,
    });

    const chunks = await textSplitter.splitText(text);
    const contextPrefix = `[Documento Contable/Tributario: ${contextLabel} — Archivo: ${file.name}]`;

    const docs = chunks.map(
      (chunk) =>
        new Document({
          pageContent: `${contextPrefix}\n\n${chunk}`,
          metadata: {
            source: file.name,
            context: contextLabel,
            type: 'user_upload',
            uploadedAt: new Date().toISOString(),
          },
        })
    );

    // Load existing vector store and add the new documents
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    let vectorStore: HNSWLib;
    try {
      vectorStore = await HNSWLib.load(vectorStorePath, embeddings);
    } catch {
      // If no store exists yet, create a fresh one
      vectorStore = await HNSWLib.fromDocuments([], embeddings);
    }

    // Add new documents to existing store
    await vectorStore.addDocuments(docs);

    // Persist vector store -- uses /tmp on Vercel (ephemeral but functional
    // within the invocation and warm-start window).
    try {
      await vectorStore.save(vectorStorePath);
    } catch (saveError) {
      console.warn(
        '[upload] Could not persist vector store to disk. Documents are available in-memory for this invocation.',
        saveError instanceof Error ? saveError.message : saveError
      );
    }

    // Invalidate the in-memory cache so the next search picks up new docs
    invalidateVectorStore();

    // Save a copy of the original file for reference (best-effort, non-critical)
    try {
      if (!fs.existsSync(uploadsPath)) {
        fs.mkdirSync(uploadsPath, { recursive: true });
      }
      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      fs.writeFileSync(path.join(uploadsPath, safeName), buffer);
    } catch (fileSaveError) {
      // Non-critical: the document is already indexed in the vector store.
      // On Vercel /tmp may have limited space; this is acceptable to skip.
      console.warn(
        '[upload] Could not save file copy to disk. This is non-critical.',
        fileSaveError instanceof Error ? fileSaveError.message : fileSaveError
      );
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      chunks: docs.length,
      extractedText: text,
      message: `Document "${file.name}" processed into ${docs.length} chunks and added to the knowledge base.`,
    });
  } catch (error) {
    console.error('[upload] Unhandled error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Internal server error processing file upload. Please try again or use a different file format.' },
      { status: 500 }
    );
  }
}
