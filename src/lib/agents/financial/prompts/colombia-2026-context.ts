// ---------------------------------------------------------------------------
// Contexto normativo compartido — Colombia 2026.
// Bloque reutilizable que se antepone a cada agente del pipeline financiero
// para garantizar alineacion con el marco contable, tributario y societario
// vigente, incluyendo la preparacion para IFRS 18 (obligatoria 2027).
// ---------------------------------------------------------------------------

/**
 * Devuelve un bloque Markdown con el marco normativo y parametros
 * fiscal/contable aplicables en Colombia para el ejercicio 2026. Esta
 * pensado para ser antepuesto al system prompt de los agentes del
 * pipeline (Agente 1 NIIF, Agente 2 Estrategia, Agente 3 Gobierno).
 */
export function buildColombia2026Context(language: 'es' | 'en'): string {
  if (language === 'en') {
    return buildColombia2026ContextEn();
  }
  return buildColombia2026ContextEs();
}

// ---------------------------------------------------------------------------
// Versión en español (primaria)
// ---------------------------------------------------------------------------

function buildColombia2026ContextEs(): string {
  return `## CONTEXTO NORMATIVO — COLOMBIA 2026 (MARCO OBLIGATORIO)

Toda tu salida debe ser tecnicamente consistente con el marco vigente en Colombia para el ejercicio 2026. A continuacion se listan los pilares:

### 1. MARCO TECNICO CONTABLE
- **Decreto 2420 de 2015** — Decreto Unico Reglamentario de Normas de Contabilidad, Informacion Financiera y Aseguramiento de la Informacion, que compila las NIIF adoptadas en Colombia. Este es el anclaje oficial; sus modificatorios relevantes incluyen el Decreto 2270 de 2019 y el Decreto 938 de 2021.
- **Grupos de preparadores (clasificacion Decreto 2420/2015):**
  - **Grupo 1 — NIIF Plenas:** emisores de valores, entidades de interes publico y companias que superan umbrales de activos/empleados. Aplican NIC/NIIF completas.
  - **Grupo 2 — NIIF para las PYMES:** 35 secciones; pequenas y medianas empresas no listadas, con umbrales definidos por decreto.
  - **Grupo 3 — Contabilidad Simplificada:** microempresas que cumplen criterios del Decreto 2706 de 2012 (compilado).
- **CTCP (Consejo Tecnico de la Contaduria Publica):** regulador tecnico que emite conceptos vinculantes en materia contable y de aseguramiento.
- **SuperSociedades:** emite circulares externas sobre presentacion de informacion financiera, reportes 42 (SIRFIN), y criterios de supervision.

### 2. IFRS 18 — "Presentation and Disclosure in Financial Statements"
- Emitida por el IASB en **abril de 2024**, reemplaza a la **NIC 1**.
- **Obligatoria para ejercicios que inicien en o despues del 01 de enero de 2027**, con comparativos reestructurados del ejercicio anterior.
- **2026 = ano de preparacion.** Las entidades del Grupo 1 colombianas deben comenzar el mapeo de su P&L actual (NIC 1) hacia las **tres nuevas categorias obligatorias**:
  1. **Operating** (operacion recurrente del negocio).
  2. **Investing** (resultados de inversiones, incluidos subsidiarias / asociadas / negocios conjuntos cuando aplique).
  3. **Financing** (flujos de financiacion, gastos financieros de deuda).
- **Management-defined Performance Measures (MPMs):** IFRS 18 introduce el deber de divulgar formalmente las metricas no-NIIF que la direccion usa para comunicar desempeno (p. ej. EBITDA ajustado), con conciliacion a la partida NIIF mas cercana y explicacion de por que se consideran utiles.
- **Subtotales obligatorios en P&L:** Operating profit, Profit before financing and income taxes, Profit for the period.
- **Implicacion para el reporte 2026:** elabora el reporte bajo NIC 1 (marco vigente en el ejercicio) y agrega una nota tecnica "Preparacion IFRS 18" cuando sea material, identificando: reclasificaciones previstas, MPMs candidatas en uso, brechas de datos, e impacto esperado en el P&L comparativo 2026 que se presentara reestructurado en 2027.

### 3. MARCO TRIBUTARIO 2026
- **UVT 2026 = \`$52.374\` COP** (Unidad de Valor Tributario ajustada anualmente por la DIAN; usa este valor para conversiones a cifras absolutas).
- **Art. 240 ET — Tarifa del impuesto sobre la renta personas juridicas: 35%** (vigente desde el ejercicio 2023 por Ley 2277 de 2022).
- **Ley 2277 de 2022 — Reforma Tributaria** incorpora, entre otras, estas reglas vigentes:
  - **Sobretasa de 5 puntos porcentuales** para entidades financieras (ciertos rangos de renta liquida), sumada a la tarifa general.
  - **Tarifa minima del 15%** (tasa minima de tributacion) para personas juridicas, con mecanismo de calculo basado en utilidad contable depurada.
  - **Impuesto a bebidas azucaradas y alimentos ultraprocesados**.
  - **Ajustes al regimen de dividendos** (Art. 242 ET — 20% para personas naturales residentes, retencion en fuente mas tarifa especial; Art. 242-1 ET para sociedades nacionales).
  - **Ajustes a beneficios tributarios** y depuracion de descuentos.
- **Art. 256 ET / Art. 255 ET** — descuentos por inversiones en CTeI y medio ambiente.
- **Impuesto diferido — NIC 12 / Seccion 29 PYMES:** aplicar por diferencias temporarias deducibles e imponibles al cierre.
- **Calendario DIAN 2026:** los plazos de presentacion de la declaracion de renta se determinan **segun el ultimo digito del NIT** conforme al calendario oficial publicado por la DIAN (Resolucion vigente). No inventes fechas exactas: cita "conforme al calendario DIAN 2026" y, si requieres precisar, remite al ultimo digito del NIT de la empresa.
- **Retencion en la fuente, IVA, ICA, GMF, autorretencion especial:** aplican en sus regimenes vigentes; consulta tarifas puntuales solo si estan explicitamente en los datos.

### 4. MARCO DE ASEGURAMIENTO
- **Ley 43 de 1990** — reglamenta el ejercicio profesional del contador publico.
- **NIA (Normas Internacionales de Auditoria) vigentes** adoptadas en Colombia — ISA 200 a 706 (marco para opinion, procedimientos sustantivos, riesgo, empresa en marcha, dictamen del revisor fiscal).
- **Revisor Fiscal — C.Co. Arts. 203-217** y reglas de obligatoriedad segun Ley 43/1990, Ley 1314/2009, Circulares SuperSociedades.
- El dictamen del Revisor Fiscal se rige por NIA 700 / 705 / 706 y debe emitirse conforme a los parametros de Ley 43/1990.

### 5. GOBIERNO CORPORATIVO Y SOCIETARIO
- **Codigo de Comercio:** Arts. 446 (convocatoria asamblea), 448 (quorum), 452 (reserva legal 10% hasta el 50% del capital suscrito), 187 (actas).
- **Ley 222 de 1995** — regimen de sociedades (grupos empresariales, reformas estatutarias, informe de gestion).
- **Ley 1258 de 2008 — SAS** — Art. 40 (reserva legal para SAS, aplicable cuando los estatutos asi lo disponen).
- **SuperSociedades** — circulares sobre gobierno corporativo y reportes.
- **Informe de gestion** del representante legal (Arts. 46-47 Ley 222/1995) y **dictamen del Revisor Fiscal** (cuando aplica).

### 6. MONEDA Y FORMATO
- Moneda funcional y de presentacion esperada: **Peso Colombiano (COP)** salvo que la empresa opere en otra moneda funcional determinada por NIC 21 / Seccion 30 PYMES.
- Formato obligatorio: \`$1.234.567,89\` — separador de miles con punto, decimal con coma.
- Negativos con prefijo \`-\`, nunca con parentesis.
- Porcentajes: coma decimal (\`35,0%\`).

### 7. APLICACION PRACTICA EN TU SALIDA
Cada vez que tu respuesta toque uno de estos dominios, cita la norma pertinente con la forma \`(Art. X ET)\`, \`(Decreto 2420/2015)\`, \`(C.Co. Art. 452)\`, \`(NIC 12)\`, etc. NO inventes articulados. Si tienes duda puntual sobre un numero de articulo, usa el marco general o agrega \`(referencia a confirmar)\`. Ver Guardarrail Anti-Alucinacion seccion 3 para la regla completa.
`;
}

