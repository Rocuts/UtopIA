/**
 * DIAN Calendar Scraper — fuente oficial del calendario tributario nacional.
 *
 * ESTRATEGIA DUAL CON FALLBACK:
 *   1. Parser primario: HTML del Comunicado de Prensa 128/2025 (texto plano).
 *   2. Fallback: PDF oficial `Calendario_Tributario_2026.pdf` (con `pdf-parse`).
 *
 * El "scraping" en sentido estricto NO extrae fechas del HTML/PDF — la DIAN
 * publica los plazos como **rangos por día hábil** (7° al 16°) y por dígito
 * de NIT, no como fechas explícitas en una tabla parseable. Lo que hacemos:
 *
 *   - Validamos que la fuente oficial sigue VIVA y mantiene el formato
 *     esperado (heurística por keywords del Comunicado 128).
 *   - Generamos el calendario derivando cada vencimiento a partir del
 *     N-ésimo día hábil del mes correspondiente, usando el calendario de
 *     festivos colombianos 2026 (ground truth interno).
 *   - Hash SHA-256 del payload fuente → permite al cron detectar cuándo
 *     la DIAN cambió el comunicado (señal para re-validar manualmente).
 *
 * Los rangos textuales del Comunicado DIAN 128/2025 (ground truth):
 *   - Renta GC C1: feb (10–23), C2 abr (13–27), C3 jun (10–24)
 *   - Renta PJ Decl+C1: may (12–26), C2 jul (9–23)
 *   - Renta PN: ago–oct (12 ago – 26 oct), por los DOS últimos dígitos
 *   - IVA Bimestral B1–B6: mar, may, jul, sep, nov, ene'27
 *   - IVA Cuatrimestral C1–C3: may, sep, ene'27
 *   - Información Exógena: NO sigue la regla del 7°–16° día hábil — tiene
 *     tabla propia (Res. Única DIAN 000227 de 2025, Título 3): grandes
 *     contribuyentes abr–may, personas jurídicas y naturales 14-may a 12-jun
 *     por los DOS últimos dígitos.
 *   - Patrimonio Decl+C1: may (12–26), C2: 14 sep (10° hábil)
 *   - Retención mensual: día 7°–16° hábil del mes siguiente
 *
 * Convención DIAN para el orden por dígito de NIT:
 *   dígito 1 → primer día del rango (7° hábil)
 *   dígito 2 → segundo día del rango (8° hábil)
 *   …
 *   dígito 9 → noveno día del rango (15° hábil)
 *   dígito 0 → último día del rango (16° hábil)
 *
 * El mapeo `digit → businessDay` es: digit === 0 ? 16 : digit + 6
 *
 * ⚠ PROCEDENCIA (auditoría normativa 2026-08). Todo lo que sale de este módulo
 * es CALCULADO por el modelo interno de días hábiles, no leído de la tabla
 * oficial. Por eso ningún deadline se emite con `verified: true`: ese flag está
 * reservado para fechas confrontadas una a una contra el PDF/resolución DIAN.
 * Ver `src/data/calendars/types.ts` ("verified false = fecha inferida").
 */

import { createHash } from 'node:crypto';
import type { NationalDeadline } from '@/data/calendars/types';

const COMUNICADO_URL =
  'https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-128-2025.aspx';
const PDF_URL =
  'https://www.dian.gov.co/Calendarios/Calendario_Tributario_2026.pdf';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) UtopIA-Calendar-Sync/1.0';

const DECREE = 'Decreto 2229 de 2023';
const COMUNICADO_NOTE = 'Comunicado DIAN 128 del 26-dic-2025 — verificado';

