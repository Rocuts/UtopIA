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
//     capitalización, firmas, dictamen RF).
//   - Reserva legal: SAS sin habilitación estatutaria NO la constituye
//     (Supersociedades Oficios 220-115333/2009 y 220-069664/2017).
//
// Ola de exactitud 2026-08 (auditoría de cálculos §3 — el acta puntuaba 2/10):
//   - TODA la aritmética del acta —reserva legal, capitalización y cada renglón
//     de destinación— se calcula ahora en centavos BigInt en
//     `contracts/base.ts` (`buildActaArithmetic`) y viaja al modelo como tokens
//     `[MoneyCop: N]` que COPIA. Antes la autoraba el LLM sin un solo cruce:
//     medido, una reserva del 10% sobre el patrimonio y una capitalización
//     deslizada del 40% al 4% ($802.258.844,31 de error) salían con `ok:true`,
//     `emittable:true` y descarga habilitada.
//   - Techo del Art. 452 C.Co. (50% del capital suscrito) y mínimo del Art. 155
//     C.Co. evaluados de forma determinista, no narrados.
//   - `estatutosRequierenReservaLegal` pasa a TRI-ESTADO: sin estatutos a la
//     vista el acta calla el régimen en vez de afirmarlo.
//   - Cinco citas normativas falsas retiradas (Art. 36-3 E.T. como exención,
//     Art. 40 y Art. 5 de la Ley 1258/2008, Art. 187 y Art. 154 atribuidos a la
//     Ley 222/1995 cuando son del Código de Comercio).
//   - Firmas estructuradas: SignatoriesSchema garantiza T.P. en formato "12345-T".
//   - Prohibición ABSOLUTA de frases evasivas (validador post-gen las detecta).
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { ActaArithmetic, ActaReserveRegime, ReportMode } from '../contracts/base';
import {
  buildActaArithmetic,
  deriveActaReserveRegime,
  normalizeEstatutosReservaLegal,
  regimeConstituyeReservaLegal,
} from '../contracts/base';
import { moneyCopToken } from '../contracts/anchors';
import { formatCopFromCents } from '../contracts/money';
import { buildAntiHallucinationGuardrail } from './anti-hallucination';
import { buildColombia2026Context } from './colombia-2026-context';
import { buildNiifDisclosureKnowledge } from './niif-colombia-knowledge';
import { buildResilienceSection0 } from './resilience-section0';

export interface GovernanceEliteContext {
  comparativosImpracticables?: boolean;
  actividadInferida?: { sectorCIIU: string; descripcion: string; evidencia?: string };
  /** Bloque <hechos_empresa> pre-renderizado (Ola 2). '' o undefined = no se inyecta. */
  hechosEmpresa?: string | null;
}

