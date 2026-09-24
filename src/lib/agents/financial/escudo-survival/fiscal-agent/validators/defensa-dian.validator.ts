// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 5 · Defensa DIAN
// ---------------------------------------------------------------------------
//
// Valida la carta que el agente PUBLICA contra el esqueleto determinista del
// `dian-letter-builder` (fase 2 de la auditoría 2026-09-24, pendiente #8). El
// contrato anterior usaba otra taxonomía («requerimiento_especial_685»,
// pliego de cargos a 3 meses) que contradecía los plazos corregidos en
// tributario-modulos-13, por eso el módulo quedaba sin validar.
//
//   L1 — Estructura
//        L1.1 la carta trae las secciones del esqueleto (la de diferencia de
//             criterio sólo si se invoca) y en su orden
//
//   L2 — Plazos, citas y reducciones
//        L2.1 tipo, plazo y norma del plazo publicados = clasificación
//             determinista del tipo (classificationFromKind)
//        L2.1b la carta cita la norma del plazo (aviso)
//        L2.2 si invoca diferencia de criterio → cita el parágrafo del Art. 647
//        L2.3 NO cita el Concepto 100208221-1352 (no verificable)
//        L2.4 si menciona una reducción de sanción → cita una norma de
//             reducción disponible para ese tipo de actuación
//
//   L3 — Defensa tributaria
//        L3.1 cierre «borrador para revisión del contador/abogado»
//        L3.2 actuación con posible sanción por inexactitud sin cita del
//             Art. 647 (aviso)
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import {
  DIAN_LETTER_SECTIONS,
  classificationFromKind,
  reduccionesDisponibles,
  type DianLetterSectionId,
} from '../tools/dian-letter-builder';
import type { Modulo5DefensaDian, ValidationCheck } from './types';
import { articulosCitados, citaArticulo, citaConcepto1352, citaParagrafo647 } from './helpers';

// ---------------------------------------------------------------------------
// Detección de secciones
// ---------------------------------------------------------------------------
//
// Una sección cuenta cuando su rótulo abre una línea: heading markdown
// ("## Antecedentes"), negrita ("**Antecedentes**"), numeración
// ("3. Soporte documental") o rótulo plano ("Petición:").
// ---------------------------------------------------------------------------

// Rótulos en español y en inglés (con language = 'en' el modelo traduce los
// encabezados del esqueleto).
const PATRON_SECCION: Record<DianLetterSectionId, string> = {
  antecedentes: '(?:antecedentes|background)',
  posicion_juridica: '(?:posici[óo]n\\s+jur[íi]dica|legal\\s+position)',
  soporte_documental:
    '(?:soportes?\\s+documental(?:es)?|supporting\\s+documents?|documentary\\s+(?:support|evidence))',
  defensa_647:
    '(?:defensa[^\\n]{0,60}647|defensa[^\\n]{0,40}diferencia\\s+de\\s+criterio|defen[cs]e[^\\n]{0,60}647|defen[cs]e[^\\n]{0,40}difference\\s+(?:of|in)\\s+(?:criteria|interpretation))',
  peticion: '(?:petici[óo]n(?:es)?|petition|request(?:s|ed\\s+relief)?\\b)',
  firmas: '(?:firmas?\\b|signatures?\\b)',
};

function indiceSeccion(texto: string, id: DianLetterSectionId): number {
  const re = new RegExp(
    `^[ \\t]*(?:#{1,6}[ \\t]*|\\*\\*[ \\t]*|(?:\\d+|[IVX]+)[.)][ \\t]+)*${PATRON_SECCION[id]}`,
    'im',
  );
  const m = texto.match(re);
  return m && m.index !== undefined ? m.index : -1;
}

function declaraBorrador(texto: string): boolean {
  const t = texto.toLowerCase();
  const tieneBorrador = /\bborrador\b|\bdraft\b/.test(t);
  const tieneRevision = /\brevisi[óo]n\b|\breview\b/.test(t);
  const tieneProfesional =
    /\bcontador(?:\s+p[úu]blico)?\b/.test(t) ||
    /\babogado\b/.test(t) ||
    /\brevisor\s+fiscal\b/.test(t) ||
    /\baccountant\b|\btax\s+(?:attorney|lawyer)\b|\bstatutory\s+auditor\b/.test(t);
  return tieneBorrador && tieneRevision && tieneProfesional;
}

