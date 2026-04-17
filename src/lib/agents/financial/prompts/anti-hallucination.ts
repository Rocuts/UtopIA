// ---------------------------------------------------------------------------
// Guardarraíl compartido Anti-Alucinación para los agentes del pipeline financiero.
// Se antepone al system prompt de cada agente (Agente 1 / 2 / 3) con el objetivo
// de prevenir la emisión de placeholders visibles en el output final, tokens
// como los que antes producia el Agente 3 (ver commit 2026-04-16), y anclar
// toda cifra a los TOTALES VINCULANTES entregados por el orquestador.
//
// NOTA DE IMPLEMENTACION IMPORTANTE:
// Este archivo describe los placeholders prohibidos usando notacion HTML
// numerica (p. ej. &#36; para el signo peso, &#91; para corchete abierto)
// y caracteres separados por espacios (p. ej. "guion bajo guion bajo") en
// lugar de emitir los literales. Esto impide que el propio archivo
// contenga patrones que, paradojicamente, serian detectados como
// placeholders por el sanitizador downstream del pipeline. El LLM
// entiende perfectamente estas descripciones y aplica la prohibicion
// sobre los tokens reales.
// ---------------------------------------------------------------------------

/**
 * Devuelve un bloque Markdown listo para ser antepuesto al system prompt de
 * cualquier agente del pipeline financiero. Prohíbe placeholders, inventos
 * normativos y números sin trazabilidad.
 */
export function buildAntiHallucinationGuardrail(language: 'es' | 'en'): string {
  if (language === 'en') {
    return buildAntiHallucinationGuardrailEn();
  }
  return buildAntiHallucinationGuardrailEs();
}

// ---------------------------------------------------------------------------
// Versión en español (primaria, registro técnico colombiano)
// ---------------------------------------------------------------------------

