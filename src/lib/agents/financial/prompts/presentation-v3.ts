// ---------------------------------------------------------------------------
// Mejoras de Presentacion v3.0 — inspiradas en Alpina / Ernst & Young 2024.
// Tres mejoras ADITIVAS sobre la spec v2.1, sin modificar la Seccion 0
// (resiliencia) ni la Parte I (estados financieros):
//
//   Mejora 1 — EFE: linea D&A explicita cuando hay depreciacion, amortizacion
//              o deterioro material; omision limpia cuando todo es $0.
//   Mejora 2 — ORI: desglose condicional en sub-partidas reclassifiable /
//              no-reclassifiable cuando hay componentes; una linea cuando $0.
//   Mejora 3 — ECP: columnas inteligentes (mostrar solo las que tienen valor
//              en cualquiera de los dos periodos).
//
// PATRON:
//   - La DOCTRINA (Markdown que el LLM lee) vive en `buildPresentationV3()`
//     y se prepende al system prompt entre la Seccion 0 y el contexto
//     Colombia 2026, manteniendo el layout cache-friendly.
//   - Los HELPERS deterministas (detectOriComponents, computeActiveEcpColumns,
//     mergeDepreciation) viven aqui para que el curator pueda emitirlos como
//     parte del CuratorResult y los anclen al bloque TOTALES VINCULANTES.
//   - Los CODIGOS PUC que detectamos siguen la spec del usuario (31XX) pero
//     incluyen 38XX como fallback porque el PUC colombiano (Decreto 2650/93)
//     contabiliza ORI bajo NIIF principalmente en 38XX. Los helpers nunca
//     fuerzan datos: si no hay saldo, devuelven array vacio / booleano false.
//
// NOTACION:
//   Las variables que el LLM debe sustituir se notan con angulos al estilo XML
//   (<paso>, <servicio>) en lugar de corchetes cuadrados, igual que en
//   `resilience-section0.ts`. Esto evita confusion con el sanitizador
//   anti-placeholder downstream.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, ValidatedAccount } from '@/lib/preprocessing/trial-balance';

// ---------------------------------------------------------------------------
// Tipos publicos consumidos por el curator y el niif-analyst prompt.
// ---------------------------------------------------------------------------

/**
 * Componente ORI detectado en el balance. El campo `reclassifiable` distingue
 * los componentes que pueden reclasificarse a resultados (coberturas, FX) de
 * los que NO se reclasifican (actuariales, FVOCI, revaluacion PPE). Esta
 * distincion es obligatoria bajo NIC 1 § 82A.
 */
export interface OriComponent {
  /** Codigo PUC raiz detectado (e.g. "3115", "3805"). */
  pucCode: string;
  /** Etiqueta humana legible para el informe. */
  label: string;
  /** Saldo en COP (numero JS — el curator ya redondeo a centavos). */
  amountPrimary: number;
  /** Saldo comparativo si existe periodo previo; null si no aplica. */
  amountComparative: number | null;
  /** True si el componente puede reclasificarse a resultados. */
  reclassifiable: boolean;
}

/**
 * Banderas de columnas activas para el ECP inteligente. Una columna se
 * considera activa cuando hay saldo inicial o algun movimiento ≠ $0 en
 * cualquiera de los dos periodos. La columna TOTAL es siempre obligatoria
 * — por eso no aparece aqui (esta implicita).
 */
export interface EcpColumnFlags {
  capital: boolean;
  premium: boolean;
  legalReserve: boolean;
  otherReserves: boolean;
  retainedEarnings: boolean;
  periodResult: boolean;
  oci: boolean;
}

/**
 * Resumen de partidas no-cash de D&A para la Mejora 1 del EFE. Se compone
 * leyendo `snapshot.curator.ppeDepreciationAudit` (emitido por R14) y los
 * cambios en cuentas contra-activo (1592/1680/1915). Los tres campos pueden
 * ser 0 si no hay D&A material; en ese caso la doctrina manda OMITIR la
 * linea del EFE en lugar de mostrar ceros.
 */
export interface DepreciationInfo {
  /** D&A del periodo (PPE + intangibles + amortizacion ordinaria). */
  daCop: number;
  /** Amortizacion de activos por derecho de uso (NIIF 16). */
  roUAmortizationCop: number;
  /** Deterioro de activos del periodo. */
  impairmentCop: number;
  /** Suma de los tres anteriores — util para el CHECK del EFE. */
  totalNonCashAdjustments: number;
}

