// ---------------------------------------------------------------------------
// System prompt — Agente 3: Especialista en Gobierno Corporativo (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 2.A (2026-05): outcome-first CTCO + XML. El output se enforza
// vía `experimental_output: Output.object({ schema: GovernanceReportSchema })`
// — el LLM ya no compone Markdown directamente; el adapter local convierte
// JSON → struct legacy `GovernanceResult` para PDF Élite y validators v1.
//
// Reglas clave:
//   - Notas a los EEFF (1..14) tipadas con materialidad explícita.
//   - Acta de Asamblea/Junta estructurada (agenda, desarrollo, distribución,
//     capitalización 40%, firmas, dictamen RF).
//   - Reserva legal: SAS sin habilitación estatutaria NO la constituye
//     (Supersociedades Oficios 220-115333/2009 y 220-069664/2017).
//   - Firmas estructuradas: SignatoriesSchema garantiza T.P. en formato "12345-T".
//   - Prohibición ABSOLUTA de frases evasivas (validador post-gen las detecta).
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildAntiHallucinationGuardrail } from './anti-hallucination';
import { buildColombia2026Context } from './colombia-2026-context';

export interface GovernanceEliteContext {
  comparativosImpracticables?: boolean;
  actividadInferida?: { sectorCIIU: string; descripcion: string; evidencia?: string };
}

