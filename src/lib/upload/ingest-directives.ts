// ---------------------------------------------------------------------------
// Directivas de ingesta confirmadas por el usuario (auditoría 2026-09-24,
// pendiente #4 — P4).
// ---------------------------------------------------------------------------
// Dos decisiones del usuario cambian la lectura determinista del balance:
//
//  1. La UNIDAD de los importes. Un archivo que declara "en miles de pesos" se
//     bloquea (recalculo-final-03) hasta que el usuario confirma la unidad; con
//     la confirmación el servidor reexpresa cada importe a pesos en centavos
//     exactos (BigInt) y deja una nota visible en el informe.
//  2. Los VENCIMIENTOS por cuenta. La clasificación corriente / no corriente es
//     por grupo PUC (supuesto revelado); el usuario puede declarar excepciones
//     por código (`1205` → no corriente) que se aplican de forma determinista.
//
// Por qué viajan DENTRO de `rawData` y no sólo como campos del body: el balance
// se re-deriva en servidor desde `rawData` en varias superficies (/upload,
// /niif, Stage 0 del orquestador que usan /consolidate y la ruta legacy,
// /export). Una línea de directiva al inicio del texto hace que todas lean la
// MISMA confirmación sin que cada ruta tenga que reenviar un campo aparte, y el
// texto que leen los agentes declara la unidad confirmada.
//
// Formato (una directiva por línea, sólo al inicio del texto):
//   [unidad-confirmada=miles]
//   [vencimientos=1205:no_corriente;2105:no_corriente]
//
// Módulo puro y sin dependencias: lo importan el intake (cliente) y el
// preprocesador (servidor).
// ---------------------------------------------------------------------------

/** Unidad en la que el usuario confirma que están los importes del archivo. */
export type UnidadMonetaria = 'pesos' | 'miles' | 'millones';

/** Clasificación por vencimiento que el usuario puede declarar por cuenta. */
export type Vencimiento = 'corriente' | 'no_corriente';

export const UNIDADES_MONETARIAS: readonly UnidadMonetaria[] = ['pesos', 'miles', 'millones'];

/** Multiplicador exacto de cada unidad hacia pesos. */
export const MULTIPLICADOR_UNIDAD: Readonly<Record<UnidadMonetaria, 1 | 1000 | 1000000>> = {
  pesos: 1,
  miles: 1000,
  millones: 1000000,
};

/** Unidad de un multiplicador (1, 1000, 1000000); `null` para cualquier otro valor. */
export function unidadDesdeMultiplicador(multiplicador: unknown): UnidadMonetaria | null {
  for (const u of UNIDADES_MONETARIAS) {
    if (MULTIPLICADOR_UNIDAD[u] === multiplicador) return u;
  }
  return null;
}

export function esUnidadMonetaria(value: unknown): value is UnidadMonetaria {
  return typeof value === 'string' && (UNIDADES_MONETARIAS as readonly string[]).includes(value);
}

export function esVencimiento(value: unknown): value is Vencimiento {
  return value === 'corriente' || value === 'no_corriente';
}

/** Tope de excepciones de vencimiento por balance (entrada del usuario). */
export const MAX_VENCIMIENTOS_DECLARADOS = 500;

/**
 * Motivo por el que un código no admite excepción de vencimiento, o `null` si
 * es válido. Sólo cuentas de activo (clase 1) o pasivo (clase 2), de 2 a 20
 * dígitos: la clasificación corriente / no corriente no existe en las demás.
 */
export function motivoCodigoVencimientoInvalido(codigo: string): string | null {
  if (!/^\d{2,20}$/.test(codigo)) {
    return `"${codigo}" no es un código PUC (2 a 20 dígitos).`;
  }
  if (codigo[0] !== '1' && codigo[0] !== '2') {
    return `la cuenta ${codigo} no es de activo (clase 1) ni de pasivo (clase 2).`;
  }
  return null;
}

export interface DirectivasIngesta {
  unidadConfirmada: UnidadMonetaria | null;
  /** `null` si no se declararon excepciones. */
  vencimientos: Record<string, Vencimiento> | null;
}

export interface LecturaDirectivas extends DirectivasIngesta {
  /** Texto sin las líneas de directiva. */
  resto: string;
  /** Las líneas de directiva tal como llegaron (con salto final), o `''`. */
  prefijo: string;
  /** Directivas mal formadas (se sirven como 422: nunca se ignoran en silencio). */
  errores: string[];
  /** `true` si el texto traía al menos una directiva. */
  tieneDirectivas: boolean;
}

const DIRECTIVA_RE = /^\[(unidad-confirmada|vencimientos)=([^\]\r\n]*)\][ \t]*$/i;

/**
 * Lee las directivas del inicio del texto. Se detiene en la primera línea que
 * no es directiva (las líneas en blanco iniciales se ignoran).
 */
