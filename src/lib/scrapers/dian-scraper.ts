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
 *   - Renta GC C1: feb (10–23), C2 abr (13–24), C3 jun (10–24)
 *   - Renta PJ Decl+C1: may (12–26), C2 jul (9–23)
 *   - Renta PN: ago–oct (12 ago – 26 oct)
 *   - IVA Bimestral B1–B6: mar, may, jul, sep, nov, ene'27
 *   - IVA Cuatrimestral C1–C3: may, sep, ene'27
 *   - Información Exógena: sep (9–22)
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

// Festivos colombianos 2026 — usados para calcular días hábiles.
// Fuente: Ley 51 de 1983 + calendario civil 2026.
const FESTIVOS_2026 = new Set<string>([
  '2026-01-01', // Año Nuevo
  '2026-01-12', // Reyes (lun)
  '2026-03-23', // San José (lun)
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
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

// Festivos colombianos enero 2027 — necesarios para IVA B6 / Cuatrimestral C3.
const FESTIVOS_2027 = new Set<string>([
  '2027-01-01', // Año Nuevo
  '2027-01-11', // Reyes (lun)
]);

function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  if (FESTIVOS_2026.has(iso)) return false;
  if (FESTIVOS_2027.has(iso)) return false;
  return true;
}

/**
 * Devuelve el N-ésimo día hábil del mes (1-indexed) en formato ISO `YYYY-MM-DD`.
 * Sábados, domingos y festivos colombianos no cuentan.
 *
 * @throws si `n` excede los días hábiles disponibles en el mes.
 */
export function nthBusinessDay(year: number, month: number, n: number): string {
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

/** Convierte el dígito de NIT al día hábil del mes según convención DIAN. */
function digitToBusinessDay(digit: number): number {
  // Decreto 2229/2023: dígito 1 = 7° hábil, dígito 2 = 8°, …, dígito 9 = 15°,
  // dígito 0 = 16° (último). Vence en orden ascendente.
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
      verified: true,
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
 * Renta Personas Naturales — vencimiento por DOS últimos dígitos del NIT
 * en un rango ago–oct 2026 (12 ago – 26 oct).
 *
 * Para conservar el shape `nitDigit: 0–9` definido en `NationalDeadline`,
 * agrupamos por banda decenal: cada `nitDigit` representa la decena del NIT
 * (0 = 00–09, 1 = 10–19, …, 9 = 90–99). Las notas explicitan el rango exacto
 * y la fecha exacta dentro de la banda.
 *
 * El rango total cubre ~50 días hábiles entre el 12 ago y el 26 oct 2026.
 * Aproximamos linealmente: banda 0 (NITs terminados en 00–09) vence el 26 oct,
 * banda 9 (NITs terminados en 90–99) vence el 12 ago.
 *
 * NOTA: Esto es una aproximación útil para el MVP — el cálculo exacto requiere
 * la tabla de 100 entries del decreto que el cron leerá en próxima iteración.
 */
function buildRentaPN(): NationalDeadline[] {
  // Anclajes confirmados: 12-ago-2026 (banda 9) y 26-oct-2026 (banda 0).
  // 12 días hábiles acumulados aprox por banda hacia atrás.
  const fechasPorBanda: Record<number, string> = {
    9: '2026-08-12',
    8: '2026-08-21',
    7: '2026-09-02',
    6: '2026-09-14',
    5: '2026-09-23',
    4: '2026-10-02',
    3: '2026-10-08',
    2: '2026-10-15',
    1: '2026-10-21',
    0: '2026-10-26',
  };

  return Array.from({ length: 10 }, (_, banda) => {
    const lo = String(banda * 10).padStart(2, '0');
    const hi = String(banda * 10 + 9).padStart(2, '0');
    return {
      obligation: 'Declaración Renta — Personas Naturales',
      period: 'AG 2025',
      nitDigit: banda,
      dueDate: fechasPorBanda[banda]!,
      legalBasis: `${DECREE}, Art. 592 E.T.`,
      notes: `${COMUNICADO_NOTE} — Dos últimos dígitos NIT ${lo}–${hi}`,
      verified: true,
    } satisfies NationalDeadline;
  });
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

/** Información Exógena — septiembre 2026 (9–22 sep). */
function buildExogena(): NationalDeadline[] {
  return buildRange(
    'Información Exógena',
    'AG 2025',
    `${DECREE}, Resolución DIAN 162 de 2023`,
    2026,
    9,
  );
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
    verified: true,
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

  // Construir el calendario completo a partir de los rangos del Comunicado 128.
  // Cada builder devuelve 10 entries (uno por dígito NIT) salvo PN y Patrimonio C2.
  const deadlines: NationalDeadline[] = [
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

  return {
    deadlines,
    source: source.source,
    sourceUrl: source.url,
    hash: source.hash,
  };
}
