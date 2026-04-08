const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const INPUT_DIR = path.resolve(__dirname, '..', 'Documentacion');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'src', 'data', 'tax_docs');

// Entity mapping from filename prefix/entity part
const ENTITY_MAP = {
  dian: 'dian',
  mincomercioit: 'mincomercioit',
  minminas: 'minminas',
  minsaludps: 'minsaludps',
  mintransporte: 'mintransporte',
  minagricultura: 'minagricultura',
  minproteccion: 'minproteccion',
  comisioncandina: 'comisioncandina',
  sgcandina: 'sgcandina',
  cioea: 'cioea',
  cizf: 'cizf',
};

// Default entity by document type
const DEFAULT_ENTITY = {
  ley: 'congreso',
  decreto: 'presidencia',
  resolucion: 'dian',
  circular: 'dian',
  decision: 'comisioncandina',
  estatuto: 'congreso',
};

// Human-readable entity labels for titles
const ENTITY_LABELS = {
  dian: 'DIAN',
  mincomercioit: 'MinCIT',
  minminas: 'MinMinas',
  minsaludps: 'MinSalud',
  mintransporte: 'MinTransporte',
  minagricultura: 'MinAgricultura',
  minproteccion: 'MinProtección',
  comisioncandina: 'CAN',
  sgcandina: 'SG CAN',
  cioea: 'CIOEA',
  cizf: 'CIZF',
  congreso: 'Congreso',
  presidencia: 'Presidencia',
};

const TYPE_LABELS = {
  ley: 'Ley',
  decreto: 'Decreto',
  resolucion: 'Resolución',
  circular: 'Circular',
  decision: 'Decisión',
  estatuto: 'Estatuto',
};

function isDuplicate(filename) {
  return /\(\d+\)\.pdf$/i.test(filename);
}

function parseFilename(filename) {
  const base = filename.replace(/\.pdf$/i, '');

  // Special case: estatuto_tributario_completo
  if (/estatuto.tributario/i.test(base)) {
    return {
      type: 'estatuto',
      entity: 'congreso',
      number: '',
      year: '',
      title: 'Estatuto Tributario de Colombia',
      outputName: 'estatuto_tributario_completo.md',
    };
  }

  // Pattern: "DECRETO 624 DE 1989" / "LEY 2277 DE 2022" / "Decreto 214 de 2025" / "Resolución 15 de 2016 DIAN"
  const spacedMatch = base.match(/^(ley|decreto|resoluci[oó]n|circular|decision)\s+(\d+)\s+de\s+(\d{4})(?:\s+(.+))?$/i);
  if (spacedMatch) {
    let rawType = spacedMatch[1].toLowerCase().replace('ó', 'o').replace('resolución', 'resolucion').replace('resolucio', 'resolucion');
    if (rawType === 'resolucion' || rawType === 'resolución') rawType = 'resolucion';
    // normalize
    if (rawType.startsWith('resoluci')) rawType = 'resolucion';

    const number = spacedMatch[2];
    const year = spacedMatch[3];
    let entity = DEFAULT_ENTITY[rawType] || 'presidencia';
    const extra = spacedMatch[4];

    if (extra) {
      const extraLower = extra.toLowerCase().replace(/\s+/g, '');
      if (ENTITY_MAP[extraLower]) entity = ENTITY_MAP[extraLower];
      else if (extraLower === 'dian') entity = 'dian';
    }

    const entityLabel = entity !== DEFAULT_ENTITY[rawType] ? ` ${ENTITY_LABELS[entity]}` : '';
    const title = `${TYPE_LABELS[rawType]}${entityLabel} ${number} de ${year}`;
    const outputName = `${rawType}_${number}_${year}.md`;

    return { type: rawType, entity, number, year, title, outputName };
  }

  // Pattern: decision_comisioncandina_dec571
  const decisionMatch = base.match(/^decision_(\w+)_dec(\d+)$/i);
  if (decisionMatch) {
    const entity = ENTITY_MAP[decisionMatch[1].toLowerCase()] || decisionMatch[1].toLowerCase();
    const number = decisionMatch[2];
    return {
      type: 'decision',
      entity,
      number,
      year: '',
      title: `Decisión ${ENTITY_LABELS[entity] || entity} ${number}`,
      outputName: `decision_${decisionMatch[1].toLowerCase()}_dec${number}.md`,
    };
  }

  // Pattern: resolucion_sgcandina_rsg1456
  const sgMatch = base.match(/^resolucion_sgcandina_rsg(\d+)$/i);
  if (sgMatch) {
    const number = sgMatch[1];
    return {
      type: 'resolucion',
      entity: 'sgcandina',
      number,
      year: '',
      title: `Resolución SG CAN ${number}`,
      outputName: `resolucion_sgcandina_rsg${number}.md`,
    };
  }

  // Pattern: type_entity_number_year.pdf  (e.g., resolucion_dian_0001_2024)
  const fullMatch = base.match(/^(ley|decreto|resolucion|circular|decision)_(\w+?)_(\d+)_(\d{4})$/i);
  if (fullMatch) {
    const rawType = fullMatch[1].toLowerCase();
    const entityPart = fullMatch[2].toLowerCase();
    const number = fullMatch[3];
    const year = fullMatch[4];

    let entity;
    if (ENTITY_MAP[entityPart]) {
      entity = ENTITY_MAP[entityPart];
    } else {
      entity = DEFAULT_ENTITY[rawType] || entityPart;
    }

    const entityLabel = ENTITY_MAP[entityPart] ? ` ${ENTITY_LABELS[entity]}` : '';
    const title = `${TYPE_LABELS[rawType]}${entityLabel} ${number} de ${year}`;
    const outputName = `${rawType}_${entityPart}_${number}_${year}.md`;

    return { type: rawType, entity, number, year, title, outputName };
  }

  // Pattern: type_number_year.pdf (e.g., ley_2277_2022, decreto_1625_2016)
  const simpleMatch = base.match(/^(ley|decreto|resolucion|circular|decision)_(\d+)_(\d{4})$/i);
  if (simpleMatch) {
    const rawType = simpleMatch[1].toLowerCase();
    const number = simpleMatch[2];
    const year = simpleMatch[3];
    const entity = DEFAULT_ENTITY[rawType] || 'presidencia';
    const title = `${TYPE_LABELS[rawType]} ${number} de ${year}`;
    const outputName = `${rawType}_${number}_${year}.md`;

    return { type: rawType, entity, number, year, title, outputName };
  }

  // Fallback: derive what we can
  const fallbackType = base.split('_')[0].toLowerCase();
  const type = TYPE_LABELS[fallbackType] ? fallbackType : 'documento';
  const entity = DEFAULT_ENTITY[type] || 'unknown';
  const sanitized = base.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return {
    type,
    entity,
    number: '',
    year: '',
    title: base,
    outputName: `${sanitized}.md`,
  };
}