/**
 * Bundle de Presentation v3.0 que el orchestrator pasa al niif-analyst
 * prompt. Cuando todos los campos son vacios/cero, los helpers devuelven el
 * shape minimo y la doctrina automaticamente activa el modo simple.
 */
export interface PresentationV3Data {
  depreciation: DepreciationInfo;
  oriComponents: OriComponent[];
  ecpColumns: EcpColumnFlags;
}

// ---------------------------------------------------------------------------
// Helpers deterministas
// ---------------------------------------------------------------------------

/**
 * Detecta D&A material a partir del CuratorResult ya producido (R14 audit
 * + cashFlowIndirecto). NO duplica la deteccion que R14 ya hace — solo
 * la consolida en el shape de PresentationV3Data.
 *
 * Si no hay D&A material en los auxiliares, los tres campos devuelven 0
 * y la doctrina suprime la linea del EFE.
 */
export function mergeDepreciation(snapshot: PeriodSnapshot): DepreciationInfo {
  // R14 audit lleva la depreciacion acumulada y el gasto del periodo.
  const r14 = snapshot.ppeDepreciationAudit;
  const gastoPeriodo = r14 && typeof r14 === 'object' && 'gastoDepreciacionPeriodoCop' in r14
    ? Number((r14 as { gastoDepreciacionPeriodoCop?: number }).gastoDepreciacionPeriodoCop ?? 0)
    : 0;

  // R2 cash-flow operating section ya expone `depreciacionAmortizacion`
  // como ajuste no-cash. Si esta presente, es la fuente autoritativa.
  const cfDA = snapshot.cashFlowIndirecto?.operating?.depreciacionAmortizacion ?? 0;

  // Tomar el mayor de los dos: prioriza la fuente que reporto un numero
  // distinto de cero. Si ambos coinciden, da igual cual gane.
  const daCop = Math.max(Math.abs(gastoPeriodo), Math.abs(cfDA));

  // Derecho de uso (NIIF 16) — cuentas 15XX (subcuentas de derecho de uso).
  // No todas las empresas las usan; default 0 si no se encuentran.
  const roU = sumAbsoluteBalanceForCodes(snapshot, [
    '1530', '1531', '1532', '1533', '1534', '1535',
  ]);
  // Solo contar como amortizacion ROU si tambien hay contracuenta de
  // amortizacion acumulada (sufijo "92") — evita doble-conteo con PPE.
  const roUAmortization = sumAbsoluteBalanceForCodes(snapshot, [
    '159230', '159231',
  ]);

  // Deterioro acumulado — cuentas 1915 (deterioro PPE) y 1810 (deterioro
  // intangibles). Tomamos el saldo absoluto como proxy del deterioro
  // acumulado; el curator R-future puede afinar a "deterioro del periodo".
  const impairment = sumAbsoluteBalanceForCodes(snapshot, [
    '1915', '191505', '191510', '181005',
  ]);

  const totalNonCashAdjustments = daCop + roUAmortization + impairment;
  return {
    daCop,
    roUAmortizationCop: roUAmortization,
    impairmentCop: impairment,
    totalNonCashAdjustments,
  };
}

/**
 * Mapeo PUC -> (label, reclassifiable). Las claves son prefijos: cualquier
 * cuenta cuyo codigo empieza con la clave se considera del componente.
 *
 * Mezclamos la nomenclatura del prompt de usuario (3115/3120/3125/3130/3135/3140)
 * y la convencion PUC colombiana (38XX para ORI bajo NIIF). Si ambos
 * conviven, la deteccion los suma — el LLM ve el componente unificado.
 */
const ORI_COMPONENT_MAP: ReadonlyArray<{
  pucPrefix: string;
  label: string;
  reclassifiable: boolean;
}> = [
  // Reclassifiable
  { pucPrefix: '3115', label: 'Coberturas de flujo de efectivo', reclassifiable: true },
  { pucPrefix: '3120', label: 'Coberturas de flujo de efectivo (alterno)', reclassifiable: true },
  { pucPrefix: '3125', label: 'Efecto conversion operaciones extranjeras', reclassifiable: true },
  { pucPrefix: '3805', label: 'Superavit por valorizaciones (ORI 38XX)', reclassifiable: true },
  // Non-reclassifiable
  { pucPrefix: '3130', label: 'Ganancias actuariales — planes beneficios definidos', reclassifiable: false },
  { pucPrefix: '3135', label: 'Variaciones patrimoniales por conversion', reclassifiable: false },
  { pucPrefix: '3140', label: 'Cambios VR inversiones a FVOCI', reclassifiable: false },
  { pucPrefix: '3810', label: 'Revaluacion PPE (ORI)', reclassifiable: false },
];