export function buildGovernancePrompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  preprocessed?: PreprocessedBalance,
  elite?: GovernanceEliteContext,
  reportMode: ReportMode = 'COMPARATIVO_COMPLETO',
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
  //
  // TRI-ESTADO (auditoría 2026-08 §3): `estatutosRequierenReservaLegal` no tiene
  // productor en el repositorio, así que llega SIEMPRE `undefined`. Colapsarlo
  // con `=== true` hacía que toda SAS afirmara —en un acta firmada por su
  // representante legal e inscrita en Cámara de Comercio— que sus estatutos NO
  // exigen reserva legal. Nadie leyó esos estatutos. Con el tri-estado el acta
  // calla el régimen en vez de inventarlo.
  const estatutosReservaLegal = normalizeEstatutosReservaLegal(
    (company as unknown as { estatutosRequierenReservaLegal?: unknown })
      .estatutosRequierenReservaLegal,
  );
  const reserveRegime: ActaReserveRegime = deriveActaRegimeForCompany(company);
  const reservaLegalAplica = regimeConstituyeReservaLegal(reserveRegime);
  const reserveLegalCitation = RESERVE_REGIME_CITATION[reserveRegime];
  const entityRegimeCitation = isSAS
    ? 'Ley 1258 de 2008 (SAS)'
    : isLtda
      ? 'Código de Comercio (sociedades limitadas)'
      : 'Ley 222 de 1995 y Código de Comercio';

  const guardrail = buildAntiHallucinationGuardrail(language);
  const resilience0 = buildResilienceSection0(language);
  const context2026 = buildColombia2026Context(language);
  const niifDisclosures = buildNiifDisclosureKnowledge(language);

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

  // Aritmética VINCULANTE del acta — calculada aquí en centavos BigInt y
  // entregada como tokens `[MoneyCop: N]`. Ninguna de estas cifras la autora el
  // modelo: son proyecciones deterministas de la utilidad neta del ejercicio.
  const acta = buildActaPrimaryArithmetic(preprocessed, reserveRegime);
  const actaBindingBlock = acta
    ? renderActaBindingBlock(acta, memberTerm, isSAS)
    : // Sin `controlTotals.cents` no hay cifra determinista que copiar. El acta
      // se emite SIN aritmética antes que con aritmética inventada: un reparto
      // de dinero estimado por el modelo es peor que un acta que no reparte.
      [
        '## CIFRAS VINCULANTES DEL ACTA — NO DISPONIBLES',
        'El preprocesador no entregó los totales de control en centavos, de modo que no hay cifras deterministas de reserva legal, capitalización ni destinación.',
        'NEVER calcular esas cifras: shareholderMinutes.resultDistribution.applies=false con lines=[] y neutralProposalText que remite la decisión a la asamblea;',
        'shareholderMinutes.capitalizationProposal.applies=false. La limitación se declara en preparerNotes.',
      ].join('\n');

  return `${guardrail}

${resilience0}

${context2026}

${niifDisclosures}

<task>Producir el sustento legal y normativo del cierre de ${company.name} (NIT ${company.nit}) — DOCUMENTO 1: Notas a los Estados Financieros (NIC 1 §112-138 / Sec. 8 PYMES) + DOCUMENTO 2: Acta de ${assemblyType} Ordinaria + DOCUMENTO 3: Checklist de Cumplimiento Normativo (Parte III §3 spec v2.0) + DOCUMENTO 4: Disclaimers Automáticos (Parte 9 spec v2.0) — devolviendo JSON validado contra GovernanceReportSchema.</task>

<success_criteria>
- financialNotes cubre las 16 notas canónicas (1..16): cada nota lleva number, title, body, materiality. Las inmateriales se marcan materiality="immaterial" y las que no aplican materiality="omitted" con body explicando por qué.
- Corrección 6 v2.1 — Numeración secuencial de notas SIN saltos: MUST: las notas en financialNotes[] se numeran SECUENCIALMENTE desde 1 hasta N (sin saltos). Si una nota canónica NO aplica a esta empresa, NO la emitas (omítela completa). Las notas restantes se RENUMERAN consecutivamente: 1, 2, 3, ... contiguos. NEVER saltar números (ej: pasar de Nota 6 a Nota 8 dejando hueco). Ejemplo: si la entidad es servicios sin inventarios (Nota canónica "Inventarios" no aplica) Y no tiene partes vinculadas (Nota canónica "Partes Vinculadas" no aplica), el output emite las notas que SÍ aplican renumeradas 1, 2, 3, 4, 5, 6, 7, 8... sin hueco. NEVER emitir: Nota 1, 2, 3, 4, 5, 7, 8, 9 — ese salto de 5 a 7 viola la spec v2.1 Corrección 6.
- Toda cifra material citada en las notas y en el acta coincide al centavo con TOTALES VINCULANTES.
- CHECK obligatorio CIFRAS ACTA == CIFRAS EEFF: utilidad neta del acta ≡ utilidad neta del Estado de Resultados (al centavo). Total Activo / Pasivo / Patrimonio del acta ≡ totales del Balance. PROHIBIDO presentar el campo "utilidad neta" como $33,22 ó cualquier valor inferior a $1.000.000 cuando los EEFF reportan utilidades en miles de millones. La fuente única es el bloque TOTALES VINCULANTES (binding totals).
- FORMATO obligatorio: cifras del acta SIEMPRE en pesos colombianos formato $1.234.567,89 (separador miles ".", decimal ","). NUNCA emitir centavos crudos sin formato ("222849678973"), ni notación científica ($2.23E9), ni abreviaturas ambiguas ("$33,22 M" sin contexto). Para cifras > $1.000.000.000 se permite abreviado contextual ($2.228 millones) SOLO entre paréntesis después del valor completo.
- shareholderMinutes.convocationStatement declara explícitamente modalidad y antelación de la convocatoria (Art. 424 C.Co.) — sin esta declaración la asamblea es impugnable.
- shareholderMinutes.agenda contiene mínimo 8 puntos canónicos (Art. 187 C.Co. — funciones de la asamblea): verificación convocatoria + quorum, aprobación EEFF (num. 2), informe de gestión (num. 5), aprobación de la gestión de los administradores, destinación de resultados (num. 3), designación/ratificación de cargos (num. 4), varios, cierre.
- shareholderMinutes.resultDistribution reproduce EXACTAMENTE el bloque CIFRAS VINCULANTES DEL ACTA: \`applies\`, los \`lines[]\` con su \`label\`, su \`amountCop\` copiado del token \`[MoneyCop: N]\` y su \`normReference\`. Los renglones NO se recalculan ni se reordenan, y su suma es igual a la utilidad neta del ejercicio con tolerancia $0.
- shareholderMinutes.signatures contiene mínimo Presidente + Secretario + Representante Legal. Si la entidad tiene Revisor Fiscal y/o Contador identificados, también aparecen.
- fiscalReviewerOpinion: applies=true solo si la entidad está obligada por Art. 203 C.Co. + Art. 13 Ley 43/1990 (activos > 5.000 SMMLV o ingresos > 3.000 SMMLV) o estatutos lo exigen; cuando applies=false, exemptionReason cita el umbral.
- capitalizationProposal reproduce el bloque CIFRAS VINCULANTES DEL ACTA: \`applies\`, \`retainedEarningsBaseCop\` y \`capitalizationAmountCop\` se COPIAN de sus tokens \`[MoneyCop: N]\`. NO se multiplica, NO se deriva un porcentaje, NO se toma la cifra de otra parte del informe. \`legalReference\` = "Ley 1258/2008 art. 29 (reforma estatutaria — mayoría de la mitad más una de las acciones presentes) + Art. 30 E.T. (dividendo en especie) — inscripción en el Registro Mercantil".
- complianceChecklist contiene mínimo 8 ítems tipados (Parte III §3 spec v2.0): cada ítem con topic, norma, status, evidencia, accionRequerida. Cubrir áreas críticas: NIIF aplicable, distribución utilidades, reserva legal, Revisor Fiscal, libros oficiales, Informe Gestión §46 Ley 222/1995, partes vinculadas NIC 24, autorización publicación NIC 10 §17.
- disclaimers se puebla SOLO con los códigos del spec Parte 9 cuya condición activadora se cumple en preprocessed/anchors. Vacío si ninguna aplica. NO inventar disclaimers.
${isComparative ? `- Las notas materiales referencian saldo del periodo ${primaryPeriod} Y saldo comparativo del periodo ${comparativePeriod} con variación absoluta.` : `- Single-period: las notas referencian solo ${primaryPeriod}; declarar "Sin periodo comparativo disponible" cuando aplique.`}
</success_criteria>

<constraints>
- MUST: toda cifra de las notas y del acta proviene de TOTALES VINCULANTES (binding totals). NO recalcular Utilidad Neta, Total Patrimonio, Ingresos, etc.
- MUST: el dictamen del Revisor Fiscal (cuando applies=true) cita NIA 700/705/706 + Art. 207-209 C.Co. + Ley 43 de 1990.
- MUST: el acta NO contiene placeholders visibles (corchetes con instrucciones, signo peso con corchete, guiones bajos como campo de dato). Si una fecha/hora exacta no se conoce, omitir el campo o usar el placeholder literal "— (dato no suministrado)" SOLO dentro de preparerNotes.
- MUST — FUENTE ÚNICA Y ESCALA DE CIFRAS DEL ACTA (corrección v2.5 #13). Todas las cifras monetarias del acta se COPIAN LITERALMENTE del Estado de Resultados y del Estado de Situación Financiera ya emitidos en TOTALES VINCULANTES (anchors Pass-1). PROHIBIDO recalcular, dividir entre 100/10⁸, multiplicar, redondear, re-derivar o tomar cifras de variables internas del sistema. Mapeo autoritativo (fuente → campo del acta):
    Utilidad Neta del Ejercicio          → \`incomeStatement.netIncomePrimary\`            → "Destinación de resultados" / base capitalización
    Total Activo                         → \`balanceSheet.totalAssetsPrimary\`             → "Aprobación de EEFF"
    Total Pasivo                         → \`balanceSheet.totalLiabilitiesPrimary\`        → "Aprobación de EEFF"
    Total Patrimonio                     → \`balanceSheet.totalEquityPrimary\`             → "Aprobación de EEFF"
    Saldo acumulado utilidades retenidas → \`equityChanges.closing_balance.resultadosAcumulados\` → mención informativa (NO base del 40%)
    Reserva legal del ejercicio          → bloque CIFRAS VINCULANTES DEL ACTA               → \`resultDistribution.lines[]\`
    Reserva ocasional                    → bloque CIFRAS VINCULANTES DEL ACTA               → \`resultDistribution.lines[]\`
    Saldo distribuible                   → bloque CIFRAS VINCULANTES DEL ACTA               → \`resultDistribution.lines[]\`
    Base de capitalización               → bloque CIFRAS VINCULANTES DEL ACTA               → \`capitalizationProposal.retainedEarningsBaseCop\`
    Monto a capitalizar                  → bloque CIFRAS VINCULANTES DEL ACTA               → \`capitalizationProposal.capitalizationAmountCop\`
  Si el TOTAL VINCULANTE viaja en MoneyCop centavos string, el operador es formatCopFromCents(centavos, false) — NUNCA aritmética sobre la cadena cruda, NUNCA división implícita por 100 (la conversión centavos→pesos vive en formatCopFromCents).
- MUST — ARITMÉTICA DEL ACTA: NO LA HAGAS. La reserva legal, la capitalización y cada renglón de destinación vienen ya calculados en centavos exactos en el bloque CIFRAS VINCULANTES DEL ACTA, cada uno con su token \`[MoneyCop: N]\`. Se copian carácter por carácter al campo \`MoneyCop\` correspondiente. NEVER multiplicar la utilidad por 0,10 / 0,40 / 0,50 para obtenerlos; NEVER calcular la reserva legal sobre el patrimonio, sobre los ingresos, sobre el activo ni sobre el saldo acumulado de utilidades retenidas — la base legal es la utilidad líquida DEL EJERCICIO (Art. 452 C.Co.); NEVER derivar una cifra del acta a partir de otra cifra del acta.
  Casos bandera roja MEDIDOS (auditoría 2026-08 §3), ambos atravesaron el sistema sin una sola señal:
    - reserva legal calculada sobre el PATRIMONIO: $222.343.999,15 emitido donde correspondían $222.849.678,97.
    - capitalización con el porcentaje deslizado del 40% al 4%: $89.139.871,58 emitido donde correspondían $891.398.715,89 (error de $802.258.844,31 en un documento que reparte dinero).
- MUST — CHECK previo a emitir el acta (ejecutar antes de devolver el JSON):
    utilidad_neta_acta            == netIncomePrimary               (al centavo, tolerancia $0)
    total_activo_acta             == totalAssetsPrimary             (al centavo, tolerancia $0)
    total_pasivo_acta             == totalLiabilitiesPrimary        (al centavo, tolerancia $0)
    total_patrimonio_acta         == totalEquityPrimary             (al centavo, tolerancia $0)
    cada renglón de destinación   == su token del bloque vinculante (al centavo, tolerancia $0)
    Σ renglones de destinación    == utilidad neta del ejercicio    (al centavo, tolerancia $0)
    base_capitalización_acta      == token de "Base de la capitalización"
    monto_capitalización_acta     == token de "Monto a capitalizar"
  Si cualquiera de los ocho checks falla → NO emitir el acta; registrar la discrepancia en preparerNotes (NO en el body visible) hasta que cuadre.
- NEVER en shareholderMinutes.* (resultDistribution, capitalizationProposal, agenda, body, considerations): emitir cifras inferiores a $1.000.000 cuando los TOTALES VINCULANTES de la misma empresa reportan utilidad neta > $100.000.000. Casos bandera roja documentados:
    - 2026-05-14 v2.2 #5: utilidad real $2.228.496.789,73 emitida como "$33,22" (división por ~10⁸).
    - 2026-05-14 v2.5 #13: misma utilidad emitida como "$0,02" en sección "Destinación del resultado" (escala internalCents → COP fallida).
  Cualquier desviación de escala > 3 órdenes de magnitud entre netIncomePrimary y la cifra emitida en el acta bloquea la emisión.
- MUST: T.P. del Revisor Fiscal y del Contador Público en formato "12345-T" (Ley 43/1990 art. 3 — Junta Central de Contadores). Si no se conoce, identification=null y el renderer pondrá un placeholder visible.
- MUST: el quorum se afirma como "se verificó el quorum conforme a los estatutos sociales" — NUNCA inventar porcentajes de capital representado. Distinción que NO es excepción a la regla anterior: la MAYORÍA QUE EXIGE LA LEY para una decisión (78% del Art. 155 C.Co. cuando el reparto queda bajo el mínimo; mitad más una de las acciones presentes del Art. 29 Ley 1258/2008 para una reforma estatutaria) es un dato normativo y el acta DEBE declararlo cuando el bloque vinculante lo indique. Lo prohibido es afirmar cuánto capital estuvo representado en la reunión.
- NEVER emitir las frases "no se suministró información" (sin complemento), "información no detallada" (sin razón), "datos no disponibles" (sin justificación), "falta de totales vinculantes", "totales vinculantes no provistos", "información no provista por el cliente", "pendiente de validación", "sujeto a verificación", "sujeto a confirmación", "no se contó con los datos", "no se cuenta con la información" en body libre de notas o acta. Los 6 disclaimers literales del spec Parte 9 SON LA EXCEPCIÓN — viven en \`disclaimers[]\` con \`code\` enumerado, son entidades estructuradas exentas del detector regex; NO emitirlos como prosa libre dentro de financialNotes[].body o shareholderMinutes.\*.
- NEVER inventar fechas de constitución, números de matrícula, NITs de socios, ciudades sin sustento.
- NEVER en pasivos laborales usar la distribución "35/35/30" (es incorrecta). Si no hay auxiliares de Clase 25, la distribución legal es: Cesantías 38,17% (Ley 50/1990 art. 99 + CST art. 249) + Intereses sobre Cesantías 4,58% (Ley 52/1975 art. 1) + Prima de Servicios 38,17% (CST art. 306) + Vacaciones 19,08% (CST art. 186). Total: 100,00%.
- NEVER — CITAS NORMATIVAS PROHIBIDAS EN EL ACTA. Estas cinco son falsas y ya llegaron firmadas al cliente. Si alguna aparece en el material de contexto de este mismo prompt, ESTE RAIL PREVALECE:
  · NEVER "Art. 36-3 E.T." como fundamento de exención de la capitalización. El inciso primero de esa norma (modificada por el Art. 37 de la Ley 1819 de 2016) cubre ÚNICAMENTE la capitalización de la cuenta de Revalorización del Patrimonio, y su inciso segundo aplica EXCLUSIVAMENTE a sociedades cuyas acciones se cotizan en bolsa. Capitalizar utilidad del ejercicio en una sociedad cerrada NO queda exento. Norma correcta: Art. 30 E.T. (es dividendo en especie) + Arts. 48 y 49 E.T. (depuración de la porción no gravada) + Arts. 242 / 242-1 / 245 E.T. (retención según la calidad del accionista), con respaldo en DIAN Oficio 1171 de 2019 num. 2.8 y Oficio 0348 del 18-03-2020.
  · NEVER "Art. 40 de la Ley 1258 de 2008" como fuente de la reserva legal de la SAS. El Art. 40 regula la resolución de conflictos societarios (arbitraje y amigable composición). La norma correcta es el Art. 45 (Remisión).
  · NEVER "Ley 1258/2008 art. 5" para una capitalización. El Art. 5 es el contenido del documento de CONSTITUCIÓN. Un aumento de capital es reforma estatutaria: Art. 29 Ley 1258/2008, que además fija la mayoría de la mitad más una de las acciones presentes en la reunión e impone la inscripción en el Registro Mercantil.
  · NEVER "Art. 187 de la Ley 222/1995". Ese artículo regula el trámite de las acciones revocatorias y de simulación y fue DEROGADO por el Art. 126 de la Ley 1116 de 2006. Las funciones de la asamblea están en el Art. 187 del CÓDIGO DE COMERCIO: num. 2 aprobar los estados financieros, num. 3 disponer de las utilidades, num. 4 hacer las elecciones, num. 5 considerar los informes de los administradores.
  · NEVER "Ley 222/1995 art. 154" para la distribución de utilidades. Las reservas ocasionales son el Art. 154 del CÓDIGO DE COMERCIO y el mínimo a repartir es el Art. 155 C.Co. (modificado por el Art. 240 de la Ley 222/1995).

If reserveRegime="indeterminado" then shareholderMinutes.resultDistribution.applies=false y lines=[]; neutralProposalText="Los ${memberTerm} resolverán la destinación de la utilidad del ejercicio con vista en los estatutos sociales, que determinan si procede la apropiación de reserva legal (Art. 45 Ley 1258 de 2008 — remisión). De proceder, la apropiación del 10% de la utilidad líquida del ejercicio prevista en el Art. 452 C.Co. corresponde a la cifra consignada en los considerandos del acta."; el acta NO afirma que los estatutos exijan reserva legal ni que no la exijan; preparerNotes incluye "Estatutos sociales no suministrados: no se pudo determinar si habilitan reserva legal (Art. 45 Ley 1258/2008)"; financialNotes de Patrimonio describe el régimen como no determinado por falta del documento estatutario
otherwise si reserveRegime="no_obligatoria" then applies=false y lines=[]; neutralProposalText="Los ${memberTerm} decidirán la destinación de la utilidad del ejercicio entre distribución de ${isLtda ? 'participaciones' : 'dividendos'} y utilidades retenidas, sin constitución de reserva legal por no exigirla los estatutos sociales (Art. 45 Ley 1258 de 2008 — remisión). Supersociedades Oficios 220-115333/2009 y 220-069664/2017."; financialNotes de Patrimonio cita "Reserva legal NO obligatoria — entidad SAS sin habilitación estatutaria"
otherwise applies=true, neutralProposalText=null y lines[] copiados renglón por renglón del bloque CIFRAS VINCULANTES DEL ACTA (reserva legal ${reserveLegalCitation}; reserva ocasional Art. 154 C.Co.; saldo distribuible Art. 155 C.Co.).

If el bloque CIFRAS VINCULANTES DEL ACTA declara "Techo del Art. 452 C.Co." then el acta declara en el desarrollo del punto de destinación cuánto de la reserva legal queda aún exigible hasta ese techo, y si el techo ya se alcanzó afirma que la apropiación exigible del ejercicio es $0,00 citando el Art. 452 C.Co. otherwise el acta declara que el capital suscrito y pagado no aparece desagregado en el balance suministrado y que por ello el techo del Art. 452 C.Co. no se evalúa, dejando la constancia en preparerNotes.

If el bloque CIFRAS VINCULANTES DEL ACTA declara \`capitalizationProposal.applies = true\` then capitalizationProposal se puebla así:
  - retainedEarningsBaseCop = token de "Base de la capitalización" (utilidad neta del ejercicio — NO el saldo acumulado del PUC 36).
  - capitalizationAmountCop = token de "Monto a capitalizar".
  - legalReference = "Ley 1258/2008 art. 29 (reforma estatutaria — mayoría de la mitad más una de las acciones presentes) + Art. 30 E.T. (dividendo en especie) — inscripción en el Registro Mercantil".
  - body LITERAL: "Capitalización de utilidades del ejercicio aprobado. La Asamblea propone capitalizar la porción de la utilidad neta del ejercicio indicada en esta proposición, con cargo al saldo distribuible y no en adición a él, mediante reforma estatutaria conforme al Art. 29 de la Ley 1258 de 2008, que exige el voto favorable de accionistas que representen cuando menos la mitad más una de las acciones presentes en la reunión y la inscripción de la determinación en el Registro Mercantil${isSAS ? ' mediante documento privado' : '; para sociedades regidas por el Código de Comercio la reforma consta en escritura pública'}. La base de la capitalización es la utilidad neta del ejercicio consignada en el Estado de Resultados aprobado en el punto previo del orden del día; las utilidades retenidas acumuladas (PUC 36) se reseñan como contexto patrimonial y NO constituyen la base. La capitalización de utilidades del ejercicio constituye distribución de dividendos en especie conforme al Art. 30 E.T.: la sociedad deberá depurar la porción no gravada según los Arts. 48 y 49 E.T. y practicar la retención en la fuente de los Arts. 242, 242-1 o 245 E.T. según la calidad de cada accionista, sobre el valor bruto de las acciones distribuidas (DIAN, Oficio 1171 de 2019, num. 2.8, y Oficio 0348 del 18 de marzo de 2020). El Art. 36-3 E.T. no otorga exención a esta operación: su inciso primero cubre únicamente la capitalización de la cuenta de Revalorización del Patrimonio y su inciso segundo aplica exclusivamente a sociedades cuyas acciones se cotizan en bolsa."
otherwise applies=false con base y amount copiados igualmente de sus tokens.

If actividadInferida.descripcion existe then financialNotes[number=1].body usa LITERALMENTE esa descripción como objeto social — solo letra CIIU "${actividadInferida?.sectorCIIU ?? 'G'}", NUNCA código de 4 dígitos sin RUT verificado otherwise inferir el objeto social del comportamiento de las cuentas (Clase 4 vs Clase 6) y declarar la inferencia.

If la entidad NO está obligada a Revisor Fiscal (Art. 203 C.Co.: sociedades por acciones, sucursales de extranjeras, o que superen Art. 13 Ley 43/1990 — activos > 5.000 SMMLV o ingresos > 3.000 SMMLV) Y no tiene RF identificado then fiscalReviewerOpinion.applies=false; exemptionReason="Entidad no obligada a Revisor Fiscal por umbral de Art. 203 C.Co. + Art. 13 Ley 43/1990"; en signatures NO incluir entrada role=revisor_fiscal otherwise applies=true con reviewerName, reviewerTp en formato "12345-T", opinionType y opinionBody (síntesis NIA 700/705/706 + Art. 207-209 C.Co.).

If comparativosImpracticables=true (delegado del Agente 1) then las notas materiales referencian ÚNICAMENTE el periodo ${primaryPeriod}; NO emitir columnas comparativas; financialNotes incluye una nota técnica con cita LITERAL NIIF for SMEs §3.14, §10.21 otherwise referenciar ambos periodos cuando applicable.

Notas obligatorias de cobertura mínima (NIC 1 / Sec. 8 PYMES):
1 Entidad y Actividad Económica; 2 Políticas Contables Significativas (going concern, moneda funcional COP, reconocimiento ingresos NIIF 15 / Sec. 23, deterioro NIIF 9 / enfoque simplificado PYMES, inventarios, PPE, beneficios a empleados); 3 Efectivo y Equivalentes; 4 Deudores Comerciales (modelo de deterioro); 5 Inventarios (valuación + valor neto realizable); 6 PPE (movimiento del periodo, vidas útiles); 7 Obligaciones Financieras (CP/LP, garantías); 8 Cuentas por Pagar y Proveedores; 9 Impuestos, Gravámenes y Tasas (renta 35% Art. 240 E.T., TMT 15% si aplica, NIC 12 diferencias temporarias, IVA, ICA, ReteFuente); 10 Pasivos Laborales (distribución 38,17/4,58/38,17/19,08 cuando no hay auxiliares); 11 Patrimonio (capital autorizado/suscrito/pagado + reserva legal según el régimen del bloque CIFRAS VINCULANTES DEL ACTA, incluido el techo del Art. 452 C.Co. cuando sea evaluable); 12 Ingresos Operacionales (NIIF 15 / Sec. 23); 13 Contingencias y Hechos Posteriores (NIC 10 / Sec. 32 — afirmar explícitamente "no se identifican hechos posteriores" cuando aplique); 14 Preparación IFRS 18 — NUNCA omitir esta nota, siempre presente con su materiality correspondiente: If company.niifGroup === 1 then materiality="material" con body que cita IFRS 18 (vigencia 2027 para Grupo 1 Colombia), identifica MPMs candidatas del sector, y describe brechas de datos conocidas — la entidad DEBE iniciar preparación en 2026 para adoptar en 2027. If company.niifGroup ∈ {2, 3} then materiality="immaterial" con body LITERAL: "IFRS 18 no aplica directamente para Grupo ${niifGroupNumLabel(company.niifGroup)}; se informa como horizonte normativo del Grupo 1 (vigencia 2027). La entidad no está obligada a su preparación conforme Decreto 2420/2015." — NO silenciar la nota, NO emitirla como omitted; 15 Partes Vinculadas y Personal Clave Directivo (NIC 24 §13-22 / Sec. 33 PYMES — revelar transacciones con matriz/subsidiarias/asociadas, compensaciones a personal clave directivo, garantías cruzadas, préstamos entre partes vinculadas; si no se identifican transacciones con partes vinculadas, materiality="immaterial" con afirmación explícita); 16 Autorización para la Publicación de los Estados Financieros (NIC 10 §17 / Sec. 32.9 PYMES — fecha de autorización + órgano que autoriza la publicación, típicamente Junta Directiva o Representante Legal con respaldo de Asamblea).

Identidad fiscal en Nota 9: utilidadNeta = utilidadAntesImpuestos − impuestoCausado. El impuesto SIEMPRE aparece como RESTA en la conciliación; PROHIBIDO sumar.

MUST: cada FinancialNote con cifra crítica lleva confidence ∈ {high, medium, low}. Usar high cuando la cifra proviene LITERALMENTE de TOTALES VINCULANTES. Usar medium cuando el auxiliar fuente es parcial o inferido. Usar low cuando la cifra está pendiente de validación humana. Null es equivalente a high — solo omitir si no hay cifra crítica en la nota.

MUST: notas técnicas (financialNotes[].body) usan tono impersonal, presente indicativo.
- Permitido: "Se reconoce", "Se mide", "Se presenta", "La entidad reconoce", "Se clasifica", "Se deprecia".
- Prohibido: "Se reconoció", "Se midió", "Se presentó", "La entidad reconoció" — EXCEPTO cuando la nota describe hecho histórico específico del periodo (asamblea pasada, evento subsecuente ya ocurrido, constitución de una reserva concreta en el ejercicio cerrado). En ese caso el pasado es correcto y obligatorio.

NEVER usar en body de financialNotes[], en el body del acta (shareholderMinutes.*), en fiscalReviewerOpinion.opinionBody, en complianceChecklist[].evidencia ni en complianceChecklist[].accionRequerida los siguientes términos: "Élite", "Excelencia", "Premium", "Excepcional", "Único", "Mejor" (como adjetivo absoluto), "Sólido", "Robusto", "Extraordinario", "excelente", "buen año", "fuerte" (como elogio), "destacado".
La autoridad del reporte proviene de la precisión y del respaldo normativo, no del adjetivo (§1.6 spec v8.1). El detector regex post-generación captura estas palabras como violaciones bloqueantes.

- Corrección 7 v2.1 — NEVER emitir "Notas internas del preparador": NEVER emitir en financialNotes[], en complianceChecklist[], en shareholderMinutes.* ni en ningún campo de body libre: secciones tituladas "Notas internas del preparador" o variantes ("Notas del preparador", "Internal preparer notes", "Notas de preparación interna", "Notas internas de proceso"); secciones marcadas "(NO incluir en EEFF firmables)" o equivalentes; comentarios sobre el proceso de generación interna del sistema; metadata del sistema de procesamiento (versiones, pipelines, nombres de agentes). El campo preparerNotes[] del schema existe ÚNICAMENTE para datos faltantes declarados explícitamente por el preparador humano responsable (ej. "Cédula del representante legal pendiente"). NEVER usar preparerNotes[] para notas de proceso de generación AI, comentarios internos del sistema ni limitaciones de datos — esas limitaciones van EXCLUSIVAMENTE en disclaimers[] con el code enumerado correspondiente (Parte 9 spec v2.0). If preparerNotes[] no tiene datos faltantes reales del preparador humano, then emitir preparerNotes=[] (array vacío).

- NEVER (REFUERZO v2.2 #6 — metadata interna del sistema). En CUALQUIER body de shareholderMinutes, financialNotes, fiscalReviewerOpinion, complianceChecklist, disclaimers: NUNCA emitir términos del sistema interno:
  • Identificadores de pases del agente: "Pass-1", "Pass-2", "Pass-3", "Pass 1", "primer pase", "anchor Pass-1", "según anchor".
  • Nombres de variables internas: "netIncomePrimary", "totalEquityPrimary", "totalAssetsPrimary", "totalLiabilitiesPrimary", "amountPrimary", "amountComparative", "curatorFlags", "equityConvergenceApplied", "cashFlowClosureForced", "negativeAssetReclassified", "presumedCostWarning", "reclassifiedAmountCop".
  • Identificadores de cuentas virtuales del curator: "2810ZZ", "ZZ", "XX" como sufijos PUC, "cuenta virtual", "cuenta transitoria curator", "cuenta sintética".
  • Variables de movimiento interno: "3605-movimiento-periodo", "movimiento 3605", "Δ 3605", "varCuentasPorCobrar" / "varInventarios" / "varCuentasPorPagar" (nombres de variables — NO el concepto contable).
  • Referencias al orquestador: "el orquestador indicó", "el preprocesador reporta", "según el orquestador", "binding totals dijo", "controlTotals".
  • Encabezados internos del preparador: "NOTAS INTERNAS DEL PREPARADOR", "NO incluir en EEFF firmables", "Advertencia interna de Valoración", "Notas del Preparador" (cualquier sección con este encabezado se OMITE — el output es el ENTREGABLE al cliente).
  • Cifras en formato técnico crudo: "241367788864 centavos", cualquier número entero > 8 dígitos sin separadores, identificadores numéricos entre comillas ("419656644290").
  Si el agente necesita anotar un detalle técnico para auditoría interna, lo hace EXCLUSIVAMENTE en preparerNotes (campo estructurado del schema — NO visible al cliente). El body de cualquier documento entregable es comunicación dirigida al socio / asambleísta / RF / DIAN.

Defensa Art. 647 E.T.: si los ajustes del Curator (R1, R5, R6, R7, R-Élite 3.b, R-Élite 4) produjeron diferencias con el reporte original del software contable o con la liquidación tributaria del periodo anterior, las notas técnicas correspondientes invocan la doctrina de "diferencia de criterio" del Art. 647 E.T. + Concepto DIAN 100208221-1352 de 2018 — los hechos económicos están plenamente documentados en el papel de trabajo del preparador, por lo que NO configuran inexactitud sancionable.

Orden del día canónico del acta (Art. 187 C.Co. — funciones de la asamblea; mínimo 8 puntos):
1) Verificación de Convocatoria (Art. 424 C.Co.) — declarar modalidad y antelación con que se citó; sin esta declaración la asamblea es impugnable por defecto de convocatoria.
2) Verificación del quorum + designación de presidente y secretario + lectura y aprobación del orden del día.
3) Presentación y aprobación de los estados financieros del periodo ${primaryPeriod} (Art. 187 num. 2 C.Co.).
4) Informe de gestión del Representante Legal (Art. 46 Ley 222/1995) + Dictamen del Revisor Fiscal (NIA 700/705/706) cuando fiscalReviewerOpinion.applies=true.
5) Aprobación de la gestión de los administradores (Art. 187 num. 5 C.Co. — considerar los informes de los administradores — + Art. 422 C.Co.) — aprobación o improbación expresa de la gestión, con efectos del Art. 200 C.Co. (modificado por el Art. 24 de la Ley 222/1995) y de la acción social de responsabilidad del Art. 25 de la Ley 222/1995.
6) Destinación de utilidades / cubrimiento de pérdidas (Art. 187 num. 3 C.Co. + Arts. 151, 154, 155 y 451-455 C.Co.) — enjugamiento de pérdidas anteriores, apropiación de reserva legal con el techo del Art. 452 C.Co., reservas ocasionales del Art. 154 C.Co., saldo distribuible y verificación del mínimo del Art. 155 C.Co.; capitalización cuando el bloque vinculante la declare aplicable.
7) Designación o ratificación de cargos (Art. 187 num. 4 C.Co.): Revisor Fiscal (Art. 204 C.Co.) y miembros de Junta Directiva (Art. 198 C.Co.) cuando el periodo estatutario lo requiera. Si no corresponde renovación, declarar explícitamente "se ratifica el cargo del Revisor Fiscal/Junta Directiva por el periodo estatutario vigente".
8) Proposiciones y varios + aprobación del acta y cierre.

Para el desarrollo del Punto 1 (Verificación de Convocatoria), shareholderMinutes.convocationStatement DEBE incluir texto literal: "Se hizo la convocatoria conforme al Art. 424 C.Co. con [N] días de antelación, mediante [medio: aviso en diario regional / comunicación escrita a cada accionista / página web corporativa según estatutos]". Si la entidad cita Junta de Socios LTDA, citar Art. 369 C.Co. en su lugar.

Bloque de firmas (signatures) — entradas obligatorias:
- presidente_asamblea (name puede ser null)
- secretario_asamblea (name puede ser null)
- representante_legal (name + identification=C.C. cuando se conozcan)
- contador_publico (name + identification=T.P. en formato "12345-T" cuando se conozcan)
- revisor_fiscal — solo si fiscalReviewerOpinion.applies=true (identification=T.P. formato "12345-T")

**Disclaimers Automáticos (Parte 9 spec v2.0).** Emite \`disclaimers[]\` con el código y texto LITERAL de la tabla de abajo, una entrada por cada condición real detectada en preprocessed o anchors. NO inventes disclaimers que no apliquen — \`disclaimers[]\` puede ser vacío. La regla: cada disclaimer es una entidad estructurada con \`code\` enumerado, NO prosa libre en los body de las notas. El detector regex anti-evasivo opera sobre body libre y EXONERA \`disclaimers[]\` por contrato.

| code | texto LITERAL (palabras exactas) | condición activadora |
|---|---|---|
| laboral_sin_detalle | "No se suministró detalle de obligaciones laborales; rubro excluido del análisis de pasivos." | preprocessed.classes['25'].auxiliaryCount === 0 O saldoTotal Clase 25 < $100.000 |
| costo_insuficiente | "Costo de ventas insuficiente para calcular días de inventario y ciclo operativo con precisión económica." | (costoVentas Clase 6 + costoProduccion Clase 7) < 0.01 × ingresos Clase 4 |
| impuesto_no_reconciliable | "Impuesto de renta registrado no permite reconstruir conciliación fiscal; cifra usada es la contable." | brecha entre impuesto contable (Clase 54) y teórico (35% × UAI) supera umbral material |
| sin_comparativo | "Sin datos comparativos del año anterior; análisis de tendencias y algunos KPIs no disponibles." | preprocessed.comparative === null |
| ajuste_3605 | "Ajuste 3605 aplicado automáticamente para efectos de presentación; no ha sido validado por el contador responsable." | curatorFlags.equityConvergenceApplied O cashFlowClosureForced (señalado por Agente 1) |
| inversiones_negativas | "Inversiones en asociadas presentan saldo negativo; requiere revisión documental antes de publicar." | preprocessed.classes['12'] contiene cuenta con saldo < 0 |

**Checklist de Cumplimiento Normativo (Parte III §3 spec v2.0).** Emite \`complianceChecklist[]\` con mínimo 8 ítems estructurados que cubran las áreas críticas. Cada ítem: topic + norma + status (cumplido | parcial | pendiente | no_aplica) + evidencia (referencia al hecho real) + accionRequerida (null si status=cumplido). Áreas mínimas a cubrir:

1. Marco NIIF aplicable (Decreto 2420/2015 — Grupo 1/2/3 según niifGroup)
2. Reserva Legal (Art. 452 C.Co. incluido su techo del 50% del capital suscrito, o Art. 45 Ley 1258/2008 según régimen; status="pendiente" cuando el régimen sea indeterminado por falta de estatutos)
3. Distribución de Utilidades (Arts. 151, 154, 155 y 451-455 C.Co.; el Art. 155 fue modificado por el Art. 240 de la Ley 222/1995)
4. Revisor Fiscal (Art. 203 C.Co. + Art. 13 Ley 43/1990 — obligatoriedad por umbrales)
5. Libros Oficiales registrados (Art. 28 C.Co. — libro de actas, accionistas, mayor)
6. Informe de Gestión (Art. 46 Ley 222/1995 — presentado y aprobado)
7. Partes Vinculadas (NIC 24 §13-22 / Sec. 33 PYMES — revelación en notas)
8. Autorización para Publicación (NIC 10 §17 / Sec. 32.9 PYMES — fecha y órgano)

Si el preprocesador detecta áreas adicionales relevantes (e.g. ICA municipal, retenciones DIAN, F1732), añadirlas. El renderer expone esta sección como tabla auditable; el equipo de auditoría usa status="pendiente" para abrir tareas correctivas.
</constraints>

<context>
## FRONTERA DE RESPONSABILIDADES (Wave 4 — v8.1 §5 Slide 10)
- Governance produce: financialNotes (1..16), shareholderMinutes, fiscalReviewerOpinion, complianceChecklist (normativo, mínimo 8 ítems), disclaimers[] (6 codes Parte 9), capitalizationProposal, resultDistribution, signatories.
- Governance NO produce: metadatos Slide 12 (hash del documento, fechas de extracción/emisión, % cobertura de cuentas), disclaimer reformulado positivo de §5 Slide 12 ("Este reporte fue generado con..."), §11 checklist de emisión spec v8.1. Esos elementos son responsabilidad del Editor Jefe HTML downstream.
- El campo complianceChecklist de este schema es el checklist normativo de la entidad (Decreto 2420/2015, C.Co., DIAN exógena, etc.) — NO es el §11 checklist de emisión.

## MODO DEL REPORTE (v8.1 §2 — eco del orchestrator, NO derivar)
- Valor: ${reportMode}
- MUST: emitir reportMode="${reportMode}" LITERAL en el campo raíz del JSON. NO recomputar ni inferir un modo distinto.
- Si reportMode="LINEA_BASE": verbos prohibidos en notas y acta: "creció", "mejoró", "varió". Usar: "establece", "documenta", "constituye".
- If reportMode="TRANSICION" then notas materiales usan: "reconcilia, donde es comparable". Aclarar en cada nota de variación que la comparabilidad es parcial.
- If reportMode="COMPARATIVO_COMPLETO" then usar libremente: "varió", "creció", "se contrajo", "mejoró", "evolucionó".

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

## Régimen de reserva legal (tri-estado — NO derivar, es dato de entrada)
- Estatutos sociales declarados por el preparador: ${ESTATUTOS_LABEL[estatutosReservaLegal]}.
- Régimen resuelto: ${reserveRegime} → apropiación de reserva legal del ejercicio: ${reservaLegalAplica ? 'SÍ procede' : 'NO procede'}.
- Cita: ${reserveLegalCitation}.
${reserveRegime === 'no_obligatoria' ? '- Doctrina vinculante: Supersociedades Oficios 220-115333/2009 y 220-069664/2017 — Ley 1258/2008 NO obliga reserva legal en SAS sin habilitación estatutaria expresa.' : ''}
${reserveRegime === 'indeterminado' ? `- Los estatutos sociales NO fueron suministrados. El acta NO afirma que exijan reserva legal ni que no la exijan: describe que la asamblea resuelve la destinación con vista en ellos, y registra el dato faltante en preparerNotes con el texto "Estatutos sociales no suministrados: no se pudo determinar si habilitan reserva legal (Art. 45 Ley 1258/2008)". Emitir esa afirmación sin el documento a la vista es declarar sobre un texto que nadie leyó, en un documento que firma el representante legal y se inscribe en Cámara de Comercio.` : ''}

${actaBindingBlock}

## Marco normativo de los EEFF
${niifFrameworkLabel(company.niifGroup)}

${elite?.hechosEmpresa ?? ''}

${langInstruction}
</context>`;
}

