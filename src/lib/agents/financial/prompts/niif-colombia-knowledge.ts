// ---------------------------------------------------------------------------
// Conocimiento NIIF Colombia — bloque estable cache-friendly.
//
// Implementa la skill `.agents/skills/niif-colombia/` como bloques de
// conocimiento compartidos para los agentes que generan o auditan reportes
// NIIF. Sigue el mismo patron que `colombia-2026-context.ts`:
//   - 100% estatico (sin datos por request) -> cachea perfecto.
//   - Se prepende como header estable, despues del guardarrail anti-aluc.
//     y del contexto Colombia 2026.
//   - Solo el delta de valor: medicion (NIIF 13/9/16, NIC 36) y revelaciones
//     por norma. El marco regulatorio Colombia ya esta en
//     `colombia-2026-context.ts` (Decreto 2420, grupos 1/2/3, IFRS 18).
//
// Fuente: `.agents/skills/niif-colombia/niif-medicion.md` y
//         `.agents/skills/niif-colombia/niif-revelaciones.md`.
// ---------------------------------------------------------------------------

/**
 * Bloque sobre bases de medicion NIIF: valor razonable (NIIF 13), deterioro
 * (NIC 36), instrumentos financieros (NIIF 9), arrendamientos (NIIF 16) y
 * modelos de PPE (NIC 16). Diseñado para inyectarse en agentes que MIDEN
 * partidas (NIIF Analyst, NIIF Auditor, Difference Identifier).
 */
export function buildNiifMeasurementKnowledge(language: 'es' | 'en'): string {
  if (language === 'en') return buildNiifMeasurementKnowledgeEn();
  return buildNiifMeasurementKnowledgeEs();
}

/**
 * Bloque sobre revelaciones (notas a los EEFF) requeridas por NIC/NIIF.
 * Checklist por norma + estructura NIC 1 + politicas contables minimas +
 * hechos posteriores (NIC 10). Diseñado para inyectarse en agentes que
 * COMPONEN notas (NIIF Analyst — technicalNotes, Governance Specialist —
 * financialNotes 1..14, NIIF Auditor — valida revelaciones).
 */
export function buildNiifDisclosureKnowledge(language: 'es' | 'en'): string {
  if (language === 'en') return buildNiifDisclosureKnowledgeEn();
  return buildNiifDisclosureKnowledgeEs();
}

// ---------------------------------------------------------------------------
// Medicion — espanol
// ---------------------------------------------------------------------------

function buildNiifMeasurementKnowledgeEs(): string {
  return `## CONOCIMIENTO NIIF — BASES DE MEDICION (REFERENCIA TECNICA)

### Bases de medicion del Marco Conceptual (IASB)
- **Costo historico**: valor de adquisicion original. Aplica a inventarios (NIC 2) y modelo del costo de PPE (NIC 16).
- **Valor razonable (NIIF 13 / Sec. 11-12 PYMES)**: precio de salida en transaccion ordenada a la fecha de medicion. Jerarquia obligatoria:
  - **Nivel 1**: precios cotizados en mercados activos (mas confiable).
  - **Nivel 2**: datos observables distintos a precios cotizados (inputs de mercado para activos similares).
  - **Nivel 3**: datos no observables basados en modelos internos (menos confiable; revelar conciliacion de movimientos).
  - Usado en: instrumentos financieros (NIIF 9), propiedades de inversion modelo VR (NIC 40), activos biologicos (NIC 41), combinaciones de negocios (NIIF 3).
- **Valor en uso**: valor presente de flujos de caja futuros esperados. Usado en pruebas de deterioro (NIC 36).
- **Costo amortizado**: medicion posterior de instrumentos financieros a tasa de interes efectiva (NIIF 9).

### Deterioro del valor de activos (NIC 36 / Sec. 27 PYMES)
- Indicadores externos: caida en valor de mercado, cambios adversos en tecnologia/mercado/economia, tasas de mercado.
- Indicadores internos: obsolescencia, daño fisico, rendimiento peor al esperado.
- Prueba: **Valor Recuperable = MAX(Valor Razonable menos costos de venta, Valor en Uso)**. Si Valor en Libros > Valor Recuperable -> reconocer perdida por deterioro.
- **UGE (Unidades Generadoras de Efectivo)**: para activos que no generan flujos independientes, agrupar en la UGE mas pequeña identificable.
- Reversion del deterioro: permitida (excepto en goodwill/plusvalia) cuando las condiciones mejoran.

### PPE — Medicion posterior (NIC 16 / Sec. 17 PYMES)
- **Modelo del costo**: Valor en libros = Costo - Depreciacion acumulada - Deterioro acumulado.
- **Modelo de revaluacion**: Valor en libros = Valor razonable a fecha de revaluacion - Depreciacion posterior - Deterioro posterior. Superavit -> ORI; deficit -> primero ORI acumulado, luego P&G.
- Metodos de depreciacion permitidos: linea recta, unidades de produccion, saldo decreciente.

### Instrumentos financieros (NIIF 9 / Sec. 11-12 PYMES)
- Clasificacion de activos financieros: depende del **modelo de negocio** y caracteristicas del flujo de caja (test SPPI).
  - **Costo amortizado**: mantener para cobrar flujos contractuales.
  - **VR con cambios en ORI**: mantener para cobrar Y vender.
  - **VR con cambios en P&G**: negociacion activa.
- **Deterioro — modelo de perdida esperada (ECL)**:
  - **Etapa 1**: ECL 12 meses (riesgo no aumento significativamente).
  - **Etapa 2**: ECL toda la vida (riesgo aumento significativamente).
  - **Etapa 3**: incumplimiento — ECL vida + interes sobre valor neto.
- PYMES (Sec. 11): enfoque simplificado de perdida incurrida + perdida esperada vida en cartera comercial.

### Arrendamientos — Arrendatario (NIIF 16 / Sec. 20 PYMES)
- **Todos los arrendamientos** se reconocen en balance (excepto corto plazo <= 12 meses y bajo valor).
- Reconocer: **Activo por derecho de uso (DDU)** + **Pasivo por arrendamiento**.
- Pasivo inicial: valor presente de pagos futuros descontados a la tasa incremental del prestamo.
- Activo inicial: pasivo + costos directos iniciales + pagos anticipados - incentivos.
- Arrendador: sigue modelo NIC 17 — operativo vs. financiero.
- Nota: en PYMES (Sec. 20) la mayoria de los arrendamientos se siguen tratando como operativos en P&G.
`;
}

