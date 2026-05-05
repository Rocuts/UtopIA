// ─── WS4 — Categorías de activos fijos con vidas útiles Art. 137 E.T. 2026 ──
//
// Referencia: Art. 137 E.T. — "Limitación a la deducción por depreciación":
//   - Inmuebles (edificios):          20 años = 240 meses  (5% anual)
//   - Barcos, trenes, aviones:        10 años = 120 meses
//   - Vehículos y equipo aeronáutico:  5 años =  60 meses
//   - Equipos de cómputo:              5 años =  60 meses  (práctica mercado: 3 años)
//   - Maquinaria, equipo e instalaciones: 10 años = 120 meses
//   - Muebles y enseres:              10 años = 120 meses
//
// Nota: para NIIF (NIC 16), la vida útil la estima la entidad — puede diferir
// del fiscal. El MVP usa las vidas fiscales del Art. 137 como punto de partida
// razonable para PYMES. El usuario puede sobrescribir por activo.
//
// Para equipo de cómputo usamos 36 meses (3 años) que es el estándar de
// mercado para PYMES tecnológicas, aunque el E.T. permite hasta 60 meses.

export interface FixedAssetCategory {
  /** Clave interna — coincide con el campo `category` de la tabla fixed_assets. */
  key: string;
  /** Nombre legible en español. */
  name: string;
  /** Vida útil en meses (Art. 137 E.T.). */
  usefulLifeMonths: number;
  /** Código PUC típico del activo (cuenta de activo). Ejemplo: 152405. */
  assetAccountCode: string;
  /** Código PUC típico de la depreciación acumulada. Ejemplo: 159205. */
  depreciationAccountCode: string;
  /** Código PUC típico del gasto de depreciación. Ejemplo: 516010. */
  expenseAccountCode: string;
}

export const FIXED_ASSET_CATEGORIES_CO_2026: FixedAssetCategory[] = [
  {
    key: 'equipo_computo',
    name: 'Equipo de cómputo y comunicaciones',
    usefulLifeMonths: 36,          // 3 años — estándar mercado PYME
    assetAccountCode: '152405',    // Equipo de cómputo
    depreciationAccountCode: '159205', // Depreciación acumulada — equipo cómputo
    expenseAccountCode: '516010',  // Gasto depreciación — equipo cómputo
  },
  {
    key: 'vehiculos',
    name: 'Vehículos',
    usefulLifeMonths: 60,          // 5 años Art. 137 E.T.
    assetAccountCode: '152005',    // Vehículos
    depreciationAccountCode: '159205', // Depreciación acumulada
    expenseAccountCode: '516010',  // Gasto depreciación
  },
  {
    key: 'muebles_enseres',
    name: 'Muebles y enseres',
    usefulLifeMonths: 120,         // 10 años Art. 137 E.T.
    assetAccountCode: '152010',    // Muebles y enseres
    depreciationAccountCode: '159205',
    expenseAccountCode: '516010',
  },
  {
    key: 'maquinaria_equipo',
    name: 'Maquinaria y equipo',
    usefulLifeMonths: 120,         // 10 años Art. 137 E.T.
    assetAccountCode: '152210',    // Maquinaria y equipo
    depreciationAccountCode: '159205',
    expenseAccountCode: '516010',
  },
  {
    key: 'edificios',
    name: 'Edificios y construcciones',
    usefulLifeMonths: 540,         // 45 años — NIIF (NIC 16); fiscal 240 meses
    assetAccountCode: '151605',    // Edificios
    depreciationAccountCode: '159205',
    expenseAccountCode: '516010',
  },
  {
    key: 'equipo_oficina',
    name: 'Equipo de oficina',
    usefulLifeMonths: 120,         // 10 años
    assetAccountCode: '152410',    // Equipo de oficina
    depreciationAccountCode: '159205',
    expenseAccountCode: '516010',
  },
];

/** Mapa clave → categoría para lookup rápido. */
export const FIXED_ASSET_CATEGORY_MAP = new Map<string, FixedAssetCategory>(
  FIXED_ASSET_CATEGORIES_CO_2026.map((c) => [c.key, c]),
);