export function leerDirectivasIngesta(text: string): LecturaDirectivas {
  const source = (text ?? '').replace(/^﻿/, '');
  const lines = source.split('\n');
  let unidadConfirmada: UnidadMonetaria | null = null;
  let vencimientos: Record<string, Vencimiento> | null = null;
  const errores: string[] = [];
  let i = 0;
  let found = false;
  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '').trim();
    if (line.length === 0 && !found) continue;
    const m = DIRECTIVA_RE.exec(line);
    if (!m) break;
    found = true;
    const nombre = m[1].toLowerCase();
    const valor = m[2].trim();
    if (nombre === 'unidad-confirmada') {
      const u = valor.toLowerCase();
      if (!esUnidadMonetaria(u)) {
        errores.push(
          `Directiva de unidad inválida "${valor}": use pesos, miles o millones.`,
        );
      } else if (unidadConfirmada !== null && unidadConfirmada !== u) {
        errores.push(
          `El texto confirma dos unidades distintas (${unidadConfirmada} y ${u}); confirme una sola.`,
        );
      } else {
        unidadConfirmada = u;
      }
    } else {
      const parsed = parseVencimientos(valor);
      errores.push(...parsed.errores);
      vencimientos = { ...(vencimientos ?? {}), ...parsed.vencimientos };
    }
  }
  if (!found) {
    return {
      unidadConfirmada: null,
      vencimientos: null,
      resto: text ?? '',
      prefijo: '',
      errores: [],
      tieneDirectivas: false,
    };
  }
  if (vencimientos && Object.keys(vencimientos).length === 0) vencimientos = null;
  return {
    unidadConfirmada,
    vencimientos,
    resto: lines.slice(i).join('\n'),
    prefijo: `${lines.slice(0, i).join('\n')}\n`,
    errores,
    tieneDirectivas: true,
  };
}

function parseVencimientos(valor: string): {
  vencimientos: Record<string, Vencimiento>;
  errores: string[];
} {
  const vencimientos: Record<string, Vencimiento> = {};
  const errores: string[] = [];
  const partes = valor.split(';').map((p) => p.trim()).filter((p) => p.length > 0);
  if (partes.length > MAX_VENCIMIENTOS_DECLARADOS) {
    errores.push(`Se declararon ${partes.length} excepciones de vencimiento (máximo ${MAX_VENCIMIENTOS_DECLARADOS}).`);
    return { vencimientos, errores };
  }
  for (const parte of partes) {
    const [codigoRaw, plazoRaw, ...extra] = parte.split(':').map((s) => s.trim());
    const codigo = (codigoRaw ?? '').replace(/[.\-\s]/g, '');
    const plazo = (plazoRaw ?? '').toLowerCase().replace(/[\s-]+/g, '_');
    const invalido = motivoCodigoVencimientoInvalido(codigo);
    if (invalido || extra.length > 0) {
      errores.push(`Excepción de vencimiento inválida "${parte}": ${invalido ?? 'formato código:plazo'}`);
      continue;
    }
    if (!esVencimiento(plazo)) {
      errores.push(
        `Excepción de vencimiento inválida "${parte}": el plazo debe ser corriente o no_corriente.`,
      );
      continue;
    }
    if (codigo in vencimientos && vencimientos[codigo] !== plazo) {
      errores.push(`La cuenta ${codigo} se declaró corriente y no corriente a la vez.`);
      continue;
    }
    vencimientos[codigo] = plazo;
  }
  return { vencimientos, errores };
}

/**
 * Escribe (o sustituye) las directivas al inicio del texto. Idempotente: las
 * directivas previas se reemplazan. `unidadConfirmada: null` y un mapa de
 * vencimientos vacío no escriben línea.
 */
export function escribirDirectivasIngesta(text: string, directivas: Partial<DirectivasIngesta>): string {
  const actual = leerDirectivasIngesta(text);
  const base = actual.tieneDirectivas ? actual.resto : text ?? '';
  const unidad =
    directivas.unidadConfirmada !== undefined ? directivas.unidadConfirmada : actual.unidadConfirmada;
  const venc = directivas.vencimientos !== undefined ? directivas.vencimientos : actual.vencimientos;
  const lines: string[] = [];
  if (unidad) lines.push(`[unidad-confirmada=${unidad}]`);
  const entradas = Object.entries(venc ?? {})
    .filter(([codigo, plazo]) => motivoCodigoVencimientoInvalido(codigo) === null && esVencimiento(plazo))
    .sort(([a], [b]) => a.localeCompare(b));
  if (entradas.length > 0) {
    lines.push(`[vencimientos=${entradas.map(([c, p]) => `${c}:${p}`).join(';')}]`);
  }
  return lines.length > 0 ? `${lines.join('\n')}\n${base}` : base;
}