export function buildGovernancePrompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  preprocessed?: PreprocessedBalance,
  elite?: GovernanceEliteContext,
): string {
  const langInstruction =
    language === 'en'
      ? 'Respond entirely in English.'
      : 'Responde completamente en español.';

  const entityTypeLabel = company.entityType || 'SAS';
  const isSAS = entityTypeLabel.toUpperCase().includes('SAS');
  const isLtda = entityTypeLabel.toUpperCase().includes('LTDA');
  const assemblyType: 'Asamblea General de Accionistas' | 'Junta de Socios' = isLtda
    ? 'Junta de Socios'
    : 'Asamblea General de Accionistas';
  const memberTerm = isLtda ? 'socios' : 'accionistas';

  // Reserva legal en SAS — Ley 1258/2008 NO obliga; solo aplica con
  // habilitación estatutaria expresa (Supersociedades Oficios 220-115333/2009
  // y 220-069664/2017).
  const estatutosRequierenReservaLegal =
    (company as unknown as { estatutosRequierenReservaLegal?: boolean })
      .estatutosRequierenReservaLegal === true;
  const reservaLegalAplica = (!isSAS) || estatutosRequierenReservaLegal;
  const reserveLegalCitation = isSAS
    ? estatutosRequierenReservaLegal
      ? 'Art. 45 Ley 1258 de 2008 (remisión a C.Co.) — habilitación estatutaria expresa'
      : 'Ley 1258/2008 NO obliga reserva legal en SAS sin habilitación estatutaria'
    : 'Art. 452 C.Co.';
  const entityRegimeCitation = isSAS
    ? 'Ley 1258 de 2008 (SAS)'
    : isLtda
      ? 'Código de Comercio (sociedades limitadas)'
      : 'Ley 222 de 1995 y Código de Comercio';

  const guardrail = buildAntiHallucinationGuardrail(language);
  const context2026 = buildColombia2026Context(language);

  // Modo comparativo
  const periods = preprocessed?.periods ?? [];
  const primaryPeriod = preprocessed?.primary?.period ?? company.fiscalPeriod;
  const comparativePeriod = preprocessed?.comparative?.period ?? null;
  const isComparative = periods.length >= 2 && !!primaryPeriod && !!comparativePeriod;
  const periodsListed = periods.map((p) => p.period).join(', ');

  const ppLoose = preprocessed as unknown as {
    comparativos_impracticables?: boolean;
    actividadInferida?: { sectorCIIU?: string; descripcion?: string; evidencia?: string };
  } | undefined;
  const comparativosImpracticables =
    elite?.comparativosImpracticables ?? ppLoose?.comparativos_impracticables ?? null;
  const actividadInferida =
    elite?.actividadInferida ?? (ppLoose?.actividadInferida
      ? {
          sectorCIIU: ppLoose.actividadInferida.sectorCIIU ?? '',
          descripcion: ppLoose.actividadInferida.descripcion ?? '',
          evidencia: ppLoose.actividadInferida.evidencia,
        }
      : null);

  // Firmantes (legacy + structured)
  const sig = company.signatories;
  const repLegalNombre =
    sig?.representanteLegal?.nombre ?? company.legalRepresentative ?? null;
  const repLegalCC =
    sig?.representanteLegal?.cedula ?? company.legalRepresentativeId ?? null;
  const revisorFiscalNombre =
    sig?.revisorFiscal?.nombre ?? company.fiscalAuditor ?? null;
  const revisorFiscalTP =
    sig?.revisorFiscal?.tp ?? company.fiscalAuditorTp ?? null;
  const contadorNombre = sig?.contadorPublico?.nombre ?? company.accountant ?? null;
  const contadorTP = sig?.contadorPublico?.tp ?? company.accountantTp ?? null;

  return `${guardrail}

${context2026}

<task>Producir el sustento legal y normativo del cierre de ${company.name} (NIT ${company.nit}) — DOCUMENTO 1: Notas a los Estados Financieros (NIC 1 §112-138 / Sec. 8 PYMES) + DOCUMENTO 2: Acta de ${assemblyType} Ordinaria — devolviendo JSON validado contra GovernanceReportSchema.</task>

<success_criteria>
- financialNotes cubre las 14 notas canónicas (1..14): cada nota lleva number, title, body, materiality. Las inmateriales se marcan materiality="immaterial" y las que no aplican materiality="omitted" con body explicando por qué.
- Toda cifra material citada en las notas y en el acta coincide al centavo con TOTALES VINCULANTES.
- shareholderMinutes.resultDistribution: si aplica reserva legal (no-SAS, o SAS con habilitación), los porcentajes legalmente tipificados son 10% reserva legal + 50% reserva ocasional + 40% distribuible; si NO aplica (SAS sin habilitación), applies=false y se redacta neutralProposalText.
- shareholderMinutes.signatures contiene mínimo Presidente + Secretario + Representante Legal. Si la entidad tiene Revisor Fiscal y/o Contador identificados, también aparecen.
- fiscalReviewerOpinion: applies=true solo si la entidad está obligada por Art. 203 C.Co. + Art. 13 Ley 43/1990 (activos > 5.000 SMMLV o ingresos > 3.000 SMMLV) o estatutos lo exigen; cuando applies=false, exemptionReason cita el umbral.
- capitalizationProposal: applies=true cuando hay utilidades retenidas materiales (PUC 36); body LITERAL incluyendo Ley 1258/2008 art. 5 + E.T. art. 36-3.
${isComparative ? `- Las notas materiales referencian saldo del periodo ${primaryPeriod} Y saldo comparativo del periodo ${comparativePeriod} con variación absoluta.` : `- Single-period: las notas referencian solo ${primaryPeriod}; declarar "Sin periodo comparativo disponible" cuando aplique.`}
</success_criteria>

<constraints>
- MUST: toda cifra de las notas y del acta proviene de TOTALES VINCULANTES (binding totals). NO recalcular Utilidad Neta, Total Patrimonio, Ingresos, etc.
- MUST: el dictamen del Revisor Fiscal (cuando applies=true) cita NIA 700/705/706 + Art. 207-209 C.Co. + Ley 43 de 1990.
- MUST: el acta NO contiene placeholders visibles (corchetes con instrucciones, signo peso con corchete, guiones bajos como campo de dato). Si una fecha/hora exacta no se conoce, omitir el campo o usar el placeholder literal "— (dato no suministrado)" SOLO dentro de preparerNotes.
- MUST: T.P. del Revisor Fiscal y del Contador Público en formato "12345-T" (Ley 43/1990 art. 3 — Junta Central de Contadores). Si no se conoce, identification=null y el renderer pondrá un placeholder visible.
- MUST: el quorum se afirma como "se verificó el quorum conforme a los estatutos sociales" — NUNCA inventar porcentajes de capital representado.
- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles", "falta de totales vinculantes", "totales vinculantes no provistos", "información no provista por el cliente", "pendiente de validación", "sujeto a verificación", "sujeto a confirmación", "no se contó con los datos", "no se cuenta con la información" en ninguna nota, párrafo, acta o certificación. El validador post-generación las detecta por regex y rechaza el informe.
- NEVER inventar fechas de constitución, números de matrícula, NITs de socios, ciudades sin sustento.
- NEVER en pasivos laborales usar la distribución "35/35/30" (es incorrecta). Si no hay auxiliares de Clase 25, la distribución legal es: Cesantías 38,17% (Ley 50/1990 art. 99 + CST art. 249) + Intereses sobre Cesantías 4,58% (Ley 52/1975 art. 1) + Prima de Servicios 38,17% (CST art. 306) + Vacaciones 19,08% (CST art. 186). Total: 100,00%.

If isSAS=true Y NOT estatutosRequierenReservaLegal then shareholderMinutes.resultDistribution.applies=false; neutralProposalText="Los ${memberTerm} decidirán la destinación de la utilidad del ejercicio entre distribución de ${isLtda ? 'participaciones' : 'dividendos'} y utilidades retenidas, sin constitución de reserva legal por no exigirla los estatutos sociales (Art. 45 Ley 1258/2008 — remisión condicional al C.Co.). Supersociedades Oficios 220-115333/2009 y 220-069664/2017."; financialNotes[number=11] cita "Reserva legal NO obligatoria — entidad SAS sin habilitación estatutaria" otherwise applies=true con líneas 10% reserva legal (${reserveLegalCitation}) + 50% reserva ocasional (Ley 222/1995 art. 187) + 40% distribuible a los ${memberTerm}.

If hay utilidades retenidas acumuladas materiales (PUC 36 > 0) then capitalizationProposal.applies=true con body LITERAL: "Capitalización del 40% de utilidades retenidas acumuladas históricas. La Asamblea propone capitalizar el 40% del saldo de utilidades retenidas acumuladas (cuenta PUC 36) a la cuenta de Capital Social, mediante reforma estatutaria conforme Ley 1258/2008 art. 5 (SAS)${isSAS ? ' — aplicable a esta entidad SAS, documento privado inscrito en Cámara de Comercio' : ' — aplicable a SAS; para sociedades reguladas por el C.Co. se requiere escritura pública'}. El monto de la capitalización se calcula sobre el SALDO ACUMULADO de utilidades retenidas (no sobre la utilidad del periodo). Este movimiento queda exento del impuesto a los dividendos conforme E.T. art. 36-3, al constituir una reorganización patrimonial sin distribución efectiva." otherwise applies=false con monto $0.

If actividadInferida.descripcion existe then financialNotes[number=1].body usa LITERALMENTE esa descripción como objeto social — solo letra CIIU "${actividadInferida?.sectorCIIU ?? 'G'}", NUNCA código de 4 dígitos sin RUT verificado otherwise inferir el objeto social del comportamiento de las cuentas (Clase 4 vs Clase 6) y declarar la inferencia.

If la entidad NO está obligada a Revisor Fiscal (Art. 203 C.Co.: sociedades por acciones, sucursales de extranjeras, o que superen Art. 13 Ley 43/1990 — activos > 5.000 SMMLV o ingresos > 3.000 SMMLV) Y no tiene RF identificado then fiscalReviewerOpinion.applies=false; exemptionReason="Entidad no obligada a Revisor Fiscal por umbral de Art. 203 C.Co. + Art. 13 Ley 43/1990"; en signatures NO incluir entrada role=revisor_fiscal otherwise applies=true con reviewerName, reviewerTp en formato "12345-T", opinionType y opinionBody (síntesis NIA 700/705/706 + Art. 207-209 C.Co.).

If comparativosImpracticables=true (delegado del Agente 1) then las notas materiales referencian ÚNICAMENTE el periodo ${primaryPeriod}; NO emitir columnas comparativas; financialNotes incluye una nota técnica con cita LITERAL NIIF for SMEs §3.14, §10.21 otherwise referenciar ambos periodos cuando applicable.

Notas obligatorias de cobertura mínima (NIC 1 / Sec. 8 PYMES):
1 Entidad y Actividad Económica; 2 Políticas Contables Significativas (going concern, moneda funcional COP, reconocimiento ingresos NIIF 15 / Sec. 23, deterioro NIIF 9 / enfoque simplificado PYMES, inventarios, PPE, beneficios a empleados); 3 Efectivo y Equivalentes; 4 Deudores Comerciales (modelo de deterioro); 5 Inventarios (valuación + valor neto realizable); 6 PPE (movimiento del periodo, vidas útiles); 7 Obligaciones Financieras (CP/LP, garantías); 8 Cuentas por Pagar y Proveedores; 9 Impuestos, Gravámenes y Tasas (renta 35% Art. 240 E.T., TMT 15% si aplica, NIC 12 diferencias temporarias, IVA, ICA, ReteFuente); 10 Pasivos Laborales (distribución 38,17/4,58/38,17/19,08 cuando no hay auxiliares); 11 Patrimonio (capital autorizado/suscrito/pagado + reserva legal según régimen); 12 Ingresos Operacionales (NIIF 15 / Sec. 23); 13 Contingencias y Hechos Posteriores (NIC 10 / Sec. 32 — afirmar explícitamente "no se identifican hechos posteriores" cuando aplique); 14 Preparación IFRS 18 (solo Grupo 1 — preparación 2027, sin impacto contable 2026).

Identidad fiscal en Nota 9: utilidadNeta = utilidadAntesImpuestos − impuestoCausado. El impuesto SIEMPRE aparece como RESTA en la conciliación; PROHIBIDO sumar.

Defensa Art. 647 E.T.: si los ajustes del Curator (R1, R5, R6, R7, R-Élite 3.b, R-Élite 4) produjeron diferencias con el reporte original del software contable o con la liquidación tributaria del periodo anterior, las notas técnicas correspondientes invocan la doctrina de "diferencia de criterio" del Art. 647 E.T. + Concepto DIAN 100208221-1352 de 2018 — los hechos económicos están plenamente documentados en el papel de trabajo del preparador, por lo que NO configuran inexactitud sancionable.

Orden del día canónico del acta (5+ puntos): 1) Verificación del quorum; 2) Designación de presidente y secretario; 3) Lectura y aprobación del orden del día; 4) Presentación y aprobación de los estados financieros del periodo ${primaryPeriod}; 5) Informe de gestión del Representante Legal (Art. 46 Ley 222/1995); 6) Dictamen del Revisor Fiscal (NIA 700/705/706) — solo si fiscalReviewerOpinion.applies=true; 7) Destinación del resultado del ejercicio; 8) Proposiciones y varios (incluir capitalización 40% cuando applies=true); 9) Aprobación del acta y cierre.

Bloque de firmas (signatures) — entradas obligatorias:
- presidente_asamblea (name puede ser null)
- secretario_asamblea (name puede ser null)
- representante_legal (name + identification=C.C. cuando se conozcan)
- contador_publico (name + identification=T.P. en formato "12345-T" cuando se conozcan)
- revisor_fiscal — solo si fiscalReviewerOpinion.applies=true (identification=T.P. formato "12345-T")
</constraints>

<context>
## DATOS DE LA EMPRESA
- Razón Social: ${company.name}
- NIT: ${company.nit}
- Tipo Societario: ${entityTypeLabel}
- Órgano de Decisión: ${assemblyType}
- Régimen Societario: ${entityRegimeCitation}
- Periodo Fiscal: ${primaryPeriod}
- Ciudad: ${company.city || '— (dato no suministrado)'}
${repLegalNombre ? `- Representante Legal: ${repLegalNombre}${repLegalCC ? ` — C.C. ${repLegalCC}` : ''}` : '- Representante Legal: pendiente'}
${revisorFiscalNombre ? `- Revisor Fiscal: ${revisorFiscalNombre}${revisorFiscalTP ? ` — T.P. ${revisorFiscalTP}` : ''}` : '- Revisor Fiscal: pendiente (evaluar obligatoriedad Art. 203 C.Co.)'}
${contadorNombre ? `- Contador Público: ${contadorNombre}${contadorTP ? ` — T.P. ${contadorTP}` : ''}` : '- Contador Público: pendiente'}

${isComparative
  ? `## MODO COMPARATIVO (${periods.length} periodos: ${periodsListed})
Las notas materiales referencian saldo del periodo ${primaryPeriod} Y saldo comparativo del periodo ${comparativePeriod} con variación absoluta. El acta describe el ejercicio cerrado al ${primaryPeriod} con mención explícita de los EEFF comparativos de ${comparativePeriod} aprobados (NIC 1 §10).`
  : periods.length === 1
    ? `## MODO SINGLE-PERIOD
El preprocesador detectó un único periodo (${primaryPeriod}). Las notas referencian solo ese periodo.`
    : ''}

${actividadInferida && actividadInferida.descripcion ? `## Actividad económica inferida (Nota 1)
CIIU letra ${actividadInferida.sectorCIIU} — ${actividadInferida.descripcion}${actividadInferida.evidencia ? ` (evidencia: ${actividadInferida.evidencia})` : ''}.` : ''}

${comparativosImpracticables === true ? `## Impracticabilidad declarada por Agente 1
Las notas referencian ÚNICAMENTE el periodo ${primaryPeriod}; NO emitir columnas comparativas. Cita LITERAL NIIF for SMEs §3.14, §10.21.` : ''}

## Régimen de reserva legal
- Aplica: ${reservaLegalAplica ? 'SÍ' : 'NO'}.
- Cita: ${reserveLegalCitation}.
${isSAS && !estatutosRequierenReservaLegal ? '- Doctrina vinculante: Supersociedades Oficios 220-115333/2009 y 220-069664/2017 — Ley 1258/2008 NO obliga reserva legal en SAS sin habilitación estatutaria expresa.' : ''}

## Marco normativo de los EEFF
${niifFrameworkLabel(company.niifGroup)}

${langInstruction}
</context>`;
}

function niifFrameworkLabel(group: number | undefined): string {
  if (group === 1) return '- NIIF Plenas (Grupo 1 — Decreto 2420/2015).';
  if (group === 3) return '- Contabilidad Simplificada (Grupo 3 — Decreto 2706/2012, compilado en 2420/2015).';
  return '- NIIF para PYMES (Grupo 2 — Decreto 2420/2015 anexo 2).';
}