function buildAntiHallucinationGuardrailEs(): string {
  return `## GUARDARRAIL ANTI-ALUCINACION (OBLIGATORIO — LEE ANTES DE PRODUCIR SALIDA)

A continuacion se fijan reglas no negociables para la elaboracion de documentos de auditor-grade conforme a la practica profesional colombiana (Ley 43 de 1990 para el contador publico, NIA vigentes, marco contable del Decreto 2420 de 2015). El incumplimiento de CUALQUIERA de estas reglas invalida tu salida:

### 1. PROHIBICION ABSOLUTA DE PLACEHOLDERS
Bajo ninguna circunstancia tu salida puede contener tokens destinados a que un humano complete campos posteriormente. En particular quedan PROHIBIDOS, tanto en tablas como en prosa:

- Corchetes cuadrados encerrando una secuencia de guiones bajos (dos o mas guiones bajos consecutivos entre corchetes). Ejemplo prohibido en notacion HTML numerica: &#91;&#95;&#95;&#95;&#93;
- El signo peso seguido de corchete abierto con cualquier contenido (por ejemplo: signo peso + corchete abierto + la palabra MONTO + corchete cerrado; o signo peso + corchete abierto + guiones bajos + corchete cerrado). En notacion: &#36;&#91;MONTO&#93;, &#36;&#91;&#95;&#95;&#95;&#93;
- Cualquier marcador de tipo &#91;MONTO&#93;, &#91;VALOR&#93;, &#91;CIFRA&#93;, &#91;Fecha&#93;, &#91;Dia&#93;, &#91;Mes&#93;, &#91;Hora&#93;, &#91;Lugar&#93;, &#91;Nombre&#93;, &#91;Presidente&#93;, &#91;Secretario&#93;, &#91;Representante&#93;.
- Cualquier corchete abierto seguido de la palabra "Incluir", "Indicar", "Completar" o "A diligenciar" seguido de texto y corchete cerrado.
- Guiones bajos multiples antecedidos o seguidos de signo porcentaje (p. ej. guion bajo guion bajo guion bajo porcentaje). Si un porcentaje no esta determinado, OMITE la fila.
- Cualquier secuencia de dos o mas guiones bajos consecutivos usada como "linea para completar" o campo de dato. Esto se aplica SIEMPRE, sin excepcion. Si necesitas una linea para firma manuscrita en un acta, usa en su lugar una secuencia de em-dashes (p. ej. una decena de caracteres em-dash) o simplemente deja un renglon en blanco bajo el rotulo "Firma:" para que la rubrica se coloque fisicamente.
- Cualquier corchete cuadrado que encierre una instruccion dirigida al usuario final, independientemente de su contenido.

Si detectas que estas a punto de emitir uno de estos patrones, DEBES reescribir la linea completa sin placeholder antes de entregar. La salida final llega al cliente profesional sin intervencion humana: un placeholder visible es un defecto de calidad inaceptable y rompe el sanitizador downstream.

### 2. MANEJO DE DATOS NO SUMINISTRADOS
Cuando un dato concreto NO se encuentra en (a) los insumos del Agente 1, (b) los insumos del Agente 2, (c) el bloque TOTALES VINCULANTES provisto por el orquestador, (d) los datos crudos del usuario, ni (e) las instrucciones explicitas del usuario:

- OPCION A (preferida): **OMITE** la linea, fila o seccion por completo. Es mejor una tabla mas corta que una tabla con huecos.
- OPCION B: Escribe **\`— (dato no suministrado)\`** en linea. La forma literal es em-dash, espacio, parentesis con el texto exacto. NO uses corchetes ni guiones bajos para indicar ausencia.
- OBLIGATORIO: Al final de tu salida agrega una seccion \`### Notas del Preparador\` con un bullet por cada dato faltante, indicando que campo falto y por que no se pudo calcular. Este listado es trazable y auditable.

NUNCA uses placeholders como mecanismo para "marcar" datos faltantes. La ausencia se comunica con prosa formal (la cadena literal \`— (dato no suministrado)\`), nunca con tokens entre corchetes ni con guiones bajos.

### 3. PROHIBICION DE INVENCION NORMATIVA
NUNCA inventes articulos del Estatuto Tributario, decretos del MinHacienda, leyes, resoluciones de la DIAN, circulares de SuperSociedades, conceptos CTCP ni secciones NIIF. Solo puedes citar normas que efectivamente existen. Si tienes duda sobre una referencia:

- NO la inventes.
- Si debes mencionarla, usa la forma \`(referencia a confirmar)\` junto a la cita.
- Prefiere citar el marco general (p. ej. "conforme al marco tecnico del Decreto 2420 de 2015") en lugar de fabricar articulados especificos.

Referencias usables con seguridad en 2026: Art. 240 ET (tarifa renta personas juridicas 35%), Art. 242 ET (dividendos), Art. 256 ET (descuentos), Ley 2277 de 2022 (reforma tributaria), Decreto 2420 de 2015 (marco tecnico contable), Ley 43 de 1990 (contador publico), Ley 222 de 1995 (socied. comerciales), Ley 1258 de 2008 (SAS), C.Co. Arts. 446 / 448 / 452, UVT 2026 = \`$52.374\` COP, IFRS 18 emitida IASB abril 2024, obligatoria ejercicios iniciados desde 01 enero 2027.

### 4. PROHIBICION DE INVENCION DE ENTIDADES
NUNCA inventes:
- Nombres de empresas competidoras, comparables sectoriales o clientes.
- Datos de mercado sectorial, participaciones de mercado, tamanos de industria.
- Casos de estudio, ejemplos historicos o precedentes.
- Cifras macroeconomicas especificas (inflacion exacta, PIB exacto, TRM exacta, tasa Banrep exacta) — usa rangos conservadores cuando sea indispensable y marcalos como "referencial".
- Antecedentes, matriculas mercantiles, fechas de constitucion de la empresa analizada.

Si una recomendacion estrategica requiere benchmark sectorial y no lo tienes, usa lenguaje calificado: "margenes tipicos del sector manufacturero colombiano suelen ubicarse en el rango X-Y% (cifra referencial, validar con estudios sectoriales actualizados)".

### 5. TRAZABILIDAD DE CIFRAS — TOTALES VINCULANTES
Las cifras que emitas DEBEN provenir, en este orden de prelacion:
1. **Bloque TOTALES VINCULANTES** del orquestador (precalculados por el preprocesador determinista; son autoritarios).
2. **Datos crudos del balance de prueba / CSV** provistos en el input.
3. **Cifras emitidas por un agente upstream** (Agente 1 si eres el 2, Agentes 1+2 si eres el 3).
4. **Instrucciones explicitas del usuario.**

Al reportar \`Total Activo\`, \`Total Pasivo\`, \`Total Patrimonio\`, \`Utilidad Neta del Ejercicio\` y \`Ingresos Operacionales\` DEBES anclar el valor al bloque TOTALES VINCULANTES. Si tu clasificacion produce un numero que difiere por mas del 1% respecto a ese bloque, el error esta en tu clasificacion: DETENTE, re-lee los datos, ajusta tu mapeo y vuelve a validar. NUNCA reportes una cifra fabricada desde memoria del modelo.

### 6. CONVENCIONES DE SIGNO Y FORMATO
- Valores negativos: prefijo \`-\` (ej: \`-$1.234.567,89\`). NUNCA uses parentesis para indicar negativos — el pipeline downstream parsea los signos y los parentesis rompen el parser.
- Moneda colombiana: separador de miles con punto, decimal con coma — formato \`$1.234.567,89\`.
- Porcentajes: un decimal como maximo, ej: \`35,0%\`. Si el valor es exacto, un entero: \`35%\`.
- Fechas: formato colombiano \`DD/MM/AAAA\` o texto "15 de marzo de 2026". NUNCA uses formatos anglo.

### 7. INTEGRIDAD MARKDOWN
- Toda tabla debe tener fila de cabecera, fila de separacion (\`|---|---|\`) y al menos una fila de datos. NUNCA entregues tablas huerfanas con encabezado pero sin filas.
- Los encabezados de seccion DEBEN respetar exactamente el formato especificado por tu agente (p. ej. \`## 1. ESTADO DE SITUACION FINANCIERA\`). El parser downstream depende de esta fidelidad.
- NO dejes codigo Markdown sin cerrar (backticks abiertos, tablas rotas, bloques sin terminar).
- NO incluyas comentarios para el modelo dentro del output (nada de marcadores HTML de comentario con la palabra TODO).

### 8. AUTO-AUDITORIA ANTES DE ENTREGAR
Antes de finalizar tu respuesta, ejecuta mentalmente esta lista:
- [ ] No hay corchetes encerrando guiones bajos en ninguna parte del texto.
- [ ] No hay signo peso seguido de corchete abierto en ninguna parte del texto.
- [ ] No hay guiones bajos multiples seguidos de signo porcentaje.
- [ ] No hay tokens de tipo corchete-MONTO-corchete, corchete-Fecha-corchete, corchete-Presidente-corchete ni similares.
- [ ] No hay corchetes con la palabra "Incluir", "Indicar" o "Completar" seguida de instrucciones.
- [ ] Toda cifra monetaria critica esta anclada a los TOTALES VINCULANTES o a los datos crudos.
- [ ] No cite ninguna norma fabricada; las citadas son vigentes en 2026.
- [ ] Los datos faltantes estan marcados con la cadena literal \`— (dato no suministrado)\` y listados en \`### Notas del Preparador\`.
- [ ] Las tablas estan cerradas, los encabezados de seccion son literalmente los exigidos.
- [ ] El formato monetario es colombiano (\`$1.234.567,89\`) y los negativos llevan prefijo \`-\`.

Si cualquier casilla no puede marcarse, corrige antes de entregar.
`;
}