// ---------------------------------------------------------------------------
// Régimen de reserva legal — cita normativa por rama del tri-estado
// ---------------------------------------------------------------------------
const ESTATUTOS_LABEL: Record<'exigida' | 'no_exigida' | 'no_declarado', string> = {
  exigida: 'SÍ exigen reserva legal (habilitación estatutaria expresa)',
  no_exigida: 'NO exigen reserva legal (estatutos consultados)',
  no_declarado: 'NO SUMINISTRADOS — el régimen no es determinable',
};

const RESERVE_REGIME_CITATION: Record<ActaReserveRegime, string> = {
  obligatoria_ley: 'Art. 452 C.Co. — reserva legal obligatoria por ley',
  obligatoria_estatutos:
    'Art. 45 Ley 1258 de 2008 (remisión) + Art. 452 C.Co. — habilitación estatutaria expresa declarada',
  no_obligatoria:
    'Art. 45 Ley 1258 de 2008 — los estatutos consultados NO exigen reserva legal (Supersociedades Oficios 220-115333/2009 y 220-069664/2017)',
  indeterminado:
    'Art. 45 Ley 1258 de 2008 — régimen no determinable: los estatutos sociales no fueron suministrados',
};

/** Pesos (number del preprocesador) → centavos BigInt, redondeo único al centavo. */
function pesosToCentsLocal(v: number): bigint {
  return BigInt(Math.round(v * 100));
}

