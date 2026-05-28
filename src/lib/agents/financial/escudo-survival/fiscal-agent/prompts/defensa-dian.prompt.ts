// ---------------------------------------------------------------------------
// Capa 4 — Módulo 5 — Prompt: Defensa DIAN (carta respuesta requerimiento)
// ---------------------------------------------------------------------------

import type { Language } from '../types';
import { buildFiscalAgentHeader, buildLanguageLine } from './fiscal-agent.prompt';

export function buildDefensaDianPrompt(
  language: Language,
  nitContext?: string,
): string {
  const header = buildFiscalAgentHeader({
    language,
    useCase: 'defensa_dian',
    nitContext,
  });

  return `${header}

<task>
Redactar la respuesta jurídica a la actuación DIAN identificada en el contexto. El esqueleto (tipo de actuación, plazo de respuesta, norma del plazo, secciones obligatorias, reducciones disponibles) viene precomputado por el tool \`dian-letter-builder\`. Tu trabajo es producir el contenido sustantivo de cada sección con sustento normativo verificado.
</task>

<success_criteria>
- \`data.tipoRequerimiento\` y \`data.normaPlazo\` se copian del esqueleto precomputado.
- \`data.antecedentes\` resume en 4-8 líneas el requerimiento DIAN: número, fecha de notificación, hechos imputados, monto controvertido si aplica.
- \`data.posicionJuridica\` argumenta la tesis del contribuyente con sustento normativo en 8-20 líneas. Citar artículos exactos del E.T., Conceptos DIAN whitelisted y jurisprudencia constitucional.
- \`data.citasNormativas\` lista TODAS las citas usadas en la carta. Cada entrada debe coincidir con el Motor Normativo.
- \`data.soportesDocumentales\` lista los documentos físicos/digitales que respaldan la tesis (≥3, ≤15).
- \`data.defensaArt647\` (nullable). Si la posición del contribuyente es una interpretación razonable del derecho aplicable, cita TEXTUALMENTE el parágrafo del Art. 647 E.T. (que aparece en el Motor Normativo bajo ART_647_PAR_ET) — esta defensa neutraliza la sanción por inexactitud. Si no aplica, deja null.
- \`data.reduccionesDisponibles\` se copia del esqueleto.
- \`data.cartaCompleta\` es la carta lista para revisión: encabezado (Señores DIAN, NIT, Periodo, Referencia), cuerpo siguiendo las 6 secciones del esqueleto, cierre con firmas (Representante Legal + Contador / RF con T.P. visible) y la oración final obligatoria: "Esta respuesta es un borrador para revisión del contador y/o abogado tributarista antes de su envío."
- El markdown muestra una versión humana de la carta + análisis del caso + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita los artículos del E.T. de procedimiento aplicables según el tipo de actuación:
  - Art. 752 E.T. para requerimiento ordinario (plazo 15 días hábiles).
  - Art. 685 E.T. para emplazamiento para corregir (plazo 1 mes).
  - Art. 715 E.T. para emplazamiento previo por no declarar.
  - Art. 707 E.T. para pliego de cargos (plazo 3 meses).
  - Art. 702 E.T. para liquidación oficial de revisión.
  - Art. 720 E.T. para recurso de reconsideración (plazo 2 meses).
ALWAYS cita el parágrafo del Art. 647 E.T. (texto literal del catálogo) cuando se invoque la defensa de diferencia de criterio razonable.
ALWAYS cita "Art. 709 E.T." cuando menciones reducción al 25% por aceptación del pliego de cargos; "Art. 713 E.T." cuando menciones reducción al 50% por aceptación de la liquidación oficial; "Art. 640 E.T." cuando menciones reducciones por principios de gradualidad / proporcionalidad / favorabilidad.
NEVER cites "Concepto 100208221-1352" para la defensa de diferencia de criterio — ESE CONCEPTO NO ESTÁ VERIFICADO en normograma y está en la blacklist. La defensa SIEMPRE se ampara en el parágrafo Art. 647 E.T.
NEVER inventes números de radicación de Conceptos DIAN — si no aparecen en el catálogo, NO los uses.
If el tipo de actuación es "desconocido" entonces dilo en warnings, redacta una carta neutra solicitando aclaración a la DIAN y NO inventes plazos.
If el contribuyente acepta total o parcialmente los cargos entonces invoca explícitamente la reducción correspondiente (Art. 709 / 713 / 644 / 640 según corresponda).
</constraints>

<context>
{texto_requerimiento_dian_del_usuario}
{esqueleto_carta_precomputado_con_tipo_plazo_reducciones}
{anchor_F01_F10_y_alertas}
{instrucciones_libres_del_usuario}
</context>

${buildLanguageLine(language)}`;
}
