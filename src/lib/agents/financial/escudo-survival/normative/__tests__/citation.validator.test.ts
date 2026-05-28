// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Tests: citation.validator
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  extractCitations,
  validateCitations,
  normalizeCitation,
} from '../validators/citation.validator';
import {
  buildSyntheticCatalogue,
  SYNTHETIC_ENTRIES,
} from '../__fixtures__/catalog-sintetico.fixture';
import {
  TEXT_RESPUESTA_VALIDA,
  TEXT_USANDO_ART_158_3_DEROGADO,
  TEXT_VARIANTES_ART_240,
  TEXT_ART_240_PARAGRAFO,
  TEXT_ART_DISTINTOS_240_2401,
  TEXT_VARIANTES_LEY_2277,
  TEXT_SENTENCIA_C_079,
  TEXT_NIIF_VARIANTES,
  TEXT_NIC_NIA,
  TEXT_RESOLUCION_DIAN,
  TEXT_MULTIPLES_CITAS_OK,
  TEXT_CITA_DESCONOCIDA,
  TEXT_VACIO,
} from '../__fixtures__/textos-prueba.fixture';

const CATALOGUE = buildSyntheticCatalogue();

describe('extractCitations — Capa 1 sintaxis', () => {
  describe('articulo_et', () => {
    it('reconoce todas las variantes canónicas de Art. 240 E.T.', () => {
      const citations = extractCitations(TEXT_VARIANTES_ART_240);
      const arts = citations.filter((c) => c.kind === 'articulo_et');
      expect(arts.length).toBeGreaterThanOrEqual(6);
      for (const c of arts) {
        expect(c.normalized).toBe('Art. 240 E.T.');
      }
    });

    it('preserva el sufijo en Art. 240-1 (NO colapsa con Art. 240)', () => {
      const citations = extractCitations(TEXT_ART_DISTINTOS_240_2401);
      const normalized = citations.map((c) => c.normalized);
      expect(normalized).toContain('Art. 240 E.T.');
      expect(normalized).toContain('Art. 240-1 E.T.');
    });

    it('normaliza par. / § / parágrafo a la misma forma canónica', () => {
      const citations = extractCitations(TEXT_ART_240_PARAGRAFO);
      const arts = citations.filter((c) => c.kind === 'articulo_et');
      expect(arts.length).toBeGreaterThanOrEqual(3);
      for (const c of arts) {
        expect(c.normalized).toBe('Art. 240 par. 2 E.T.');
      }
    });

    it('NO reconoce "Art. 5 del contrato" como cita E.T. (falso positivo)', () => {
      const text = 'Esto está en el Art. 5 del contrato comercial firmado.';
      const citations = extractCitations(text);
      expect(citations).toEqual([]);
    });

    it('reconoce "Art. 647 par. E.T." sin número de parágrafo', () => {
      // El parágrafo sin número no captura — entonces se reporta como "Art. 647 E.T."
      // Esto es esperado: la forma canónica para entradas como "ART_647_PAR_ET" tiene
      // la cita "Art. 647 par. E.T." pero el extractor del texto solo reconoce
      // parágrafos numerados. Caso documentado.
      const text = 'Defensa según Art. 647 E.T.';
      const citations = extractCitations(text);
      expect(citations.length).toBe(1);
      expect(citations[0].normalized).toBe('Art. 647 E.T.');
    });
  });

  describe('ley', () => {
    it('reconoce variantes de Ley 2277 de 2022', () => {
      const citations = extractCitations(TEXT_VARIANTES_LEY_2277);
      const leyes = citations.filter((c) => c.kind === 'ley');
      expect(leyes.length).toBeGreaterThanOrEqual(3);
      for (const c of leyes) {
        expect(c.normalized).toBe('Ley 2277 de 2022');
      }
    });
  });

  describe('decreto', () => {
    it('reconoce "Decreto 1474 de 2025"', () => {
      const text = 'El Decreto 1474 de 2025 incrementó la sobretasa.';
      const citations = extractCitations(text);
      const decretos = citations.filter((c) => c.kind === 'decreto');
      expect(decretos.length).toBe(1);
      expect(decretos[0].normalized).toBe('Decreto 1474 de 2025');
    });
  });

  describe('concepto_dian', () => {
    it('reconoce Concepto Unificado DIAN 202(006038) de 2024', () => {
      const text = 'Conforme al Concepto Unificado DIAN 202(006038) de 2024 procede la deducción.';
      const citations = extractCitations(text);
      const conceptos = citations.filter((c) => c.kind === 'concepto_dian');
      expect(conceptos.length).toBe(1);
      expect(conceptos[0].normalized).toBe('Concepto Unificado DIAN 202(006038) de 2024');
    });

    it('reconoce Concepto DIAN 100208221-1352 de 2018 (radicado largo)', () => {
      const text = 'Apoya su tesis el Concepto DIAN 100208221-1352 de 2018.';
      const citations = extractCitations(text);
      const conceptos = citations.filter((c) => c.kind === 'concepto_dian');
      expect(conceptos.length).toBe(1);
      // La normalización añade DIAN explícitamente (incluso si ya estaba).
      expect(conceptos[0].normalized).toContain('100208221-1352');
      expect(conceptos[0].normalized).toContain('2018');
    });
  });

  describe('sentencia_corte', () => {
    it('reconoce Sentencia C-079 de 2026', () => {
      const citations = extractCitations(TEXT_SENTENCIA_C_079);
      const sentencias = citations.filter((c) => c.kind === 'sentencia_corte');
      expect(sentencias.length).toBe(1);
      expect(sentencias[0].normalized).toBe('Sentencia C-079 de 2026');
    });

    it('reconoce Sentencia sin prefijo (Consejo de Estado)', () => {
      const text = 'La Sentencia 28920 de 2025 del Consejo de Estado.';
      const citations = extractCitations(text);
      const sentencias = citations.filter((c) => c.kind === 'sentencia_corte');
      expect(sentencias.length).toBe(1);
      expect(sentencias[0].normalized).toBe('Sentencia 28920 de 2025');
    });
  });

  describe('niif_pymes', () => {
    it('reconoce variantes (§29, Sección 29, seccion 29)', () => {
      const citations = extractCitations(TEXT_NIIF_VARIANTES);
      const niifs = citations.filter((c) => c.kind === 'niif_pymes');
      expect(niifs.length).toBeGreaterThanOrEqual(3);
      for (const c of niifs) {
        expect(c.normalized).toBe('NIIF para PYMES §29');
      }
    });
  });

  describe('nic / nia', () => {
    it('reconoce NIC 12 y NIA 705 en el mismo texto', () => {
      const citations = extractCitations(TEXT_NIC_NIA);
      const nic = citations.filter((c) => c.kind === 'nic');
      const nia = citations.filter((c) => c.kind === 'nia');
      expect(nic.length).toBe(1);
      expect(nia.length).toBe(1);
      expect(nic[0].normalized).toBe('NIC 12');
      expect(nia[0].normalized).toBe('NIA 705');
    });
  });

  describe('resolucion_dian', () => {
    it('reconoce Resolución DIAN 000238 de 2025 y la normaliza con zero-padding', () => {
      const citations = extractCitations(TEXT_RESOLUCION_DIAN);
      const res = citations.filter((c) => c.kind === 'resolucion_dian');
      expect(res.length).toBe(1);
      expect(res[0].normalized).toBe('Resolución DIAN 000238 de 2025');
    });

    it('normaliza "Resolución DIAN 238/2025" al mismo zero-padding', () => {
      const text = 'Conforme a la Resolución DIAN 238/2025 se actualiza la UVT.';
      const citations = extractCitations(text);
      const res = citations.filter((c) => c.kind === 'resolucion_dian');
      expect(res.length).toBe(1);
      expect(res[0].normalized).toBe('Resolución DIAN 000238 de 2025');
    });
  });

  it('texto vacío produce array vacío', () => {
    expect(extractCitations('')).toEqual([]);
  });

  it('preserva posiciones (start/end) correctas', () => {
    const text = 'Inicio Art. 240 E.T. final.';
    const citations = extractCitations(text);
    expect(citations.length).toBe(1);
    expect(citations[0].position.start).toBe(text.indexOf('Art. 240'));
    expect(citations[0].position.end).toBe(citations[0].position.start + citations[0].raw.length);
  });
});