function buildMarkdown(meta, text) {
  const frontmatter = [
    '---',
    `title: "${meta.title}"`,
    `type: ${meta.type}`,
    `entity: ${meta.entity}`,
    `number: "${meta.number}"`,
    `year: "${meta.year}"`,
    `source: "${meta.source}"`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n# ${meta.title}\n\n${text.trim()}\n`;
}

async function extractText(filepath) {
  const buf = fs.readFileSync(filepath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  return result.text || '';
}

async function main() {
  const files = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`Found ${files.length} PDF files in ${INPUT_DIR}`);

  // Ensure output dir exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let converted = 0;
  let skippedDuplicates = 0;
  let failures = [];
  let totalTextSize = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Skip duplicates
    if (isDuplicate(file)) {
      skippedDuplicates++;
      console.log(`  SKIP duplicate: ${file}`);
      continue;
    }

    try {
      const meta = parseFilename(file);
      meta.source = file;
      const outputPath = path.join(OUTPUT_DIR, meta.outputName);

      const text = await extractText(path.join(INPUT_DIR, file));
      const md = buildMarkdown(meta, text);

      fs.writeFileSync(outputPath, md, 'utf-8');
      totalTextSize += Buffer.byteLength(md, 'utf-8');
      converted++;

      if (converted % 20 === 0) {
        console.log(`  Progress: ${converted} files converted, ${(totalTextSize / 1024 / 1024).toFixed(2)} MB total text`);
      }
    } catch (err) {
      failures.push({ file, error: err.message });
      console.error(`  FAIL: ${file} — ${err.message}`);
    }
  }

  console.log('\n=== CONVERSION COMPLETE ===');
  console.log(`Total files found:     ${files.length}`);
  console.log(`Duplicates skipped:    ${skippedDuplicates}`);
  console.log(`Successfully converted: ${converted}`);
  console.log(`Failures:              ${failures.length}`);
  console.log(`Total markdown size:   ${(totalTextSize / 1024 / 1024).toFixed(2)} MB`);

  if (failures.length > 0) {
    console.log('\nFailed files:');
    failures.forEach(f => console.log(`  - ${f.file}: ${f.error}`));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
