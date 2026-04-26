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
import type { RepairContext } from './types';

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
  // Resumen denso del preprocesado (cuando esta disponible)
  // ---------------------------------------------------------------------------
  const dataBlock = preprocessed
    ? buildPreprocessedBlock(preprocessed, isEs)
    : isEs
      ? `## Datos del balance\n\nNo se pudo recuperar el balance pre-procesado. Solo dispones del mensaje de error literal de arriba. NO inventes saldos: si necesitas un numero especifico, dilo abiertamente al usuario y pidele que vuelva a subir el archivo.`
      : `## Balance data\n\nThe preprocessed trial balance is not available. You only have the literal error message above. DO NOT invent balances: if you need a specific number, say so openly to the user and ask them to re-upload the file.`;

  // ---------------------------------------------------------------------------
  // Tools disponibles
  // ---------------------------------------------------------------------------
  const toolsBlock = isEs
    ? `## Herramientas disponibles

Tienes dos herramientas. Usalas con criterio:

1. **read_account({ code })** — Inspecciona una cuenta PUC por codigo (ej. "11", "1105", "110505"). Te devuelve el saldo, descendientes inmediatos y total de la clase. **USA ESTA TOOL SIEMPRE antes de afirmar el saldo de una cuenta.** Si el codigo es de Clase (1 digito) o Grupo (2 digitos), te devolvera tambien sus cuentas hijas para que las analices. Si el codigo no existe, te dara una pista basada en prefijos cercanos.

2. **mark_provisional({ reason })** — Marca el reporte como BORRADOR con la razon que el usuario te declare por escrito. **REGLAS CRITICAS:**
   - NUNCA llames esta tool por iniciativa propia. SOLO cuando el usuario, en el ultimo turno de la conversacion, exprese inequivocamente que quiere generar el reporte como borrador a pesar del error.
   - La \`reason\` debe ser la razon que el usuario te dio, parafraseada en una sola frase clara (no inventes razones).
   - Si el usuario duda, NO la llames: pidele primero que confirme con palabras explicitas (por ejemplo "si, generalo igual" o "marcalo como borrador").
   - Esta tool no modifica nada en el servidor: solo emite una senal a la interfaz para que ofrezca al usuario re-correr el reporte con el override.`
    : `## Available tools

You have two tools. Use them with judgment:

1. **read_account({ code })** — Inspect a PUC account by code (e.g. "11", "1105", "110505"). Returns balance, immediate descendants, and class total. **ALWAYS use this tool before stating an account balance.** If the code is Class (1 digit) or Group (2 digits), it will also return its child accounts. If the code does not exist, it will hint at nearby prefixes.

2. **mark_provisional({ reason })** — Marks the report as DRAFT with the reason the user has explicitly declared. **CRITICAL RULES:**
   - NEVER call this tool on your own initiative. ONLY when the user, in their latest turn, unambiguously expresses they want to generate the report as a draft despite the error.
   - The \`reason\` must be the user's stated reason, paraphrased in a single clear sentence (do not invent reasons).
   - If the user hesitates, DO NOT call it: first ask them to confirm with explicit words (e.g. "yes, generate it anyway" or "mark it as draft").
   - This tool does not change anything on the server: it only signals the UI to offer the user the option to re-run with the override.`;

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
    toolsBlock,
    '',
    rulesBlock,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPreprocessedBlock(pp: PreprocessedBalance, isEs: boolean): string {
  const lines: string[] = [];
  lines.push(isEs ? '## Resumen del balance pre-procesado' : '## Preprocessed balance summary');
  lines.push('');
  if (pp.period) {
    lines.push(isEs ? `- Periodo detectado: ${pp.period}` : `- Detected period: ${pp.period}`);
  }
  const ct = pp.controlTotals;
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

  if (pp.discrepancies.length > 0) {
    lines.push('');
    lines.push(isEs ? `### Discrepancias detectadas (${pp.discrepancies.length})` : `### Detected discrepancies (${pp.discrepancies.length})`);
    for (const d of pp.discrepancies.slice(0, 8)) {
      lines.push(`- **${d.location}**: ${d.description}`);
    }
    if (pp.discrepancies.length > 8) {
      lines.push(isEs
        ? `- ...y ${pp.discrepancies.length - 8} mas (consulta el reporte completo abajo).`
        : `- ...and ${pp.discrepancies.length - 8} more (see full report below).`);
    }
  }

  if (pp.missingAccounts.length > 0) {
    lines.push('');
    lines.push(isEs ? `### Cuentas PUC faltantes o con saldo 0 (${pp.missingAccounts.length})` : `### Missing or zero-balance PUC accounts (${pp.missingAccounts.length})`);
    for (const m of pp.missingAccounts.slice(0, 6)) {
      lines.push(`- ${m}`);
    }
    if (pp.missingAccounts.length > 6) {
      lines.push(isEs
        ? `- ...y ${pp.missingAccounts.length - 6} mas.`
        : `- ...and ${pp.missingAccounts.length - 6} more.`);
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

function fmtCop(n: number): string {
  if (!Number.isFinite(n)) return 'N/D';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-$' : '$') + formatted;
}
