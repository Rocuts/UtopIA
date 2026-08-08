import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guardas de accesibilidad para las dos superficies donde el usuario entrega
 * datos financieros y credenciales:
 *
 *  - NiifReportIntake: los <label> eran hermanos del <input> sin htmlFor ni id,
 *    así que un lector de pantalla anunciaba "editar texto, en blanco" en
 *    Razón Social, NIT, periodo, etc.
 *  - ERPConnector: 3 diálogos declaraban role="dialog" aria-modal="true" sin
 *    Escape ni trampa de foco; el fondo seguía tabulable mientras el usuario
 *    escribía credenciales del vault AES.
 */

const REPO = resolve(__dirname, '../../../..');

function sinComentarios(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Devuelve el texto de cada etiqueta de apertura `<tag ... >` del fuente. */
function etiquetasDeApertura(src: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'g');
  return sinComentarios(src).match(re) ?? [];
}

describe('NiifReportIntake — nombres accesibles en el formulario', () => {
  const src = readFileSync(
    resolve(REPO, 'src/components/workspace/intake/NiifReportIntake.tsx'),
    'utf8',
  );

  it('el detector marca el patrón previo al fix (label hermano sin htmlFor)', () => {
    const previo = `
        <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
          Razón Social <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          value={values.company.name}
        />`;
    const labels = etiquetasDeApertura(previo, 'label');
    const inputs = etiquetasDeApertura(previo, 'input');
    expect(labels.some((l) => !/htmlFor=|\sid=/.test(l))).toBe(true);
    expect(inputs.some((i) => !/\sid=|aria-label/.test(i))).toBe(true);
  });

  it.each(['input', 'select', 'textarea'])(
    'todo <%s> tiene id (o aria-label) para poder ser nombrado',
    (tag) => {
      const huerfanos = etiquetasDeApertura(src, tag).filter(
        (t) => !/\sid=/.test(t) && !/aria-label/.test(t),
      );
      expect(huerfanos).toEqual([]);
    },
  );

  it('todo <label> apunta a su control (htmlFor) o expone un id para aria-labelledby', () => {
    const huerfanos = etiquetasDeApertura(src, 'label').filter(
      (l) => !/htmlFor=/.test(l) && !/\sid=/.test(l),
    );
    expect(huerfanos).toEqual([]);
  });

  it('los ids declarados en htmlFor existen como id de algún control', () => {
    const limpio = sinComentarios(src);
    const destinos = [...limpio.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]);
    const ids = new Set([...limpio.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    expect(destinos.length).toBeGreaterThan(0);
    expect(destinos.filter((d) => !ids.has(d))).toEqual([]);
  });
});

describe('ERPConnector — diálogos modales', () => {
  const src = readFileSync(
    resolve(REPO, 'src/components/workspace/ERPConnector.tsx'),
    'utf8',
  );
  const limpio = sinComentarios(src);

  it('cada role="dialog" tiene una trampa de foco con salida por Escape', () => {
    const dialogos = (limpio.match(/role="dialog"/g) ?? []).length;
    const trampas = (limpio.match(/useFocusTrap\(/g) ?? []).length;

    expect(dialogos).toBeGreaterThan(0);
    // Antes del fix: 3 diálogos, 0 llamadas a useFocusTrap.
    expect(trampas).toBe(dialogos);
  });

  it('cada diálogo cuelga la trampa de un ref en el contenedor del modal', () => {
    const dialogos = (limpio.match(/role="dialog"/g) ?? []).length;
    const refs = (limpio.match(/ref=\{dialogRef\}/g) ?? []).length;
    expect(refs).toBe(dialogos);
  });

  it('los inputs de credenciales están asociados a su label', () => {
    // Los checkboxes de SyncModal van ENVUELTOS por su <label> (asociación
    // implícita, válida); los demás campos necesitan id + htmlFor.
    const inputs = etiquetasDeApertura(src, 'input').filter(
      (i) => !/type="checkbox"/.test(i),
    );
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.filter((i) => !/\sid=/.test(i))).toEqual([]);

    const bloquesLabel = sinComentarios(src).match(/<label\b[\s\S]*?<\/label>/g) ?? [];
    const huerfanos = bloquesLabel.filter(
      (b) => !/htmlFor=/.test(b) && !/<input\b/.test(b),
    );
    expect(huerfanos).toEqual([]);
  });

  it('los botones de solo icono tienen nombre accesible', () => {
    const botones = etiquetasDeApertura(src, 'button');
    const soloIcono = botones.filter((b) => /aria-label=|title=/.test(b));
    expect(soloIcono.length).toBeGreaterThanOrEqual(3);
    expect(soloIcono.filter((b) => !/aria-label=/.test(b))).toEqual([]);
  });
});
