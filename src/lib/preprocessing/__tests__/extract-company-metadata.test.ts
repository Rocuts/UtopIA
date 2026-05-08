import { describe, expect, it } from 'vitest';

import { extractCompanyMetadata } from '../trial-balance';

describe('extractCompanyMetadata — Pulido NIIF PYME Grupo 2', () => {
  it('detecta NIT con DV explícito en formato canónico', () => {
    const text = `
      EMPRESA TEST
      NIT: 901.714.014-6
      Periodo: 2025
    `;
    const meta = extractCompanyMetadata(text);
    expect(meta.nitFromFile).toBe('901.714.014-6');
    expect(meta.nitBodyDigits).toBe('901714014');
    expect(meta.nitCheckDigit).toBe('6');
  });

  it('detecta razón social con label explícito', () => {
    const text = `
      Razón Social: Grupo Empresarial 2 Tres SAS
      NIT: 901714014-6
    `;
    const meta = extractCompanyMetadata(text);
    expect(meta.razonSocialFromFile).toBe('Grupo Empresarial 2 Tres SAS');
  });

  it('detecta razón social por sufijo societario en línea adyacente al NIT', () => {
    const text = `
      GRUPO EMPRESARIAL 2 TRES S.A.S.
      NIT: 901714014-6
      Periodo: 2025
    `;
    const meta = extractCompanyMetadata(text);
    expect(meta.nitFromFile).toBe('901.714.014-6');
    expect(meta.razonSocialFromFile).toMatch(/GRUPO EMPRESARIAL 2 TRES/i);
  });

  it('texto sin NIT ni razón social → ambos null', () => {
    const text = `
      codigo,nombre,saldo
      1,Activo,1000000
    `;
    const meta = extractCompanyMetadata(text);
    expect(meta.nitFromFile).toBeNull();
    expect(meta.razonSocialFromFile).toBeNull();
  });

  it('null/undefined/empty input → todos null', () => {
    expect(extractCompanyMetadata('').nitFromFile).toBeNull();
    expect(extractCompanyMetadata('').razonSocialFromFile).toBeNull();
  });

  it('NIT con espacios en el formato (e.g. "NIT 901 714 014-6")', () => {
    const text = `NIT 901 714 014-6`;
    const meta = extractCompanyMetadata(text);
    expect(meta.nitFromFile).toBe('901.714.014-6');
  });

  it('sólo escanea las primeras 100 líneas crudas (no agarra basura del cuerpo)', () => {
    // Padding > 100 líneas crudas: el NIT cae fuera de la ventana de header.
    const padding = '\n'.repeat(120);
    const text =
      padding +
      'NIT: 999999999-9\n' +
      'Razón Social: Empresa Falsa\n';
    const meta = extractCompanyMetadata(text);
    expect(meta.nitFromFile).toBeNull();
  });
});
