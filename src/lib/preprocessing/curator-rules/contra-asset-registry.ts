// ---------------------------------------------------------------------------
// Registro de CUENTAS CORRECTORAS (contra-activo) de la Clase 1 del PUC
// ---------------------------------------------------------------------------
// Fuente unica de verdad. La consumen R1 (no reclasificar), R14 (excluir del
// PPE bruto), R2 (D&A del EFE) y presentation-v3 (presentacion bruto/neto).
//
// ── POR QUE ESTAS CUENTAS NO SE RECLASIFICAN A PASIVO ──────────────────────
//
// R1 detecta saldos credito en Clase 1 y los reclasifica a Clase 2. Esa regla
// NO debe aplicarse a las cuentas correctoras (depreciacion acumulada,
// agotamiento, amortizacion acumulada, deterioros / provisiones de activo),
// cuya naturaleza contable es acreedora POR DISENO dentro del Activo.
//
// 1) NIC 1 parr. 32 prohibe compensar ACTIVOS con PASIVOS. Una cuenta
//    correctora NO es un pasivo: no existe obligacion presente frente a un
//    tercero surgida de un suceso pasado. Es una correccion de medicion del
//    MISMO activo. Aplicar el parr. 32 aqui es un error de subsuncion.
//
//    NIC 1 parr. 32 (Anexo 1 DUR 2420/2015):
//      "Una entidad no compensara activos con pasivos o ingresos con gastos
//       a menos que asi lo requiera o permita una NIIF."
//
// 2) NIC 1 parr. 33 resuelve el punto de forma EXPRESA — ultima frase:
//      "La medicion por el neto en el caso de los activos sujetos a
//       correcciones valorativas —por ejemplo correcciones por deterioro del
//       valor de inventarios por obsolescencia y de las cuentas por cobrar de
//       dudoso cobro— no es una compensacion."
//
// 3) Equivalente Grupo 2 — NIIF para las PYMES parr. 2.52(a) (Anexo 2 DUR
//    2420/2015): misma excepcion expresa para activos sujetos a correcciones
//    valorativas.
//
// 4) La presentacion bruto / correctora / neto no solo esta permitida: es
//    OBLIGATORIO revelarla.
//      NIC 16 parr. 73(d): se revelara "el importe en libros bruto y la
//        depreciacion acumulada (junto con el importe acumulado de las
//        perdidas por deterioro de valor), tanto al principio como al final
//        de cada periodo".
//      NIIF para las PYMES parr. 17.31(d): equivalente para Grupo 2.
//      NIIF para las PYMES Seccion 27: la correccion por deterioro reduce el
//        importe en libros contra resultados — no es un pasivo.
//
//    => Mover la depreciacion acumulada al pasivo DESTRUYE el dato exigido
//       por NIC 16 parr. 73(d) e infla Activo y Pasivo en el mismo importe,
//       distorsionando endeudamiento, ROA y capital de trabajo.
//
// ── CODIGOS ────────────────────────────────────────────────────────────────
//
// Decreto 2650 de 1993 (PUC para comerciantes), Catalogo de Cuentas, Clase 1,
// modificado por D.R. 2894/1994 y D.R. 2116/1996. Verificados uno a uno contra
// el texto del catalogo.
//
// ── ESTATUS DEL PUC (para redaccion del reporte) ───────────────────────────
//
// El Decreto 2650/1993 NO ha sido derogado expresamente, pero perdio
// obligatoriedad para las entidades que aplican los marcos tecnicos de la
// Ley 1314 de 2009. CTCP Concepto 2024-0061 (13-jun-2024): bajo los nuevos
// marcos "cada entidad tiene la facultad de definir su propio catalogo de
// cuentas". Los supervisores conservan la potestad de imponer catalogos
// (Ley 1314/2009, art. 11).
//   => Redaccion segura: "referencia tecnica de uso generalizado en Colombia".
//      NUNCA "catalogo obligatorio vigente".
//   => Corolario tecnico: como cada entidad puede crear codigos propios, el
//      match por prefijo se complementa con `looksLikeContraAssetByName()`,
//      que NO muta y solo emite un finding para decision humana.
//
// Marco vigente: DUR 2420/2015 modificado por el Decreto 0701 del 7-jul-2026.
// Ese decreto no incorporo la NIIF 18, por lo que NIC 1 parr. 32/33 sigue
// siendo la norma de no compensacion aplicable en Colombia para 2026.
// ---------------------------------------------------------------------------

/**
 * Cuentas correctoras identificables por prefijo de 4 digitos. Naturaleza
 * CREDITO dentro del Activo por diseno del catalogo.
 */
