// ---------------------------------------------------------------------------
// Cobertura del guard de strict mode Zod
// ---------------------------------------------------------------------------
// ESTADO ANTERIOR (auditoria 2026-08): `scripts/lint-strict-mode.mjs` escaneaba
// DOS directorios fijos — `financial/contracts` y `facts`. Todo schema strict
// que viviera fuera quedaba sin guarda, y varios viven fuera: el classifier, la
// extraccion Vision del modulo Pyme, el categorizador, los modulos del Agente
// Fiscal del Escudo y las tools de chat.
//
// El fallo es silencioso y ocurre en produccion, no en CI: un `.optional()` en
// un schema que viaja como `response_format: json_schema` con `strict: true`
// hace que OpenAI RECHACE la peticion en tiempo de ejecucion. El guard verde
// daba una falsa sensacion de cobertura.
//
// Ahora la cobertura se DESCUBRE: se resuelve el modulo de cada identificador
// pasado como argumento `schema:`. Este test fija esa propiedad — que los
// modulos que hoy quedaban fuera esten dentro — y que el descubrimiento
// funcione sobre un arbol sintetico, no solo por casualidad sobre este repo.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { discoverSchemaModules, runStrictModeLint } from '../../scripts/lint-strict-mode.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

/** Rutas relativas de los modulos descubiertos, con separador POSIX. */
function discoveredRelPaths(): string[] {
  const { modules } = discoverSchemaModules(REPO_ROOT) as { modules: string[] };
  return modules.map((m) => m.slice(REPO_ROOT.length + 1));
}

describe('cobertura descubierta sobre el repo real', () => {
  it.each([
    // Structured output fuera de `contracts/` — todos quedaban sin guarda.
    'src/lib/agents/classifier.ts',
    'src/lib/agents/pyme/extraction/schemas.ts',
    'src/lib/agents/pyme/agents/categorizer.ts',
    'src/lib/agents/financial/escudo-survival/fiscal-agent/schemas.ts',
    'src/lib/agents/financial/escudo-survival/orchestrator.ts',
    'src/lib/tools/risk-assessor.ts',
    'src/lib/tools/document-analyzer.ts',
    'src/lib/tools/dian-response-generator.ts',
  ])('%s entra al escaneo', (rel) => {
    expect(discoveredRelPaths()).toContain(rel);
  });

  it('los contratos financieros siguen cubiertos', () => {
    const files = (runStrictModeLint(REPO_ROOT) as { files: string[] }).files;
    const rels = files.map((f) => f.slice(REPO_ROOT.length + 1));
    expect(rels).toContain('src/lib/agents/financial/contracts/niif-report.ts');
    expect(rels).toContain('src/lib/agents/financial/contracts/strategy-report.ts');
  });

  it('el repo esta limpio con la cobertura ampliada', () => {
    const { violations } = runStrictModeLint(REPO_ROOT) as {
      violations: Array<{ file: string; line: number; label: string }>;
    };
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe('descubrimiento sobre un arbol sintetico', () => {
  it('sigue el import y detecta la violacion en el modulo del schema', () => {
    const root = mkdtempSync(join(tmpdir(), 'strict-mode-'));
    try {
      const agents = join(root, 'src', 'agents');
      mkdirSync(agents, { recursive: true });

      // Modulo de schema en una carpeta que NINGUN SCAN_DIRS cubre.
      writeFileSync(
        join(agents, 'nuevo-schema.ts'),
        [
          "import { z } from 'zod';",
          'export const NuevoReporteSchema = z.object({',
          '  titulo: z.string(),',
          '  nota: z.string().optional(),',
          '});',
        ].join('\n'),
      );

      // Call site que lo usa como structured output.
      writeFileSync(
        join(agents, 'nuevo-agente.ts'),
        [
          "import { Output, generateText } from 'ai';",
          "import { NuevoReporteSchema } from './nuevo-schema';",
          'export async function run(model: unknown) {',
          '  return generateText({',
          '    model,',
          '    experimental_output: Output.object({ schema: NuevoReporteSchema }),',
          '  });',
          '}',
        ].join('\n'),
      );

      const { violations } = runStrictModeLint(root) as {
        violations: Array<{ file: string; label: string }>;
      };

      expect(violations).toHaveLength(1);
      expect(violations[0].label).toBe('.optional()');
      expect(violations[0].file.replace(/\\/g, '/')).toBe('src/agents/nuevo-schema.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('no confunde una mencion en comentario con un call site real', () => {
    const root = mkdtempSync(join(tmpdir(), 'strict-mode-'));
    try {
      const agents = join(root, 'src', 'agents');
      mkdirSync(agents, { recursive: true });

      // El prompt SOLO menciona el schema en prosa. No debe arrastrar nada.
      writeFileSync(
        join(agents, 'algo.prompt.ts'),
        [
          '// El output se enforza via Output.object({ schema: OtroSchema }),',
          '// no en prosa.',
          "export const PROMPT = 'hola';",
        ].join('\n'),
      );

      const { unresolved } = discoverSchemaModules(root) as { unresolved: unknown[] };
      expect(unresolved).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
