import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { invalidateVectorStore } from '@/lib/rag/vectorstore';
import { uploadContextSchema, ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/validation/schemas';
import fs from 'fs';
import path from 'path';

const vectorStorePath = path.join(process.cwd(), 'src', 'data', 'vector_store');
const uploadsPath = path.join(process.cwd(), 'src', 'data', 'uploads');

// Magic byte signatures for validated file types
const MAGIC_BYTES: Record<string, number[]> = {
  '.pdf': [0x25, 0x50, 0x44, 0x46],        // %PDF
  '.xlsx': [0x50, 0x4B, 0x03, 0x04],        // PK (ZIP archive)
};

function validateMagicBytes(buffer: Buffer, ext: string): boolean {
  const expected = MAGIC_BYTES[ext];
  if (!expected) return true; // text formats don't have magic bytes
  if (buffer.length < expected.length) return false;
  return expected.every((byte, i) => buffer[i] === byte);
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
    return result.text;
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
    } catch {
      return NextResponse.json({ error: 'Could not process file.' }, { status: 400 });
    }

    if (!text.trim()) {
      return NextResponse.json({ error: 'File is empty or could not be read.' }, { status: 400 });
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
    await vectorStore.save(vectorStorePath);

    // Invalidate the in-memory cache so the next search picks up new docs
    invalidateVectorStore();

    // Save a copy of the original file for reference
    if (!fs.existsSync(uploadsPath)) {
      fs.mkdirSync(uploadsPath, { recursive: true });
    }
    const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fs.writeFileSync(path.join(uploadsPath, safeName), buffer);

    return NextResponse.json({
      success: true,
      filename: file.name,
      chunks: docs.length,
      message: `Document "${file.name}" processed into ${docs.length} chunks and added to the knowledge base.`,
    });
  } catch (error) {
    console.error('Upload API error.');
    return NextResponse.json(
      { error: 'Internal server error processing file upload.' },
      { status: 500 }
    );
  }
}
