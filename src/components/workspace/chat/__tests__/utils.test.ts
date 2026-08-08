// ---------------------------------------------------------------------------
// Regresion — honestidad del panel de inteligencia y del banner de pipeline
// ---------------------------------------------------------------------------
//
// Hallazgos cubiertos:
//   - citas-no-validadas-etiquetadas-como-et: `extractLegalReferences` rotulaba
//     como "Art. N E.T." CUALQUIER "Art. N" del texto (el grupo que exigia
//     "E.T." era opcional) y ChatWorkspace lo publicaba con
//     source: 'Estatuto Tributario'. Un "Art. 33 de la Ley 2277", un "Art. 5
//     del contrato" o un articulo alucinado aparecian como cita verificada del
//     E.T. en el panel de Fuentes.
//   - pipeline-banner-etiqueta-mal-los-agentes: el mapa comparaba contra
//     'tax'/'accounting'/'documents' mientras el servidor envia displayNames
//     ('Agente Tributario', ...), asi que TODA consulta se mostraba como
//     "Analizado por: Ag. Estrategia".
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  extractLegalReferences,
  resolveAgentPresentation,
  resolveFinalAnswer,
  UNVERIFIED_SOURCE_LABEL,
} from '../utils';

describe('extractLegalReferences', () => {
  it('atribuye al Estatuto Tributario SOLO cuando el texto lo declara', () => {
    const refs = extractLegalReferences(
      'La sancion se liquida conforme al Art. 641 E.T. y su reduccion.',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].article).toBe('Art. 641 E.T.');
    expect(refs[0].source).toBe('Estatuto Tributario');
    expect(refs[0].verified).toBe(true);
  });

  it('NO reetiqueta como E.T. un articulo de otra norma', () => {
    const refs = extractLegalReferences(
      'Segun el Art. 33, adicionado por la Ley 2277 de 2022, la tarifa cambia.',
    );
    // El codigo viejo devolvia "Art. 33 E.T." y el panel lo publicaba como cita
    // verificada del Estatuto Tributario.
    expect(refs.map((r) => r.article)).not.toContain('Art. 33 E.T.');
    expect(refs.every((r) => r.source !== 'Estatuto Tributario')).toBe(true);
    expect(refs.some((r) => r.article === 'Ley 2277 de 2022' && r.verified)).toBe(true);
  });

  it('marca como no verificada una mencion de articulo sin norma (p. ej. un contrato)', () => {
    const refs = extractLegalReferences(
      'La clausula del Art. 5, del contrato de arrendamiento, exige aviso previo.',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].article).toBe('Art. 5');
    expect(refs[0].verified).toBe(false);
    expect(refs[0].source).toBe(UNVERIFIED_SOURCE_LABEL);
  });

  it('marca como no verificado un "Art. N" suelto (posible alucinacion)', () => {
    const refs = extractLegalReferences('Aplica el Art. 9999.');
    expect(refs).toHaveLength(1);
    expect(refs[0].article).toBe('Art. 9999');
    expect(refs[0].verified).toBe(false);
    expect(refs[0].source).not.toBe('Estatuto Tributario');
  });

  it('reconoce normas contables sin convertirlas en articulos del E.T.', () => {
    const refs = extractLegalReferences('La provision se reconoce bajo NIC 37.');
    expect(refs.some((r) => r.article === 'NIC 37' && r.source === 'NIIF / NIC')).toBe(true);
    expect(refs.some((r) => r.source === 'Estatuto Tributario')).toBe(false);
  });

  it('deduplica y conserva articulos compuestos (240-1 != 240)', () => {
    const refs = extractLegalReferences(
      'Art. 240 E.T. fija la tarifa; el Art. 240-1 E.T. la tasa minima; ver de nuevo Art. 240 E.T.',
    );
    const articles = refs.map((r) => r.article);
    expect(articles).toContain('Art. 240 E.T.');
    expect(articles).toContain('Art. 240-1 E.T.');
    expect(articles.filter((a) => a === 'Art. 240 E.T.')).toHaveLength(1);
  });
});

describe('resolveAgentPresentation', () => {
  it('mapea los displayName que realmente envia el servidor', () => {
    expect(resolveAgentPresentation('Agente Tributario').label).toBe('Ag. Tributario');
    expect(resolveAgentPresentation('Agente Contable').label).toBe('Ag. Contable');
    expect(resolveAgentPresentation('Agente Documental').label).toBe('Ag. Documentos');
    expect(resolveAgentPresentation('Agente de Estrategia').label).toBe('Ag. Estrategia');
  });

  it('reconoce al Agente Litigante, que antes no existia en ninguna rama', () => {
    expect(resolveAgentPresentation('Agente Litigante').label).toBe('Ag. Litigante');
  });

  it('sigue aceptando la clave de dominio', () => {
    expect(resolveAgentPresentation('tax')).toEqual({ label: 'Ag. Tributario', branch: 'tax' });
    expect(resolveAgentPresentation('accounting').branch).toBe('accounting');
  });

  it('ante un nombre desconocido NO inventa un agente: devuelve el nombre crudo', () => {
    expect(resolveAgentPresentation('Agente Desconocido').label).toBe('Agente Desconocido');
  });
});

describe('resolveFinalAnswer', () => {
  it('marca como truncada la respuesta cuando el stream se cierra sin evento result', () => {
    const out = resolveFinalAnswer({
      result: null,
      streamed: 'La sancion por extemporaneidad se liquida al 5% mensual sobre',
      language: 'es',
    });
    expect(out).not.toBeNull();
    expect(out!.truncated).toBe(true);
    expect(out!.content).toContain('Respuesta incompleta');
    // La marca viaja DENTRO del contenido: se persiste con el mensaje.
    expect(out!.content.startsWith('La sancion por extemporaneidad')).toBe(true);
  });

  it('no marca nada cuando el servidor sí envio el evento result', () => {
    const out = resolveFinalAnswer({
      result: { content: 'Respuesta completa.' },
      streamed: 'Respuesta comp',
      language: 'es',
    });
    expect(out).toEqual({ content: 'Respuesta completa.', truncated: false });
  });

  it('devuelve null cuando no hubo ni result ni contenido streameado', () => {
    expect(resolveFinalAnswer({ result: null, streamed: '', language: 'es' })).toBeNull();
  });

  it('usa el texto streameado si el evento result llego sin content', () => {
    const out = resolveFinalAnswer({ result: {}, streamed: 'texto', language: 'es' });
    expect(out).toEqual({ content: 'texto', truncated: false });
  });
});
