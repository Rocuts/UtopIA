import fs from 'fs';
import path from 'path';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY not found in .env.local.");
  process.exit(1);
}

const docsPath = path.join(process.cwd(), 'src', 'data', 'tax_docs');
const vectorStorePath = path.join(process.cwd(), 'src', 'data', 'vector_store');

const docsOnly = process.argv.includes('--docs-only');

// ---------------------------------------------------------------------------
// Frontmatter parser (no external dependency)
// ---------------------------------------------------------------------------

function parseFrontmatter(text: string): { metadata: Record<string, string>; content: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, content: text };
  const metadata: Record<string, string> = {};
  match[1].split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) metadata[key.trim()] = rest.join(':').trim();
  });
  return { metadata, content: match[2] };
}

// ---------------------------------------------------------------------------
// Context prefix from frontmatter metadata
// ---------------------------------------------------------------------------

function getContextPrefix(metadata: Record<string, string>, filename: string): string {
  const { type, number, year, entity } = metadata;

  if (type && number && year) {
    switch (type) {
      case 'ley':
        return `Ley ${number} de ${year} — Normativa tributaria colombiana aprobada por el Congreso.`;
      case 'decreto':
        return `Decreto ${number} de ${year} — Decreto reglamentario expedido por la Presidencia.`;
      case 'resolucion':
        if (entity === 'dian') {
          return `Resolución DIAN ${number} de ${year} — Regulación administrativa de la DIAN.`;
        }
        return `Resolución ${entity ? entity.toUpperCase() + ' ' : ''}${number} de ${year}.`;
      case 'circular':
        return `Circular ${entity ? entity.toUpperCase() + ' ' : ''}${number} de ${year} — Instrucciones operativas.`;
      case 'decision':
        return `Decisión CAN ${number} — Normativa de la Comunidad Andina de Naciones.`;
      case 'estatuto':
        return 'Estatuto Tributario de Colombia — Código fiscal principal.';
      default:
        break;
    }
  }

  if (type === 'estatuto') {
    return 'Estatuto Tributario de Colombia — Código fiscal principal.';
  }

  // Fallback: use title from frontmatter or filename
  if (metadata.title) return metadata.title;
  return `Documento: ${filename}`;
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

async function ingestData() {
  console.log('Starting Colombian tax/accounting document ingestion...');
  console.log('Using contextual retrieval prefixes from frontmatter.\n');

  if (docsOnly) {
    console.log('Mode: --docs-only (processing tax_docs only)\n');
  }

  if (!fs.existsSync(docsPath)) {
    console.log(`Creating tax_docs directory at: ${docsPath}`);
    fs.mkdirSync(docsPath, { recursive: true });
  }

  const allFiles = fs.readdirSync(docsPath).filter(f => f.endsWith('.md') || f.endsWith('.txt'));

  if (allFiles.length === 0) {
    console.log('No documents found in tax_docs directory. Please add Colombian tax documents and run again.');
    console.log(`Expected path: ${docsPath}`);
    return;
  }

  console.log(`Found ${allFiles.length} files in tax_docs/\n`);

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 3000,
    chunkOverlap: 600,
    separators: [
      '\n## ',    // H2 headers (article boundaries)
      '\n### ',   // H3 headers (sub-sections)
      '\n#### ',  // H4 headers
      '\n\n',     // Paragraph breaks
      '\n',       // Line breaks
      '. ',       // Sentence boundaries
      ' ',        // Words
    ],
  });

  const docs: Document[] = [];
  let processed = 0;
  let skipped = 0;

  for (const file of allFiles) {
    try {
      const filePath = path.join(docsPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { metadata, content } = parseFrontmatter(raw);
      const contextPrefix = getContextPrefix(metadata, file);

      const textChunks = await textSplitter.splitText(content);

      for (const chunk of textChunks) {
        const enrichedContent = `[${contextPrefix}]\n\n${chunk}`;
        docs.push(
          new Document({
            pageContent: enrichedContent,
            metadata: {
              source: file,
              docType: metadata.type || 'unknown',
              entity: metadata.entity || 'unknown',
              year: metadata.year || 'unknown',
              number: metadata.number || '',
              context: contextPrefix,
            },
          })
        );
      }

      processed++;

      // Progress log every 20 files
      if (processed % 20 === 0) {
        console.log(`  Processed ${processed}/${allFiles.length} files (${docs.length} chunks so far)...`);
      }
    } catch (err) {
      skipped++;
      console.warn(`  WARN: Skipping ${file} — ${(err as Error).message}`);
    }
  }

  console.log(`\nProcessed ${processed} files (${skipped} skipped) -> ${docs.length} enriched chunks total.`);

  console.log('Generating embeddings via OpenAI (text-embedding-3-small)...');
  const embeddings = new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
    batchSize: 200, // Prevent "maximum request size is 300000 tokens" error
  });

  const vectorStore = await HNSWLib.fromDocuments(docs, embeddings);

  if (!fs.existsSync(vectorStorePath)) {
    fs.mkdirSync(vectorStorePath, { recursive: true });
  }

  await vectorStore.save(vectorStorePath);
  console.log(`\nVector database persisted at: ${vectorStorePath}`);
  console.log(`Total chunks: ${docs.length}`);
  console.log('RAG system ready. Chunks include contextual prefixes for better retrieval.');
}

ingestData().catch((error) => {
  console.error('Error during ingestion:', error);
  process.exit(1);
});