// ---------------------------------------------------------------------------
// Medicion — ingles
// ---------------------------------------------------------------------------

function buildNiifMeasurementKnowledgeEn(): string {
  return `## IFRS KNOWLEDGE — MEASUREMENT BASES (TECHNICAL REFERENCE)

### Measurement bases (IASB Conceptual Framework)
- **Historical cost**: original acquisition value. Applies to inventories (IAS 2) and PPE cost model (IAS 16).
- **Fair value (IFRS 13 / SME Sec. 11-12)**: exit price in an orderly transaction at the measurement date. Mandatory hierarchy:
  - **Level 1**: quoted prices in active markets (most reliable).
  - **Level 2**: observable inputs other than quoted prices (market data for similar assets).
  - **Level 3**: unobservable inputs based on internal models (least reliable; disclose movement reconciliation).
  - Used in: financial instruments (IFRS 9), investment property FV model (IAS 40), biological assets (IAS 41), business combinations (IFRS 3).
- **Value in use**: present value of expected future cash flows. Used in impairment testing (IAS 36).
- **Amortized cost**: subsequent measurement of financial instruments using effective interest rate (IFRS 9).

### Impairment of assets (IAS 36 / SME Sec. 27)
- External indicators: market value decline, adverse changes in technology/market/economy, interest rates.
- Internal indicators: obsolescence, physical damage, worse-than-expected performance.
- Test: **Recoverable Amount = MAX(Fair Value less costs of disposal, Value in Use)**. If Carrying Amount > Recoverable Amount -> recognize impairment loss.
- **CGUs (Cash-Generating Units)**: for assets not generating independent cash flows, group into the smallest identifiable CGU.
- Reversal: permitted (except for goodwill) when conditions improve.

### PPE — Subsequent measurement (IAS 16 / SME Sec. 17)
- **Cost model**: Carrying amount = Cost - Accumulated depreciation - Accumulated impairment.
- **Revaluation model**: Carrying amount = Fair value at revaluation date - Subsequent depreciation - Subsequent impairment. Surplus -> OCI; deficit -> first OCI, then P&L.
- Allowed depreciation methods: straight-line, units of production, declining balance.

### Financial instruments (IFRS 9 / SME Sec. 11-12)
- Classification of financial assets: depends on **business model** and **cash flow characteristics** (SPPI test).
  - **Amortized cost**: hold to collect contractual flows.
  - **FV through OCI**: hold to collect AND sell.
  - **FV through P&L**: active trading.
- **Impairment — Expected Credit Loss (ECL) model**:
  - **Stage 1**: 12-month ECL (no significant credit risk increase).
  - **Stage 2**: lifetime ECL (significant risk increase).
  - **Stage 3**: default — lifetime ECL + interest on net amount.
- SMEs (Sec. 11): simplified incurred loss + lifetime ECL for trade receivables.

### Leases — Lessee (IFRS 16 / SME Sec. 20)
- **All leases** are recognized on the balance sheet (except short-term <= 12 months and low value).
- Recognize: **Right-of-Use Asset (RoU)** + **Lease Liability**.
- Initial liability: present value of future payments discounted at the incremental borrowing rate.
- Initial asset: liability + initial direct costs + prepayments - incentives.
- Lessor: still follows IAS 17 model — operating vs. finance.
- Note: under SMEs (Sec. 20) most leases continue to be treated as operating leases in P&L.
`;
}