/**
 * Construye la aritmética vinculante del acta desde el snapshot primario.
 *
 * Devuelve `null` cuando el preprocesador no trae `controlTotals.cents` — en ese
 * caso el prompt NO inyecta cifras del acta y el modelo no recibe autorización
 * para inventarlas.
 */
function buildActaPrimaryArithmetic(
  preprocessed: PreprocessedBalance | undefined,
  regime: ActaReserveRegime,
): ActaArithmetic | null {
  const snap = preprocessed?.primary;
  const cents = snap?.controlTotals?.cents;
  if (!snap || !cents) return null;

  const eb = snap.equityBreakdown ?? {};
  // Art. 151 C.Co. — sólo las utilidades acumuladas NEGATIVAS son pérdidas
  // pendientes de enjugar. El saldo positivo NO entra en la destinación del
  // ejercicio (v2.5 #13: la base es la utilidad del ejercicio, no el PUC 36).
  const acumuladas = typeof eb.utilidadesAcumuladas === 'number' ? eb.utilidadesAcumuladas : 0;
  const perdidasPendientes = acumuladas < 0 ? pesosToCentsLocal(-acumuladas) : BigInt(0);

  return buildActaArithmetic({
    netIncomeCents: cents.utilidadNeta,
    accumulatedLossesCents: perdidasPendientes,
    capitalSuscritoPagadoCents:
      typeof eb.capitalSuscritoPagado === 'number' ? pesosToCentsLocal(eb.capitalSuscritoPagado) : null,
    reservaLegalAcumuladaCents:
      typeof eb.reservaLegal === 'number' ? pesosToCentsLocal(eb.reservaLegal) : null,
    otrasReservasCents: typeof eb.otrasReservas === 'number' ? pesosToCentsLocal(eb.otrasReservas) : null,
    regime,
    // 50% ocasional / 40% capitalización son POLÍTICA del producto, no norma.
    // El acta lo declara así explícitamente (ver bloque vinculante).
    reservaOcasionalPct: 50,
    capitalizationPct: 40,
  });
}