// Días NO hábiles 2026 — usados para calcular días hábiles.
// Fuente: Ley 51 de 1983 (traslado al lunes) + Ley 35 de 1939 / Ley 43 de 1975.
const FESTIVOS_2026 = new Set<string>([
  '2026-01-01', // Año Nuevo
  '2026-01-12', // Reyes (lun)
  '2026-03-23', // San José (lun)
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
  // Día Cívico de la Paz con la Naturaleza — tercer viernes de abril.
  // Decreto 500 de 2024 (Presidencia de la República), de aplicación anual.
  // La DIAN confirmó el 4-mar-2026 que, por estar los plazos fijados en DÍAS
  // HÁBILES (Decreto 2229 de 2023), el 17-abr-2026 no cuenta y CORRE un día
  // hábil todos los vencimientos posteriores de abril: la 2ª cuota de grandes
  // contribuyentes pasa de 13–24 abr a 13–27 abr, y la retención del período
  // marzo/2026 de 13–24 abr a 13–27 abr.
  // https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=238215
  // https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/03/dian-informo-cambios-en-los-plazos-para-declaracion-y-pago-de-algunos-impuestos/
  '2026-04-17',
  '2026-05-01', // Día del Trabajo
  '2026-05-18', // Ascensión (lun)
  '2026-06-08', // Corpus Christi (lun)
  '2026-06-15', // Sagrado Corazón (lun)
  '2026-06-29', // San Pedro y San Pablo (lun)
  '2026-07-20', // Independencia
  '2026-08-07', // Batalla de Boyacá
  '2026-08-17', // Asunción (lun)
  '2026-10-12', // Día de la Raza (lun)
  '2026-11-02', // Todos los Santos (lun)
  '2026-11-16', // Independencia de Cartagena (lun)
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad
]);

// Festivos colombianos enero 2027 — necesarios para IVA B6 / Cuatrimestral C3
// y para la retención del período diciembre/2026. NO cubrimos el resto de 2027.
const FESTIVOS_2027_ENERO = new Set<string>([
  '2027-01-01', // Año Nuevo
  '2027-01-11', // Reyes (trasladado al lunes — Ley 51 de 1983)
]);

/**
 * ¿Tenemos el set de días no hábiles VERIFICADO para este (año, mes)?
 *
 * Auditoría normativa 2026-08: `nthBusinessDay` devolvía una fecha para
 * cualquier año, calculándola con un calendario de festivos que sólo conoce
 * 2026 y enero de 2027. Para febrero de 2027 en adelante eso produce fechas
 * silenciosamente TARDÍAS (los festivos no descontados corren el conteo), que
 * es exactamente el error que genera sanción por extemporaneidad. Preferimos
 * fallar ruidosamente a inventar un vencimiento.
 */
export function tieneFestivosVerificados(year: number, month: number): boolean {
  if (year === 2026) return true;
  if (year === 2027 && month === 1) return true;
  return false;
}

function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  if (FESTIVOS_2026.has(iso)) return false;
  if (FESTIVOS_2027_ENERO.has(iso)) return false;
  return true;
}

/**
 * Devuelve el N-ésimo día hábil del mes (1-indexed) en formato ISO `YYYY-MM-DD`.
 * Sábados, domingos y festivos colombianos no cuentan.
 *
 * @throws si `n` excede los días hábiles disponibles en el mes, o si el
 *         (año, mes) pedido no tiene set de festivos verificado.
 */
