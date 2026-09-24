// ---------------------------------------------------------------------------
// Numeración determinista de las notas (spec v2.1 Corrección 6)
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (niif-contrato-19): `StatementNoteSchema.ref` es texto
// libre y ninguna regla controlaba saltos ni duplicados entre las notas del
// ESF, el ERI, el ECP y las notas técnicas; con `ref = null` el renderer
// reiniciaba "Nota 1" en cada estado. Ahora el renderer numera 1..N global y
// devuelve el JSON numerado (el mismo que imprimen el PDF y el Excel).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import { toNiifAnalysisResult } from '../agents/renderer';
import { numberStatementNotes } from '@/lib/export/statement-presentation';
import type { NiifReportJson } from '../contracts/niif-report';

const note = (ref: string | null, body: string) => ({ ref, norma: null, body });

function conNotas(): NiifReportJson {
  const base = makeCoherentNiifReport();
  return {
    ...base,
    balanceSheet: { ...base.balanceSheet, notes: [note(null, 'Efectivo'), note('Nota 3', 'Deudores')] },
    incomeStatement: { ...base.incomeStatement, notes: [note('Nota 1', 'Ingresos; ver Nota 3.')] },
    equityChanges: { ...base.equityChanges, notes: [note(null, 'Patrimonio')] },
    technicalNotes: [note('Nota 7 — Políticas', 'Políticas'), note('*', 'Marca al pie'), note(null, 'Impuestos')],
  };
}

describe('niif-contrato-19 — numeración global y secuencial de notas', () => {
  it('numera 1..N sin saltos ni duplicados en el orden ESF → ERI → ECP → técnicas', () => {
    const { json } = numberStatementNotes(conNotas());
    expect(json.balanceSheet.notes.map((n) => n.ref)).toEqual(['Nota 1', 'Nota 2']);
    expect(json.incomeStatement.notes.map((n) => n.ref)).toEqual(['Nota 3']);
    expect(json.equityChanges.notes.map((n) => n.ref)).toEqual(['Nota 4']);
    expect(json.technicalNotes.map((n) => n.ref)).toEqual(['Nota 5 — Políticas', '*', 'Nota 6']);
    // La referencia cruzada al antiguo "Nota 3" (Deudores) sigue a su nota.
    expect(json.incomeStatement.notes[0].body).toBe('Ingresos; ver Nota 2.');
  });

  it('es idempotente', () => {
    const once = numberStatementNotes(conNotas()).json;
    const twice = numberStatementNotes(once);
    expect(twice.changed).toBe(0);
    expect(twice.json).toBe(once);
  });

  it('el Markdown y el JSON que devuelve el renderer llevan la misma numeración, sin "Nota 1" repetida', () => {
    const r = toNiifAnalysisResult(conNotas());
    const refs = r.fullContent.match(/\*\*Nota \d+/g) ?? [];
    expect(refs).toEqual(['**Nota 1', '**Nota 2', '**Nota 3', '**Nota 4', '**Nota 5', '**Nota 6']);
    expect(r.json!.technicalNotes[2].ref).toBe('Nota 6');
  });
});
