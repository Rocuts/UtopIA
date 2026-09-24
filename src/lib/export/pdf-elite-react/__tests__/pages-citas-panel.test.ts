// reportes-export-04 — panel derecho del ESF/ERI tomaba la columna del periodo
// ANTERIOR y anteponía "+ " a cifras entre paréntesis.
// reportes-export-16 — citas normativas erróneas (NIIF 1.10, NIIF 5.36, NIIF 7,
// NIIF 6.20, IFRS 18) en las páginas del PDF editorial.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAbstractionGroups, panelFigure } from '../pages/StatementsPages';
import { statementCitations } from '../../statement-presentation';
import type { ParsedTable } from '../types';

describe('reportes-export-04 — panel derecho usa el periodo actual y el signo real', () => {
  const table: ParsedTable = {
    headers: ['Concepto', '2025', '2024'],
    rows: [
      { account: 'INGRESOS', cells: [] },
      { account: '41 — Ventas', cells: ['$1.000,00', '$800,00'] },
      { account: '4175 — Devoluciones', cells: ['($100,00)', '($50,00)'] },
      { account: 'PÉRDIDA NETA DEL PERÍODO', cells: ['($2.000,00)', '$300,00'], emphasis: 'total' },
    ],
  };

  it('la cifra del panel es cells[0] (periodo actual)', () => {
    expect(panelFigure(table.rows[1])).toBe('$1.000,00');
  });

  it('los grupos no anteponen "+" y conservan los paréntesis', () => {
    const [g] = buildAbstractionGroups(table);
    expect(g.rows).toEqual(['$1.000,00', '($100,00)']);
    expect(g.groupTotal).toBe('($2.000,00)');
    expect(g.rows.join(' ')).not.toMatch(/\+/);
  });
});

describe('reportes-export-16 — citas según el grupo NIIF', () => {
  it('Grupo 2 cita Secciones de NIIF para las PYMES', () => {
    expect(statementCitations('balance', 2)).toEqual(['NIIF PYMES Secc. 4']);
    expect(statementCitations('income', 2)).toEqual(['NIIF PYMES Secc. 5']);
    expect(statementCitations('cashFlow', 2)).toEqual(['NIIF PYMES Secc. 7']);
    expect(statementCitations('equity', 2)).toEqual(['NIIF PYMES Secc. 6']);
  });

  it('Grupo 1 cita NIC 1 y NIC 7 (no "NIIF 7")', () => {
    expect(statementCitations('cashFlow', 1)).toEqual(['NIC 7']);
    expect(statementCitations('balance', 1)).toEqual(['NIC 1.54']);
    expect(statementCitations('equity', 1)).toEqual(['NIC 1.106']);
  });

  it('sin grupo declarado usa el par que prescribe la spec v10.1', () => {
    expect(statementCitations('cashFlow', null)).toEqual(['NIIF PYMES Secc. 7', 'NIC 7']);
  });

  it('ninguna página del PDF editorial cita NIIF 1/5/6/7 o IFRS 18 como base de los estados', () => {
    const dir = path.join(__dirname, '..', 'pages');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      for (const bad of [/label[=:]\s*["']NIIF 1\.10["']/, /["']NIIF 5\.36["']/, /["']NIIF 6\.20["']/, /label[=:]\s*["']NIIF 7["']/, /label[=:]\s*["']IFRS 18["']/, /label[=:]\s*["']NIIF 9["']/]) {
        if (bad.test(src)) offenders.push(`${f}: ${bad}`);
      }
      if (/Flujo de caja libre del período|\(UODI\)/.test(src)) offenders.push(`${f}: subtítulo de otra métrica`);
    }
    expect(offenders).toEqual([]);
  });
});
