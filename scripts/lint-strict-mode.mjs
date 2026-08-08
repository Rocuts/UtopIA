#!/usr/bin/env node
// ---------------------------------------------------------------------------
// lint-strict-mode.mjs — Guardrail CI para strict mode Zod
// ---------------------------------------------------------------------------
// Falla con exit 1 si detecta patrones prohibidos por OpenAI strict json_schema
// en cualquier schema Zod que viaje al LLM como structured output.
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
// ---------------------------------------------------------------------------
// QUE SE ESCANEA, Y POR QUE ASI (ampliacion 2026-08)
// ---------------------------------------------------------------------------
// El guard escaneaba DOS directorios fijos: `financial/contracts` y `facts`.
// Todo schema strict que viviera fuera de ahi quedaba sin guarda — y varios
// viven fuera: el classifier, la extraccion Vision de Pyme, el categorizador,
// los modulos del Agente Fiscal del Escudo y las tools de chat. Una lista fija
// de directorios envejece: el proximo agente que alguien agregue en una carpeta
// nueva vuelve a quedarse fuera sin que nadie se entere.
//
// Por eso la cobertura se DESCUBRE en vez de declararse:
//
//   FASE A — directorios raiz. Todo .ts dentro de ellos debe cumplir, aunque
//            hoy no tenga call site (son carpetas de contratos por definicion).
//
//   FASE B — descubrimiento. Se recorre `src/`, se buscan los sitios donde un
//            identificador se pasa como argumento `schema:` (el patron de
//            `Output.object({ schema })`, `generateObject`, `callFinancialAgent`,
//            `callFiscalAgent`, `callStructuredTool` y cualquier wrapper futuro
//            que respete esa convencion), se resuelve el MODULO donde ese
//            identificador esta definido, y ese modulo entra al escaneo.
//
// LIMITE DELIBERADO — los `inputSchema` de las tools NO se escanean.
// Un tool schema tambien viaja al LLM, pero por otro canal: `@ai-sdk/openai`
// solo emite `strict` en la definicion de una tool cuando la tool lo declara
// explicitamente (`...tool.strict != null ? { strict: tool.strict } : {}` en
// node_modules/@ai-sdk/openai/dist/index.js). Sin esa declaracion la tool va en
// modo NO estricto y `.optional()` es perfectamente valido — de hecho es lo
// correcto para un parametro opcional. En cambio `response_format: json_schema`
// (el camino de `Output.object`) sale con `strict: true` por defecto. Meter los
// tool schemas aqui produciria ~30 falsos positivos y entrenaria al equipo a
// ignorar el guard. `src/lib/facts` es la excepcion explicita y esta en FASE A
// por decision previa.
//
// Allowlist (archivos excluidos — sus schemas NO van via experimental_output):
//   contracts/html-editor.ts  — output HTML libre, no JSON estructurado al LLM
//
// Refs: Wave 4.F1 (nullable().optional() bug), Wave 4.F2 (.default([]) bug),
//       Wave 5.A1 + A3 audit findings, auditoria integral 2026-08.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = join(__dirname, '..');

/** Directorios cuyo contenido completo debe cumplir strict mode (FASE A). */
export const SCAN_DIRS = [
  'src/lib/agents/financial/contracts',
  // Hechos del negocio: `registrarHechoInputSchema` es input de tool → va al LLM.
  'src/lib/facts',
];

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

/** Directorios que nunca se recorren. */
const SKIP_DIRS = new Set(['__tests__', '__fixtures__', 'node_modules', '.next', 'dist']);

// ---------------------------------------------------------------------------
// Helpers de lectura
// ---------------------------------------------------------------------------