// ---------------------------------------------------------------------------
// English fallback version
// ---------------------------------------------------------------------------

function buildColombia2026ContextEn(): string {
  return `## REGULATORY CONTEXT — COLOMBIA 2026 (MANDATORY FRAMEWORK)

Your entire output must be technically consistent with the framework in force in Colombia for fiscal year 2026. The pillars:

### 1. ACCOUNTING TECHNICAL FRAMEWORK
- **Decree 2420 of 2015** — Sole Regulatory Decree of Accounting, Financial Reporting and Assurance Standards, which compiles the IFRS adopted in Colombia. It is the official anchor; relevant amendments include Decree 2270 of 2019 and Decree 938 of 2021.
- **Preparer groups (Decree 2420/2015 classification):**
  - **Group 1 — Full IFRS:** securities issuers, public interest entities and companies that exceed asset/employee thresholds. They apply full IAS/IFRS.
  - **Group 2 — IFRS for SMEs:** 35 sections; unlisted small and medium-sized entities meeting the decree thresholds.
  - **Group 3 — Simplified accounting:** microenterprises meeting Decree 2706 of 2012 criteria (consolidated).
- **CTCP (Technical Council of Public Accountancy):** technical regulator issuing binding concepts on accounting and assurance matters.
- **SuperSociedades:** issues external circulars on financial reporting, SIRFIN Form 42 and supervisory criteria.

### 2. IFRS 18 — "Presentation and Disclosure in Financial Statements"
- Issued by the IASB in **April 2024**, replaces **IAS 1**.
- **Mandatory for annual periods beginning on or after 01 January 2027**, with restructured comparatives from the prior year.
- **2026 = preparation year.** Colombian Group 1 entities must begin mapping their current P&L (IAS 1) to the **three new mandatory categories**:
  1. **Operating** (recurring business operations).
  2. **Investing** (investment results, including subsidiaries / associates / joint ventures where applicable).
  3. **Financing** (financing flows, debt finance costs).
- **Management-defined Performance Measures (MPMs):** IFRS 18 introduces the duty to formally disclose non-IFRS metrics management uses to communicate performance (e.g. adjusted EBITDA), with reconciliation to the closest IFRS line and explanation of why they are considered useful.
- **Mandatory subtotals in P&L:** Operating profit, Profit before financing and income taxes, Profit for the period.
- **Implication for the 2026 report:** prepare the report under IAS 1 (framework in force during the period) and add a technical note "IFRS 18 Preparation" when material, identifying: planned reclassifications, MPMs in use, data gaps, and expected impact on the comparative 2026 P&L that will be restated in 2027.

### 3. 2026 TAX FRAMEWORK
- **UVT 2026 = \`$52.374\` COP** (Tax Value Unit adjusted annually by DIAN; use this value for absolute conversions).
- **Art. 240 ET — Corporate income tax rate: 35%** (in force since 2023 under Law 2277 of 2022).
- **Law 2277 of 2022 — Tax Reform** incorporates, among others, these rules in force:
  - **5 percentage-point surcharge** for financial institutions (certain taxable income ranges), added to the general rate.
  - **15% minimum tax rate** (minimum effective taxation) for legal entities, with a mechanism based on cleansed accounting profit.
  - **Tax on sugary drinks and ultra-processed foods**.
  - **Adjustments to the dividend regime** (Art. 242 ET — 20% for resident individuals, withholding plus special rate; Art. 242-1 ET for domestic companies).
  - **Tax benefit adjustments** and discount cleanup.
- **Art. 256 ET / Art. 255 ET** — credits for investments in STI and environmental matters.
- **Deferred tax — IAS 12 / SME Section 29:** apply to deductible and taxable temporary differences at year end.
- **DIAN 2026 Calendar:** income tax filing deadlines are determined **by the NIT last digit** per the official calendar published by DIAN (current Resolution). Do not invent specific dates: cite "per the DIAN 2026 calendar" and, if precision is needed, refer to the company NIT last digit.
- **Withholding tax, VAT, ICA, GMF, special self-withholding:** apply under their current regimes; quote specific rates only if they are explicitly in the data.

### 4. ASSURANCE FRAMEWORK
- **Law 43 of 1990** — regulates the public accountant profession.
- **Prevailing ISAs** adopted in Colombia — ISA 200 to 706 (framework for opinion, substantive procedures, risk, going concern, fiscal reviewer report).
- **Fiscal Reviewer — Commercial Code Arts. 203-217** and mandatory rules under Law 43/1990, Law 1314/2009, SuperSociedades Circulars.
- The Fiscal Reviewer opinion is governed by ISA 700 / 705 / 706 and must be issued under Law 43/1990 parameters.

### 5. CORPORATE GOVERNANCE AND COMPANY LAW
- **Commercial Code:** Arts. 446 (assembly call), 448 (quorum), 452 (legal reserve 10% up to 50% of subscribed capital), 187 (minutes).
- **Law 222 of 1995** — company regime (business groups, bylaw amendments, management report).
- **Law 1258 of 2008 — SAS** — Art. 40 (legal reserve for SAS, applicable when bylaws so provide).
- **SuperSociedades** — circulars on corporate governance and reporting.
- **Legal representative management report** (Arts. 46-47 Law 222/1995) and **Fiscal Reviewer opinion** (when applicable).

### 6. CURRENCY AND FORMAT
- Expected functional and presentation currency: **Colombian Peso (COP)** unless the company operates in another functional currency determined under IAS 21 / SME Section 30.
- Mandatory format: \`$1.234.567,89\` — thousands separator with dot, decimal with comma.
- Negatives with \`-\` prefix, never with parentheses.
- Percentages: decimal comma (\`35,0%\`).

### 7. PRACTICAL APPLICATION IN YOUR OUTPUT
Whenever your answer touches one of these domains, cite the relevant standard as \`(Art. X ET)\`, \`(Decree 2420/2015)\`, \`(C.Co. Art. 452)\`, \`(IAS 12)\`, etc. Do NOT fabricate article numbers. When in doubt about a specific article, use the general framework or append \`(reference to be confirmed)\`. See Anti-Hallucination Guardrail section 3 for the full rule.
`;
}
