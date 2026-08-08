import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dict } from '../dictionaries';

/**
 * Guard de i18n de la superficie de intake.
 *
 * Modo de fallo que cierra: los 5 wizards de intake (+ el chasis StepWizard,
 * la vista previa y el modal) nacieron con TODO el copy hardcodeado en
 * español. Con `language === 'en'` el usuario veía una pantalla en español y
 * —peor— el lector de pantalla anunciaba en español los `aria-label` de
 * navegación del wizard. Un componente puede volver a caer en eso sin que
 * `tsc` ni ESLint digan nada, porque un literal JSX siempre compila.
 *
 * Estrategia: no hay jsdom/testing-library en este repo (vitest corre en
 * `environment: 'node'`), así que el guard es de CÓDIGO FUENTE, no de render:
 *   1. cada archivo de la superficie debe estar cableado al diccionario;
 *   2. ningún literal ni texto JSX de esos archivos puede contener castellano.
 *
 * Lo que SÍ puede quedar en castellano está en `LITERALES_PERMITIDOS`: son
 * palabras clave de OCR que se comparan contra el texto extraído del documento
 * del contribuyente (siempre en español, porque los actos de la DIAN lo están).
 * Traducirlas rompería la detección, no la arreglaría.
 */

const RAIZ = new URL('../../../', import.meta.url);

function fuente(rutaRelativa: string): string {
  return readFileSync(fileURLToPath(new URL(rutaRelativa, RAIZ)), 'utf8');
}

/** Archivos de la superficie de intake que deben estar 100% cableados a i18n. */
const SUPERFICIE: Array<{ nombre: string; ruta: string }> = [
  { nombre: 'StepWizard', ruta: 'design-system/components/StepWizard.tsx' },
  { nombre: 'IntakePreview', ruta: 'components/workspace/intake/IntakePreview.tsx' },
  { nombre: 'IntakeModal', ruta: 'components/workspace/intake/IntakeModal.tsx' },
  { nombre: 'DianDefenseIntake', ruta: 'components/workspace/intake/DianDefenseIntake.tsx' },
  { nombre: 'TaxRefundIntake', ruta: 'components/workspace/intake/TaxRefundIntake.tsx' },
  { nombre: 'DueDiligenceIntake', ruta: 'components/workspace/intake/DueDiligenceIntake.tsx' },
  { nombre: 'FinancialIntelIntake', ruta: 'components/workspace/intake/FinancialIntelIntake.tsx' },
  { nombre: 'GenericPipelineIntake', ruta: 'components/workspace/intake/GenericPipelineIntake.tsx' },
];

/**
 * Literales que se comparan contra el texto OCR del documento subido. Van en
 * español porque el documento origen (requerimiento DIAN, liquidación oficial)
 * está en español sin importar el idioma de la interfaz.
 */
const LITERALES_PERMITIDOS = new Set<string>([
  'pliego de cargos',
  'liquidacion oficial',
  'liquidacion de revision',
]);

/** Marcadores de ortografía castellana: si aparecen, el texto es copy en español. */
const DIACRITICOS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;

/**
 * Palabras funcionales del castellano. Se buscan con frontera de palabra para
 * no disparar con clases de Tailwind (`border-n-200`) ni con rutas de import.
 * `y` y `o` quedan FUERA a propósito: en JS `-` no es carácter de palabra, así
 * que `overflow-y-auto` haría match de `\by\b` y el guard gritaría sobre una
 * clase CSS. El detector es un piso, no un techo: no pretende cazar cada
 * cadena (p. ej. "Documento" no lleva ni tilde ni palabra función), pero sí
 * cualquier frase de copy real.
 */
const PALABRAS_FUNCION =
  /\b(el|la|los|las|un|una|unos|unas|del|de|su|sus|con|para|por|que|desde|hasta|sin|sobre|ante|este|esta|estos|estas|cada|ya|aun|mas|segun|en|al)\b/i;

