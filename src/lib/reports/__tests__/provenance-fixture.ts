// ---------------------------------------------------------------------------
// Fixtures de las pruebas de procedencia servidor (fase 2, P1)
// ---------------------------------------------------------------------------
// - CSV con identidad en el encabezado y un informe NIIF coherente con él
//   (`makeExportableReport`, Activo $10.000): /consolidate lo declara emitible
//   y el gate de exportación no encuentra bloqueos.
// - `makeReportsTableFake`: almacenamiento controlado de la tabla `reports`.
//   Evalúa las condiciones REALES que construye el store (renderizadas con el
//   dialecto de Postgres de drizzle), así que si el store dejara de filtrar por
//   workspace o por kind la prueba lo detecta. Simula `jsonb` con un viaje
//   JSON. No sustituye a Postgres (ver *.db.test.ts) ni prueba la resolución
//   real de sesión: el workspace se fija en cada prueba.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import { withCoherentParts } from './coherent-parts';

export const PROVENANCE_CSV = [
  'Razón social: EMPRESA PRUEBA SAS',
  'NIT: 900.123.456-8',
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,1700',
  '130505,Clientes,Auxiliar,1,8300',
  '220505,Proveedores,Auxiliar,1,4000',
  '311505,Capital,Auxiliar,1,3000',
  '330505,Reserva legal,Auxiliar,1,500',
  '370505,Utilidades acumuladas,Auxiliar,1,500',
  '360505,Utilidad del ejercicio,Auxiliar,1,2000',
  '410505,Ventas,Auxiliar,1,7000',
  '510505,Sueldos,Auxiliar,1,2000',
  '530505,Intereses,Auxiliar,1,1000',
  '613505,CMV,Auxiliar,1,2000',
].join('\n');

export const PROVENANCE_COMPANY = {
  name: 'Empresa Prueba SAS',
  nit: '900123456-8',
  fiscalPeriod: '2025',
  entityType: 'SAS',
  niifGroup: 2,
};

/**
 * Partes I–III coherentes con `PROVENANCE_CSV`. Desde I3 el servidor
 * re-renderiza el Markdown desde el JSON de cada Parte (y sella la Parte sin
 * JSON válido): las Partes II y III llevan JSON del contrato coherente con el
 * balance, y la Parte I la declaración de impracticabilidad de comparativos
 * (V15) en sus notas técnicas; la TTD (V10) está en la nota de impuestos. Los
 * textos sueltos de abajo son lo que "envía el navegador": el servidor los
 * descarta. `csv` fija el balance contra el que se arman las Partes II y III
 * (el JSON NIIF es siempre el de Activo $10.000).
 */
export function makeProvenanceParts(csv: string = PROVENANCE_CSV) {
  const read = preprocessUploadedTrialBalanceText(csv);
  if (read.kind !== 'ok') throw new Error('balance del fixture ilegible');
  const r = withCoherentParts(
    { ...makeExportableReport(), company: { ...PROVENANCE_COMPANY, niifGroup: 2 } },
    read.preprocessed,
    { impracticable: true },
  );
  r.niifAnalysis.fullContent = [
    '## Estado de Situación Financiera',
    '| Concepto | 2025 |',
    '|---|---|',
    '| Total Activo | $10.000 |',
    '| Total Pasivo | $4.000 |',
    '| Total Patrimonio | $6.000 |',
    '',
    'Comparativos impracticables (NIIF para PYMES §3.14 y §10.21).',
  ].join('\n');
  r.strategicAnalysis.fullContent =
    'Análisis estratégico. TTD (parágrafo 6 del art. 240 E.T.): N/D sin ID/UD verificados.';
  r.governance.fullContent = 'Acta de asamblea ordinaria.';
  return {
    niifAnalysis: r.niifAnalysis,
    strategicAnalysis: r.strategicAnalysis,
    governance: r.governance,
  };
}

export function consolidateBody(extra: Record<string, unknown> = {}) {
  return {
    rawData: PROVENANCE_CSV,
    company: PROVENANCE_COMPANY,
    language: 'es',
    reportParts: makeProvenanceParts(),
    ...extra,
  };
}

export interface FakeReportRow {
  id: string;
  workspaceId: string;
  kind: string;
  title: string | null;
  data: unknown;
  controlTotals: unknown;
}

const COLUMN_TO_FIELD: Record<string, keyof FakeReportRow> = {
  id: 'id',
  workspace_id: 'workspaceId',
  kind: 'kind',
  title: 'title',
};

/** Fake mínimo de `getDb()` para la tabla `reports` (insert/select/update). */
export function makeReportsTableFake() {
  const rows: FakeReportRow[] = [];
  const dialect = new PgDialect();
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const matcher = (cond: SQL | undefined) => {
    if (!cond) return () => true;
    const q = dialect.sqlToQuery(cond);
    queries.push({ sql: q.sql, params: q.params });
    const clauses = [...q.sql.matchAll(/"reports"\."(\w+)" = \$(\d+)/g)].map((m) => ({
      field: COLUMN_TO_FIELD[m[1]],
      value: q.params[Number(m[2]) - 1],
    }));
    if (clauses.some((c) => !c.field)) throw new Error(`columna no soportada en el fake: ${q.sql}`);
    return (row: FakeReportRow) => clauses.every((c) => row[c.field] === c.value);
  };

  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        let inserted: FakeReportRow | null = null;
        const doInsert = async () => {
          if (!inserted) {
            inserted = {
              id: randomUUID(),
              workspaceId: String(v.workspaceId),
              kind: String(v.kind),
              title: (v.title as string | null) ?? null,
              // jsonb: viaje JSON (bigint no llega: el store guarda JSON-safe).
              data: JSON.parse(JSON.stringify(v.data)),
              controlTotals:
                v.controlTotals === undefined ? null : JSON.parse(JSON.stringify(v.controlTotals)),
            };
            rows.push(inserted);
          }
          return [{ id: inserted.id }];
        };
        return {
          returning: doInsert,
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            doInsert().then(res, rej),
        };
      },
    }),
    select: (projection?: Record<string, unknown>) => ({
      from: () => {
        let pred: (r: FakeReportRow) => boolean = () => true;
        const chain = {
          where: (cond: SQL) => {
            pred = matcher(cond);
            return chain;
          },
          orderBy: () => chain,
          limit: async (n: number) =>
            rows
              .filter(pred)
              .slice(0, n)
              .map((r) =>
                projection
                  ? Object.fromEntries(
                      Object.keys(projection).map((k) => [k, (r as unknown as Record<string, unknown>)[k]]),
                    )
                  : r,
              ),
        };
        return chain;
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: SQL) => {
          const pred = matcher(cond);
          const apply = async () => {
            const hit = rows.filter(pred);
            for (const r of hit) Object.assign(r, JSON.parse(JSON.stringify(patch)));
            return hit.map((r) => ({ id: r.id }));
          };
          return { returning: apply, then: (res: (v: unknown) => unknown) => apply().then(res) };
        },
      }),
    }),
  };
  return { db, rows, queries };
}
