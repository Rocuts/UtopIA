import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { invalidateVectorStore } from '@/lib/rag/vectorstore';
import fs from 'fs';
import path from 'path';

const vectorStorePath = path.join(process.cwd(), 'src', 'data', 'vector_store');
const uploadsPath = path.join(process.cwd(), 'src', 'data', 'uploads');

// Supported file types and their text extractors
function extractText(buffer: Buffer, filename: string): string {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf-8');
  }

  // For other text-based formats, attempt UTF-8 decode
  if (['.csv', '.json', '.html', '.xml'].includes(ext)) {
    return buffer.toString('utf-8');
  }

  throw new Error(`Unsupported file type: ${ext}. Supported: .txt, .md, .csv, .json, .html, .xml`);
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const contextLabel = (formData.get('context') as string) || 'User uploaded document';

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    // Size limit: 5MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text: string;

    try {
      text = extractText(buffer, file.name);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 400 });
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
    const contextPrefix = `[User Document: ${contextLabel} — File: ${file.name}]`;

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
  } catch (error: any) {
    console.error('❌ Error in upload API:', error);
    return NextResponse.json(
      { error: 'Internal server error processing file upload.' },
      { status: 500 }
    );
  }
}