// ---------------------------------------------------------------------------
// Revelaciones — espanol
// ---------------------------------------------------------------------------

function buildNiifDisclosureKnowledgeEs(): string {
  return `## CONOCIMIENTO NIIF — REVELACIONES Y NOTAS A LOS EEFF (REFERENCIA TECNICA)

### Estructura canonica de las notas (NIC 1 par. 112-138 / Sec. 8 PYMES)
1. Declaracion de cumplimiento con NIIF.
2. Resumen de politicas contables significativas.
3. Informacion de apoyo a partidas de los estados financieros (mismo orden que los estados).
4. Otra informacion a revelar (contingencias, hechos posteriores, partes relacionadas).

### Revelaciones clave por norma

**NIC 1 — Presentacion general**
- Nombre de la entidad, domicilio, naturaleza de operaciones.
- Moneda de presentacion y nivel de redondeo.
- Periodo cubierto. Juicios significativos en aplicacion de politicas.

**NIC 2 — Inventarios**
- Politicas adoptadas (PEPS, costo promedio ponderado).
- Valor en libros por categoria; costo de ventas reconocido en el periodo; deterioros y reversiones.

**NIC 16 — PPE**
- Bases de medicion y metodos de depreciacion; vidas utiles o tasas.
- Valor bruto y depreciacion acumulada por clase.
- Conciliacion del valor en libros (tabla de movimientos).
- Activos comprometidos como garantia.

**NIC 19 — Beneficios a empleados**
- Naturaleza de los planes (contribucion definida vs prestacion definida).
- Para prestacion definida: hipotesis actuariales clave + sensibilidades; gastos del periodo.

**NIC 24 — Partes relacionadas**
- Identificacion (matriz, subsidiarias, asociadas, personal clave).
- Naturaleza de las relaciones; montos de transacciones, saldos y condiciones.

**NIC 37 — Provisiones y contingencias**
- Naturaleza y estimacion de cada provision significativa.
- Incertidumbres en estimacion del importe o momento.
- Activos y pasivos contingentes (cuando la probabilidad es posible pero no probable).

**NIIF 7 — Riesgos de instrumentos financieros**
- **Riesgo de credito**: exposicion maxima, calidad crediticia, concentraciones.
- **Riesgo de liquidez**: analisis de vencimientos de pasivos financieros.
- **Riesgo de mercado**: analisis de sensibilidad (tasa de interes, tipo de cambio, precios).

**NIIF 12 — Participaciones en otras entidades**
- Subsidiarias significativas (nombre, pais, % participacion).
- Restricciones sobre activos y pasivos. Participaciones no controladoras relevantes.

**NIIF 13 — Valor razonable**
- Tecnicas de valoracion e inputs utilizados.
- Para Nivel 3: conciliacion de movimientos + descripcion del proceso de valoracion.
- Para activos/pasivos no medidos a VR: descripcion y VR estimado a efectos de revelacion.

**NIIF 15 — Ingresos con clientes**
- Desagregacion de ingresos (por tipo, geografia, canal, momento de reconocimiento).
- Obligaciones de desempeño identificadas y politicas para su reconocimiento.
- Saldos de contratos (activos y pasivos por contrato).
- Juicio aplicado.

**NIIF 16 — Arrendamientos (arrendatario)**
- Tabla de movimientos del activo DDU por clase de activo subyacente.
- Intereses sobre el pasivo de arrendamiento.
- Gastos por corto plazo y bajo valor.
- Compromisos de arrendamiento no capitalizados.

### Politicas contables — contenido minimo
Para cada politica significativa, revelar: norma NIIF aplicable, opcion contable elegida (cuando hay alternativas), estimaciones y juicios clave. Politicas a revelar tipicas: reconocimiento de ingresos (NIIF 15), medicion de PPE (costo vs revaluacion), clasificacion NIIF 9, consolidacion y metodo de la participacion, conversion de moneda extranjera (NIC 21), impuesto diferido (NIC 12), deterioro de activos financieros (NIIF 9).

### Hechos ocurridos despues del periodo (NIC 10 / Sec. 32 PYMES)
- **Ajustables** (ocurridos antes del cierre, conocidos despues): ajustar estados financieros. Ejemplo: sentencia judicial que confirma obligacion existente al cierre.
- **No ajustables** (condicion nueva surgida despues del cierre): revelar en notas si son materiales. Ejemplo: desastre natural que destruye activos despues del cierre. Revelar naturaleza del hecho + estimacion del impacto.

### Lista de verificacion — revelaciones minimas obligatorias
- [ ] Declaracion de cumplimiento NIIF.
- [ ] Base de preparacion (negocio en marcha, devengo).
- [ ] Moneda funcional y de presentacion.
- [ ] Politicas contables significativas.
- [ ] Juicios y estimaciones criticas (NIC 1 par. 122-133).
- [ ] Informacion por segmentos si aplica (NIIF 8).
- [ ] Partes relacionadas (NIC 24).
- [ ] Riesgos de instrumentos financieros (NIIF 7).
- [ ] Compromisos y contingencias (NIC 37).
- [ ] Hechos posteriores al periodo (NIC 10).
- [ ] Impuesto a las ganancias corriente y diferido (NIC 12).
`;
}

