// ---------------------------------------------------------------------------
// Desglose determinista del Balance
// ---------------------------------------------------------------------------
// El desglose del Estado de Situación Financiera NO es un juicio contable: es
// una proyección del balance de prueba. El preprocesador ya tiene todas las
// cuentas auxiliares con sus centavos exactos; agruparlas por grupo PUC y
// sumarlas es aritmética, no criterio.
//
// Por qué existe este módulo: medido con LLM real sobre el balance de un cliente
// real (docs/FASE0_MEDICION_2026-08.md), el modelo copia los TOTALES sin un solo
// error —9/9 anclas exactas en tres corridas— pero omite renglones del desglose
// de forma inestable: el detalle del Activo se quedó corto un 0,10%, un 41,2% y
// un 99,9% según la corrida, y en una de ellas el Pasivo salió con los dos
// encabezados de sección y NINGÚN renglón bajo un total de $1.962.538.849,62.
//
// Se probó primero la vía barata —reinvocar el pase con la brecha exacta en
// pesos inyectada en el prompt— y NO funciona: el bucle dispara, cuesta ~110s, y
// el desglose sigue incompleto. Por eso el desglose pasa a construirlo el
// código.
//
// Qué sigue aportando el modelo: la clasificación corriente / no corriente
// cuando el plazo no se deduce del código PUC, la etiqueta NIIF de cada rubro, y
// toda la narrativa. Este módulo no le quita criterio; le quita la aritmética,
// que es donde falla.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import { pesosToCents } from '@/lib/preprocessing/curator-rules/sync-control-totals';

const ZERO = BigInt(0);

/** Renglón de detalle listo para inyectar en el Balance. */
export interface BreakdownRow {
  /** Código del grupo PUC de dos dígitos: '11', '13', '22', '31', ... */
  account: string;
  /** Etiqueta NIIF por defecto. El modelo puede afinarla; el monto, no. */
  label: string;
  /** Centavos exactos, en convención natural. */
  cents: bigint;
}

/**
 * Etiquetas NIIF por grupo PUC (Decreto 2650/1993 ↔ NIIF para PYMES).
 *
 * Sólo se listan los grupos que aparecen en un balance de PYME colombiana con
 * frecuencia suficiente para justificar una etiqueta propia. Los que no estén
 * caen a "Grupo NN" — visible y verificable, en vez de desaparecer del informe,
 * que es el fallo que este módulo viene a cerrar.
 */
const GROUP_LABELS: Record<string, string> = {
  // Activo
  '11': 'Efectivo y equivalentes de efectivo',
  '12': 'Inversiones',
  '13': 'Deudores comerciales y otras cuentas por cobrar',
  '14': 'Inventarios',
  '15': 'Propiedades, planta y equipo',
  '16': 'Intangibles',
  '17': 'Diferidos',
  '18': 'Otros activos',
  '19': 'Valorizaciones',
  // Pasivo
  '21': 'Obligaciones financieras',
  '22': 'Proveedores',
  '23': 'Cuentas por pagar',
  '24': 'Impuestos, gravámenes y tasas',
  '25': 'Beneficios a empleados',
  '26': 'Pasivos estimados y provisiones',
  '27': 'Diferidos',
  '28': 'Otros pasivos',
  '29': 'Bonos y papeles comerciales',
  // Patrimonio
  '31': 'Capital social',
  '32': 'Superávit de capital',
  '33': 'Reservas',
  '34': 'Revalorización del patrimonio',
  '35': 'Dividendos o participaciones decretados en acciones',
  '36': 'Resultados del ejercicio',
  '37': 'Resultados de ejercicios anteriores',
  '38': 'Superávit por valorizaciones',
};

/**
 * Grupos PUC de activo que son NO CORRIENTES por naturaleza.
 *
 * NIIF para PYMES §4.5: un activo es corriente si se espera realizar dentro del
 * ciclo normal de operación o de los doce meses siguientes. Para propiedades,
 * planta y equipo, intangibles y valorizaciones la respuesta no depende del
 * caso; para el resto sí, y por eso NO se clasifican aquí — el modelo conserva
 * ese juicio.
 */
const NON_CURRENT_ASSET_GROUPS = new Set(['15', '16', '19']);

/** Grupos PUC de pasivo no corrientes por naturaleza. */
const NON_CURRENT_LIABILITY_GROUPS = new Set(['29']);

export type BreakdownSection = 'assets' | 'liabilities' | 'equity';

const CLASS_BY_SECTION: Record<BreakdownSection, number> = {
  assets: 1,
  liabilities: 2,
  equity: 3,
};

/**
 * Construye el desglose por grupo PUC de un estado, desde las cuentas del
 * snapshot. La suma de los renglones devueltos es EXACTAMENTE el total de la
 * clase — es la misma cifra, agregada de otra forma.
 *
 * Las cuentas correctoras conservan su signo negativo: NIC 16.73 y NIIF PYMES
 * 17.31 exigen presentar el importe en libros neto, y agregar por grupo lo hace
 * de forma natural (la 1592 vive dentro del grupo 15 y lo reduce).
 */
export function buildDeterministicBreakdown(
  snapshot: PeriodSnapshot,
  section: BreakdownSection,
): BreakdownRow[] {
  const classCode = CLASS_BY_SECTION[section];
  const puc = snapshot.classes.find((c) => c.code === classCode);
  if (!puc) return [];

  const byGroup = new Map<string, bigint>();
  for (const account of puc.accounts) {
    // Sólo hojas: sumar además los niveles agregados duplicaría todo.
    if (!account.isLeaf) continue;
    const code = String(account.code).replace(/\D/g, '');
    if (code.length < 2) continue;
    const group = code.slice(0, 2);
    byGroup.set(group, (byGroup.get(group) ?? ZERO) + pesosToCents(account.balance));
  }

  return [...byGroup.entries()]
    .filter(([, cents]) => cents !== ZERO)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, cents]) => ({
      account: group,
      label: GROUP_LABELS[group] ?? `Grupo ${group}`,
      cents,
    }));
}

/**
 * `true` si el grupo es no corriente por naturaleza. Lo consume el prompt para
 * decirle al modelo qué NO tiene que decidir.
 */
export function isNonCurrentGroup(section: BreakdownSection, group: string): boolean {
  if (section === 'assets') return NON_CURRENT_ASSET_GROUPS.has(group);
  if (section === 'liabilities') return NON_CURRENT_LIABILITY_GROUPS.has(group);
  return false;
}
