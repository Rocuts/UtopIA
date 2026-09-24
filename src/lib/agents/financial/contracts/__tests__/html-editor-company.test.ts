// ---------------------------------------------------------------------------
// /api/financial-report/html — `company` tal como lo envía la UI (e2e-niif-13)
// ---------------------------------------------------------------------------
// PipelineWorkspace.handleGenerateHtml envía `company: backendReport.company`,
// el CompanyInfo que devuelve /niif (`context.company`): sin `signatories`,
// con los firmantes como strings legacy y las claves opcionales ausentes.
// CompanyInfoSchema exigía `signatories` presente y /html respondía 400 a toda
// llamada de la UI; con `comparativePeriod: ''` además "FiscalYear debe ser YYYY".
// Las pruebas de la ruta sustituyen HtmlEditorInputSchema por un mock y no lo
// detectaban: aquí se valida el campo con el esquema REAL.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { HtmlEditorInputSchema, normalizeHtmlCompanyInput } from '../html-editor';

const companySchema = HtmlEditorInputSchema.shape.company;

/** `context.company` de /niif tal como lo reenvía la UI (captura de la corrida e2e). */
const UI_COMPANY = {
  name: 'Demo Perdidas SAS',
  nit: '900123456-8',
  entityType: 'SAS',
  sector: 'Comercio',
  niifGroup: 2,
  fiscalPeriod: '2025',
  comparativePeriod: '2024',
  city: 'Cali',
  legalRepresentative: 'Ana Pérez',
  detectedPeriods: ['2024', '2025'],
};

describe('HtmlEditorInputSchema.company — contrato con la UI (e2e-niif-13)', () => {
  it('acepta el company de la UI sin `signatories` y deriva el representante legal', () => {
    const r = companySchema.safeParse(UI_COMPANY);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      name: 'Demo Perdidas SAS',
      fiscalPeriod: '2025',
      comparativePeriod: '2024',
      signatories: { representanteLegal: { nombre: 'Ana Pérez' }, revisorFiscal: null, contadorPublico: null },
    });
  });

  it('comparativo vacío y claves opcionales ausentes → null (no 400)', () => {
    const r = companySchema.safeParse({
      name: 'Demo SAS',
      nit: '900123456-8',
      fiscalPeriod: '2025',
      comparativePeriod: '',
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      entityType: null,
      sector: null,
      niifGroup: null,
      comparativePeriod: null,
      city: null,
      signatories: null,
    });
  });

  it('firmantes legacy con T.P. válida se estructuran; una T.P. mal formada no se inventa', () => {
    const r = companySchema.safeParse({
      ...UI_COMPANY,
      fiscalAuditor: 'Luis Gómez',
      fiscalAuditorTp: '12345-T',
      accountant: 'Marta Ruiz',
      accountantTp: 'sin tarjeta',
    });
    expect(r.success).toBe(true);
    expect(r.data?.signatories).toEqual({
      representanteLegal: { nombre: 'Ana Pérez' },
      revisorFiscal: { nombre: 'Luis Gómez', tp: '12345-T' },
      contadorPublico: null,
    });
  });

  it('la forma canónica `signatories` gana y sus slots ausentes quedan en null', () => {
    const r = companySchema.safeParse({
      ...UI_COMPANY,
      signatories: { representanteLegal: { nombre: 'Rep. Canónico' } },
    });
    expect(r.success).toBe(true);
    expect(r.data?.signatories).toEqual({
      representanteLegal: { nombre: 'Rep. Canónico' },
      revisorFiscal: null,
      contadorPublico: null,
    });
  });

  it('periodo "AAAA-MM" del corte parcial se lee como el año', () => {
    const r = companySchema.safeParse({ ...UI_COMPANY, fiscalPeriod: '2025-06', comparativePeriod: '2024-12' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ fiscalPeriod: '2025', comparativePeriod: '2024' });
  });

  it('sigue rechazando lo que no es un company (sin NIT)', () => {
    expect(companySchema.safeParse({ name: 'X', fiscalPeriod: '2025' }).success).toBe(false);
  });

  it('es idempotente (runHtmlEditor re-valida el input ya parseado)', () => {
    const once = normalizeHtmlCompanyInput(UI_COMPANY);
    expect(normalizeHtmlCompanyInput(companySchema.parse(once))).toEqual(companySchema.parse(once));
  });
});