export const CONTRA_ASSET_PREFIXES_4D: readonly string[] = [
  '1299', // PROVISIONES (Inversiones) — corrige 1205..1295
  '1399', // PROVISIONES (Deudores) — deterioro de cartera, corrige 1305..1390
  '1499', // PROVISIONES (Inventarios) — corrige 1405..1465
  '1592', // DEPRECIACION ACUMULADA (PPE) — corrige 1504..1588
  '1597', // AMORTIZACION ACUMULADA (PPE) — corrige 1564/1568/1584
  '1598', // AGOTAMIENTO ACUMULADO (PPE) — corrige 1572/1576/1580
  '1599', // PROVISIONES (PPE) — corrige 1504..1588
  '1698', // DEPRECIACION Y/O AMORTIZACION ACUMULADA (Intangibles) — D.R. 2116/96
  '1699', // PROVISIONES (Intangibles)
  '1798', // AMORTIZACION ACUMULADA (Diferidos) — corrige 1715/1720
  '1899', // PROVISIONES (Otros activos)
] as const;

/**
 * Cuentas correctoras que viven DENTRO de una cuenta de naturaleza debito, y
 * que por tanto el prefijo de 4 digitos no atrapa. El Decreto 2650 las marca
 * explicitamente con "(CR)".
 */
export const CONTRA_ASSET_PREFIXES_6D: readonly string[] = [
  // 1596 DEPRECIACION DIFERIDA es de naturaleza MIXTA:
  //   159605 EXCESO FISCAL SOBRE LA CONTABLE      -> debito
  //   159610 DEFECTO FISCAL SOBRE LA CONTABLE (CR) -> credito
  // Por eso 1596 NO se whitelistea a 4 digitos.
  '159610',
  // 189515 AMORTIZACION ACUMULADA DE BIENES ENTREGADOS EN COMODATO (CR),
  // dentro de 1895 Diversos (naturaleza debito).
  '189515',
] as const;

/**
 * Prefijo de la cuenta de naturaleza mixta. Un saldo agregado a 4 digitos en
 * `1596` no permite decidir: puede ser deudor (159605) o acreedor (159610).
 * R1 no lo reclasifica, pero emite un finding pidiendo el desglose.
 */
export const MIXED_NATURE_PREFIX_4D = '1596';

/** Normaliza un codigo PUC: quita puntos, guiones y espacios. */
export function normalizePucCode(code: string): string {
  return (code ?? '').replace(/[\s.\-]/g, '');
}

/**
 * True si el codigo corresponde a una cuenta correctora (contra-activo) segun
 * el Decreto 2650/1993. Estas cuentas conservan su saldo credito DENTRO del
 * Activo y nunca se reclasifican a pasivo.
 */
export function isContraAsset(code: string): boolean {
  const c = normalizePucCode(code);
  if (!c) return false;
  for (const p of CONTRA_ASSET_PREFIXES_6D) {
    if (c.startsWith(p)) return true;
  }
  for (const p of CONTRA_ASSET_PREFIXES_4D) {
    if (c.startsWith(p)) return true;
  }
  return false;
}

/**
 * True si el codigo es la cuenta de naturaleza mixta `1596` sin desglosar a 6
 * digitos. No se puede decidir su naturaleza: no se reclasifica, se pregunta.
 */
export function isAmbiguousNatureAccount(code: string): boolean {
  const c = normalizePucCode(code);
  if (!c.startsWith(MIXED_NATURE_PREFIX_4D)) return false;
  // Si viene desglosada a 6+ digitos, `isContraAsset` ya decidio por 159610 y
  // 159605 es debito legitimo — en ninguno de los dos casos es ambigua.
  return c.length < 6;
}

/**
 * Deteccion de respaldo por DENOMINACION, para catalogos propios de la entidad
 * (permitidos bajo Ley 1314/2009 segun CTCP 2024-0061). Un acierto aqui NO
 * autoriza a mutar el snapshot: solo a emitir un finding para revision humana,
 * porque el nombre no es evidencia suficiente de la naturaleza de la cuenta.
 */
const CONTRA_ASSET_NAME_RE =
  /deprecia|amortiza|agotamiento|deterioro|provisi[oó]n|impairment|desvaloriz/i;

export function looksLikeContraAssetByName(name: string): boolean {
  return CONTRA_ASSET_NAME_RE.test(name ?? '');
}

/**
 * Prefijos de PPE bruto: Clase 15 excluyendo TODAS sus correctoras. R14 usa
 * esto para medir materialidad del PPE — si solo se excluye 1592, el "bruto"
 * viene neto de agotamiento y provisiones y la materialidad se subestima.
 */
export function isPpeGrossAccount(code: string): boolean {
  const c = normalizePucCode(code);
  return c.startsWith('15') && !isContraAsset(c) && !c.startsWith(MIXED_NATURE_PREFIX_4D);
}
