// ---------------------------------------------------------------------------
// ITEM 5 ORDEN DE CIERRE — Signatories tests
// ---------------------------------------------------------------------------
// Verifica que `signatoriesFromCompany` + `renderSignatureBlock` consumen los
// nuevos campos `legalRepresentativeId` / `fiscalAuditorTp` / `accountantTp`
// del shape legacy y renderizan el bloque de firma completo Ley 43/1990.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  renderSignatureBlock,
  signatoriesFromCompany,
} from '../signatories';

describe('signatoriesFromCompany — ITEM 5 ORDEN DE CIERRE (T.P. + C.C. legacy)', () => {
  it('caso canónico DARIO/MAURICIO/ANDREA: legacy strings + T.P. + C.C. → 3 slots completos', () => {
    const s = signatoriesFromCompany({
      legalRepresentative: 'DARIO PEREZ',
      legalRepresentativeId: '80.123.456',
      fiscalAuditor: 'MAURICIO VELEZ',
      fiscalAuditorTp: '12345-T',
      accountant: 'ANDREA GOMEZ',
      accountantTp: '67890-T',
    });

    expect(s.representanteLegal).toEqual({
      nombre: 'DARIO PEREZ',
      cedula: '80.123.456',
    });
    expect(s.revisorFiscal).toEqual({
      nombre: 'MAURICIO VELEZ',
      tp: '12345-T',
    });
    expect(s.contadorPublico).toEqual({
      nombre: 'ANDREA GOMEZ',
      tp: '67890-T',
    });
  });

  it('legacy sin T.P.: revisor/contador caen a null (no falsifica tarjetas)', () => {
    const s = signatoriesFromCompany({
      legalRepresentative: 'DARIO PEREZ',
      fiscalAuditor: 'MAURICIO VELEZ',
      // sin fiscalAuditorTp
      accountant: 'ANDREA GOMEZ',
      // sin accountantTp
    });

    expect(s.representanteLegal?.nombre).toBe('DARIO PEREZ');
    // Sin TP, los slots estructurados quedan null — el renderer pinta placeholder.
    expect(s.revisorFiscal).toBeNull();
    expect(s.contadorPublico).toBeNull();
  });

  it('shape canónico `signatories` prevalece sobre legacy', () => {
    const s = signatoriesFromCompany({
      signatories: {
        representanteLegal: { nombre: 'CANONICO RL', cedula: '11.111.111' },
        revisorFiscal: { nombre: 'CANONICO RF', tp: '99999-T' },
        contadorPublico: { nombre: 'CANONICO CP', tp: '88888-T' },
      },
      // Legacy strings — deben ser ignorados.
      legalRepresentative: 'LEGACY RL',
      legalRepresentativeId: '00.000.000',
      fiscalAuditor: 'LEGACY RF',
      fiscalAuditorTp: '00000-T',
      accountant: 'LEGACY CP',
      accountantTp: '00000-T',
    });

    expect(s.representanteLegal?.nombre).toBe('CANONICO RL');
    expect(s.representanteLegal?.cedula).toBe('11.111.111');
    expect(s.revisorFiscal?.tp).toBe('99999-T');
    expect(s.contadorPublico?.tp).toBe('88888-T');
  });
});

describe('renderSignatureBlock — ITEM 5 ORDEN DE CIERRE (firma con T.P. + C.C.)', () => {
  it('bloque completo: 3 firmas con T.P. + C.C. renderizadas Ley 43/1990', () => {
    const rendered = renderSignatureBlock({
      representanteLegal: { nombre: 'DARIO PEREZ', cedula: '80.123.456' },
      revisorFiscal: { nombre: 'MAURICIO VELEZ', tp: '12345-T' },
      contadorPublico: { nombre: 'ANDREA GOMEZ', tp: '67890-T' },
    });

    expect(rendered).toContain('DARIO PEREZ');
    expect(rendered).toContain('Representante Legal');
    expect(rendered).toContain('C.C. 80.123.456');

    expect(rendered).toContain('MAURICIO VELEZ');
    expect(rendered).toContain('Revisor Fiscal');
    expect(rendered).toContain('T.P. 12345-T de la JCC');

    expect(rendered).toContain('ANDREA GOMEZ');
    expect(rendered).toContain('Contador Publico');
    expect(rendered).toContain('T.P. 67890-T de la JCC');
  });

  it('placeholders cuando los slots son null (NO falsifica datos)', () => {
    const rendered = renderSignatureBlock(null);
    expect(rendered).toContain('Revisor Fiscal');
    expect(rendered).toContain('Contador Publico');
    expect(rendered).toContain('Representante Legal');
    // Lineas de placeholder Ley 43/1990
    expect(rendered).toContain('T.P. ____________ de la JCC');
  });
});
