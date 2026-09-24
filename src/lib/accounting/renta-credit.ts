// ---------------------------------------------------------------------------
// Crédito imputable al impuesto de RENTA — regla única (1355 / 1805)
// ---------------------------------------------------------------------------
// Fuente ÚNICA de «qué hoja de 1355/1805 es crédito del impuesto de renta».
// La usan el preprocesador (`isRentaCreditAccount` → saldo a favor de renta),
// el Doctor de Datos (`repair/adjustments.ts`, vía el preprocesador), el
// Âncora Fiscal (F03, `fiscal-anchor/credito-renta.ts`) y el Âncora NIIF
// (`ancora/build-ancora.ts`). Antes había dos implementaciones que divergían y
// el mismo balance publicaba dos saldos a favor distintos (auditoría 2026-09,
// integración W3-B; hallazgos niif-preproceso-19 y tributario-modulos-01).
//
// Criterio (decisión del coordinador de la auditoría):
//   · 135505 «Anticipo de impuestos de renta y complementarios» y 135515
//     «Retención en la fuente» → crédito de renta (Arts. 365, 373 y 807 E.T.),
//     salvo que el nombre declare otro tributo: IVA, ICA, predial, timbre, GMF
//     o contribuciones.
//   · 135595 «Otros» y 1805 → sólo si el NOMBRE es de renta (renta, retención
//     en la fuente, autorretención). En el PUC oficial (Decreto 2650/1993) la
//     1805 es «Bienes de arte y cultura»: presentarla como saldo a favor sin
//     que el nombre lo diga es una cifra falsa.
//   · Hoja 1355 sin subcuenta (código de 4 dígitos): mismo trato que 135595,
//     porque el código no dice de qué tributo es.
//   · 135517 (ReteIVA, Art. 484-1 E.T.) → contra IVA; 135510 y 135518 (anticipo
//     y retención de ICA) → tributo municipal; 135520, 135525, 135530 y el
//     resto de subcuentas de 1355 → no son crédito de renta.
// Lo que no es crédito de renta se informa aparte y NUNCA netea el impuesto.
// ---------------------------------------------------------------------------

export type ClaseActivoImpuesto = 'credito_renta' | 'rete_iva' | 'rete_ica' | 'otro_no_renta';

/** Minúsculas, sin tildes y con espacios simples (los nombres llegan de Excel). */
function normalizarNombre(nombre: string): string {
  return String(nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

const PATRON_IVA =
  /(\biva\b|\bi\.v\.a\b|\breteiva\b|\brete iva\b|impuestos? (?:a|sobre) las ventas|\bdescontables?\b)/;
const PATRON_ICA = /(\bica\b|\breteica\b|\brete ica\b|industria y comercio|avisos y tableros)/;
const PATRON_OTRO_TRIBUTO =
  /(\bpredial\b|\btimbre\b|\bgmf\b|gravamen a los movimientos financieros|\b4 ?x ?1000\b|\bcuatro por mil\b|\bcontribucion(?:es)?\b)/;
const PATRON_RENTA =
  /(\brentas?\b|\bretencion(?:es)? en la fuente\b|\brete ?fuente\b|\bautorretencion(?:es)?\b|\bauto retencion(?:es)?\b)/;

/** ¿Algún nombre del contexto declara un tributo distinto de renta? */
function tributoAjeno(nombres: readonly string[]): ClaseActivoImpuesto | null {
  if (nombres.some((n) => PATRON_IVA.test(n))) return 'rete_iva';
  if (nombres.some((n) => PATRON_ICA.test(n))) return 'rete_ica';
  if (nombres.some((n) => PATRON_OTRO_TRIBUTO.test(n))) return 'otro_no_renta';
  return null;
}

/**
 * Clasifica una hoja de 1355/1805. Devuelve `null` si la cuenta no pertenece a
 * esos grupos (no es un activo por impuestos que el crédito de renta considere).
 *
 * @param nombresContexto nombre de la hoja y, si se conocen, los de sus cuentas
 *   padre dentro del prefijo que decide la regla (ver `nombresConAncestros`).
 */
export function clasificarActivoImpuesto(
  code: string,
  nombresContexto: readonly string[],
): ClaseActivoImpuesto | null {
  const esGrupo1805 = code.startsWith('1805');
  if (!code.startsWith('1355') && !esGrupo1805) return null;

  if (code.startsWith('135517')) return 'rete_iva';
  if (code.startsWith('135518') || code.startsWith('135510')) return 'rete_ica';

  const porCodigo = code.startsWith('135505') || code.startsWith('135515');
  const porNombre = esGrupo1805 || code.startsWith('135595') || code.length < 6;
  if (!porCodigo && !porNombre) return 'otro_no_renta';

  const nombres = nombresContexto.map(normalizarNombre);
  const ajeno = tributoAjeno(nombres);
  if (ajeno) return ajeno;
  if (porCodigo) return 'credito_renta';
  return nombres.some((n) => PATRON_RENTA.test(n)) ? 'credito_renta' : 'otro_no_renta';
}

/** ¿La hoja es crédito imputable al impuesto de renta? */
export function esCreditoRenta(code: string, nombresContexto: readonly string[]): boolean {
  return clasificarActivoImpuesto(code, nombresContexto) === 'credito_renta';
}

/**
 * Nombre de la hoja + los de sus cuentas padre que comparten el prefijo que
 * decide la regla por nombre (1805 completo o 135595). Para el resto de
 * cuentas devuelve sólo el nombre de la hoja.
 *
 * @param nombreDe busca el nombre de una cuenta por código en el catálogo del
 *   cliente (`undefined` si no está).
 */
export function nombresConAncestros(
  code: string,
  name: string,
  nombreDe: (codigo: string) => string | undefined,
): string[] {
  const raiz = code.startsWith('1805') ? '1805' : code.startsWith('135595') ? '135595' : null;
  const nombres = [name ?? ''];
  if (!raiz) return nombres;
  for (let len = raiz.length; len < code.length; len += 1) {
    const nombre = nombreDe(code.slice(0, len));
    if (nombre) nombres.push(nombre);
  }
  return nombres;
}

/**
 * Hojas de una lista de cuentas (1355/1805 y demás) que son crédito de renta
 * según la regla única, resolviendo los nombres de las cuentas padre con la
 * misma lista (como el Âncora Fiscal). La usan el curator (R4, R10, R16) y la
 * posición de renta del Dictamen 2 (`audit/bindings.ts`) para que el mismo
 * balance dé la misma posición en todas las superficies (re-auditoría
 * 2026-09, NM-06).
 */
export function filtrarCreditoRenta<T extends { code: string; name?: string | null }>(
  cuentas: readonly T[],
): T[] {
  const nombrePorCodigo = new Map<string, string>();
  for (const c of cuentas) nombrePorCodigo.set(c.code, c.name ?? '');
  return cuentas.filter((c) =>
    esCreditoRenta(
      c.code,
      nombresConAncestros(c.code, c.name ?? '', (codigo) => nombrePorCodigo.get(codigo)),
    ),
  );
}
