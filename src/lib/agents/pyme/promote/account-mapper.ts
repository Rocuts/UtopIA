import 'server-only';
// ---------------------------------------------------------------------------
// WS2 — account-mapper: categoría/pucHint → UUID en chart_of_accounts
// ---------------------------------------------------------------------------
// Estrategia en dos pasos:
//   1. Búsqueda exacta: si pucHint existe y hay una cuenta `code=pucHint`,
//      `is_postable=true` en el workspace → úsala.
//   2. Fallback heurístico: tabla de códigos PUC PYMES (Decreto 2706/2012)
//      según kind + palabras clave de la descripción/categoría.
//
// Si ningún paso resuelve → accountId=null (el caller agrega al `skipped`).
//
// Las cuentas de los fallbacks son auxiliares (nivel 5) del PUC simplificado
// PYME; asumimos que el workspace las tiene si usó `db:push` con el seed de
// PUC incluido. Si no existen, el double-entry service las rechazará con
// ACCOUNT_NOT_POSTABLE y el bridge los captura como `skipped`.
// ---------------------------------------------------------------------------

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { chartOfAccounts } from '@/lib/db/schema';
import type { AccountMapping } from './types';

// ---------------------------------------------------------------------------
// Fallbacks heurísticos (kind → código PUC PYME por defecto)
// ---------------------------------------------------------------------------

/**
 * Tabla de fallbacks ordered by specificity (más específico primero).
 * Cada entrada: [keywords (en descripción + categoria, lowercase), kind, pucCode, pucName].
 * Se evalúa en orden; la primera que hace match gana.
 */
const FALLBACK_RULES: Array<{
  keywords: string[];
  kind: 'ingreso' | 'egreso' | 'both';
  code: string;
  name: string;
}> = [
  // ─── Ingresos ────────────────────────────────────────────────────────────
  {
    keywords: ['venta', 'ventas', 'mercancia', 'mercancía', 'producto'],
    kind: 'ingreso',
    code: '413505',
    name: 'Ventas - Comercio al por menor',
  },
  {
    keywords: ['servicio', 'servicios', 'honorario', 'honorarios', 'consultor'],
    kind: 'ingreso',
    code: '417510',
    name: 'Ingresos por servicios',
  },
  {
    keywords: ['arriendo', 'alquiler', 'arrendamiento'],
    kind: 'ingreso',
    code: '419510',
    name: 'Otros ingresos - Arrendamientos',
  },
  // ─── Egresos ─────────────────────────────────────────────────────────────
  {
    keywords: ['arriendo', 'alquiler', 'arrendamiento', 'local'],
    kind: 'egreso',
    code: '511005',
    name: 'Gastos de personal - Arrendamientos',
  },
  {
    keywords: ['nomina', 'nómina', 'salario', 'sueldo', 'empleado', 'trabajador'],
    kind: 'egreso',
    code: '510515',
    name: 'Gastos de personal - Salarios',
  },
  {
    keywords: ['mercancia', 'mercancía', 'inventario', 'materia prima', 'compra'],
    kind: 'egreso',
    code: '143505',
    name: 'Inventarios - Mercancías',
  },
  {
    keywords: ['servicio publico', 'servicios publicos', 'agua', 'luz', 'energia', 'energía', 'gas'],
    kind: 'egreso',
    code: '521505',
    name: 'Gastos generales - Servicios públicos',
  },
  {
    keywords: ['telefono', 'teléfono', 'celular', 'internet', 'comunicacion', 'comunicación'],
    kind: 'egreso',
    code: '521520',
    name: 'Gastos generales - Comunicaciones',
  },
  {
    keywords: ['transporte', 'flete', 'mensajeria', 'mensajería', 'envio', 'envío'],
    kind: 'egreso',
    code: '521525',
    name: 'Gastos generales - Transporte',
  },
  {
    keywords: ['publicidad', 'marketing', 'propaganda', 'anuncio'],
    kind: 'egreso',
    code: '521530',
    name: 'Gastos generales - Publicidad',
  },
  {
    keywords: ['papeleria', 'papelería', 'utiles', 'útiles', 'suministro'],
    kind: 'egreso',
    code: '521535',
    name: 'Gastos generales - Útiles y papelería',
  },
  // ─── Fallback genérico por kind ─────────────────────────────────────────
  {
    keywords: [],
    kind: 'ingreso',
    code: '419595',
    name: 'Otros ingresos no operacionales',
  },
  {
    keywords: [],
    kind: 'egreso',
    code: '529595',
    name: 'Gastos generales - Diversos',
  },
];

