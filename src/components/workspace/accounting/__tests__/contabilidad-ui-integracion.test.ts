// ---------------------------------------------------------------------------
// UI de contabilidad — integración IW5b (auditoría 2026-09-24)
// ---------------------------------------------------------------------------
//   · contab-nomina-01: el original de un reverso queda status='posted' con
//     reversedByEntryId; el badge «Reversado» debe salir de ese campo.
//   · contab-nomina-04: el cierre anual es una corrida del workflow sobre el
//     período 13; el cierre mensual no genera asiento de cierre.
//   · reportes-export-06: débito/crédito con parseCOPStrict; entrada
//     inválida = error visible y envío bloqueado (nunca el "0" de parseCOP).
// El entorno de pruebas es node (sin DOM): las decisiones viven en módulos
// puros y los componentes se verifican por su código fuente.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import { displayEntryStatus } from '../entry-status';
import { amountForTotals, findAmountIssues, parseLineAmount } from '../journal-amounts';
import {
  closeRequestFor,
  periodMonthLabel,
  periodMonthOptions,
} from '../period-close';
import { dict } from '@/lib/i18n/dictionaries';

const DIR = path.resolve(process.cwd(), 'src/components/workspace/accounting');
const src = (f: string) =>
  fs
    .readFileSync(path.join(DIR, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('badge «Reversado» (contab-nomina-01)', () => {
  it('se deriva de reversedByEntryId aunque el estado sea posted', () => {
    expect(displayEntryStatus({ status: 'posted', reversedByEntryId: 'rev-1' })).toBe('reversed');
    expect(displayEntryStatus({ status: 'posted', reversedByEntryId: null })).toBe('posted');
    expect(displayEntryStatus({ status: 'draft' })).toBe('draft');
    expect(displayEntryStatus({ status: 'voided', reversedByEntryId: undefined })).toBe('voided');
  });

  for (const f of ['LedgerView.tsx', 'ContabilidadLanding.tsx']) {
    it(`${f} pinta el badge con displayEntryStatus, no con status crudo`, () => {
      const s = src(f);
      expect(s).toMatch(/displayEntryStatus\(/);
      expect(s).toMatch(/reversedByEntryId/);
      expect(s).not.toMatch(/STATUS_BADGE\[\w+\.status\]/);
    });
  }
});

describe('montos de asientos con parseCOPStrict (reportes-export-06)', () => {
  it('interpreta es-CO y rechaza lo ambiguo o negativo', () => {
    expect(parseLineAmount('1.234.567,89')).toBe('1234567.89');
    expect(parseLineAmount('850.000')).toBe('850000');
    expect(parseLineAmount('')).toBe('0');
    expect(parseLineAmount('1,234,567')).toBeNull();
    expect(parseLineAmount('12.3456')).toBeNull();
    expect(parseLineAmount('-5')).toBeNull();
    expect(amountForTotals('abc')).toBe('0');
  });

  it('reporta la línea (1-based) con el monto inválido', () => {
    expect(
      findAmountIssues([
        { debit: '1.000', credit: '' },
        { debit: '', credit: '1,000.50' },
        { debit: '(5)', credit: '' },
      ]),
    ).toEqual([
      { line: 2, kind: 'invalid' },
      { line: 3, kind: 'negative' },
    ]);
  });

  it('JournalEntryForm no usa el contrato legado de parseCOP y bloquea ambos envíos', () => {
    const s = src('JournalEntryForm.tsx');
    expect(s).not.toMatch(/\bparseCOP\(/);
    expect(s).toMatch(/findAmountIssues\(/);
    expect(s).toMatch(/parseLineAmount\(/);
    // Borrador y posteo quedan deshabilitados con montos inválidos.
    const disabled = s.match(/disabled=\{[^}]*\}/g) ?? [];
    expect(disabled.filter((d) => d.includes('amountIssues.length')).length).toBeGreaterThanOrEqual(2);
    expect(s).toMatch(/validationAmountInvalid/);
    expect(s).toMatch(/role="alert"/);
  });

  it('los textos del error existen en es y en', () => {
    for (const lang of ['es', 'en'] as const) {
      expect(dict[lang].accounting.validationAmountInvalid).toContain('{n}');
      expect(dict[lang].accounting.validationAmountNegative).toContain('{n}');
    }
  });
});

describe('cierre anual en el período 13 (contab-nomina-04)', () => {
  it('el selector de apertura ofrece el mes 13', () => {
    const es = periodMonthOptions('es');
    expect(es).toHaveLength(13);
    expect(es[12]).toEqual({ value: 13, label: 'Cierre anual (13) — 31 dic' });
    expect(periodMonthOptions('en')[12].label).toMatch(/Year-end close/);
    expect(periodMonthLabel(13, 'es')).toBe('Cierre anual');
    expect(periodMonthLabel(12, 'es')).toBe('Diciembre');
  });

  it('el período 13 se cierra con el workflow; los mensuales con el cierre simple', () => {
    expect(closeRequestFor({ id: 'p13', month: 13 })).toEqual({
      kind: 'annual_workflow',
      url: '/api/accounting/close/start',
      body: { periodId: 'p13' },
    });
    expect(closeRequestFor({ id: 'p6', month: 6 })).toEqual({
      kind: 'monthly',
      url: '/api/accounting/periods/close',
      body: { periodId: 'p6' },
    });
  });

  it('OpenPeriodModal y ClosePeriodConfirmDialog usan esas decisiones', () => {
    expect(src('OpenPeriodModal.tsx')).toMatch(/periodMonthOptions\(/);
    const dialog = src('ClosePeriodConfirmDialog.tsx');
    expect(dialog).toMatch(/closeRequestFor\(/);
    expect(dialog).not.toMatch(/'\/api\/accounting\/periods\/close'/);
    expect(src('PeriodsManagementView.tsx')).toMatch(/annualCloseHint/);
  });

  it('el texto del cierre mensual no promete asiento de cierre', () => {
    for (const lang of ['es', 'en'] as const) {
      const p = dict[lang].accounting.periods;
      expect(p.monthlyCloseBody).not.toMatch(/genera asientos de cierre|generates closing entries/i);
      expect(p.annualCloseBody).toMatch(/360505/);
      expect(p.annualCloseBody).toMatch(/361005/);
    }
  });
});

describe('claves i18n de la tarjeta ERP (ingesta-18)', () => {
  it('existen en es y en con los marcadores', () => {
    expect(dict.es.erp.recordsRead).toBe('{n} registros leídos desde {provider}');
    expect(dict.en.erp.recordsRead).toBe('{n} records read from {provider}');
    expect(dict.es.erp.notPersistedNote).toMatch(/todavía no se guardan/);
    expect(dict.en.erp.notPersistedNote).toMatch(/not stored or used in reports yet/);
    expect([dict.es.erp.close, dict.en.erp.close]).toEqual(['Cerrar', 'Close']);
    expect([dict.es.erp.lastRead, dict.en.erp.lastRead]).toEqual(['Última lectura', 'Last read']);
  });
});
