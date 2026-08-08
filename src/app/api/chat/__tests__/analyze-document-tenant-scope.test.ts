// ---------------------------------------------------------------------------
// La tool `analyze_document` del handler legacy debe acotar por tenant
// ---------------------------------------------------------------------------
// Hallazgo de la revisión adversarial del equipo RAG (2026-08-08), que
// contradijo la conclusión que el propio equipo había documentado.
//
// `searchDocuments(query, k, filter)` construye su cláusula de tenant así
// (vectorstore.ts:214-216):
//
//   filter?.workspaceId
//     ? sql`(workspace_id IS NULL OR workspace_id = ${filter.workspaceId}::uuid)`
//     : sql`workspace_id IS NULL`
//
// Es decir: SIN `workspaceId`, la búsqueda se restringe a `workspace_id IS NULL`.
// Combinado con `doc_type = 'user_upload'`, el conjunto resultante es
// EXACTAMENTE el pool de uploads huérfanos —1.892 chunks en producción, medidos—
// que son documentos de OTROS clientes: balances de prueba y requerimientos DIAN.
//
// No era una fuga alcanzable en teoría: era una ruta de lectura dedicada. El
// camino orquestado (`tools/registry.ts:432`) ya pasaba `ctx.workspaceId`
// correctamente; el handler legacy no — el mismo patrón de duplicación sin
// sincronizar que la auditoría integral identificó como causa raíz.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

const ROUTE = path.resolve(process.cwd(), 'src/app/api/chat/route.ts');
const REGISTRY = path.resolve(process.cwd(), 'src/lib/agents/tools/registry.ts');

/**
 * Quita comentarios antes de escanear. Sin esto, la propia documentación de
 * este defecto —que cita la llamada defectuosa para explicarla— cuenta como una
 * llamada real y el test falla contra el código ya corregido.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Extrae las llamadas a `searchDocuments` que filtran por `user_upload`. */
function userUploadSearchCalls(source: string): string[] {
  const out: string[] = [];
  const re = /searchDocuments\([\s\S]{0,400}?\)/g;
  for (const match of stripComments(source).match(re) ?? []) {
    if (match.includes('user_upload')) out.push(match);
  }
  return out;
}

describe('analyze_document — acotamiento por tenant', () => {
  it('el handler legacy pasa workspaceId al recuperar el documento del cliente', () => {
    const calls = userUploadSearchCalls(fs.readFileSync(ROUTE, 'utf8'));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `searchDocuments con user_upload SIN workspaceId:\n${call}`).toContain(
        'workspaceId',
      );
    }
  });

  it('el camino orquestado sigue acotando igual — los dos no pueden divergir', () => {
    const calls = userUploadSearchCalls(fs.readFileSync(REGISTRY, 'utf8'));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('workspaceId');
  });

  it('`handleLegacy` recibe el workspace como parámetro explícito', () => {
    // Si el parámetro desaparece, la tool vuelve a cerrar sobre `undefined` sin
    // que ningún tipo lo impida: `workspaceId?: string` es opcional en
    // `SearchFilters`.
    const source = stripComments(fs.readFileSync(ROUTE, 'utf8'));
    const signature = source.slice(
      source.indexOf('async function handleLegacy('),
      source.indexOf(') {', source.indexOf('async function handleLegacy(')),
    );
    expect(signature).toContain('workspaceId');
  });
});