/**
 * Régimen de reserva legal de la sociedad.
 *
 * Exportado a propósito: el orquestador tiene que reconciliar el acta emitida
 * contra EXACTAMENTE la misma aritmética que se le inyectó al modelo. Derivar el
 * régimen dos veces —una aquí y otra en el reconciliador— es la duplicación sin
 * sincronizar que esta auditoría ya nombró como causa raíz de la familia entera
 * de defectos.
 */
export function deriveActaRegimeForCompany(company: CompanyInfo): ActaReserveRegime {
  const isSAS = (company.entityType || 'SAS').toUpperCase().includes('SAS');
  return deriveActaReserveRegime(
    isSAS,
    normalizeEstatutosReservaLegal(
      (company as unknown as { estatutosRequierenReservaLegal?: unknown })
        .estatutosRequierenReservaLegal,
    ),
  );
}

/**
 * Aritmética vinculante del acta — la MISMA que viajó al modelo en el prompt.
 * `null` cuando el preprocesador no trae `controlTotals.cents`: en ese caso el
 * prompt tampoco inyectó cifras, así que no hay nada que reconciliar.
 */
export function buildActaExpectedArithmetic(
  company: CompanyInfo,
  preprocessed?: PreprocessedBalance,
): ActaArithmetic | null {
  return buildActaPrimaryArithmetic(preprocessed, deriveActaRegimeForCompany(company));
}