function esCastellano(texto: string): boolean {
  const limpio = texto.trim();
  if (limpio.length < 3) return false;
  if (LITERALES_PERMITIDOS.has(limpio.toLowerCase())) return false;
  // Un literal sin espacios ni acentos es casi siempre una clase CSS, un
  // import, un enum o un id — no copy.
  if (DIACRITICOS.test(limpio)) return true;
  if (!limpio.includes(' ')) return false;
  return PALABRAS_FUNCION.test(limpio);
}

/** Literales de cadena (comillas simples y dobles) presentes en el archivo. */
function literales(src: string): string[] {
  const salida: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    salida.push(m[1] ?? m[2] ?? '');
  }
  return salida;
}

/**
 * Los comentarios de bloque de este repo van en español por convención — no son
 * copy de interfaz. Se eliminan antes de buscar texto JSX o el guard se
 * autoinculparía con sus propios `// ─── Step 2: Tipo de Acto ───`.
 */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Texto plano entre etiquetas JSX (`<p>Cargue su documento</p>`). */
function textosJsx(src: string): string[] {
  const salida: string[] = [];
  const limpio = sinComentarios(src);
  const re = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio)) !== null) {
    // Un `;` o un `=` delatan que el match saltó de una expresión a otra y
    // arrastró código, no un nodo de texto.
    if (/[;=]/.test(m[1])) continue;
    salida.push(m[1]);
  }
  return salida;
}

describe('intake — i18n de la superficie', () => {
  it.each(SUPERFICIE)('$nombre está cableado al diccionario', ({ ruta }) => {
    const src = fuente(ruta);
    expect(src).toContain('useLanguage');
    expect(src).toMatch(/from '@\/lib\/i18n\/dictionaries'/);
  });

  it.each(SUPERFICIE)('$nombre no tiene copy en español hardcodeado', ({ ruta }) => {
    const src = fuente(ruta);
    const sospechosos = [...literales(src), ...textosJsx(src)]
      .filter(esCastellano)
      .map((s) => s.trim());
    expect([...new Set(sospechosos)]).toEqual([]);
  });
});

describe('intake — bloque compartido del diccionario', () => {
  /**
   * 27 cadenas se repetían en 2..5 wizards ("Cargue su documento" x5,
   * "Auto-detectado" x5). Sin un bloque común, traducir wizard por wizard
   * produce 5 copias que divergen en la primera corrección de copy.
   */
  const COMPARTIDAS = [
    'uploadTitle',
    'uploadAnother',
    'uploading',
    'extracting',
    'retry',
    'dropzoneLabel',
    'manualFill',
    'fieldsDetected',
    'fieldsAutoDetected',
    'confHigh',
    'confMedium',
    'confHighShort',
    'confMediumShort',
    'accountsDetected',
    'equationLabel',
    'equationValid',
    'equationInvalid',
    'supportDocsTitle',
    'fileTypesHint',
    'optional',
    'companyName',
    'entityType',
    'niifGroup',
    'periodFrom',
    'periodTo',
    'stepDocument',
    'stepPreview',
  ] as const;

  it('intake.common existe en ambos idiomas con las 27 claves compartidas', () => {
    for (const idioma of ['es', 'en'] as const) {
      const comun = dict[idioma].intake.common as Record<string, string>;
      for (const clave of COMPARTIDAS) {
        expect(typeof comun[clave], `${idioma}.intake.common.${clave}`).toBe('string');
        expect(comun[clave].length).toBeGreaterThan(0);
      }
    }
  });

  it('el copy compartido está traducido, no duplicado', () => {
    expect(dict.es.intake.common.uploadTitle).not.toBe(dict.en.intake.common.uploadTitle);
    expect(dict.es.intake.common.confHigh).not.toBe(dict.en.intake.common.confHigh);
    expect(dict.es.intake.common.manualFill).not.toBe(dict.en.intake.common.manualFill);
  });

  it('los contadores compartidos conservan sus marcadores {n} y {total}', () => {
    for (const idioma of ['es', 'en'] as const) {
      for (const clave of ['fieldsDetected', 'fieldsAutoDetected'] as const) {
        const valor = dict[idioma].intake.common[clave];
        expect(valor, `${idioma}.${clave}`).toContain('{n}');
        expect(valor, `${idioma}.${clave}`).toContain('{total}');
      }
    }
  });
});