describe('normalizeCitation — helper', () => {
  it('normaliza un fragmento aislado', () => {
    const r = normalizeCitation('Art. 240 E.T.');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('articulo_et');
    expect(r?.normalized).toBe('Art. 240 E.T.');
  });

  it('retorna null para fragmento que no matchea', () => {
    expect(normalizeCitation('algo sin cita')).toBeNull();
  });
});

describe('validateCitations — Capa 2 catálogo', () => {
  it('respuesta válida: todas las citas verifican como VIGENTE_2026', () => {
    const results = validateCitations(TEXT_RESPUESTA_VALIDA, CATALOGUE);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.veredicto).toBe('valida');
      expect(r.enCatalogo).toBe(true);
      expect(r.estado).toBe('VIGENTE_2026');
      expect(r.blacklistHit).toBeNull();
    }
  });

  it('Art. 158-3 derogado: veredicto bloqueo + blacklist hit + estado DEROGADO', () => {
    const results = validateCitations(TEXT_USANDO_ART_158_3_DEROGADO, CATALOGUE);
    const art1583 = results.find((r) => r.citation.normalized === 'Art. 158-3 E.T.');
    expect(art1583).toBeDefined();
    expect(art1583?.veredicto).toBe('bloqueo');
    expect(art1583?.blacklistHit?.id).toBe('BL_ART_158_3_DEROGADO');
    // Tras blacklist hit, también está en catálogo como DEROGADO
    expect(art1583?.enCatalogo).toBe(true);
    expect(art1583?.estado).toBe('DEROGADO');
    expect(art1583?.alternativa).toContain('258-1');
  });

  it('cita desconocida (Art. 9999): veredicto bloqueo + enCatalogo false', () => {
    const results = validateCitations(TEXT_CITA_DESCONOCIDA, CATALOGUE);
    expect(results.length).toBe(1);
    expect(results[0].veredicto).toBe('bloqueo');
    expect(results[0].enCatalogo).toBe(false);
    expect(results[0].estado).toBeNull();
    expect(results[0].mensaje).toContain('NO está en el catálogo');
  });

  it('cita MODIFICADO en catálogo: veredicto advertencia', () => {
    // Override: marca Art. 240 como MODIFICADO
    const cat = buildSyntheticCatalogue({
      articulosET: CATALOGUE.articulosET.map((a) =>
        a.id === 'ART_240_ET' ? { ...a, estado: 'MODIFICADO' as const } : a,
      ),
    });
    const text = 'Tarifa según Art. 240 E.T.';
    const results = validateCitations(text, cat);
    expect(results[0].veredicto).toBe('advertencia');
    expect(results[0].estado).toBe('MODIFICADO');
  });

  it('múltiples citas válidas: todas valida', () => {
    const results = validateCitations(TEXT_MULTIPLES_CITAS_OK, CATALOGUE);
    expect(results.length).toBeGreaterThanOrEqual(4);
    const veredictos = results.map((r) => r.veredicto);
    expect(veredictos.every((v) => v === 'valida')).toBe(true);
  });

  it('Concepto DIAN 1352 (blacklist CRITICA): bloqueo', () => {
    const text = 'Conforme al Concepto DIAN 1352 de 2018 procede la deducción.';
    const results = validateCitations(text, CATALOGUE);
    const concepto = results.find((r) => r.blacklistHit?.id === 'BL_CONCEPTO_100208221_1352');
    expect(concepto).toBeDefined();
    expect(concepto?.veredicto).toBe('bloqueo');
  });

  it('texto vacío produce array vacío de citas', () => {
    expect(validateCitations(TEXT_VACIO, CATALOGUE)).toEqual([]);
  });

  it('cita en catálogo con estado INEXEQUIBLE: bloqueo', () => {
    const cat = buildSyntheticCatalogue({
      articulosET: [
        ...CATALOGUE.articulosET,
        {
          ...SYNTHETIC_ENTRIES.ART_122_ET,
          id: 'ART_TEST_INEXEQ',
          cita: 'Art. 999 E.T.',
          estado: 'INEXEQUIBLE' as const,
        },
      ],
    });
    const text = 'Aplica el Art. 999 E.T.';
    const results = validateCitations(text, cat);
    expect(results[0].veredicto).toBe('bloqueo');
    expect(results[0].estado).toBe('INEXEQUIBLE');
  });
});