// ---------------------------------------------------------------------------
// Revelaciones — ingles
// ---------------------------------------------------------------------------

function buildNiifDisclosureKnowledgeEn(): string {
  return `## IFRS KNOWLEDGE — DISCLOSURES AND NOTES (TECHNICAL REFERENCE)

### Canonical notes structure (IAS 1 para 112-138 / SME Sec. 8)
1. Statement of compliance with IFRS.
2. Summary of significant accounting policies.
3. Supporting information for items in the financial statements (same order as the statements).
4. Other disclosures (contingencies, subsequent events, related parties).

### Key disclosures by standard

**IAS 1 — General presentation**
- Entity name, domicile, nature of operations.
- Presentation currency and rounding level.
- Period covered. Significant judgments in applying policies.

**IAS 2 — Inventories**
- Adopted policies (FIFO, weighted average cost).
- Carrying amount by category; cost of sales recognized in the period; impairments and reversals.

**IAS 16 — PPE**
- Measurement bases and depreciation methods; useful lives or rates.
- Gross amount and accumulated depreciation by class.
- Reconciliation of carrying amount (movement table).
- Assets pledged as collateral.

**IAS 19 — Employee benefits**
- Nature of plans (defined contribution vs defined benefit).
- For defined benefit: key actuarial assumptions + sensitivities; period expenses.

**IAS 24 — Related parties**
- Identification (parent, subsidiaries, associates, key personnel).
- Nature of relationships; transaction amounts, balances and conditions.

**IAS 37 — Provisions and contingencies**
- Nature and estimation of each significant provision.
- Uncertainties in amount or timing estimation.
- Contingent assets and liabilities (when probability is possible but not probable).

**IFRS 7 — Risks of financial instruments**
- **Credit risk**: maximum exposure, credit quality, concentrations.
- **Liquidity risk**: maturity analysis of financial liabilities.
- **Market risk**: sensitivity analysis (interest rate, FX, prices).

**IFRS 12 — Interests in other entities**
- Significant subsidiaries (name, country, % ownership).
- Restrictions on assets and liabilities. Material non-controlling interests.

**IFRS 13 — Fair value**
- Valuation techniques and inputs used.
- For Level 3: movement reconciliation + description of valuation process.
- For non-FV measured assets/liabilities: description and estimated FV for disclosure.

**IFRS 15 — Revenue from contracts with customers**
- Revenue disaggregation (by type, geography, channel, timing).
- Identified performance obligations and policies for recognition.
- Contract balances (contract assets and liabilities).
- Applied judgment.

**IFRS 16 — Leases (lessee)**
- RoU asset movement table by underlying asset class.
- Interest on lease liability.
- Short-term and low-value lease expenses.
- Non-capitalized lease commitments.

### Accounting policies — minimum content
For each significant policy disclose: applicable IFRS standard, accounting option chosen (where alternatives exist), key estimates and judgments. Typical policies to disclose: revenue recognition (IFRS 15), PPE measurement (cost vs revaluation), IFRS 9 classification, consolidation and equity method, FX translation (IAS 21), deferred tax (IAS 12), impairment of financial assets (IFRS 9).

### Subsequent events (IAS 10 / SME Sec. 32)
- **Adjusting** (existed before year-end, known after): adjust financial statements. Example: court ruling confirming obligation existing at year-end.
- **Non-adjusting** (new condition arising after year-end): disclose in notes if material. Example: natural disaster destroying assets after year-end. Disclose nature + estimated impact.

### Checklist — mandatory minimum disclosures
- [ ] IFRS compliance statement.
- [ ] Basis of preparation (going concern, accrual).
- [ ] Functional and presentation currency.
- [ ] Significant accounting policies.
- [ ] Critical judgments and estimates (IAS 1 para 122-133).
- [ ] Segment information if applicable (IFRS 8).
- [ ] Related parties (IAS 24).
- [ ] Financial instruments risks (IFRS 7).
- [ ] Commitments and contingencies (IAS 37).
- [ ] Subsequent events (IAS 10).
- [ ] Current and deferred income tax (IAS 12).
`;
}
