#!/usr/bin/env node
// ---------------------------------------------------------------------------
// lint-strict-mode.mjs — Guardrail CI para strict mode Zod en contracts/
// ---------------------------------------------------------------------------
// Falla con exit 1 si detecta patrones prohibidos por OpenAI strict json_schema
// en src/lib/agents/financial/contracts/**.ts
//
// Patrones prohibidos (producen "additionalProperties" o "default" en el JSON
// schema generado, que OpenAI strict mode rechaza en tiempo de ejecucion):
//   .optional()   — produce required[] sin la clave en strict
//   .nullish()    — alias de .optional().nullable(), prohibido
//   .default(     — produce "default" key en el schema, rechazado por strict
//   .passthrough()— habilita additionalProperties, incompatible con strict
//   z.record(     — produce additionalProperties:true, incompatible con strict
//   .catchall(    — equivalente a additionalProperties, incompatible con strict
//
// Allowlist (archivos excluidos — sus schemas NO van via experimental_output):
//   contracts/html-editor.ts  — output HTML libre, no JSON estructurado al LLM
//
// Refs: Wave 4.F1 (nullable().optional() bug), Wave 4.F2 (.default([]) bug),
//       Wave 5.A1 + A3 audit findings.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const CONTRACTS_DIR = join(
  REPO_ROOT,
  'src/lib/agents/financial/contracts'
);

const FORBIDDEN = [
  { regex: /\.optional\(\)/, label: '.optional()' },
  { regex: /\.nullish\(\)/, label: '.nullish()' },
  { regex: /\.default\(/, label: '.default(' },
  { regex: /\.passthrough\(\)/, label: '.passthrough()' },
  { regex: /z\.record\(/, label: 'z.record(' },
  { regex: /\.catchall\(/, label: '.catchall(' },
];

// Files (basename match) that are exempt from strict-mode checks.
const ALLOWLIST_BASENAMES = new Set(['html-editor.ts']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test directories — fixtures can use any Zod pattern.
      if (entry.name === '__tests__' || entry.name === '__fixtures__') continue;
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Strip inline comments from a line of TypeScript before pattern-matching.
 * Handles:
 *   - Full-line comments: "  // foo" → ""
 *   - Trailing comments: "  z.string(), // foo" → "  z.string(), "
 *   - Block comment lines (lines containing only block comment content)
 *
 * This is NOT a full TS parser — it is intentionally conservative.
 * The goal is to avoid flagging patterns that only appear inside comment text
 * (e.g. "Why: rechaza .default()" in a comment block).
 */
function stripLineComment(line) {
  // Remove everything from // onward (handles trailing and full-line comments).
  // We use a simple indexOf approach to avoid regex catastrophic backtracking.
  const commentIdx = line.indexOf('//');
  if (commentIdx !== -1) {
    return line.slice(0, commentIdx);
  }
  return line;
}

/**
 * Returns true if this line is entirely inside a block comment (/* ... *\/).
 * We track state with a mutable flag passed in/out.
 */
function isInsideBlockComment(line, inBlockRef) {
  const trimmed = line.trim();

  if (inBlockRef.value) {
    // We are inside a block comment. Check if it ends here.
    if (trimmed.includes('*/')) {
      inBlockRef.value = false;
    }
    return true;
  }

  // Not currently inside a block comment. Does one open here?
  if (trimmed.startsWith('/*')) {
    if (!trimmed.includes('*/')) {
      // Multi-line block comment starts here.
      inBlockRef.value = true;
    }
    // Entire opening line is comment content.
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

const files = collectTsFiles(CONTRACTS_DIR);
const violations = [];

for (const filePath of files) {
  const basename = filePath.split('/').pop();

  // Skip allowlisted files.
  if (ALLOWLIST_BASENAMES.has(basename)) continue;

  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const relPath = relative(REPO_ROOT, filePath);

  const inBlockComment = { value: false };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Skip block-comment lines entirely (no code can appear here).
    if (isInsideBlockComment(rawLine, inBlockComment)) continue;

    // Strip inline (trailing) comment text before matching.
    const codeLine = stripLineComment(rawLine);

    for (const { regex, label } of FORBIDDEN) {
      if (regex.test(codeLine)) {
        violations.push({
          file: relPath,
          line: i + 1,
          label,
          text: rawLine.trim(),
        });
        // One report per line (multiple patterns on same line are rare; first wins).
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (violations.length === 0) {
  console.log('All contracts pass strict mode lint.');
  process.exit(0);
} else {
  console.error(`Strict mode violations detected (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.label}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    `\nFix: replace .optional() with .nullable(), remove .default(...),\n` +
    `replace z.record() with explicit z.object() shape, remove .passthrough() / .catchall().\n` +
    `If the schema does NOT go via experimental_output (Output.object), add its file\n` +
    `to ALLOWLIST_BASENAMES in scripts/lint-strict-mode.mjs.`
  );
  process.exit(1);
}