describe('intake — paridad de las LISTAS del diccionario', () => {
  /**
   * Agujero real de `dictionaries-parity.test.ts`: su `rutas()` recorre objetos
   * pero trata un Array como HOJA (`!Array.isArray(v)`), así que sólo compara la
   * ruta `intake.pipelines.X.agents` — nunca su longitud ni su contenido. Hasta
   * este bloque, la superficie de intake introdujo las primeras listas del
   * diccionario (6 `agents` + `dueDiligence.checklist`) y ninguna estaba cubierta.
   *
   * Modo de fallo que cierra: borrar un agente de la entrada inglesa deja el
   * pipeline en inglés mostrando 2 agentes donde el español muestra 3, y una
   * cadena vacía renderiza como un renglón en blanco. Ni `tsc` (la longitud de
   * un `string[]` no viaja en el tipo) ni el guard de paridad ni el escáner de
   * fuente lo ven: se verificó sabotéandolo y los cuatro seguían en verde.
   *
   * Se recorre el diccionario ENTERO, no sólo `intake`: el agujero es del
   * walker, no del bloque, y `services.*_bullets` corría el mismo riesgo.
   */
  type Nodo = Record<string, unknown>;

  function listas(o: Nodo, prefijo = '', acc: Map<string, unknown[]> = new Map()) {
    for (const [k, v] of Object.entries(o)) {
      const ruta = prefijo ? `${prefijo}.${k}` : k;
      if (Array.isArray(v)) acc.set(ruta, v);
      else if (v && typeof v === 'object') listas(v as Nodo, ruta, acc);
    }
    return acc;
  }

  const listasEs = listas(dict.es as unknown as Nodo);
  const listasEn = listas(dict.en as unknown as Nodo);

  it('las mismas rutas son lista en ambos idiomas', () => {
    expect([...listasEs.keys()].sort()).toEqual([...listasEn.keys()].sort());
  });

  it('cada lista tiene la misma longitud en es y en en', () => {
    const desiguales = [...listasEs.entries()]
      .filter(([ruta, valor]) => valor.length !== listasEn.get(ruta)?.length)
      .map(([ruta, valor]) => `${ruta}: es=${valor.length} en=${listasEn.get(ruta)?.length}`);
    expect(desiguales).toEqual([]);
  });

  it('ningún elemento de lista queda vacío en ninguno de los dos idiomas', () => {
    const vacios: string[] = [];
    for (const [idioma, mapa] of [
      ['es', listasEs],
      ['en', listasEn],
    ] as const) {
      for (const [ruta, valor] of mapa) {
        valor.forEach((elemento, i) => {
          if (typeof elemento === 'string' && elemento.trim() === '') {
            vacios.push(`${idioma}.${ruta}[${i}]`);
          }
        });
      }
    }
    expect(vacios).toEqual([]);
  });
});

describe('StepWizard — accesibilidad traducida', () => {
  /**
   * El `aria-label` de cada paso y el `aria-label` de la navegación se
   * anunciaban SIEMPRE en español, incluso con la interfaz en inglés: es el
   * único texto de la superficie que un usuario ciego no puede sortear.
   */
  it('el copy de navegación y los estados de paso existen en ambos idiomas', () => {
    for (const idioma of ['es', 'en'] as const) {
      const w = dict[idioma].intake.wizard;
      for (const clave of [
        'back',
        'next',
        'submit',
        'navLabel',
        'stepAria',
        'stateDone',
        'stateCurrent',
        'statePending',
      ] as const) {
        expect(typeof w[clave], `${idioma}.intake.wizard.${clave}`).toBe('string');
        expect(w[clave].length).toBeGreaterThan(0);
      }
      expect(w.stepAria).toContain('{n}');
      expect(w.stepAria).toContain('{label}');
      expect(w.stepAria).toContain('{state}');
    }
    expect(dict.es.intake.wizard.navLabel).not.toBe(dict.en.intake.wizard.navLabel);
    expect(dict.es.intake.wizard.statePending).not.toBe(dict.en.intake.wizard.statePending);
  });
});