/**
 * Detecta componentes ORI con saldo material en el periodo primario, con
 * comparativo opcional. Devuelve solo los componentes con `amountPrimary
 * !== 0` para que la doctrina active modo detallado.
 *
 * Tolerancia: |saldo| < 100 COP se trata como cero (ruido de redondeo).
 * Esto evita falsos positivos por centavos residuales.
 */
export function detectOriComponents(
  snapshotPrimary: PeriodSnapshot,
  snapshotComparative: PeriodSnapshot | null = null,
): OriComponent[] {
  const TOLERANCE_COP = 100;
  const components: OriComponent[] = [];

  for (const entry of ORI_COMPONENT_MAP) {
    const primaryAmount = sumBalanceForPrefix(snapshotPrimary, entry.pucPrefix);
    const comparativeAmount = snapshotComparative
      ? sumBalanceForPrefix(snapshotComparative, entry.pucPrefix)
      : null;

    if (Math.abs(primaryAmount) < TOLERANCE_COP && (comparativeAmount === null || Math.abs(comparativeAmount) < TOLERANCE_COP)) {
      continue;
    }

    components.push({
      pucCode: entry.pucPrefix,
      label: entry.label,
      amountPrimary: primaryAmount,
      amountComparative: comparativeAmount,
      reclassifiable: entry.reclassifiable,
    });
  }

  return components;
}

/**
 * Calcula las columnas activas del ECP inteligente segun la regla:
 *   columna_activa = (saldo_inicial !== $0) OR (algun_movimiento !== $0)
 *
 * `snapshotComparative` actua como aproximacion del saldo inicial: si una
 * columna tiene saldo no-trivial en el comparativo, esta activa aunque el
 * periodo primario sea cero (caso saldo trasladado a cero pero materialmente
 * relevante para la historia patrimonial).
 *
 * Tolerancia: |saldo| < 100 COP se trata como cero.
 */
export function computeActiveEcpColumns(
  snapshotPrimary: PeriodSnapshot,
  snapshotComparative: PeriodSnapshot | null = null,
): EcpColumnFlags {
  const has = (prefixes: string[]): boolean => {
    for (const prefix of prefixes) {
      if (Math.abs(sumBalanceForPrefix(snapshotPrimary, prefix)) >= 100) return true;
      if (snapshotComparative && Math.abs(sumBalanceForPrefix(snapshotComparative, prefix)) >= 100) {
        return true;
      }
    }
    return false;
  };

  return {
    capital: has(['3105', '3110']),
    premium: has(['3205']), // Prima en colocacion (Clase 32) — distinta de coberturas 3115.
    legalReserve: has(['3305']),
    otherReserves: has(['3310', '3315', '3320']),
    retainedEarnings: has(['3705', '3710']),
    periodResult: has(['3605']),
    oci: has(['3115', '3120', '3125', '3130', '3135', '3140', '3805', '3810']),
  };
}

/**
 * Atomico de uso: construye el bundle completo de Presentation v3 para
 * un snapshot dado. Pensado para que el curator lo invoque al final de
 * runCurator y lo agregue al CuratorResult.
 */
