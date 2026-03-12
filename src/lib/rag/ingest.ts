import fs from 'fs';
import path from 'path';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ ERROR: OPENAI_API_KEY not found in .env.local.");
  process.exit(1);
}

const docsPath = path.join(process.cwd(), 'src', 'data', 'legal_docs');
const vectorStorePath = path.join(process.cwd(), 'src', 'data', 'vector_store');

// Map filenames to human-readable contextual prefixes.
// This is a 2025-2026 best practice ("contextual retrieval") —
// each chunk carries a short summary of its parent document so the
// embedding and the LLM both know which law/regulation the chunk belongs to.
const DOC_CONTEXT_MAP: Record<string, string> = {
  'flsa_summary_2026.md':
    'From the Fair Labor Standards Act (FLSA) — covers minimum wage, overtime, tipped employees, exempt/non-exempt classification, child labor, and wage theft.',
  'eeoc_summary_2026.md':
    'From the EEOC / Title VII / ADA / ADEA — covers employment discrimination, harassment, hostile work environment, wrongful termination, and reasonable accommodations.',
  'osha_summary_2026.md':
    'From OSHA — covers workplace safety rights, injury reporting, workers compensation, whistleblower protections, and employer safety obligations.',
  'immigration_employment_2026.md':
    'From Immigration & Employment Law — covers worker protections regardless of status, U/T Visas, H-1B/H-2A/H-2B visas, I-9/E-Verify, and ICE enforcement policies.',
  'personal_injury_auto_accidents_2026.md':
    'From Personal Injury & Auto Accidents — covers fault/no-fault states, PIP, comparative negligence, rideshare liability, statute of limitations, and undocumented immigrant rights in accident cases.',
};

function getContextPrefix(filename: string): string {
  return DOC_CONTEXT_MAP[filename] || `From document: ${filename}`;
}

async function ingestData() {
  console.log('📚 Starting legal document ingestion (U.S. 2026)...');
  console.log('🔄 Using contextual retrieval prefixes for improved search accuracy.\n');

  const docs: Document[] = [];
  const files = fs.readdirSync(docsPath).filter(f => f.endsWith('.md'));

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 250,
  });

  for (const file of files) {
    const filePath = path.join(docsPath, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const contextPrefix = getContextPrefix(file);

    const textChunks = await textSplitter.splitText(text);

    for (const chunk of textChunks) {
      // Prepend contextual prefix so the embedding captures document-level meaning
      const enrichedContent = `[${contextPrefix}]\n\n${chunk}`;
      docs.push(
        new Document({
          pageContent: enrichedContent,
          metadata: {
            source: file,
            context: contextPrefix,
          },
        })
      );
    }

    console.log(`  ✅ ${file} → ${textChunks.length} chunks (with context prefix)`);
  }

  console.log(`\n📄 ${files.length} documents loaded → ${docs.length} enriched chunks total.`);

  console.log('🧠 Generating embeddings via OpenAI (text-embedding-3-small)...');
  const embeddings = new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
  });

  const vectorStore = await HNSWLib.fromDocuments(docs, embeddings);

  if (!fs.existsSync(vectorStorePath)) {
    fs.mkdirSync(vectorStorePath, { recursive: true });
  }

  await vectorStore.save(vectorStorePath);
  console.log(`💾 Vector database persisted at: ${vectorStorePath}`);
  console.log('🚀 RAG system ready. Chunks include contextual prefixes for better retrieval.');
}

ingestData().catch((error) => {
  console.error('❌ Error during ingestion:', error);
});
