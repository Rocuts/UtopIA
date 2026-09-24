// ─── WS4 — Categorías de activos fijos: vida útil contable y tope fiscal ────
//
// contab-nomina-23 (auditoría 2026-09-24). La versión anterior atribuía al
// Art. 137 E.T. vidas de 20 años para edificios y 5 para vehículos: ese
// esquema es anterior a la Ley 1819 de 2016. Hoy el Art. 137 (mod. art. 82
// Ley 1819/2016, src/data/tax_docs/estatuto_tributario_completo.md) dice que
// la depreciación fiscal es la contable "siempre que no exceda las tasas
// máximas" y, sin reglamento, fija en su parágrafo 1 tasas anuales máximas:
//   - Construcciones y edificaciones            2,22 %
//   - Flota y equipo de transporte terrestre   10,00 %
//   - Maquinaria, equipos                      10,00 %
//   - Muebles y enseres                        10,00 %
//   - Equipo eléctrico                         10,00 %
//   - Equipo de computación / de comunicación  20,00 %
//
// Por eso cada categoría separa:
//   - `usefulLifeMonths`: vida útil CONTABLE sugerida (NIC 16 / Sección 17 de
//     NIIF para las PYMES: la estima la entidad; el usuario la sobrescribe por
//     activo). No es una vida "permitida por el E.T.".
//   - `fiscalMaxAnnualRatePct`: tasa máxima fiscal del Art. 137 par. 1. Si la
//     depreciación contable la supera (p. ej. cómputo a 36 meses ≈ 33 % frente
//     al 20 % fiscal), el exceso no es deducible en el año y genera una
//     diferencia temporaria (Art. 137 par. 4).
//
// Cuentas PUC (Decreto 2650/1993, src/data/tax_docs/puc_pymes_2026.json): cada
// categoría usa SU subcuenta de depreciación acumulada 1592xx y su espejo de
// gasto 5160xx (mismos dos últimos dígitos, convención del PUC sembrado en
// puc-pyme-colombia.ts). Antes todas usaban 159205/516010 (construcciones /
// maquinaria) y cómputo usaba 152405 (muebles y enseres).
//
// Sin consumidores en producción: el módulo de depreciación lee la
// configuración de cada activo, no esta tabla.

export interface FixedAssetCategory {
  /** Clave interna — coincide con el campo `category` de la tabla fixed_assets. */
  key: string;
  /** Nombre legible en español. */
  name: string;
  /** Vida útil CONTABLE sugerida en meses (estimación de la entidad, NIC 16 / Secc. 17). */
  usefulLifeMonths: number;
  /** Tasa anual máxima de depreciación fiscal (Art. 137 E.T. par. 1), en %. */
  fiscalMaxAnnualRatePct: number;
  /** Concepto de la tabla del Art. 137 par. 1 del que sale la tasa. */
  fiscalConcept: string;
  /** Código PUC del activo. */
  assetAccountCode: string;
  /** Código PUC de la depreciación acumulada (1592xx de la categoría). */
  depreciationAccountCode: string;
  /** Código PUC del gasto de depreciación (5160xx espejo de la 1592xx). */
  expenseAccountCode: string;
}

export const FIXED_ASSET_CATEGORIES_CO_2026: FixedAssetCategory[] = [
  {
    key: 'equipo_computo',
    name: 'Equipo de cómputo y comunicaciones',
    usefulLifeMonths: 36,          // 3 años: estimación contable usual; ≈ 33 %/año > 20 % fiscal
    fiscalMaxAnnualRatePct: 20,
    fiscalConcept: 'EQUIPO DE COMPUTACIÓN',
    assetAccountCode: '152805',    // Equipos de procesamiento de datos
    depreciationAccountCode: '159220', // Dep. acumulada — equipo de computación y comunicación
    expenseAccountCode: '516020',  // Depreciación — equipo de computación y comunicación
  },
  {
    key: 'vehiculos',
    name: 'Vehículos',
    usefulLifeMonths: 60,          // 5 años contable; fiscal máx. 10 %/año
    fiscalMaxAnnualRatePct: 10,
    fiscalConcept: 'FLOTA Y EQUIPO DE TRANSPORTE TERRESTRE',
    assetAccountCode: '154005',    // Autos, camionetas y camperos
    depreciationAccountCode: '159235', // Dep. acumulada — flota y equipo de transporte
    expenseAccountCode: '516035',  // Depreciación — flota y equipo de transporte
  },
  {
    key: 'muebles_enseres',
    name: 'Muebles y enseres',
    usefulLifeMonths: 120,         // 10 años
    fiscalMaxAnnualRatePct: 10,
    fiscalConcept: 'MUEBLES Y ENSERES',
    assetAccountCode: '152405',    // Muebles y enseres
    depreciationAccountCode: '159215', // Dep. acumulada — equipo de oficina
    expenseAccountCode: '516015',  // Depreciación — equipo de oficina
  },
  {
    key: 'maquinaria_equipo',
    name: 'Maquinaria y equipo',
    usefulLifeMonths: 120,         // 10 años
    fiscalMaxAnnualRatePct: 10,
    fiscalConcept: 'MAQUINARIA, EQUIPOS',
    assetAccountCode: '152010',    // Maquinaria y equipo (en operación)
    depreciationAccountCode: '159210', // Dep. acumulada — maquinaria y equipo
    expenseAccountCode: '516010',  // Depreciación — maquinaria y equipo
  },
  {
    key: 'edificios',
    name: 'Edificios y construcciones',
    usefulLifeMonths: 540,         // 45 años; fiscal máx. 2,22 %/año (≈ 45 años)
    fiscalMaxAnnualRatePct: 2.22,
    fiscalConcept: 'CONSTRUCCIONES Y EDIFICACIONES',
    assetAccountCode: '151605',    // Edificios
    depreciationAccountCode: '159205', // Dep. acumulada — construcciones y edificaciones
    expenseAccountCode: '516005',  // Depreciación — construcciones y edificaciones
  },
  {
    key: 'equipo_oficina',
    name: 'Equipo de oficina',
    usefulLifeMonths: 120,         // 10 años
    fiscalMaxAnnualRatePct: 10,
    // El Art. 137 no lista "equipo de oficina": se asimila a muebles y enseres
    // (la misma tasa que equipo eléctrico).
    fiscalConcept: 'MUEBLES Y ENSERES',
    assetAccountCode: '152410',    // Equipos (de oficina)
    depreciationAccountCode: '159215', // Dep. acumulada — equipo de oficina
    expenseAccountCode: '516015',  // Depreciación — equipo de oficina
  },
];

/** Mapa clave → categoría para lookup rápido. */
export const FIXED_ASSET_CATEGORY_MAP = new Map<string, FixedAssetCategory>(
  FIXED_ASSET_CATEGORIES_CO_2026.map((c) => [c.key, c]),
);
