// ---------------------------------------------------------------------------
// Contexto normativo compartido — Colombia 2026.
// Bloque reutilizable que se antepone a cada agente del pipeline financiero
// para garantizar alineacion con el marco contable, tributario y societario
// vigente, incluyendo la preparacion para IFRS 18 (obligatoria 2027).
// ---------------------------------------------------------------------------
// AUDITORIA NORMATIVA 2026-08-07 — fuentes verificadas de los valores que
// viajan en este bloque (las versiones ES y EN DEBEN mantenerse espejo):
//
//  - UVT 2026 = $52.374 — Resolucion DIAN 000238 del 15-dic-2025 (variacion
//    IPC ingresos medios 5,17% certificada por el DANE). Vigente 01-ene-2026
//    a 31-dic-2026. => 1.090 UVT = $57.087.660.
//  - Regimen de dividendos: Art. 242 E.T. (mod. Art. 3 Ley 2277/2022),
//    Art. 242-1 E.T., Art. 245 E.T. (mod. Art. 4 Ley 2277/2022),
//    Art. 254-1 E.T. (adicionado por el Art. 5 Ley 2277/2022) y Art. 49 E.T.
//    Reglamentacion de la retencion: Decreto 1103 de 2023 — tabla del
//    paragrafo del Art. 242: 0 a 1.090 UVT => 0%; > 1.090 UVT => 15% sobre
//    el exceso. Descuento Art. 254-1: 0% hasta 1.090 UVT; 19% sobre el
//    exceso. Vigentes desde el ano gravable 2023 y aplicables en 2026.
//    Fuente: https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm
//    NO existe tarifa plana del 20% en el Art. 242 — el 20% es el Art. 245
//    (no residentes). La escala derogada (10% sobre el exceso de 300 UVT)
//    murio el 31-dic-2022 con la Ley 2277/2022.
//  - Grupo 3: Art. 1.1.3.1 del Decreto 2420/2015 modificado por el
//    Decreto 1670 de 2021 (vigente desde 01-ene-2023), que derogo los
//    criterios de tamano del Anexo 3 (Decreto 2706/2012: 10 trabajadores,
//    500 SMMLV de activos, 6.000 SMMLV de ingresos). Topes de microempresa:
//    Decreto 1074/2015 Cap. 13 Tit. 1 Parte 2 Libro 2, adicionado por el
//    Decreto 957 de 2019 — manufacturero <= 23.563 UVT, servicios
//    <= 32.988 UVT, comercio <= 44.769 UVT.
//  - Cadena de modificatorios del DUR 2420/2015 confirmada contra MinCIT
//    (normatividad vigente) + Diario Oficial: 2496/2015, 2483/2018,
//    2270/2019, 938/2021, 1670/2021, 1611/2022, 1271/2024 (NIIF 17) y
//    Decreto 0701 del 07-jul-2026 (Diario Oficial 53.547 del 08-jul-2026,
//    rige desde el 09-jul-2026 por su art. 5 — SIN transicion, aplica al
//    ejercicio 2026).
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
- **Decreto 2420 de 2015** — Decreto Unico Reglamentario de Normas de Contabilidad, Informacion Financiera y Aseguramiento de la Informacion, que compila las NIIF adoptadas en Colombia. Este es el anclaje oficial. Cadena de modificatorios vigente a la fecha del ejercicio 2026:
  - **Decreto 2496 de 2015** y **Decreto 2483 de 2018** (compila y actualiza los Anexos 1 y 2).
  - **Decreto 2270 de 2019** (compila y actualiza los marcos tecnicos).
  - **Decreto 938 de 2021** (marco tecnico Grupo 1).
  - **Decreto 1670 de 2021** — simplificacion contable: reclasificacion de los Grupos 2 y 3, **vigente desde el 01-ene-2023**.
  - **Decreto 1611 de 2022** — enmiendas IASB (NIC 1, NIC 8, NIC 12 y NIIF 16), incluida "Informacion a revelar sobre politicas contables".
  - **Decreto 1271 de 2024** — incorpora **NIIF 17 Contratos de Seguro** (Anexo Tecnico Normativo 01 de 2024); la NIIF 4 se deroga desde el 01-ene-2027.
  - **Decreto 0701 del 07 de julio de 2026** — modifica parcialmente los marcos tecnicos de **Grupo 1 y Grupo 2**, incorporando las enmiendas emitidas por el IASB entre sep-2022 y sep-2023 (arrendamientos, presentacion de estados financieros, estado de flujos de efectivo, instrumentos financieros, impuesto a las ganancias y conversion de moneda extranjera). Publicado en el **Diario Oficial 53.547 del 08-jul-2026** y **rige desde el 09-jul-2026** (art. 5), **sin periodo de transicion: aplica al ejercicio 2026 objeto de este reporte**. Las fechas de vigencia previstas por el IASB en los estandares incorporados NO son las fechas de vigencia en Colombia; rigen las del decreto.
  - No afirmes "conforme al marco vigente" omitiendo el Decreto 0701/2026: es la norma mas reciente aplicable a este mismo ejercicio.