/**
 * True si la carta menciona o solicita una reducción DE SANCIÓN (lo que L2.4
 * exige soportar): en la misma oración, la palabra de reducción aparece a
 * poca distancia de «sanción / penalty», «cuarta parte», «mitad»,
 * «gradualidad», «acogerse a la reducción» o de una norma de reducción. «La
 * reducción de los ingresos obedece a…» es un hecho del caso (revisión de la
 * fase 2, pendiente #8), y «solicitamos reducir la adición / el mayor
 * impuesto» discute la glosa, no la sanción (re-auditoría 2026-09-24, NT-06):
 * «solicitar / request / aplicar» ya no bastan como contexto. Límite
 * documentado: una oración que pide reducir la glosa y, lejos en la misma
 * oración, menciona la sanción no se juzga (se prefiere no bloquear).
 */
const RE_REDUCCION = /\breduc(?:ci[óo]n(?:es)?|ida|ido|ir|e|en)\b|\breduction\b|\breduced?\b/gi;
const RE_CONTEXTO_SANCION =
  /\bsanci[óo]n(?:es)?\b|\bpenalt(?:y|ies)\b|\bcuarta\s+parte\b|\ba\s+la\s+mitad\b|\bone[-\s](?:quarter|half)\b|\bgradualidad\b|\bproporcionalidad\b|\bacog\w*\s+a\s+la\s+reducci[óo]n\b|\bArt(?:[íi]culos?|s)?\.?\s*(?:640|644|709|713|716)\b/gi;
/** Distancia máxima (caracteres) entre la reducción y su objeto sancionatorio. */
const VENTANA_REDUCCION_SANCION = 80;