// ---------------------------------------------------------------------------
// Cuenta de contrapartida: siempre 1105 (Caja) para el MVP.
// ---------------------------------------------------------------------------

export const CAJA_PUC_CODE = '110505';
export const CAJA_PUC_NAME = 'Caja general';

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

export async function mapCategoryToAccount(
  workspaceId: string,
  pucHint: string | null,
  kind: 'ingreso' | 'egreso',
  description?: string | null,
  category?: string | null,
): Promise<AccountMapping> {
  const db = getDb();

  // ── Paso 1: búsqueda exacta por pucHint ────────────────────────────────
  if (pucHint && pucHint.trim().length > 0) {
    const rows = await db
      .select()
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.workspaceId, workspaceId),
          eq(chartOfAccounts.code, pucHint.trim()),
          eq(chartOfAccounts.isPostable, true),
          eq(chartOfAccounts.active, true),
        ),
      )
      .limit(1);

    if (rows.length > 0) {
      const acct = rows[0];
      return {
        pymeEntryId: '',
        accountId: acct.id,
        accountCode: acct.code,
        accountName: acct.name,
        isExact: true,
        fallbackCode: null,
      };
    }
  }

  // ── Paso 2: fallback heurístico ─────────────────────────────────────────
  const needle = [description ?? '', category ?? ''].join(' ').toLowerCase();

  let matchedCode: string | null = null;
  let matchedName: string | null = null;

  for (const rule of FALLBACK_RULES) {
    if (rule.kind !== 'both' && rule.kind !== kind) continue;
    const matches =
      rule.keywords.length === 0 ||
      rule.keywords.some((kw) => needle.includes(kw));
    if (matches) {
      matchedCode = rule.code;
      matchedName = rule.name;
      break;
    }
  }

  if (!matchedCode) {
    // Nunca debería llegar aquí porque hay fallbacks genéricos con keywords=[],
    // pero lo manejamos por seguridad.
    return {
      pymeEntryId: '',
      accountId: null,
      accountCode: null,
      accountName: null,
      isExact: false,
      fallbackCode: null,
    };
  }

  // Intentar encontrar el UUID en chart_of_accounts para el código fallback.
  // Si el workspace no tiene el PUC sembrado, devolvemos null → skipped.
  const fallbackRows = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.code, matchedCode),
        eq(chartOfAccounts.isPostable, true),
        eq(chartOfAccounts.active, true),
      ),
    )
    .limit(1);

  if (fallbackRows.length === 0) {
    return {
      pymeEntryId: '',
      accountId: null,
      accountCode: matchedCode,
      accountName: matchedName,
      isExact: false,
      fallbackCode: matchedCode,
    };
  }

  const fallbackAcct = fallbackRows[0];
  return {
    pymeEntryId: '',
    accountId: fallbackAcct.id,
    accountCode: fallbackAcct.code,
    accountName: fallbackAcct.name,
    isExact: false,
    fallbackCode: matchedCode,
  };
}

/**
 * Resuelve el UUID de la cuenta de caja (1105 05) para el workspace.
 * Retorna null si no existe en chart_of_accounts.
 */
export async function resolveCajaAccount(
  workspaceId: string,
): Promise<{ id: string; code: string; name: string } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.code, CAJA_PUC_CODE),
        eq(chartOfAccounts.isPostable, true),
        eq(chartOfAccounts.active, true),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return { id: rows[0].id, code: rows[0].code, name: rows[0].name };
}