- **Grupos de preparadores (clasificacion Decreto 2420/2015):**
  - **Grupo 1 — NIIF Plenas:** emisores de valores, entidades de interes publico y companias que superan umbrales de activos/empleados. Aplican NIC/NIIF completas.
  - **Grupo 2 — NIIF para las PYMES:** 35 secciones; pequenas y medianas empresas no listadas, con umbrales definidos por decreto.
  - **Grupo 3 — Contabilidad Simplificada (Anexo 3 del DUR 2420/2015):** criterios del **Art. 1.1.3.1 del Decreto 2420/2015 modificado por el Decreto 1670 de 2021**, vigentes desde el **01-ene-2023**. Pertenecen al Grupo 3 las personas naturales y juridicas obligadas a llevar contabilidad (y quienes sin estarlo pretendan hacerla valer como prueba) que cumplan **TODOS** estos requisitos:
    1. Ingresos por actividades ordinarias del ano inmediatamente anterior dentro de los topes de **microempresa** del **Decreto 1074 de 2015** (Cap. 13, Tit. 1, Parte 2, Libro 2, adicionado por el Decreto 957 de 2019), por macrosector: **manufacturero <= 23.563 UVT; servicios <= 32.988 UVT; comercio <= 44.769 UVT**.
    2. No mantener inversiones en instrumentos de patrimonio en subsidiarias, negocios conjuntos ni asociadas.
    3. No estar obligada a presentar estados financieros consolidados, combinados o separados.
    4. No realizar transacciones con pagos basados en acciones.
    5. No mantener planes de beneficios post-empleo de beneficios definidos.
    6. No ser cooperativa de ahorro y credito.
    **NEVER uses los criterios de tamano del Anexo 3 / Decreto 2706 de 2012 (10 trabajadores, 500 SMMLV de activos, 6.000 SMMLV de ingresos): fueron DEROGADOS por el Decreto 1670 de 2021.** El criterio de tamano hoy es UNICAMENTE de ingresos por macrosector.
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
  - **Ajustes a beneficios tributarios** y depuracion de descuentos.