function posiciones(re: RegExp, texto: string): Array<{ start: number; end: number }> {
  return [...texto.matchAll(re)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

function mencionaReduccionDeSancion(texto: string): boolean {
  // Un punto seguido de un número no cierra la oración («Art. 644 E.T.»).
  return texto
    .split(/(?<=[.;!?])\s+(?!\d)|\n+/)
    .some((o) => {
      const reducciones = posiciones(RE_REDUCCION, o);
      if (reducciones.length === 0) return false;
      const contextos = posiciones(RE_CONTEXTO_SANCION, o);
      return reducciones.some((r) =>
        contextos.some((c) => {
          const distancia = c.start >= r.end ? c.start - r.end : r.start >= c.end ? r.start - c.end : 0;
          return distancia <= VENTANA_REDUCCION_SANCION;
        }),
      );
    });
}

const invocaDiferenciaCriterio = (m5: Modulo5DefensaDian) =>
  m5.defensaArt647 !== null && m5.defensaArt647.trim().length > 0;

// ---------------------------------------------------------------------------
// CAPA 1 — Estructura
// ---------------------------------------------------------------------------

export function validateDefensaDianL1(m5: Modulo5DefensaDian): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const exigidas = DIAN_LETTER_SECTIONS.filter((s) => !s.condicional || invocaDiferenciaCriterio(m5));
  const detectadas = exigidas.map((s) => ({ titulo: s.titulo, index: indiceSeccion(m5.cartaTexto, s.id) }));
  const faltantes = detectadas.filter((d) => d.index < 0).map((d) => d.titulo);
  const okPresencia = faltantes.length === 0;
  checks.push({
    name: 'M5.L1.1_secciones_presentes',
    passed: okPresencia,
    severity: 'error',
    norma: 'INTERNAL — esqueleto dian-letter-builder',
    detail: okPresencia
      ? `La carta contiene las ${exigidas.length} secciones del esqueleto.`
      : `La carta NO contiene: ${faltantes.join(', ')}. Estructura: ${exigidas.map((s) => s.titulo).join(' / ')}.`,
  });

  if (okPresencia) {
    let primerFuera: string | null = null;
    let last = -1;
    for (const d of detectadas) {
      if (d.index < last) {
        primerFuera = d.titulo;
        break;
      }
      last = d.index;
    }
    checks.push({
      name: 'M5.L1.1b_secciones_ordenadas',
      passed: primerFuera === null,
      severity: 'error',
      norma: 'INTERNAL — esqueleto dian-letter-builder',
      detail:
        primerFuera === null
          ? 'Las secciones aparecen en el orden del esqueleto.'
          : `La sección «${primerFuera}» aparece fuera de orden. Orden: ${exigidas.map((s) => s.titulo).join(' → ')}.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Plazos, citas y reducciones
// ---------------------------------------------------------------------------

export function validateDefensaDianL2(m5: Modulo5DefensaDian): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m5.cartaTexto;
  const esperado = classificationFromKind(m5.tipoRequerimiento);

  {
    const ok =
      esperado.kind === m5.tipoRequerimiento &&
      m5.plazoRespuesta === esperado.plazoRespuesta &&
      m5.normaPlazo === esperado.normaPlazo;
    checks.push({
      name: 'M5.L2.1_plazo_y_norma_deterministas',
      passed: ok,
      severity: 'error',
      norma: esperado.normaPlazo,
      detail: ok
        ? `Tipo ${m5.tipoRequerimiento}: plazo «${m5.plazoRespuesta}» (${m5.normaPlazo}).`
        : `Tipo ${m5.tipoRequerimiento}: se publicó «${m5.plazoRespuesta}» / «${m5.normaPlazo}»; el esqueleto determinista fija «${esperado.plazoRespuesta}» / «${esperado.normaPlazo}».`,
    });
  }

  if (m5.tipoRequerimiento !== 'desconocido') {
    const articulos = articulosCitados(m5.normaPlazo);
    const ok = articulos.length === 0 || articulos.some((a) => citaArticulo(texto, a));
    checks.push({
      name: 'M5.L2.1b_carta_cita_norma_del_plazo',
      passed: ok,
      severity: 'warning',
      norma: m5.normaPlazo,
      detail: ok
        ? `La carta cita la norma del plazo (${m5.normaPlazo}).`
        : `La carta no cita ninguno de los artículos de la norma del plazo (${articulos.join(', ')}).`,
    });
  }

  if (invocaDiferenciaCriterio(m5)) {
    const ok = citaParagrafo647(texto);
    checks.push({
      name: 'M5.L2.2_diferencia_criterio_cita_par_647',
      passed: ok,
      severity: 'error',
      norma: 'Art. 647 par. E.T.',
      detail: ok
        ? 'La defensa por diferencia de criterio cita el parágrafo del Art. 647 E.T.'
        : 'Se invoca la diferencia de criterio pero la carta NO cita el parágrafo del Art. 647 E.T.',
    });
  }

  {
    const violacion = citaConcepto1352(texto);
    checks.push({
      name: 'M5.L2.3_no_cita_concepto_1352',
      passed: !violacion,
      severity: 'error',
      norma: 'Blacklist normativa — Concepto 100208221-1352 no verificable',
      detail: violacion
        ? 'La carta cita el Concepto DIAN 100208221-1352 de 2018, no verificable en normograma. Sustituir por el parágrafo del Art. 647 E.T. y jurisprudencia de la Sección Cuarta.'
        : 'No se detectó cita al Concepto 100208221-1352.',
    });
  }

  if (mencionaReduccionDeSancion(texto)) {
    const disponibles = [...new Set(reduccionesDisponibles(m5.tipoRequerimiento).flatMap(articulosCitados))];
    const ok = disponibles.some((a) => citaArticulo(texto, a));
    checks.push({
      name: 'M5.L2.4_reduccion_cita_norma',
      passed: ok,
      severity: 'error',
      norma: disponibles.map((a) => `Art. ${a} E.T.`).join(' / '),
      detail: ok
        ? 'La mención de reducción está soportada en una norma disponible para este tipo de actuación.'
        : `La carta menciona una reducción sin citar la norma aplicable a ${m5.tipoRequerimiento} (${disponibles.map((a) => `Art. ${a}`).join(', ')}).`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria
// ---------------------------------------------------------------------------

const ACTUACIONES_CON_INEXACTITUD = new Set(['requerimiento_especial', 'liquidacion_oficial_revision']);

export function validateDefensaDianL3(m5: Modulo5DefensaDian): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m5.cartaTexto;

  {
    const ok = declaraBorrador(texto);
    checks.push({
      name: 'M5.L3.1_cierre_borrador_revision',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok
        ? 'La carta declara que es un borrador para revisión del contador / abogado / revisor fiscal.'
        : 'La carta NO declara que es un borrador para revisión profesional antes de su envío.',
    });
  }

  if (ACTUACIONES_CON_INEXACTITUD.has(m5.tipoRequerimiento)) {
    const ok = citaArticulo(texto, '647');
    checks.push({
      name: 'M5.L3.2_cita_art_647',
      passed: ok,
      severity: 'warning',
      norma: 'Art. 647 E.T.',
      detail: ok
        ? 'La carta cita el Art. 647 E.T. (sanción por inexactitud).'
        : `Actuación ${m5.tipoRequerimiento} con posible sanción por inexactitud y la carta no cita el Art. 647 E.T.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateDefensaDian(m5: Modulo5DefensaDian): ValidationCheck[] {
  return [
    ...validateDefensaDianL1(m5),
    ...validateDefensaDianL2(m5),
    ...validateDefensaDianL3(m5),
  ];
}