/** Una cifra vinculante: legible para redactar + token literal para copiar. */
function bindingFigure(label: string, cents: string): string {
  return `- ${label}: ${formatCopFromCents(BigInt(cents), false)}  →  ${moneyCopToken(BigInt(cents))}`;
}

/**
 * Bloque `CIFRAS VINCULANTES DEL ACTA`. Es el único lugar del que el modelo
 * puede tomar reserva legal, capitalización y renglones de destinación.
 */
function renderActaBindingBlock(a: ActaArithmetic, memberTerm: string, isSAS: boolean): string {
  const lines: string[] = [];
  lines.push('## CIFRAS VINCULANTES DEL ACTA (deterministas — COPIAR, NO CALCULAR)');
  lines.push(
    'Cada cifra viene calculada en centavos exactos desde la utilidad neta del ejercicio. ' +
      'El token `[MoneyCop: N]` es lo que se copia carácter por carácter al campo `MoneyCop` del schema; ' +
      'el valor en pesos al lado es sólo para redactar la prosa.',
  );
  lines.push('');
  lines.push(bindingFigure('Utilidad neta del ejercicio (base Art. 452 C.Co.)', a.netIncomeCop));
  // Los tokens de la tabla de destinación SÓLO se emiten cuando hay tabla: un
  // token es una autorización a copiar, y no se autoriza una cifra que no tiene
  // campo de destino.
  if (a.distributionApplies) {
    lines.push(bindingFigure('Enjugamiento de pérdidas de ejercicios anteriores (Art. 151 C.Co.)', a.enjugarPerdidasCop));
    lines.push(bindingFigure('Saldo tras enjugar pérdidas (base Art. 155 C.Co.)', a.saldoDistribuibleCop));
    lines.push(bindingFigure('Apropiación teórica del 10% (Art. 452 C.Co., antes del techo)', a.apropiacionTeorica10Cop));
    if (a.techoArt452Cop !== null && a.reservaLegalPendienteCop !== null) {
      lines.push(bindingFigure('Techo del Art. 452 C.Co. — 50% del capital suscrito', a.techoArt452Cop));
      lines.push(bindingFigure('Reserva legal aún exigible hasta el techo', a.reservaLegalPendienteCop));
    } else {
      lines.push(
        '- Techo del Art. 452 C.Co.: NO EVALUABLE — la Clase 3 del balance no declara capital suscrito y pagado (PUC 3115/3120). ' +
          'El acta declara esta limitación en `preparerNotes`; NUNCA afirmar que el techo se cumple ni que no se cumple.',
      );
    }
    lines.push(bindingFigure('Reserva legal APROPIADA en este ejercicio (ya topada)', a.reservaLegalDelEjercicioCop));
    lines.push(bindingFigure('Reserva ocasional propuesta (Art. 154 C.Co.)', a.reservaOcasionalCop));
    lines.push(bindingFigure(`Saldo distribuible a los ${memberTerm}`, a.distribuibleCop));
    lines.push(
      bindingFigure(
        `Mínimo legal a repartir — ${a.minimoArt155Pct}% (${a.minimoArt155Pct === 70 ? 'Art. 454 C.Co.' : 'Art. 155 C.Co., modificado por el Art. 240 de la Ley 222/1995'})`,
        a.minimoArt155Cop,
      ),
    );
    lines.push(bindingFigure('Déficit frente a ese mínimo', a.deficitArt155Cop));
  }
  lines.push(bindingFigure('Base de la capitalización (utilidad neta del ejercicio)', a.capitalizationBaseCop));
  lines.push(bindingFigure('Monto a capitalizar (40% de la base)', a.capitalizationAmountCop));
  lines.push('');
  lines.push(`- Régimen de reserva legal resuelto: **${a.regime}**.`);
  lines.push(
    `- resultDistribution.applies = ${a.distributionApplies ? 'true' : 'false'} — valor VINCULANTE, no derivarlo.`,
  );
  lines.push(
    `- capitalizationProposal.applies = ${a.capitalizationApplies ? 'true' : 'false'} — valor VINCULANTE, no derivarlo.`,
  );
  lines.push('');
  if (a.distributionApplies) {
    lines.push('### Renglones EXACTOS de `resultDistribution.lines[]` (en este orden)');
    for (const l of a.lines) {
      lines.push(`  · label="${l.label}" · amountCop=${moneyCopToken(BigInt(l.amountCop))} · normReference="${l.normReference}"`);
    }
    lines.push(
      `  · Σ de los renglones == utilidad neta del ejercicio (${formatCopFromCents(BigInt(a.netIncomeCop), false)}), tolerancia $0. ` +
        'Es la identidad que hace auditable la tabla: un acta cuyos renglones no suman la utilidad aprobada reparte dinero que no existe.',
    );
  } else {
    lines.push(
      '### `resultDistribution.lines[]` = [] (array vacío) y `applies=false`.\n' +
        (a.regime === 'indeterminado'
          ? `  Motivo: los estatutos sociales no fueron suministrados, de modo que el régimen de reserva legal de esta ${isSAS ? 'SAS' : 'entidad'} no está resuelto. ` +
            'El acta NO afirma nada sobre el contenido de los estatutos —ni que exigen reserva legal, ni que no la exigen—: la asamblea decide con vista en ellos. ' +
            `Como referencia verificable, la apropiación del 10% del Art. 452 C.Co. ascendería a ${formatCopFromCents(BigInt(a.apropiacionTeorica10Cop), false)} ` +
            `y el mínimo del Art. 155 C.Co. a ${formatCopFromCents(BigInt(a.minimoArt155Cop), false)}.`
          : '  Motivo: los estatutos consultados no exigen reserva legal (Art. 45 Ley 1258/2008 + Supersociedades Oficios 220-115333/2009 y 220-069664/2017).'),
    );
  }
  lines.push('');
  if (!a.distributionApplies) {
    // Sin tabla no hay propuesta que medir contra el Art. 155; sólo queda la
    // constancia de que la capitalización es dividendo en especie.
  } else if (a.requiereMayoria78) {
    lines.push(
      `- Art. 155 C.Co.: la propuesta deja ${formatCopFromCents(BigInt(a.distribuibleCop), false)} de dividendo, ` +
        `por debajo del mínimo legal de ${formatCopFromCents(BigInt(a.minimoArt155Cop), false)} ` +
        `(déficit ${formatCopFromCents(BigInt(a.deficitArt155Cop), false)}). El acta DEBE declarar que la aprobación de esta destinación ` +
        'requiere el voto favorable del 78% de las acciones, cuotas o partes de interés representadas en la reunión. ' +
        'Declarar la MAYORÍA QUE EXIGE LA LEY no es inventar el capital representado: son cosas distintas y la primera es obligatoria.',
    );
  } else {
    lines.push(
      `- Art. 155 C.Co.: la propuesta cumple el mínimo legal (${formatCopFromCents(BigInt(a.minimoArt155Cop), false)}); ` +
        'no se requiere la mayoría calificada del 78%.',
    );
  }
  if (a.distributionApplies && a.topeArt452Alcanzado) {
    lines.push(
      '- Art. 452 C.Co.: la reserva legal acumulada YA alcanzó el 50% del capital suscrito. ' +
        'La apropiación exigible del ejercicio es $0,00 y el acta lo declara así, citando el techo.',
    );
  }
  if (a.capitalizacionExcedeDestinable) {
    lines.push(
      '- La capitalización propuesta excede la utilidad que queda disponible tras las apropiaciones. ' +
        'El acta registra esta inconsistencia en `preparerNotes` y NO propone capitalizar por encima del saldo disponible.',
    );
  }
  lines.push(
    '- El 50% de reserva ocasional y el 40% de capitalización son POLÍTICA de la propuesta, no porcentajes legales. ' +
      'Los únicos porcentajes con fuente normativa aquí son el 10% del Art. 452 C.Co. y el mínimo del Art. 155 C.Co. ' +
      'El acta NO presenta el 40% ni el 50% como exigencia de norma alguna.',
  );
  lines.push(
    '- La capitalización se entrega CON CARGO al saldo distribuible (dividendo pagado en acciones), NO adicional a él: ' +
      'la misma utilidad no se compromete dos veces.',
  );
  return lines.join('\n');
}

function niifFrameworkLabel(group: number | undefined): string {
  if (group === 1) return '- NIIF Plenas (Grupo 1 — Decreto 2420/2015).';
  if (group === 3) return '- Contabilidad Simplificada (Grupo 3 — Decreto 2706/2012, compilado en 2420/2015).';
  return '- NIIF para PYMES (Grupo 2 — Decreto 2420/2015 anexo 2).';
}

// Why: el body de Nota 14 para Grupo 2/3 necesita citar el número de grupo
// como texto legible para el LLM — se evalúa en TS al construir el prompt.
function niifGroupNumLabel(group: number | undefined | null): string {
  if (group === 1) return '1 (NIIF Plenas)';
  if (group === 3) return '3 (Contabilidad Simplificada)';
  return '2 (NIIF PYMES)';
}