#### 3.1. REGIMEN DE DIVIDENDOS (post-Ley 2277 de 2022) — NO existe tarifa plana del 20% para residentes
Vigente desde el ano gravable 2023 y aplicable en 2026. La escala derogada del Art. 242 (10% sobre el exceso de 300 UVT) murio el 31-dic-2022: **NEVER la cites**.
- **Persona natural residente — dividendos NO gravados** (provenientes de utilidades distribuidas como INCRNGO en cabeza de la sociedad): se **integran a la renta liquida** y tributan a la **tarifa progresiva marginal del Art. 241 E.T. (0% a 39%)**, por remision del inciso 1 del **Art. 242 E.T.** (mod. Art. 3 Ley 2277/2022).
- **Retencion en la fuente** (paragrafo del Art. 242 E.T., reglamentada por el **Decreto 1103 de 2023**) — es escalonada y es un **ANTICIPO IMPUTABLE, no el impuesto definitivo**:
  - De 0 a 1.090 UVT → **0%**.
  - Sobre el exceso de 1.090 UVT → **15%**, es decir \`(dividendos en UVT − 1.090 UVT) × 15%\`.
  - 1.090 UVT = \`$57.087.660\` con la UVT 2026 de \`$52.374\`.
- **Descuento tributario del Art. 254-1 E.T.** (adicionado por el Art. 5 de la Ley 2277/2022, aplicable desde el AG 2023): se resta del impuesto a cargo del socio. 0% hasta 1.090 UVT de renta liquida cedular de dividendos; **19%** sobre el exceso de 1.090 UVT.
- **Persona natural residente — dividendos GRAVADOS** (utilidades gravadas conforme al **paragrafo 2 del Art. 49 E.T.**): tarifa del **Art. 240 E.T. (35%)** por remision del inciso 2 del Art. 242; una vez disminuido ese impuesto, el remanente sigue el regimen del inciso 1 (Art. 241).
- **Sociedad nacional receptora:** **10%** de retencion **trasladable e imputable** (**Art. 242-1 E.T.**). No aplica a entidades del Regimen Tributario Especial (par. 3).
- **No residente** (sociedad o entidad extranjera, o persona natural sin residencia): **20%** (**Art. 245 E.T.**, mod. Art. 4 Ley 2277/2022). **Este 20% pertenece al Art. 245 — NEVER lo atribuyas al Art. 242.**
- **Art. 49 E.T. — cuanto es no gravado:** la porcion repartible como INCRNGO esta topada por el maximo del Art. 49 (renta liquida gravable + ganancias ocasionales gravables, menos el impuesto basico de renta y el impuesto de ganancias ocasionales liquidados, ajustado por los descuentos del Art. 254 E.T.). La utilidad comercial despues de impuestos que **exceda** ese maximo se reparte como **dividendo GRAVADO** (par. 2 Art. 49).
- If proyectas flujo al socio o recomiendas politica de reparto then declara explicitamente que tarifa marginal del Art. 241 asumiste y que la retencion del 15% es imputable otherwise no cifres el impuesto al dividendo.

#### 3.2. OTRAS REGLAS DEL MARCO TRIBUTARIO 2026
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
- **Decree 2420 of 2015** — Sole Regulatory Decree of Accounting, Financial Reporting and Assurance Standards, which compiles the IFRS adopted in Colombia. It is the official anchor. Chain of amendments in force for fiscal year 2026:
  - **Decree 2496 of 2015** and **Decree 2483 of 2018** (compiles and updates Annexes 1 and 2).
  - **Decree 2270 of 2019** (compiles and updates the technical frameworks).
  - **Decree 938 of 2021** (Group 1 technical framework).
  - **Decree 1670 of 2021** — accounting simplification: reclassification of Groups 2 and 3, **in force since 01-Jan-2023**.
  - **Decree 1611 of 2022** — IASB amendments (IAS 1, IAS 8, IAS 12 and IFRS 16), including "Disclosure of Accounting Policies".
  - **Decree 1271 of 2024** — incorporates **IFRS 17 Insurance Contracts** (Technical Annex 01 of 2024); IFRS 4 is repealed from 01-Jan-2027.
  - **Decree 0701 of 07 July 2026** — partially amends the **Group 1 and Group 2** technical frameworks, incorporating the IASB amendments issued between Sep-2022 and Sep-2023 (leases, presentation of financial statements, statement of cash flows, financial instruments, income taxes and foreign currency translation). Published in **Official Gazette 53,547 of 08-Jul-2026** and **effective from 09-Jul-2026** (art. 5), **with no transition period: it applies to the 2026 fiscal year covered by this report**. The effective dates set by the IASB in the incorporated standards are NOT the effective dates in Colombia; the decree's dates govern.
  - Do not assert "in accordance with the framework in force" while omitting Decree 0701/2026: it is the most recent standard applicable to this same fiscal year.
- **Preparer groups (Decree 2420/2015 classification):**
  - **Group 1 — Full IFRS:** securities issuers, public interest entities and companies that exceed asset/employee thresholds. They apply full IAS/IFRS.
  - **Group 2 — IFRS for SMEs:** 35 sections; unlisted small and medium-sized entities meeting the decree thresholds.
  - **Group 3 — Simplified accounting (Annex 3 of DUR 2420/2015):** criteria of **Art. 1.1.3.1 of Decree 2420/2015 as amended by Decree 1670 of 2021**, in force since **01-Jan-2023**. Group 3 comprises individuals and legal entities required to keep accounting records (and those who, without being required, wish to use them as evidence) that meet **ALL** of the following:
    1. Ordinary-activity revenue of the immediately preceding year within the **microenterprise** thresholds of **Decree 1074 of 2015** (Ch. 13, Tit. 1, Part 2, Book 2, added by Decree 957 of 2019), by macro-sector: **manufacturing <= 23,563 UVT; services <= 32,988 UVT; commerce <= 44,769 UVT**.
    2. Holds no equity instrument investments in subsidiaries, joint ventures or associates.
    3. Is not required to present consolidated, combined or separate financial statements.
    4. Carries out no share-based payment transactions.
    5. Maintains no defined-benefit post-employment plans.
    6. Is not a savings and credit cooperative.
    **NEVER use the size criteria of Annex 3 / Decree 2706 of 2012 (10 employees, 500 SMMLV of assets, 6,000 SMMLV of revenue): they were REPEALED by Decree 1670 of 2021.** The size test today is revenue by macro-sector ONLY.
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
  - **Tax benefit adjustments** and discount cleanup.

#### 3.1. DIVIDEND REGIME (post Law 2277 of 2022) — there is NO 20% flat rate for residents
In force since tax year 2023 and applicable in 2026. The repealed Art. 242 schedule (10% on the excess over 300 UVT) died on 31-Dec-2022: **NEVER cite it**.
- **Resident individual — NON-TAXED dividends** (from profits distributed as non-taxable income at the company level): they are **integrated into taxable income** and taxed at the **progressive marginal scale of Art. 241 ET (0% to 39%)**, by reference from the first paragraph of **Art. 242 ET** (as amended by Art. 3 of Law 2277/2022).
- **Withholding at source** (Art. 242 ET proviso, regulated by **Decree 1103 of 2023**) — it is tiered and is an **IMPUTABLE PREPAYMENT, not the final tax**:
  - From 0 to 1,090 UVT → **0%**.
  - On the excess over 1,090 UVT → **15%**, i.e. \`(dividends in UVT − 1,090 UVT) × 15%\`.
  - 1,090 UVT = \`$57.087.660\` with the 2026 UVT of \`$52.374\`.
- **Tax credit of Art. 254-1 ET** (added by Art. 5 of Law 2277/2022, applicable from tax year 2023), deducted from the shareholder's tax due: 0% up to 1,090 UVT of the dividend schedular taxable income; **19%** on the excess over 1,090 UVT.
- **Resident individual — TAXED dividends** (profits taxed under **paragraph 2 of Art. 49 ET**): the **Art. 240 ET rate (35%)** applies by reference from the second paragraph of Art. 242; once that tax is deducted, the remainder follows the first-paragraph regime (Art. 241).
- **Receiving domestic company:** **10%** withholding, **transferable and creditable** (**Art. 242-1 ET**). It does not apply to Special Tax Regime entities (proviso 3).
- **Non-resident** (foreign company or entity, or non-resident individual): **20%** (**Art. 245 ET**, as amended by Art. 4 of Law 2277/2022). **This 20% belongs to Art. 245 — NEVER attribute it to Art. 242.**
- **Art. 49 ET — how much is non-taxed:** the portion distributable as non-taxable income is capped by the Art. 49 maximum (taxable income + taxable occasional gains, less the basic income tax and the occasional-gains tax assessed, adjusted for the Art. 254 ET credits). Commercial profit after tax **exceeding** that maximum is distributed as a **TAXED dividend** (Art. 49 proviso 2).
- If you project shareholder cash flow or recommend a distribution policy then explicitly state which Art. 241 marginal rate you assumed and that the 15% withholding is creditable otherwise do not quantify the dividend tax.

#### 3.2. OTHER 2026 TAX FRAMEWORK RULES
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
