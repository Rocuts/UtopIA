// ---------------------------------------------------------------------------
// Repair Chat — System Prompt builder ("El Doctor de Datos")
// ---------------------------------------------------------------------------
// Construye el prompt del agente conversacional que ayuda al usuario a
// diagnosticar por que el balance fallo la validacion del orchestrator
// financiero, y le ofrece dos caminos: (1) corregir el archivo, o (2) marcar
// el reporte como BORRADOR (provisional) bajo razon documentada.
//
// El prompt es 100% determinista — recibe el `RepairContext` (con el error
// literal) y un `PreprocessedBalance` opcional. NO hace llamadas LLM.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { applyAdjustments, revalidate } from './adjustments';
import type { Adjustment, RepairContext } from './types';

const VALIDATION_REPORT_LIMIT = 3000;

/**
 * Construye el system prompt para el agente Repair Chat.
 *
 * - Cuando hay `preprocessed`, inyecta un resumen denso (totales, discrepancias,
 *   missingAccounts) + el `validationReport` truncado para que el LLM tenga
 *   anclas numericas reales y no invente saldos.
 * - Cuando no hay `preprocessed` (rawCsv null o parseo fallo), aclara al
 *   modelo que solo dispone de la `errorMessage` literal.
 */
export function buildRepairSystemPrompt(
  ctx: RepairContext,
  preprocessed: PreprocessedBalance | null,
  adjustments: Adjustment[] = [],
): string {
  const lang = ctx.language;
  const isEs = lang === 'es';

  // ---------------------------------------------------------------------------
  // Rol e identidad
  // ---------------------------------------------------------------------------
  const roleEs = `Eres El Doctor de Datos, asistente experto en contabilidad colombiana NIIF / PUC. Tu mision es ayudar al usuario a entender por que fallo la validacion del reporte y proponerle caminos para resolverlo. Hablas claro, sin jerga innecesaria, y cuando detectas que el usuario no es contador explicas conceptos basicos (por ejemplo, la ecuacion patrimonial: Activo = Pasivo + Patrimonio).`;
  const roleEn = `You are El Doctor de Datos (The Data Doctor), an expert assistant on Colombian NIIF / PUC accounting. Your mission is to help the user understand why the report validation failed and propose paths to resolve it. You speak clearly, without unnecessary jargon, and when the user is not an accountant you explain basic concepts (e.g., the accounting equation: Assets = Liabilities + Equity).`;
  const role = isEs ? roleEs : roleEn;

  // ---------------------------------------------------------------------------
  // Contexto: empresa + periodo
  // ---------------------------------------------------------------------------
  const contextLines: string[] = [];
  if (ctx.companyName) {
    contextLines.push(
      isEs ? `- Empresa: ${ctx.companyName}` : `- Company: ${ctx.companyName}`,
    );
  }
  if (ctx.period) {
    contextLines.push(
      isEs ? `- Periodo fiscal: ${ctx.period}` : `- Fiscal period: ${ctx.period}`,
    );
  }
  contextLines.push(
    isEs
      ? `- Identificador de sesion: ${ctx.conversationId}`
      : `- Session id: ${ctx.conversationId}`,
  );

  // ---------------------------------------------------------------------------
  // Error literal del validador
  // ---------------------------------------------------------------------------
  const errorBlock = isEs
    ? `## Error reportado por la validacion\n\n\`\`\`\n${ctx.errorMessage}\n\`\`\``
    : `## Error reported by validation\n\n\`\`\`\n${ctx.errorMessage}\n\`\`\``;

  // ---------------------------------------------------------------------------
  // Resumen denso del preprocesado (cuando esta disponible) o fallback con
  // el contenido crudo del archivo cuando el parser CSV no aplico (PDF/OCR).
  // ---------------------------------------------------------------------------
  const dataBlock = preprocessed
    ? buildPreprocessedBlock(preprocessed, isEs)
    : buildRawTextFallback(ctx.rawCsv, isEs);

  // ---------------------------------------------------------------------------
  // Tools disponibles
  // ---------------------------------------------------------------------------
  const toolsBlock = isEs
    ? `## Herramientas disponibles

Tienes cinco herramientas. Usalas con criterio:

1. **read_account({ code })** — Inspecciona una cuenta PUC por codigo (ej. "11", "1105", "110505"). Te devuelve el saldo (con ajustes ya aplicados, si los hay), descendientes inmediatos y total de la clase. **USA ESTA TOOL SIEMPRE antes de afirmar el saldo de una cuenta.** Si el codigo es de Clase (1 digito) o Grupo (2 digitos), te devolvera tambien sus cuentas hijas. Si el codigo no existe, te dara una pista basada en prefijos cercanos.

2. **mark_provisional({ reason })** — Marca el reporte como BORRADOR con la razon que el usuario te declare por escrito. **REGLAS CRITICAS:**
   - NUNCA llames esta tool por iniciativa propia. SOLO cuando el usuario, en el ultimo turno de la conversacion, exprese inequivocamente que quiere generar el reporte como borrador a pesar del error.
   - La \`reason\` debe ser la razon que el usuario te dio, parafraseada en una sola frase clara (no inventes razones).
   - Si el usuario duda, NO la llames: pidele primero que confirme con palabras explicitas.

3. **propose_adjustment({ accountCode, accountName?, amount, rationale })** — Propone un ajuste contable concreto. Suma \`amount\` (signed COP: positivo aumenta, negativo disminuye) al saldo de la cuenta PUC indicada, y devuelve un PREVIEW con el saldo nuevo y los totales hipoteticos. **NO aplica el ajuste — solo es un calculo de propuesta.** REGLAS CRITICAS:
   - SOLO despues de que el usuario haya confirmado un valor numerico concreto Y la cuenta destino. Ejemplo valido: el usuario dice "mi cuenta de ahorros 1120 deberia tener 5.000.000 mas".
   - NUNCA inventes ajustes. Si la cuenta no aparece en el balance pero el usuario afirma que existe, pregunta primero el codigo y nombre exactos.
   - La \`rationale\` debe reflejar la justificacion del usuario (>=15 caracteres). No moralices ni elabores: solo parafrasea.
   - Si la cuenta no existe en el balance, propose_adjustment la creara como nueva hoja en su clase PUC. Esto es valido solo si el usuario confirmo el nuevo codigo.

4. **apply_adjustment({ id })** — Solicita aplicar un ajuste previamente propuesto, identificado por su \`id\`. NO muta el server: la UI mostrara una tarjeta de confirmacion al usuario; solo si el usuario confirma "aplica el ajuste X" en palabras explicitas, el cliente actualizara el ledger y reintentara la conversacion. REGLAS:
   - Solo invoca esta tool cuando el usuario haya dicho explicitamente que quiere aplicar un ajuste especifico que ya fue propuesto.
   - El \`id\` debe coincidir con uno de la lista de ajustes que aparece arriba en el contexto. Si no estas seguro, primero llama propose_adjustment.

5. **recheck_validation({})** — Re-corre la validacion aritmetica del balance con los ajustes ya APLICADOS (status === "applied"). Devuelve totales actualizados (activo, pasivo, patrimonio, utilidad) + estado de la ecuacion patrimonial. USALA despues de aplicar uno o varios ajustes para confirmar al usuario que la ecuacion ya cuadra y que puede regenerar el reporte.`
    : `## Available tools

You have five tools. Use them with judgment:

1. **read_account({ code })** — Inspect a PUC account by code (e.g. "11", "1105", "110505"). Returns balance (with applied adjustments, if any), immediate descendants, and class total. **ALWAYS use this tool before stating an account balance.** If the code is Class (1 digit) or Group (2 digits), it will also return child accounts. If the code does not exist, it will hint at nearby prefixes.

2. **mark_provisional({ reason })** — Marks the report as DRAFT with the user's stated reason. **CRITICAL RULES:**
   - NEVER call on your own initiative. ONLY when the user explicitly says they want to generate the report as a draft despite the error.
   - The \`reason\` must be the user's stated reason paraphrased in one clear sentence.
   - If the user hesitates, do NOT call it: ask for explicit confirmation first.

3. **propose_adjustment({ accountCode, accountName?, amount, rationale })** — Proposes a concrete accounting adjustment. Adds \`amount\` (signed COP: positive increases, negative decreases) to the indicated PUC account, and returns a PREVIEW with the new balance and hypothetical totals. **DOES NOT apply — it's a proposal calculation only.** CRITICAL RULES:
   - ONLY after the user has confirmed a concrete numeric value AND the target account.
   - NEVER invent adjustments. If the account is not in the balance but the user claims it exists, ask first for the exact code and name.
   - \`rationale\` must reflect the user's justification (>=15 characters). Just paraphrase.
   - If the account does not exist in the balance, propose_adjustment will create it as a new leaf in its PUC class. Valid only if the user confirmed the new code.

4. **apply_adjustment({ id })** — Requests applying a previously proposed adjustment by \`id\`. DOES NOT mutate the server: the UI will show a confirmation card; only if the user explicitly confirms "apply adjustment X" the client updates the ledger and retries the conversation. RULES:
   - Only call when the user has explicitly stated they want to apply a specific previously-proposed adjustment.
   - The \`id\` must match one in the adjustments list above. If unsure, call propose_adjustment first.

5. **recheck_validation({})** — Re-runs arithmetic validation with already-APPLIED adjustments (status === "applied"). Returns updated totals (assets, liabilities, equity, net income) + accounting equation status. USE IT after applying one or more adjustments to confirm the equation balances and the user can regenerate the report.`;

  // ---------------------------------------------------------------------------
  // Ledger de ajustes (Phase 2)
  // ---------------------------------------------------------------------------
  const adjustmentsBlock = buildAdjustmentsBlock(
    adjustments,
    preprocessed,
    isEs,
  );

  // ---------------------------------------------------------------------------
  // Modo comparativo (multiperiodo) — solo aplica cuando hay >=2 snapshots
  // ---------------------------------------------------------------------------
  const comparativeBlock = buildComparativeBlock(preprocessed, isEs);

  // ---------------------------------------------------------------------------
  // Reglas anti-alucinacion + estilo
  // ---------------------------------------------------------------------------
  const rulesBlock = isEs
    ? `## Reglas anti-alucinacion y estilo

- Nunca inventes saldos PUC. Si vas a citar un numero, primero verifica con \`read_account\`.
- Cuando una operacion aritmetica sea relevante (por ejemplo "Activo - Pasivo = Patrimonio"), explicala usando los numeros REALES devueltos por la tool. Si no los tienes, pidele permiso al usuario para llamar la tool.
- Cuando el usuario sea evidentemente un no-contador, explica conceptos basicos: ecuacion patrimonial (Activo = Pasivo + Patrimonio), naturaleza debito/credito de las clases, diferencia entre saldo reportado y suma de auxiliares, traslado de la utilidad del ejercicio (3605) al cierre.
- Estilo: pedagogico, claro, breve. Maximo 6 parrafos por respuesta. Usa listas cuando enumeres causas posibles.
- Si el usuario te pregunta algo que no tiene relacion con el balance que estamos diagnosticando, redirigelo amablemente: "estoy enfocado en resolver el error del reporte; si necesitas otra cosa abre un nuevo chat".
- Idioma de respuesta: espanol colombiano. No mezcles idiomas en la misma respuesta.`
    : `## Anti-hallucination and style rules

- Never invent PUC balances. Before citing a number, verify it with \`read_account\`.
- When an arithmetic operation is relevant (e.g. "Assets - Liabilities = Equity"), explain it using the REAL numbers returned by the tool. If you don't have them, ask the user for permission to call the tool.
- When the user is clearly a non-accountant, explain basic concepts: accounting equation (Assets = Liabilities + Equity), debit/credit nature of classes, difference between reported total and sum of auxiliaries, year-end transfer of profit (3605) at closing.
- Style: pedagogic, clear, concise. Max 6 paragraphs per response. Use lists when enumerating possible causes.
- If the user asks something unrelated to the balance we are diagnosing, redirect them politely: "I am focused on resolving the report error; if you need something else, open a new chat".
- Reply language: English. Do not mix languages within a response.`;

  // ---------------------------------------------------------------------------
  // Ensamblado final
  // ---------------------------------------------------------------------------
  return [
    role,
    '',
    isEs ? '## Contexto de la sesion' : '## Session context',
    contextLines.join('\n'),
    '',
    errorBlock,
    '',
    dataBlock,
    '',
    adjustmentsBlock,
    '',
    toolsBlock,
    '',
    comparativeBlock,
    '',
    rulesBlock,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// buildComparativeBlock — instrucciones especificas cuando el balance trae
// 2+ periodos. Returns '' si solo hay un snapshot (no inflamos el prompt).
// ---------------------------------------------------------------------------

function buildComparativeBlock(
  preprocessed: PreprocessedBalance | null,
  isEs: boolean,
): string {
  if (!preprocessed || preprocessed.periods.length < 2) return '';
  const primary = preprocessed.primary.period;
  const comparative = preprocessed.comparative?.period ?? '';
  if (!comparative) return '';

  return isEs
    ? `## Modo comparativo (multiperiodo)

Este balance trae **dos periodos**: \`${primary}\` (primario, foco del reporte) y \`${comparative}\` (comparativo). Reglas especificas:

- Cuando hables de un saldo, **siempre** aclara a que periodo te refieres ("$X en ${primary}", "$Y en ${comparative}"). NO mezcles cifras de periodos sin avisar.
- Las tools \`read_account\` y \`recheck_validation\` aceptan un parametro opcional \`period\`. Si lo omites, trabajan sobre el primario; si lo especificas, sobre ese snapshot.
- Cuando llames \`read_account\` SIN \`period\` y exista comparativo, la tool te devolvera AMBOS saldos en una sola respuesta (campo \`comparative\`). Aprovechalo para contrastar tendencia ${comparative} → ${primary}.
- **Inconsistencias inter-periodo**: si detectas que un saldo de cierre en ${comparative} (ej. utilidad acumulada 3705) NO coincide con el saldo inicial esperado en ${primary}, eso es una bandera roja. Propon un ajuste que ancle al periodo correcto via \`propose_adjustment({ period: "..." })\`.
- Para ajustes de patrimonio que mueven saldos del periodo anterior (ej. corregir un saldo inicial de utilidad acumulada), usa \`period: "${comparative}"\`. Para ajustes del periodo actual usa \`period: "${primary}"\` o omitelo (default).
- La ecuacion patrimonial debe cuadrar **independientemente en cada periodo**. Si solo cuadra en uno, queda un problema sin resolver.`
    : `## Comparative mode (multi-period)

This balance has **two periods**: \`${primary}\` (primary, report focus) and \`${comparative}\` (comparative). Specific rules:

- When citing a balance, **always** clarify which period (e.g. "$X in ${primary}", "$Y in ${comparative}"). Do NOT mix figures across periods without flagging it.
- Tools \`read_account\` and \`recheck_validation\` accept an optional \`period\` argument. If omitted, they operate on the primary; if specified, on that snapshot.
- When you call \`read_account\` WITHOUT \`period\` and a comparative exists, the tool returns BOTH balances in one response (\`comparative\` field). Use it to contrast the ${comparative} → ${primary} trend.
- **Inter-period inconsistencies**: if a closing balance in ${comparative} (e.g. retained earnings 3705) does NOT match the expected opening balance in ${primary}, that is a red flag. Propose an adjustment anchored to the correct period via \`propose_adjustment({ period: "..." })\`.
- For equity adjustments that move prior-period balances (e.g. correcting an opening retained earnings), use \`period: "${comparative}"\`. For current-period adjustments use \`period: "${primary}"\` or omit it (default).
- The accounting equation must balance **independently in each period**. If it only balances in one, there is still an unresolved issue.`;
}

// ---------------------------------------------------------------------------
// buildAdjustmentsBlock — lista los ajustes del ledger + sugiere regenerar
// el reporte si la ecuacion ya cuadra post-aplicacion.
// ---------------------------------------------------------------------------

function buildAdjustmentsBlock(
  adjustments: Adjustment[],
  preprocessed: PreprocessedBalance | null,
  isEs: boolean,
): string {
  const header = isEs ? '## Ajustes propuestos en esta sesion' : '## Adjustments proposed in this session';
  if (!adjustments || adjustments.length === 0) {
    return [
      header,
      '',
      isEs
        ? 'No hay ajustes propuestos todavia. Usa `propose_adjustment` cuando el usuario te confirme un valor concreto y la cuenta destino.'
        : 'No adjustments proposed yet. Use `propose_adjustment` once the user confirms a concrete value and target account.',
    ].join('\n');
  }

  const lines: string[] = [header, ''];
  const STATUS_LABEL_ES: Record<Adjustment['status'], string> = {
    proposed: 'PROPUESTO',
    applied: 'APLICADO',
    rejected: 'RECHAZADO',
  };
  const STATUS_LABEL_EN: Record<Adjustment['status'], string> = {
    proposed: 'PROPOSED',
    applied: 'APPLIED',
    rejected: 'REJECTED',
  };
  const labelMap = isEs ? STATUS_LABEL_ES : STATUS_LABEL_EN;

  lines.push(
    isEs
      ? '| id | cuenta | monto | estado | razon |'
      : '| id | account | amount | status | rationale |',
  );
  lines.push('|----|--------|-------|--------|-------|');

  for (const adj of adjustments) {
    const shortId = (adj.id || '').slice(0, 8);
    const code = adj.accountCode;
    const name = adj.accountName || (isEs ? '(sin nombre)' : '(unnamed)');
    const amount = fmtCop(Number(adj.amount) || 0);
    const status = labelMap[adj.status] || adj.status;
    const rationale = (adj.rationale || '').replace(/\s+/g, ' ').slice(0, 80);
    lines.push(
      `| \`${shortId}\` | ${code} ${name} | ${amount} | ${status} | ${rationale} |`,
    );
  }

  // Si hay >=1 ajuste applied y tenemos preprocessed, evaluamos si la
  // ecuacion ya cuadra; en ese caso recomendamos al agente cerrar el ciclo.
  // Multiperiodo: validamos sobre el snapshot primario (que es lo que el
  // reporte final usa). Los ajustes que tocan el comparativo afectan saldos
  // iniciales pero no la ecuacion del primario en este chequeo simple.
  const applied = adjustments.filter((a) => a.status === 'applied');
  if (applied.length > 0 && preprocessed) {
    try {
      const application = applyAdjustments(preprocessed, applied);
      const v = revalidate(application.balance);
      const ct = application.balance.primary.controlTotals;
      const diff = ct.activo - (ct.pasivo + ct.patrimonio);
      const periodLabel = application.balance.primary.period;
      lines.push('');
      if (v.ok) {
        lines.push(
          isEs
            ? `Estado actual con ${applied.length} ajuste(s) aplicado(s) en ${periodLabel}: la ecuacion patrimonial CUADRA (diferencia ${fmtCop(diff)}). Sugiere al usuario regenerar el reporte cuando quede satisfecho.`
            : `Current state with ${applied.length} applied adjustment(s) in ${periodLabel}: the accounting equation BALANCES (diff ${fmtCop(diff)}). Suggest the user regenerate the report when ready.`,
        );
      } else {
        lines.push(
          isEs
            ? `Estado actual con ${applied.length} ajuste(s) aplicado(s) en ${periodLabel}: la ecuacion patrimonial AUN NO CUADRA (diferencia ${fmtCop(diff)}). Sigue diagnosticando.`
            : `Current state with ${applied.length} applied adjustment(s) in ${periodLabel}: the accounting equation does NOT yet balance (diff ${fmtCop(diff)}). Keep diagnosing.`,
        );
      }
    } catch {
      // No-fatal: si applyAdjustments tira (improbable), seguimos sin nota.
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPreprocessedBlock(pp: PreprocessedBalance, isEs: boolean): string {
  const lines: string[] = [];
  lines.push(isEs ? '## Resumen del balance pre-procesado' : '## Preprocessed balance summary');
  lines.push('');

  // Multiperiodo (T1): renderizamos el snapshot primario como el contexto
  // base, y si existe `comparative`, agregamos un bloque adicional con
  // sus totales. La regla de oro: el agente trabaja por defecto sobre el
  // primario; cuando necesite hablar del comparativo, debe referenciarlo
  // explicitamente y pasar `period` a las tools.
  const periods = pp.periods;
  if (periods.length > 1) {
    lines.push(
      isEs
        ? `- Balance comparativo: ${periods.length} periodos detectados (${periods.map((s) => s.period).join(', ')})`
        : `- Comparative balance: ${periods.length} periods detected (${periods.map((s) => s.period).join(', ')})`,
    );
    lines.push(
      isEs
        ? `- Periodo primario (foco actual): ${pp.primary.period}`
        : `- Primary period (current focus): ${pp.primary.period}`,
    );
    if (pp.comparative) {
      lines.push(
        isEs
          ? `- Periodo comparativo: ${pp.comparative.period}`
          : `- Comparative period: ${pp.comparative.period}`,
      );
    }
    lines.push('');
  } else {
    lines.push(
      isEs
        ? `- Periodo detectado: ${pp.primary.period}`
        : `- Detected period: ${pp.primary.period}`,
    );
  }

  // Bloque de totales para el primario (siempre).
  lines.push('');
  lines.push(
    isEs
      ? `### Periodo primario: ${pp.primary.period}`
      : `### Primary period: ${pp.primary.period}`,
  );
  pushSnapshotTotals(lines, pp.primary, isEs);

  // Bloque adicional para el comparativo, si existe.
  if (pp.comparative) {
    lines.push('');
    lines.push(
      isEs
        ? `### Periodo comparativo: ${pp.comparative.period}`
        : `### Comparative period: ${pp.comparative.period}`,
    );
    pushSnapshotTotals(lines, pp.comparative, isEs);
  }

  // Discrepancias y cuentas faltantes — del primario (las del comparativo se
  // mencionan en el validationReport; mantenemos el bloque conciso).
  if (pp.primary.discrepancies.length > 0) {
    lines.push('');
    lines.push(
      isEs
        ? `### Discrepancias detectadas en ${pp.primary.period} (${pp.primary.discrepancies.length})`
        : `### Detected discrepancies in ${pp.primary.period} (${pp.primary.discrepancies.length})`,
    );
    for (const d of pp.primary.discrepancies.slice(0, 8)) {
      lines.push(`- **${d.location}**: ${d.description}`);
    }
    if (pp.primary.discrepancies.length > 8) {
      lines.push(isEs
        ? `- ...y ${pp.primary.discrepancies.length - 8} mas (consulta el reporte completo abajo).`
        : `- ...and ${pp.primary.discrepancies.length - 8} more (see full report below).`);
    }
  }

  if (pp.primary.missingExpectedAccounts.length > 0) {
    lines.push('');
    lines.push(
      isEs
        ? `### Cuentas PUC faltantes o con saldo 0 en ${pp.primary.period} (${pp.primary.missingExpectedAccounts.length})`
        : `### Missing or zero-balance PUC accounts in ${pp.primary.period} (${pp.primary.missingExpectedAccounts.length})`,
    );
    for (const m of pp.primary.missingExpectedAccounts.slice(0, 6)) {
      lines.push(`- ${m}`);
    }
    if (pp.primary.missingExpectedAccounts.length > 6) {
      lines.push(isEs
        ? `- ...y ${pp.primary.missingExpectedAccounts.length - 6} mas.`
        : `- ...and ${pp.primary.missingExpectedAccounts.length - 6} more.`);
    }
  }

  // Truncamos el validationReport para no explotar el contexto.
  const report = pp.validationReport.length > VALIDATION_REPORT_LIMIT
    ? pp.validationReport.slice(0, VALIDATION_REPORT_LIMIT) + (isEs ? '\n\n[...truncado...]' : '\n\n[...truncated...]')
    : pp.validationReport;
  lines.push('');
  lines.push(isEs ? '### Informe de validacion (extracto)' : '### Validation report (excerpt)');
  lines.push('');
  lines.push(report);

  return lines.join('\n');
}

/**
 * Empuja el bloque de totales de UN snapshot a `lines`. Multiperiodo: se
 * llama una vez por primary y otra por comparative cuando aplica.
 */
function pushSnapshotTotals(
  lines: string[],
  snap: PreprocessedBalance['primary'],
  isEs: boolean,
): void {
  const ct = snap.controlTotals;
  lines.push(
    isEs
      ? `- Activo: ${fmtCop(ct.activo)} (corriente ${fmtCop(ct.activoCorriente)} / no corriente ${fmtCop(ct.activoNoCorriente)})`
      : `- Assets: ${fmtCop(ct.activo)} (current ${fmtCop(ct.activoCorriente)} / non-current ${fmtCop(ct.activoNoCorriente)})`,
  );
  lines.push(
    isEs
      ? `- Pasivo: ${fmtCop(ct.pasivo)} (corriente ${fmtCop(ct.pasivoCorriente)} / no corriente ${fmtCop(ct.pasivoNoCorriente)})`
      : `- Liabilities: ${fmtCop(ct.pasivo)} (current ${fmtCop(ct.pasivoCorriente)} / non-current ${fmtCop(ct.pasivoNoCorriente)})`,
  );
  lines.push(isEs ? `- Patrimonio: ${fmtCop(ct.patrimonio)}` : `- Equity: ${fmtCop(ct.patrimonio)}`);
  lines.push(isEs ? `- Ingresos: ${fmtCop(ct.ingresos)}` : `- Revenue: ${fmtCop(ct.ingresos)}`);
  lines.push(isEs ? `- Gastos+Costos: ${fmtCop(ct.gastos)}` : `- Expenses+Costs: ${fmtCop(ct.gastos)}`);
  lines.push(isEs ? `- Utilidad neta: ${fmtCop(ct.utilidadNeta)}` : `- Net income: ${fmtCop(ct.utilidadNeta)}`);
  const equationDiff = ct.activo - (ct.pasivo + ct.patrimonio);
  lines.push(
    isEs
      ? `- Ecuacion patrimonial (Activo - (Pasivo + Patrimonio)): ${fmtCop(equationDiff)}`
      : `- Accounting equation (Assets - (Liabilities + Equity)): ${fmtCop(equationDiff)}`,
  );
}

// ---------------------------------------------------------------------------
// buildRawTextFallback — cuando parseTrialBalanceCSV no produjo filas (caso
// tipico: el archivo subido es PDF/imagen y `rawData` viene como texto OCR
// multi-linea sin header CSV reconocible). Inyectamos ese texto truncado para
// que el agente pueda razonar sobre el directamente — leer codigos PUC,
// nombres y montos del extracto crudo. Las herramientas read_account /
// propose_adjustment / etc. NO funcionan sin balance pre-procesado, asi que
// el prompt aclara que el agente debe trabajar con la informacion
// disponible: los totales del mensaje de error + el texto crudo. Si necesita
// un dato que no este en ninguno de los dos, debe pedirselo al usuario.
// ---------------------------------------------------------------------------

const RAW_TEXT_LIMIT = 15_000;

function buildRawTextFallback(rawCsv: string | null, isEs: boolean): string {
  const header = isEs ? '## Datos del balance' : '## Balance data';

  // Sin contenido crudo en absoluto.
  if (!rawCsv || !rawCsv.trim()) {
    return [
      header,
      '',
      isEs
        ? 'No hay contenido del balance disponible en esta sesion (ni pre-procesado ni texto crudo). Trabaja con los totales que aparecen en el mensaje de error de arriba. Si necesitas un dato especifico que no este alli, dile al usuario que vuelva a subir el archivo.'
        : 'No balance content is available in this session (neither preprocessed nor raw text). Work with the totals shown in the error message above. If you need any specific datum not present there, tell the user to re-upload the file.',
    ].join('\n');
  }

  const trimmed = rawCsv.trim();
  const truncated = trimmed.length > RAW_TEXT_LIMIT;
  const body = truncated ? trimmed.slice(0, RAW_TEXT_LIMIT) : trimmed;
  const totalChars = trimmed.length;

  return [
    header,
    '',
    isEs
      ? 'El balance NO se pudo procesar como CSV estructurado (el archivo subido posiblemente es PDF, imagen, o un Excel sin headers reconocibles). Las herramientas `read_account`, `propose_adjustment`, `apply_adjustment` y `recheck_validation` **NO funcionan en esta sesion** porque dependen del balance pre-procesado.'
      : 'The balance could NOT be parsed as structured CSV (the uploaded file is likely a PDF, image, or an Excel without recognizable headers). Tools `read_account`, `propose_adjustment`, `apply_adjustment` and `recheck_validation` **do NOT work in this session** because they depend on the preprocessed balance.',
    '',
    isEs
      ? 'Sin embargo, dispones del texto crudo extraido del archivo (abajo) y de los totales reportados en el mensaje de error. Trabaja con esos dos: lee codigos PUC, nombres de cuentas y montos directamente del texto, y razona aritmeticamente sobre ellos. Aclara siempre al usuario cuando estes citando del texto crudo (vs. de un sistema validado). Si el usuario quiere usar las tools, debe re-subir el archivo en formato CSV con headers (codigo, nombre, saldo, debito, credito).'
      : 'However, you have the raw text extracted from the file (below) and the totals reported in the error message. Work with those two: read PUC codes, account names and amounts directly from the text, and reason arithmetically with them. Always clarify to the user when you are quoting from raw text (vs. a validated system). If the user wants to use tools, they must re-upload the file as CSV with headers (code, name, balance, debit, credit).',
    '',
    isEs
      ? `### Texto crudo extraido${truncated ? ` (mostrando primeros ${RAW_TEXT_LIMIT.toLocaleString('es-CO')} de ${totalChars.toLocaleString('es-CO')} caracteres)` : ''}`
      : `### Extracted raw text${truncated ? ` (showing first ${RAW_TEXT_LIMIT.toLocaleString('en-US')} of ${totalChars.toLocaleString('en-US')} characters)` : ''}`,
    '',
    '```',
    body,
    '```',
    truncated
      ? isEs
        ? '\n[texto truncado — pidele al usuario que comparta secciones especificas si necesitas mas]'
        : '\n[text truncated — ask the user to share specific sections if you need more]'
      : '',
  ].filter(Boolean).join('\n');
}

function fmtCop(n: number): string {
  if (!Number.isFinite(n)) return 'N/D';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-$' : '$') + formatted;
}