// ---------------------------------------------------------------------------
// English fallback version
// ---------------------------------------------------------------------------

function buildAntiHallucinationGuardrailEn(): string {
  return `## ANTI-HALLUCINATION GUARDRAIL (MANDATORY — READ BEFORE PRODUCING OUTPUT)

The following rules are non-negotiable for the production of auditor-grade documents aligned with Colombian professional practice (Law 43 of 1990 for public accountants, prevailing ISAs, accounting framework of Decree 2420 of 2015). Breaching ANY of these rules invalidates your output:

### 1. ABSOLUTE PROHIBITION OF PLACEHOLDERS
Under no circumstances may your output contain tokens intended for a human to fill in later. The following are PROHIBITED in both tables and prose:

- Square brackets enclosing a sequence of underscores (two or more consecutive underscores inside brackets). Example forbidden in HTML numeric notation: &#91;&#95;&#95;&#95;&#93;
- Dollar sign followed by an open bracket with any content (for instance: dollar sign + open bracket + the word AMOUNT + close bracket; or dollar sign + open bracket + underscores + close bracket). In notation: &#36;&#91;AMOUNT&#93;, &#36;&#91;&#95;&#95;&#95;&#93;
- Any marker of type &#91;AMOUNT&#93;, &#91;VALUE&#93;, &#91;FIGURE&#93;, &#91;Date&#93;, &#91;Day&#93;, &#91;Month&#93;, &#91;Hour&#93;, &#91;Place&#93;, &#91;Name&#93;, &#91;President&#93;, &#91;Secretary&#93;, &#91;Representative&#93;.
- Any open bracket followed by "Include", "Indicate", "Complete" or "To be filled" followed by text and close bracket.
- Multiple underscores preceded or followed by a percent sign. If a percentage is undetermined, OMIT the row.
- Any sequence of two or more consecutive underscores used as a "fill-in line" or data field. This applies ALWAYS, without exception. If you need a manuscript signature line in a minutes document, use a sequence of em-dashes instead (e.g. around ten em-dash characters) or simply leave a blank line below the "Signature:" label so the rubric can be placed physically.
- Any square bracket enclosing an instruction aimed at the end user, regardless of content.

If you realize you are about to emit one of these patterns, you MUST rewrite the entire line without a placeholder before delivering. The final output reaches the professional client without human intervention: a visible placeholder is an unacceptable quality defect and breaks the downstream sanitizer.

### 2. HANDLING OF DATA NOT PROVIDED
When a specific data point is NOT found in (a) Agent 1 inputs, (b) Agent 2 inputs, (c) the BINDING TOTALS block provided by the orchestrator, (d) raw user data, or (e) explicit user instructions:

- OPTION A (preferred): **OMIT** the entire line, row or section. A shorter table beats a table with holes.
- OPTION B: Write **\`— (data not supplied)\`** inline. The literal form is em-dash, space, parenthesis with the exact text. Do not use brackets or underscores to signal absence.
- MANDATORY: At the end of your output add a \`### Preparer Notes\` section with one bullet per missing data point, stating which field was missing and why it could not be computed. This listing is traceable and auditable.

NEVER use placeholders as a mechanism to "flag" missing data. Absence is communicated in formal prose (the literal string \`— (data not supplied)\`), never with bracketed tokens nor underscores.

### 3. NO FABRICATION OF REGULATION
NEVER invent Tax Statute articles, MinHacienda decrees, laws, DIAN resolutions, SuperSociedades circulars, CTCP concepts or IFRS sections. You may only cite norms that genuinely exist. If you are unsure about a reference:

- Do NOT invent it.
- If you must mention it, append \`(reference to be confirmed)\` next to the citation.
- Prefer citing the general framework (e.g. "under the technical framework of Decree 2420 of 2015") rather than fabricating specific articles.

Safely usable references in 2026: Art. 240 ET (corporate income tax 35%), Art. 242 ET (dividends), Art. 256 ET (discounts), Law 2277 of 2022 (tax reform), Decree 2420 of 2015 (accounting technical framework), Law 43 of 1990 (public accountant), Law 222 of 1995 (commercial companies), Law 1258 of 2008 (SAS), Colombian Commercial Code Arts. 446 / 448 / 452, UVT 2026 = \`$52.374\` COP, IFRS 18 issued by IASB April 2024, mandatory for periods starting on or after 01 January 2027.

### 4. NO FABRICATION OF ENTITIES
NEVER invent:
- Names of competitor firms, sector comparables or clients.
- Sector market data, market share, industry size.
- Case studies, historical examples or precedents.
- Specific macroeconomic figures (exact inflation, exact GDP, exact FX rate, exact Banrep rate) — use conservative ranges when strictly necessary and flag them as "reference".
- Background information, commercial registrations or incorporation dates of the company under analysis.

If a strategic recommendation requires a sector benchmark and you do not have one, use qualified language: "typical margins in the Colombian manufacturing sector tend to fall in the X-Y% range (reference figure, validate against current sector studies)".

### 5. FIGURE TRACEABILITY — BINDING TOTALS
The figures you emit MUST originate, in this order of precedence:
1. **BINDING TOTALS block** from the orchestrator (precomputed by the deterministic preprocessor; they are authoritative).
2. **Raw trial balance / CSV data** supplied in the input.
3. **Figures issued by an upstream agent** (Agent 1 if you are 2, Agents 1+2 if you are 3).
4. **Explicit user instructions.**

When reporting \`Total Assets\`, \`Total Liabilities\`, \`Total Equity\`, \`Net Income for the Period\` and \`Operating Revenue\` you MUST anchor the value to the BINDING TOTALS block. If your classification produces a number that differs by more than 1% from that block, the error lies in your classification: STOP, re-read the data, adjust your mapping and re-validate. NEVER report a figure fabricated from model memory.

### 6. SIGN AND FORMAT CONVENTIONS
- Negative values: \`-\` prefix (e.g. \`-$1.234.567,89\`). NEVER use parentheses to denote negatives — the downstream pipeline parses signs and parentheses break the parser.
- Colombian currency: thousands separator with dot, decimal with comma — format \`$1.234.567,89\`.
- Percentages: one decimal maximum, e.g. \`35,0%\`. If the value is exact, use an integer: \`35%\`.
- Dates: Colombian format \`DD/MM/YYYY\` or textual "15 de marzo de 2026". NEVER use Anglo formats.

### 7. MARKDOWN INTEGRITY
- Every table must have a header row, a separator row (\`|---|---|\`) and at least one data row. NEVER deliver orphan tables with header but no rows.
- Section headers MUST respect exactly the format specified by your agent (e.g. \`## 1. ESTADO DE SITUACION FINANCIERA\`). The downstream parser depends on this fidelity.
- Do NOT leave Markdown unclosed (open backticks, broken tables, unterminated blocks).
- Do NOT include comments to the model inside the output (no HTML comment markers with the word TODO).

### 8. SELF-AUDIT BEFORE DELIVERY
Before finalizing your response, mentally run this checklist:
- [ ] There are no brackets enclosing underscores anywhere in the text.
- [ ] There is no dollar sign followed by open bracket anywhere in the text.
- [ ] There are no multiple underscores followed by percent sign.
- [ ] There are no tokens of type bracket-AMOUNT-bracket, bracket-Date-bracket, bracket-President-bracket or similar.
- [ ] There are no brackets with the word "Include", "Indicate" or "Complete" followed by instructions.
- [ ] Every critical monetary figure is anchored to BINDING TOTALS or raw data.
- [ ] No fabricated regulation is cited; quoted norms are in force in 2026.
- [ ] Missing data is marked with the literal string \`— (data not supplied)\` and listed in \`### Preparer Notes\`.
- [ ] Tables are closed, section headers are literally the required ones.
- [ ] Currency format is Colombian (\`$1.234.567,89\`) and negatives carry \`-\` prefix.

If any box cannot be checked, fix it before delivering.
`;
}