export function collectTsFiles(dir, { includeTsx = false } = {}) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test directories — fixtures can use any Zod pattern.
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...collectTsFiles(full, { includeTsx }));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || (includeTsx && entry.name.endsWith('.tsx')))) {
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

/**
 * Devuelve el codigo del archivo sin comentarios, linea a linea (las lineas de
 * comentario quedan como ''). Se usa tanto para buscar violaciones como para
 * descubrir call sites: sin esto, una mencion en prosa del tipo
 * "el schema se enforza via Output.object({ schema: FooSchema })" dentro de un
 * `.prompt.ts` se contaba como call site real.
 */
export function stripComments(src) {
  const inBlock = { value: false };
  return src.split('\n').map((line) => {
    if (isInsideBlockComment(line, inBlock)) return '';
    return stripLineComment(line);
  });
}

// ---------------------------------------------------------------------------
// FASE B — descubrimiento de modulos de schema
// ---------------------------------------------------------------------------

/**
 * Identificador pasado como argumento `schema:`.
 *
 * El lookahead `(?![\w$.])` descarta accesos a propiedad (`schema: opts.schema`
 * en los wrappers genericos), que no nombran un modulo sino un parametro.
 */
const SCHEMA_ARG_RE = /\bschema:\s*([A-Za-z_$][\w$]*)(?![\w$.])/g;

const IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** Nombres locales que introduce una clausula `{ A, type B, C as D }`. */
function importedLocalNames(clause) {
  return clause
    .split(',')
    .map((token) => {
      const parts = token.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      return (parts[1] ?? parts[0]).trim();
    })
    .filter(Boolean);
}

/** Resuelve un import spec a un archivo real dentro de `src/`. */
function resolveModuleSpec(spec, fromFile, srcRoot) {
  let base;
  if (spec.startsWith('@/')) base = join(srcRoot, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // paquete externo — fuera del alcance del guard
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Recorre `src/` y devuelve los modulos que DEFINEN un schema usado como
 * structured output, mas los identificadores que no se pudieron resolver.
 *
 * Un identificador sin resolver NO se ignora en silencio: se reporta, porque
 * significa exactamente lo que este guard existe para evitar — un schema que
 * viaja al LLM sin guarda.
 */
export function discoverSchemaModules(repoRoot = REPO_ROOT) {
  const srcRoot = join(repoRoot, 'src');
  const modules = new Set();
  const unresolved = [];

  for (const file of collectTsFiles(srcRoot, { includeTsx: true })) {
    const code = stripComments(readFileSync(file, 'utf8')).join('\n');
    if (!/\bschema:\s*[A-Za-z_$]/.test(code)) continue;

    const idents = new Set([...code.matchAll(SCHEMA_ARG_RE)].map((m) => m[1]));

    for (const ident of idents) {
      // Parametro generico del wrapper (`<TSchema extends z.ZodTypeAny>`): no
      // nombra ningun modulo, el schema real lo aportan sus callers.
      if (new RegExp(`<\\s*${ident}\\s+extends\\b`).test(code)) continue;

      // Definido en el propio archivo (schema inline).
      if (new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${ident}\\b`).test(code)) {
        modules.add(file);
        continue;
      }

      let spec = null;
      for (const [, clause, from] of code.matchAll(IMPORT_RE)) {
        if (importedLocalNames(clause).includes(ident)) {
          spec = from;
          break;
        }
      }
      if (!spec) {
        unresolved.push({ file: relative(repoRoot, file), ident, reason: 'sin import que lo declare' });
        continue;
      }

      const target = resolveModuleSpec(spec, file, srcRoot);
      if (!target) {
        unresolved.push({ file: relative(repoRoot, file), ident, reason: `no se resolvio "${spec}"` });
        continue;
      }
      modules.add(target);
    }
  }

  return { modules: [...modules].sort(), unresolved };
}

// ---------------------------------------------------------------------------
// Escaneo
// ---------------------------------------------------------------------------

export function findViolations(filePath, repoRoot = REPO_ROOT) {
  const basename = filePath.split(/[\\/]/).pop();
  if (ALLOWLIST_BASENAMES.has(basename)) return [];

  const relPath = relative(repoRoot, filePath);
  const lines = stripComments(readFileSync(filePath, 'utf8'));
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    for (const { regex, label } of FORBIDDEN) {
      if (regex.test(lines[i])) {
        violations.push({ file: relPath, line: i + 1, label, text: lines[i].trim() });
        // One report per line (multiple patterns on same line are rare; first wins).
        break;
      }
    }
  }
  return violations;
}

/**
 * Ejecuta el guard completo. Devuelve `{ files, violations, unresolved }` sin
 * tocar `process.exit` — el CLI decide el exit code, el test lo inspecciona.
 */
export function runStrictModeLint(repoRoot = REPO_ROOT) {
  const fromDirs = SCAN_DIRS.flatMap((d) => collectTsFiles(join(repoRoot, d)));
  const { modules, unresolved } = discoverSchemaModules(repoRoot);

  const files = [...new Set([...fromDirs, ...modules])].sort();
  const violations = files.flatMap((f) => findViolations(f, repoRoot));

  return { files, violations, unresolved };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const { files, violations, unresolved } = runStrictModeLint();

  for (const u of unresolved) {
    console.warn(
      `[strict-mode] aviso: en ${u.file} el schema "${u.ident}" ${u.reason}; ` +
        `no se pudo verificar. Si define un contrato strict, muevelo a un modulo ` +
        `importable o agrega su carpeta a SCAN_DIRS.`,
    );
  }

  if (violations.length === 0) {
    console.log(`All strict-mode schemas pass (${files.length} archivos escaneados).`);
    process.exit(0);
  }

  console.error(`Strict mode violations detected (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.label}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    `\nFix: replace .optional() with .nullable(), remove .default(...),\n` +
      `replace z.record() with explicit z.object() shape, remove .passthrough() / .catchall().\n` +
      `If the schema does NOT go via experimental_output (Output.object), add its file\n` +
      `to ALLOWLIST_BASENAMES in scripts/lint-strict-mode.mjs.`,
  );
  process.exit(1);
}