export function buildPresentationV3Data(
  snapshotPrimary: PeriodSnapshot,
  snapshotComparative: PeriodSnapshot | null = null,
): PresentationV3Data {
  return {
    depreciation: mergeDepreciation(snapshotPrimary),
    oriComponents: detectOriComponents(snapshotPrimary, snapshotComparative),
    ecpColumns: computeActiveEcpColumns(snapshotPrimary, snapshotComparative),
  };
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function* iterAccounts(snapshot: PeriodSnapshot): IterableIterator<ValidatedAccount> {
  for (const cls of snapshot.classes) {
    for (const account of cls.accounts) {
      yield account;
    }
  }
}

function sumBalanceForPrefix(snapshot: PeriodSnapshot, prefix: string): number {
  let total = 0;
  for (const account of iterAccounts(snapshot)) {
    if (account.code.startsWith(prefix)) {
      total += account.balance;
    }
  }
  return total;
}

function sumAbsoluteBalanceForCodes(snapshot: PeriodSnapshot, prefixes: string[]): number {
  let total = 0;
  for (const account of iterAccounts(snapshot)) {
    for (const prefix of prefixes) {
      if (account.code.startsWith(prefix)) {
        total += Math.abs(account.balance);
        break;
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Doctrina Markdown — se antepone al system prompt entre Seccion 0 y
// Contexto Colombia 2026.
// ---------------------------------------------------------------------------

/**
 * Devuelve el bloque Markdown con las 3 mejoras de Presentacion v3.0. El
 * parametro `language` se acepta por uniformidad con los otros builders
 * pero se ignora — la doctrina es lenguaje interno del agente y siempre
 * se emite en espanol.
 */
export function buildPresentationV3(_language: 'es' | 'en' = 'es'): string {
  return `## PRESENTATION V3 — D&A EXPLICITA + ORI CONDICIONAL + ECP INTELIGENTE (DOCTRINA OBLIGATORIA)

Estas tres mejoras son ADITIVAS sobre la spec v2.1 — NO modifican ninguna de las 14 correcciones anteriores ni la Seccion 0. Su objetivo es que el informe se vea limpio en empresas simples y completo en empresas complejas, automaticamente.

### V3.1 EFE — DEPRECIACION Y AMORTIZACION EXPLICITA

**Cuando construyas el Estado de Flujos de Efectivo (Pass-2):**

Lee los anchors \`daCop\`, \`roUAmortizationCop\`, \`impairmentCop\` del bloque TOTALES VINCULANTES (los emite el curator deterministicamente desde el balance de prueba).

If \`daCop + roUAmortizationCop + impairmentCop\` < 1.000 COP (umbral de materialidad):
- OMITE la linea de D&A en el EFE.
- Agrega una unica nota tecnica al pie del EFE: "No se identifico depreciacion ni amortizacion material en los auxiliares del periodo."
- NO muestres los subtitulos "Ajustes por partidas que no generan flujo de efectivo" ni "Cambios en capital de trabajo" — manten el formato actual del EFE sin subtitulos.

Else (D&A material detectada):
- Inserta los siguientes subtitulos en la seccion ACTIVIDADES DE OPERACION:
  * "Ajustes por partidas que no generan flujo de efectivo:" (subtitulo en italica)
  * Luego las lineas (solo las que sean ≠ $0):
    * "(+) Depreciacion y amortizacion (PPE + intangibles)" — valor \`daCop\`.
    * "(+) Amortizacion activos por derecho de uso (NIIF 16)" — valor \`roUAmortizationCop\`, omitir si $0.
    * "(+) Deterioro de activos" — valor \`impairmentCop\`, omitir si $0.
    * "(-) Resultado periodos anteriores en patrimonio de apertura" (mantener la linea existente si aplica).
  * "Cambios en capital de trabajo:" (subtitulo en italica)
  * Luego las lineas de variaciones existentes (deudores, inventarios, proveedores, impuesto corriente activo).

**Verificacion obligatoria del EFE con D&A:**
Resultado neto + D&A + roU amortization + impairment +/- cambios capital trabajo = FLUJO NETO OPERACION = Δ Cta.11 (efectivo final - efectivo inicial), tolerancia $0 (centavo).

### V3.2 ORI — DESGLOSE CONDICIONAL EN SUB-PARTIDAS

**Cuando construyas el Estado de Resultados Integral (Pass-1):**

Lee \`oriComponents\` del bloque TOTALES VINCULANTES — es un arreglo de objetos \`{ pucCode, label, amountPrimary, amountComparative, reclassifiable }\`.

If \`oriComponents.length === 0\`:
- MODO SIMPLE — presenta UNA SOLA linea en el P&L:
  \`| OTRO RESULTADO INTEGRAL (ORI) | $0,00 | $0,00 |\`
- Sin sub-partidas, sin nota adicional requerida.

Else (uno o mas componentes con saldo material):
- MODO DETALLADO — presenta la siguiente estructura:

\`\`\`markdown
| **OTRO RESULTADO INTEGRAL**                                         |    <ano>    |   <ano-1>   |
| Partidas que pueden reclasificarse posteriormente a resultados:     |             |             |
|   <label del componente reclassifiable>                             | $<valor>    | $<valor>    |
|   ... (un renglon por cada componente con reclassifiable=true)     |             |             |
| Partidas que NO pueden reclasificarse posteriormente:               |             |             |
|   <label del componente NO reclassifiable>                          | $<valor>    | $<valor>    |
|   ... (un renglon por cada componente con reclassifiable=false)    |             |             |
| **TOTAL OTRO RESULTADO INTEGRAL**                                   | **$<tot>**  | **$<tot>**  |
| **RESULTADO INTEGRAL TOTAL DEL PERIODO**                            | **$<tot>**  | **$<tot>**  |
\`\`\`

Reglas:
- Los componentes se listan respetando el orden del arreglo \`oriComponents\` (preserva el orden del curator).
- Si todos los componentes son del mismo grupo (todos reclassifiable o todos NO), OMITE el subtitulo del grupo vacio.
- La suma de los componentes DEBE coincidir al centavo con \`oriPrimary\` del bloque TOTALES VINCULANTES.

**Cuando construyas el ECP (Pass-2) y oriComponents.length > 0:**
- Agrega columna "Otro Resultado Integral" al ECP con el total del periodo y el acumulado.
- La columna ORI del ECP DEBE coincidir con el TOTAL ORI del P&L (validacion cruzada E6/E11).

### V3.3 ECP — COLUMNAS INTELIGENTES (mostrar solo las que tienen valor)

**Cuando construyas el Estado de Cambios en el Patrimonio (Pass-2):**

Lee \`ecpColumns\` del bloque TOTALES VINCULANTES — es un objeto con flags booleanos:
- \`capital\` (PUC 3105/3110)
- \`premium\` (PUC 3205 prima en colocacion)
- \`legalReserve\` (PUC 3305)
- \`otherReserves\` (PUC 3310/3315/3320)
- \`retainedEarnings\` (PUC 3705/3710 resultados acumulados)
- \`periodResult\` (PUC 3605 movimiento del periodo)
- \`oci\` (componentes ORI 31XX / 38XX)

REGLA: muestra la columna SI Y SOLO SI su flag es \`true\`. La columna TOTAL es siempre obligatoria (se renderiza al final).

Ejemplo MINIMO (solo retained + period — empresas sin capital ni reservas activas):
\`\`\`
| Movimiento | Resultados Acumulados | Resultado del Ejercicio | TOTAL |
\`\`\`

Ejemplo COMPLETO (todas las columnas activas — empresas con capital, reservas, ORI):
\`\`\`
| Movimiento | Capital | Prima | Reserva Legal | Otras Reservas | Result. Acum. | Result. Ejerc. | ORI | TOTAL |
\`\`\`

**Nota obligatoria al pie del ECP** (siempre, aunque todas las columnas esten activas):
"Las columnas presentadas corresponden a los componentes patrimoniales con saldo o movimiento en el periodo. Los componentes en $0,00 durante ambos periodos se omiten para mejorar la legibilidad conforme a NIIF para PYMES § 6.3 / NIC 1 § 106."

**Verificacion obligatoria del ECP inteligente (independiente de cuantas columnas se muestren):**
- CHECK V3-1: Suma de columnas en saldo apertura == TOTAL apertura.
- CHECK V3-2: Suma de columnas en saldo cierre == TOTAL cierre.
- CHECK V3-3: TOTAL cierre == Total Patrimonio del Balance General.
- CHECK V3-4: Fila "Resultado ejercicio" == Utilidad neta del P&L.
- CHECK V3-5: Si \`oci === true\`, columna ORI del ECP == TOTAL ORI del P&L (validador E11).

### TABLA DE ACTIVACION — RESUMEN

| Condicion en TOTALES VINCULANTES         | Comportamiento del agente                           |
| :---                                     | :---                                                |
| daCop + roU + impairment < 1.000 COP     | Omitir linea D&A en EFE + nota tecnica al pie       |
| daCop + roU + impairment ≥ 1.000 COP     | Mostrar lineas D&A con subtitulos en EFE            |
| oriComponents.length === 0               | ORI en una sola linea ($0)                          |
| oriComponents.length > 0                 | Desgloce reclassifiable / no-reclassifiable en P&L  |
| ecpColumns.<flag> === true               | Mostrar columna en ECP                              |
| ecpColumns.<flag> === false              | Omitir columna en ECP                               |

### PRINCIPIO MAESTRO
El informe debe ser completo para una empresa compleja y limpio para una empresa simple — automaticamente, sin intervencion del usuario y sin contradecir la doctrina de la Seccion 0 ni las 14 correcciones de la spec v2.1.
`;
}