export function nthBusinessDay(year: number, month: number, n: number): string {
  if (!tieneFestivosVerificados(year, month)) {
    throw new Error(
      `Sin calendario de festivos verificado para ${year}-${String(month).padStart(2, '0')}: ` +
        'no se puede calcular un día hábil sin inventar la fecha.',
    );
  }
  const d = new Date(Date.UTC(year, month - 1, 1));
  let count = 0;
  while (d.getUTCMonth() === month - 1) {
    if (isBusinessDay(d)) {
      count++;
      if (count === n) return d.toISOString().slice(0, 10);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  throw new Error(`No hay ${n} días hábiles en ${year}-${month}`);
}

/**
 * Convierte el dígito de NIT al día hábil del mes según convención DIAN.
 *
 * Decreto 2229/2023 (compilado en el DUR 1625/2016), arts. 1.6.1.13.2.12 y
 * 1.6.1.13.2.33: dígito 1 = 7º hábil, dígito 2 = 8º, …, dígito 9 = 15º,
 * dígito 0 = 16º (último). Vence en orden ascendente.
 * https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
 *
 * FUENTE ÚNICA. `src/data/calendars/nacional-2026.ts` tenía su propia copia de
 * esta regla, invertida, y de ahí salían todos los vencimientos del calendario
 * nacional. Cualquier consumidor nuevo importa esta función; no la reimplementa.
 */
export function digitToBusinessDay(digit: number): number {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new Error(`Dígito NIT inválido: ${digit}`);
  }
  return digit === 0 ? 16 : digit + 6;
}

interface ScrapedSource {
  text: string;
  url: string;
  source: 'dian-comunicado' | 'dian-pdf';
  hash: string;
}

async function fetchComunicadoHTML(): Promise<ScrapedSource | null> {
  try {
    const res = await fetch(COMUNICADO_URL, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      console.warn('[scraper] HTML fetch non-OK status:', res.status);
      return null;
    }
    const html = await res.text();
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    // El comunicado vive dentro del <body>; quitamos scripts/styles/nav.
    $('script, style, noscript, nav, header, footer').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    if (text.length < 500) {
      console.warn('[scraper] HTML body suspiciously short:', text.length);
      return null;
    }
    const hash = createHash('sha256').update(text).digest('hex');
    return { text, url: COMUNICADO_URL, source: 'dian-comunicado', hash };
  } catch (err) {
    console.error('[scraper] HTML fetch failed:', err);
    return null;
  }
}

async function fetchCalendarPDF(): Promise<ScrapedSource | null> {
  try {
    const res = await fetch(PDF_URL, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      console.warn('[scraper] PDF fetch non-OK status:', res.status);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // pdf-parse v2 expone la clase `PDFParse`. Misma API que usamos en /api/upload.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    const text = (result.text ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 500) {
      console.warn('[scraper] PDF text suspiciously short:', text.length);
      return null;
    }
    const hash = createHash('sha256').update(text).digest('hex');
    return { text, url: PDF_URL, source: 'dian-pdf', hash };
  } catch (err) {
    console.error('[scraper] PDF fetch failed:', err);
    return null;
  }
}

// ── Builders por tributo ─────────────────────────────────────────────

/**
 * Construye 10 entries (uno por dígito NIT 0–9) para una obligación que
 * vence en el rango día 7°–16° hábil de un mes específico.
 */
function buildRange(
  obligation: string,
  period: string,
  legalBasis: string,
  year: number,
  month: number,
  notes: string = COMUNICADO_NOTE,
): NationalDeadline[] {
  return Array.from({ length: 10 }, (_, i) => {
    const digit = i;
    const businessDay = digitToBusinessDay(digit);
    return {
      obligation,
      period,
      nitDigit: digit,
      dueDate: nthBusinessDay(year, month, businessDay),
      legalBasis,
      notes,
      // Fecha DERIVADA del modelo interno de días hábiles, no leída de la tabla
      // oficial. `verified: true` significaría "confrontada contra el decreto";
      // marcarla así suprimía el disclaimer aguas abajo (tax-calendar imprime
      // "verificadas contra decreto oficial") sobre fechas que este archivo
      // calcula. Ver el bloque ⚠ PROCEDENCIA del encabezado.
      verified: false,
    } satisfies NationalDeadline;
  });
}

/** Renta Personas Jurídicas — declaración + 1ª cuota: mayo 2026 (12–26 may). */
function buildRentaPJDecl(): NationalDeadline[] {
  return buildRange(
    'Declaración Renta — Personas Jurídicas',
    'AG 2025 — Declaración + Cuota 1',
    `${DECREE}, Art. 591 E.T.`,
    2026,
    5,
  );
}

/** Renta PJ — 2ª cuota: julio 2026 (9–23 jul). */
function buildRentaPJCuota2(): NationalDeadline[] {
  return buildRange(
    'Declaración Renta — Personas Jurídicas',
    'AG 2025 — Cuota 2',
    `${DECREE}, Art. 591 E.T.`,
    2026,
    7,
  );
}

/** Grandes Contribuyentes — Cuota 1: febrero (10–23 feb). */
function buildGCCuota1(): NationalDeadline[] {
  return buildRange(
    'Renta Grandes Contribuyentes — Cuota 1',
    'AG 2025 — Anticipo',
    `${DECREE}, Art. 591 E.T.`,
    2026,
    2,
  );
}

/** Grandes Contribuyentes — Declaración + Cuota 2: abril (13–24 abr). */
function buildGCDeclCuota2(): NationalDeadline[] {
  return buildRange(
    'Renta Grandes Contribuyentes — Declaración + Cuota 2',
    'AG 2025',
    `${DECREE}, Art. 591 E.T.`,
    2026,
    4,
  );
}

/** Grandes Contribuyentes — Cuota 3: junio (10–24 jun). */
function buildGCCuota3(): NationalDeadline[] {
  return buildRange(
    'Renta Grandes Contribuyentes — Cuota 3',
    'AG 2025 — Cuota final',
    `${DECREE}, Art. 591 E.T.`,
    2026,
    6,
  );
}

/**
 * Tabla oficial de renta de personas naturales y sucesiones ilíquidas AG 2025,
 * por los DOS ÚLTIMOS dígitos del NIT (sin dígito de verificación).
 *
 * Art. 1.6.1.13.2.15 del DUR 1625 de 2016 modificado por el Decreto 2229 de
 * 2023; art. 592 E.T. Los 50 grupos van en orden ASCENDENTE: 01-02 vence
 * PRIMERO (12-ago-2026) y 99-00 ÚLTIMO (26-oct-2026).
 *
 * Verificación cruzada: los 50 grupos consumen exactamente los días hábiles
 * del 12-ago al 28-sep (33) más todos los de octubre (17) — el calendario
 * oficial no usa el 29 ni el 30 de septiembre. Los festivos descontados
 * (17-ago Asunción, 12-oct Día de la Raza) cuadran con la Ley 51 de 1983.
 *
 * ⚠ Auditoría normativa 2026-08 — esta tabla estaba INVERTIDA en el repo:
 * la banda 90-99 figuraba en agosto y la 00-09 en octubre. A un declarante
 * con cédula terminada en 01-09 se le anunciaba el 26-oct-2026 cuando su
 * plazo real vencía en agosto: más de dos meses de extemporaneidad
 * (sanción Art. 641 E.T., 5% mensual con mínimo 10 UVT).
 */
const RENTA_PN_2026_POR_DOS_DIGITOS: ReadonlyArray<readonly [desde: number, hasta: number, iso: string]> = [
  [1, 2, '2026-08-12'], [3, 4, '2026-08-13'], [5, 6, '2026-08-14'],
  [7, 8, '2026-08-18'], [9, 10, '2026-08-19'], [11, 12, '2026-08-20'],
  [13, 14, '2026-08-21'], [15, 16, '2026-08-24'], [17, 18, '2026-08-25'],
  [19, 20, '2026-08-26'], [21, 22, '2026-08-27'], [23, 24, '2026-08-28'],
  [25, 26, '2026-08-31'], [27, 28, '2026-09-01'], [29, 30, '2026-09-02'],
  [31, 32, '2026-09-03'], [33, 34, '2026-09-04'], [35, 36, '2026-09-07'],
  [37, 38, '2026-09-08'], [39, 40, '2026-09-09'], [41, 42, '2026-09-10'],
  [43, 44, '2026-09-11'], [45, 46, '2026-09-14'], [47, 48, '2026-09-15'],
  [49, 50, '2026-09-16'], [51, 52, '2026-09-17'], [53, 54, '2026-09-18'],
  [55, 56, '2026-09-21'], [57, 58, '2026-09-22'], [59, 60, '2026-09-23'],
  [61, 62, '2026-09-24'], [63, 64, '2026-09-25'], [65, 66, '2026-09-28'],
  [67, 68, '2026-10-01'], [69, 70, '2026-10-02'], [71, 72, '2026-10-05'],
  [73, 74, '2026-10-06'], [75, 76, '2026-10-07'], [77, 78, '2026-10-08'],
  [79, 80, '2026-10-09'], [81, 82, '2026-10-13'], [83, 84, '2026-10-14'],
  [85, 86, '2026-10-15'], [87, 88, '2026-10-16'], [89, 90, '2026-10-19'],
  [91, 92, '2026-10-20'], [93, 94, '2026-10-21'], [95, 96, '2026-10-22'],
  [97, 98, '2026-10-23'], [99, 0, '2026-10-26'],
];

/**
 * Fecha oficial de renta PN para unos dos últimos dígitos concretos (0–99).
 * El último grupo es `99-00`, así que el 00 se trata aparte.
 */
export function rentaPNPorDosDigitos(dosDigitos: number): string {
  if (!Number.isInteger(dosDigitos) || dosDigitos < 0 || dosDigitos > 99) {
    throw new Error(`Dos últimos dígitos inválidos: ${dosDigitos}`);
  }
  for (const [desde, hasta, iso] of RENTA_PN_2026_POR_DOS_DIGITOS) {
    if (hasta < desde) {
      // Grupo envolvente 99-00.
      if (dosDigitos >= desde || dosDigitos <= hasta) return iso;
      continue;
    }
    if (dosDigitos >= desde && dosDigitos <= hasta) return iso;
  }
  throw new Error(`Sin fecha de renta PN para los dos últimos dígitos ${dosDigitos}`);
}

/**
 * Comprime una tabla indexada por los DOS últimos dígitos del NIT al shape
 * `nitDigit: 0–9` de `NationalDeadline`, devolviendo la fecha MÁS TEMPRANA
 * compatible con ese último dígito.
 *
 * Un solo dígito no determina el plazo, así que hay que elegir un
 * representante. La elección no es simétrica: publicar una fecha ANTERIOR a la
 * legal sólo adelanta la presentación; publicar una POSTERIOR produce
 * extemporaneidad (Art. 641 / Art. 651 E.T.). Por eso siempre el mínimo.
 */
export function fechaMasTempranaPorUltimoDigito(
  ultimoDigito: number,
  lookup: (dosDigitos: number) => string,
): string {
  if (!Number.isInteger(ultimoDigito) || ultimoDigito < 0 || ultimoDigito > 9) {
    throw new Error(`Último dígito inválido: ${ultimoDigito}`);
  }
  const fechas = Array.from({ length: 10 }, (_, decena) => lookup(decena * 10 + ultimoDigito));
  return fechas.slice().sort()[0]!;
}

/** Renta Personas Naturales comprimida al shape `nitDigit: 0–9`. */
function buildRentaPN(): NationalDeadline[] {
  return Array.from({ length: 10 }, (_, digit) => ({
    obligation: 'Declaración Renta — Personas Naturales',
    period: 'AG 2025',
    nitDigit: digit,
    dueDate: fechaMasTempranaPorUltimoDigito(digit, rentaPNPorDosDigitos),
    legalBasis: `${DECREE}, Art. 592 E.T.`,
    notes:
      'El plazo lo fijan los DOS últimos dígitos del NIT (sin DV), del ' +
      '12-ago-2026 (01-02) al 26-oct-2026 (99-00). Se publica la fecha más ' +
      'temprana compatible con este último dígito; confirme la suya en la ' +
      'tabla de la Res. Única DIAN 000227 de 2025.',
    verified: false,
  } satisfies NationalDeadline));
}

/** IVA Bimestral B1–B6 — un mes por bimestre + ajuste para B6 (ene 2027). */
function buildIVABimestral(): NationalDeadline[] {
  const bimestres: Array<{ b: number; period: string; year: number; month: number }> = [
    { b: 1, period: 'Bimestre 1 (Ene-Feb 2026)', year: 2026, month: 3 },
    { b: 2, period: 'Bimestre 2 (Mar-Abr 2026)', year: 2026, month: 5 },
    { b: 3, period: 'Bimestre 3 (May-Jun 2026)', year: 2026, month: 7 },
    { b: 4, period: 'Bimestre 4 (Jul-Ago 2026)', year: 2026, month: 9 },
    { b: 5, period: 'Bimestre 5 (Sep-Oct 2026)', year: 2026, month: 11 },
    { b: 6, period: 'Bimestre 6 (Nov-Dic 2026)', year: 2027, month: 1 },
  ];
  return bimestres.flatMap(({ period, year, month }) =>
    buildRange(
      'IVA Bimestral',
      period,
      `${DECREE}, Art. 600 E.T.`,
      year,
      month,
    ),
  );
}

/** IVA Cuatrimestral C1–C3. */
function buildIVACuatrimestral(): NationalDeadline[] {
  const cuatris: Array<{ c: number; period: string; year: number; month: number }> = [
    { c: 1, period: 'Cuatrimestre 1 (Ene-Abr 2026)', year: 2026, month: 5 },
    { c: 2, period: 'Cuatrimestre 2 (May-Ago 2026)', year: 2026, month: 9 },
    { c: 3, period: 'Cuatrimestre 3 (Sep-Dic 2026)', year: 2027, month: 1 },
  ];
  return cuatris.flatMap(({ period, year, month }) =>
    buildRange(
      'IVA Cuatrimestral',
      period,
      `${DECREE}, Art. 600 E.T.`,
      year,
      month,
    ),
  );
}

/**
 * Información Exógena AG 2025 — Res. Única DIAN 000227 del 23-sep-2025,
 * Título 3 (compila Res. 000162 de 2023 y Res. 000188 de 2024), modificada por
 * la Res. DIAN 000233 de 2025.
 *
 * ⚠ Auditoría normativa 2026-08 — el repo la generaba en SEPTIEMBRE de 2026
 * (7°–16° día hábil). Dos errores en uno:
 *   1. La exógena NO sigue la regla del 7°–16° día hábil; tiene tabla propia.
 *   2. Los plazos reales terminan el 12-jun-2026, casi tres meses ANTES.
 * Anunciar septiembre expone al contribuyente a la sanción del Art. 651 E.T.
 * (hasta 15.000 UVT) más el desconocimiento de costos y deducciones.
 *
 * Fuentes: https://actualicese.com/plazos-para-reportar-informacion-exogena-en-2026/
 *          https://siemprealdia.co/colombia/impuestos/resolucion-000012-de-2026-cambios-en-exogena/
 */

/**
 * Grandes contribuyentes — por ÚLTIMO dígito del NIT (sin DV).
 * Se publican los plazos ORIGINALES de la Res. 000227 de 2025. La Res. DIAN
 * 000012 del 29-abr-2026 prorrogó únicamente los dígitos 1, 2 y 3 al 14, 15 y
 * 19 de mayo de 2026; no la aplicamos como fecha base porque una prórroga
 * posterior sólo puede ampliar, y publicar la fecha temprana nunca sanciona.
 *
 * Dígito 3: las fuentes secundarias discrepan (30-abr vs 4-may). Se usa la más
 * temprana, 30-abr-2026, por el mismo criterio.
 */
export const EXOGENA_GC_2026: Readonly<Record<number, string>> = {
  1: '2026-04-28',
  2: '2026-04-29',
  3: '2026-04-30',
  4: '2026-05-05',
  5: '2026-05-06',
  6: '2026-05-07',
  7: '2026-05-08',
  8: '2026-05-11',
  9: '2026-05-12',
  0: '2026-05-13',
};

/**
 * Personas jurídicas y naturales — por los DOS ÚLTIMOS dígitos del NIT, en
 * grupos de cinco y en orden ASCENDENTE (01-05 primero, 96-00 último).
 */
const EXOGENA_PJPN_2026: ReadonlyArray<readonly [desde: number, hasta: number, iso: string]> = [
  [1, 5, '2026-05-14'], [6, 10, '2026-05-15'], [11, 15, '2026-05-19'],
  [16, 20, '2026-05-20'], [21, 25, '2026-05-21'], [26, 30, '2026-05-22'],
  [31, 35, '2026-05-25'], [36, 40, '2026-05-26'], [41, 45, '2026-05-27'],
  [46, 50, '2026-05-28'], [51, 55, '2026-05-29'], [56, 60, '2026-06-01'],
  [61, 65, '2026-06-02'], [66, 70, '2026-06-03'], [71, 75, '2026-06-04'],
  [76, 80, '2026-06-05'], [81, 85, '2026-06-09'], [86, 90, '2026-06-10'],
  [91, 95, '2026-06-11'], [96, 0, '2026-06-12'],
];

/** Fecha de exógena PJ/PN para unos dos últimos dígitos concretos (0–99). */
export function exogenaPJPNPorDosDigitos(dosDigitos: number): string {
  if (!Number.isInteger(dosDigitos) || dosDigitos < 0 || dosDigitos > 99) {
    throw new Error(`Dos últimos dígitos inválidos: ${dosDigitos}`);
  }
  for (const [desde, hasta, iso] of EXOGENA_PJPN_2026) {
    if (hasta < desde) {
      if (dosDigitos >= desde || dosDigitos <= hasta) return iso;
      continue;
    }
    if (dosDigitos >= desde && dosDigitos <= hasta) return iso;
  }
  throw new Error(`Sin fecha de exógena para los dos últimos dígitos ${dosDigitos}`);
}

const EXOGENA_LEGAL_BASIS =
  'Res. Única DIAN 000227 de 2025 (Título 3), modif. Res. 000233 de 2025; Arts. 623-631 E.T.';

function buildExogena(): NationalDeadline[] {
  const gc: NationalDeadline[] = Array.from({ length: 10 }, (_, digit) => ({
    obligation: 'Información Exógena — Grandes Contribuyentes',
    period: 'AG 2025',
    nitDigit: digit,
    dueDate: EXOGENA_GC_2026[digit]!,
    legalBasis: EXOGENA_LEGAL_BASIS,
    notes:
      'Por ÚLTIMO dígito del NIT sin DV. La Res. DIAN 000012 del 29-abr-2026 ' +
      'prorrogó los dígitos 1, 2 y 3 al 14, 15 y 19 de mayo de 2026.',
    verified: false,
  } satisfies NationalDeadline));

  // El plazo de PJ/PN depende de los DOS últimos dígitos; comprimido al shape
  // `nitDigit` publicamos la fecha más temprana de la banda (nunca posterior
  // a la legal). Ver el mismo criterio en `buildRentaPN`.
  const pjpn: NationalDeadline[] = Array.from({ length: 10 }, (_, digit) => {
    return {
      obligation: 'Información Exógena — Personas Jurídicas y Naturales',
      period: 'AG 2025',
      nitDigit: digit,
      dueDate: fechaMasTempranaPorUltimoDigito(digit, exogenaPJPNPorDosDigitos),
      legalBasis: EXOGENA_LEGAL_BASIS,
      notes:
        'El plazo lo fijan los DOS últimos dígitos del NIT (sin DV), del ' +
        '14-may-2026 (01-05) al 12-jun-2026 (96-00). Se publica la fecha más ' +
        'temprana compatible con este último dígito; confirme la suya en la tabla.',
      verified: false,
    } satisfies NationalDeadline;
  });

  return [...gc, ...pjpn];
}

/** Impuesto al Patrimonio — Declaración + Cuota 1: mayo 2026 (12–26 may). */
function buildPatrimonioDecl(): NationalDeadline[] {
  return buildRange(
    'Impuesto al Patrimonio — Declaración + Cuota 1',
    '2026',
    `${DECREE}, Art. 292-3 E.T.`,
    2026,
    5,
  );
}

/**
 * Impuesto al Patrimonio — Cuota 2: 14 sep 2026 (10° día hábil de sep,
 * fecha fija sin diferenciación por dígito NIT). Generamos 10 entries
 * con la MISMA fecha para mantener uniformidad de shape (consultas por
 * `nitDigit` siempre devuelven 1 row para esta obligación).
 */
function buildPatrimonioCuota2(): NationalDeadline[] {
  const dueDate = nthBusinessDay(2026, 9, 10);
  return Array.from({ length: 10 }, (_, digit) => ({
    obligation: 'Impuesto al Patrimonio — Cuota 2',
    period: '2026',
    nitDigit: digit,
    dueDate,
    legalBasis: `${DECREE}, Art. 292-3 E.T.`,
    notes: `${COMUNICADO_NOTE} — Fecha única (10° día hábil de septiembre)`,
    // Derivada de `nthBusinessDay`, no leída de la tabla oficial. Ver ⚠ PROCEDENCIA.
    verified: false,
  } satisfies NationalDeadline));
}

/**
 * Retención en la Fuente mensual — día 7°–16° hábil del mes SIGUIENTE
 * al período. Cubrimos los 12 períodos de 2026:
 *   - Ene 2026 vence en febrero
 *   - Feb 2026 vence en marzo
 *   - …
 *   - Dic 2026 vence en enero 2027
 */
function buildRetencion(): NationalDeadline[] {
  const months: Array<{ name: string; dueYear: number; dueMonth: number }> = [
    { name: 'Enero 2026', dueYear: 2026, dueMonth: 2 },
    { name: 'Febrero 2026', dueYear: 2026, dueMonth: 3 },
    { name: 'Marzo 2026', dueYear: 2026, dueMonth: 4 },
    { name: 'Abril 2026', dueYear: 2026, dueMonth: 5 },
    { name: 'Mayo 2026', dueYear: 2026, dueMonth: 6 },
    { name: 'Junio 2026', dueYear: 2026, dueMonth: 7 },
    { name: 'Julio 2026', dueYear: 2026, dueMonth: 8 },
    { name: 'Agosto 2026', dueYear: 2026, dueMonth: 9 },
    { name: 'Septiembre 2026', dueYear: 2026, dueMonth: 10 },
    { name: 'Octubre 2026', dueYear: 2026, dueMonth: 11 },
    { name: 'Noviembre 2026', dueYear: 2026, dueMonth: 12 },
    { name: 'Diciembre 2026', dueYear: 2027, dueMonth: 1 },
  ];
  return months.flatMap(({ name, dueYear, dueMonth }) =>
    buildRange(
      'Retención en la Fuente',
      name,
      `${DECREE}, Art. 382 E.T.`,
      dueYear,
      dueMonth,
    ),
  );
}

// ── API pública ──────────────────────────────────────────────────────

export interface ScrapeResult {
  deadlines: NationalDeadline[];
  source: 'dian-comunicado' | 'dian-pdf';
  sourceUrl: string;
  hash: string;
}

/**
 * Calendario nacional 2026 completo, sin I/O. Es la parte del scraper que
 * realmente produce las fechas: `scrapeDIANCalendar` sólo le antepone la
 * validación de que la fuente oficial sigue viva. Se exporta para poder
 * auditar la procedencia (`verified`) sin salir a la red.
 */
export function buildDeadlines2026(): NationalDeadline[] {
  return [
    ...buildGCCuota1(),
    ...buildGCDeclCuota2(),
    ...buildGCCuota3(),
    ...buildRentaPJDecl(),
    ...buildRentaPJCuota2(),
    ...buildRentaPN(),
    ...buildIVABimestral(),
    ...buildIVACuatrimestral(),
    ...buildExogena(),
    ...buildPatrimonioDecl(),
    ...buildPatrimonioCuota2(),
    ...buildRetencion(),
  ];
}

/**
 * Ejecuta el scraping del calendario DIAN para `year`. Devuelve `null`
 * si la fuente oficial no responde o cambió su formato (en cuyo caso
 * el cron debe alertar y NO sobreescribir el snapshot existente).
 *
 * Solo soportado para 2026 (Comunicado 128/2025). Años futuros requieren
 * añadir el comunicado equivalente y el set de festivos correspondiente.
 */
export async function scrapeDIANCalendar(
  year: number,
): Promise<ScrapeResult | null> {
  if (year !== 2026) {
    console.warn(
      `[scraper] Solo soportado año 2026 (Comunicado 128/2025). Recibido: ${year}`,
    );
    return null;
  }

  const source = (await fetchComunicadoHTML()) ?? (await fetchCalendarPDF());
  if (!source) {
    console.error('[scraper] Ambas fuentes (HTML + PDF) fallaron.');
    return null;
  }

  // Heurística de validación: el texto fuente debe contener al menos 2 de
  // 3 keywords esperadas. Si DIAN reorganiza drásticamente el comunicado,
  // preferimos retornar null antes que generar fechas en blanco.
  const expectedKeywords = ['calendario tributario', '2026', 'día hábil'];
  const lower = source.text.toLowerCase();
  const matched = expectedKeywords.filter((k) => lower.includes(k)).length;
  if (matched < 2) {
    console.warn(
      `[scraper] Fuente ${source.source} no contiene keywords esperadas ` +
        `(matched=${matched}/3). Posible cambio de formato — abortando.`,
    );
    return null;
  }

  return {
    deadlines: buildDeadlines2026(),
    source: source.source,
    sourceUrl: source.url,
    hash: source.hash,
  };
}
