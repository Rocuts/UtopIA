// ---------------------------------------------------------------------------
// Firmantes — Loader + Renderer
// ---------------------------------------------------------------------------
// Resuelve los datos de Representante Legal, Revisor Fiscal y Contador Publico
// para una sesión / workspace y entrega un bloque de firma listo para insertar
// en el dictamen NIA, la certificacion de EEFF (Art. 37 Ley 222/1995) y el PDF
// editorial.
//
// Why server-only: lee de Neon Postgres a traves de getDb(); todo consumo
// debe ocurrir en route handlers / server actions. No es compatible con
// Server Components que se evaluan en build.
//
// Fallback / robustez: si la fila no existe, si el campo es null, o si el
// query falla, devolvemos `null` por slot — el renderer maneja placeholders.
// ---------------------------------------------------------------------------

import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { workspaces } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Tipos de salida
// ---------------------------------------------------------------------------

export interface SignatoryName {
  nombre: string;
}

export interface SignatoryWithCard {
  nombre: string;
  /** Tarjeta Profesional formato '<numero>-T' (Junta Central de Contadores). */
  tp: string;
}

export type Signatories = {
  representanteLegal: SignatoryName | null;
  revisorFiscal: SignatoryWithCard | null;
  contadorPublico: SignatoryWithCard | null;
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Lee los firmantes registrados en `workspaces` para `workspaceId`.
 * Si la fila no existe o cualquier campo viene null, ese slot se devuelve
 * como `null` y el renderer pintara placeholder.
 *
 * Errores de Postgres se convierten en `null`s — el dictamen NUNCA debe
 * fallar por un problema de DB; preferimos firmar con placeholders y dejar
 * la auditoria humana corregirlo.
 */
export async function loadSignatoriesForWorkspace(
  workspaceId: string,
): Promise<Signatories> {
  const empty: Signatories = {
    representanteLegal: null,
    revisorFiscal: null,
    contadorPublico: null,
  };
  if (!workspaceId || typeof workspaceId !== 'string') return empty;

  try {
    const db = getDb();
    const rows = await db
      .select({
        rl: workspaces.representanteLegalNombre,
        rfNombre: workspaces.revisorFiscalNombre,
        rfTp: workspaces.revisorFiscalTp,
        cpNombre: workspaces.contadorPublicoNombre,
        cpTp: workspaces.contadorPublicoTp,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (rows.length === 0) return empty;

    const row = rows[0];

    const representanteLegal: SignatoryName | null =
      typeof row.rl === 'string' && row.rl.trim().length > 0
        ? { nombre: row.rl.trim() }
        : null;

    const revisorFiscal: SignatoryWithCard | null =
      typeof row.rfNombre === 'string' &&
      row.rfNombre.trim().length > 0 &&
      typeof row.rfTp === 'string' &&
      row.rfTp.trim().length > 0
        ? { nombre: row.rfNombre.trim(), tp: row.rfTp.trim() }
        : null;

    const contadorPublico: SignatoryWithCard | null =
      typeof row.cpNombre === 'string' &&
      row.cpNombre.trim().length > 0 &&
      typeof row.cpTp === 'string' &&
      row.cpTp.trim().length > 0
        ? { nombre: row.cpNombre.trim(), tp: row.cpTp.trim() }
        : null;

    return { representanteLegal, revisorFiscal, contadorPublico };
  } catch (err) {
    // Why: si Neon esta caido o el schema todavia no migro, NO bloquear el
    // dictamen — emitir con placeholders y dejar trazas para depuracion.
    console.warn('[signatories] loadSignatoriesForWorkspace failed:', err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Renderer (Markdown / texto plano)
// ---------------------------------------------------------------------------

const PLACEHOLDER_LINE = '__________________________________';

/**
 * Renderiza el bloque de firma en formato Ley 43/1990 (dictamen de revisoria
 * fiscal y certificacion del contador). El bloque puede usarse tal cual en
 * Markdown o pasarse al PDF editorial (que conserva los saltos de linea).
 *
 * Estructura canonica colombiana (post-firma del dictamen):
 *
 *   __________________________________
 *   <Nombre Revisor Fiscal>
 *   Revisor Fiscal
 *   T.P. <12345-T> de la JCC
 *
 *   __________________________________
 *   <Nombre Contador Publico>
 *   Contador Publico
 *   T.P. <67890-T> de la JCC
 *
 *   __________________________________
 *   <Nombre Representante Legal>
 *   Representante Legal
 *
 * Cuando un slot es null, se imprime la linea de firma + placeholder con el
 * cargo, manteniendo el tamaño visual del bloque para que el PDF editorial
 * no colapse el layout.
 */
export function renderSignatureBlock(s: Signatories | null): string {
  if (!s) {
    return [
      PLACEHOLDER_LINE,
      'Revisor Fiscal',
      'T.P. ____________ de la JCC',
      '',
      PLACEHOLDER_LINE,
      'Contador Publico',
      'T.P. ____________ de la JCC',
      '',
      PLACEHOLDER_LINE,
      'Representante Legal',
    ].join('\n');
  }

  const lines: string[] = [];

  // --- Bloque Revisor Fiscal (Art. 8 Ley 43/1990 + Art. 207 C.Co.) ---
  lines.push(PLACEHOLDER_LINE);
  if (s.revisorFiscal) {
    lines.push(s.revisorFiscal.nombre);
    lines.push('Revisor Fiscal');
    lines.push(`T.P. ${s.revisorFiscal.tp} de la JCC`);
  } else {
    lines.push('Revisor Fiscal');
    lines.push('T.P. ____________ de la JCC');
  }

  lines.push('');

  // --- Bloque Contador Publico (Art. 37 Ley 222/1995 — certificacion EEFF) ---
  lines.push(PLACEHOLDER_LINE);
  if (s.contadorPublico) {
    lines.push(s.contadorPublico.nombre);
    lines.push('Contador Publico');
    lines.push(`T.P. ${s.contadorPublico.tp} de la JCC`);
  } else {
    lines.push('Contador Publico');
    lines.push('T.P. ____________ de la JCC');
  }

  lines.push('');

  // --- Bloque Representante Legal (Art. 22 Ley 222/1995 + Art. 2.2.1.5 RUM) ---
  lines.push(PLACEHOLDER_LINE);
  if (s.representanteLegal) {
    lines.push(s.representanteLegal.nombre);
    lines.push('Representante Legal');
  } else {
    lines.push('Representante Legal');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Compat helper — mapea el legacy CompanyInfo (strings sueltos) al type nuevo
// ---------------------------------------------------------------------------

/**
 * Normaliza los signatarios desde el shape canonico nuevo (`signatories?`) o
 * desde los campos legacy (`legalRepresentative`/`fiscalAuditor`/`accountant`)
 * de `CompanyInfo`. Si ambos coexisten, `signatories` gana.
 *
 * Cuando el legacy solo trae el nombre (strings sin TP), el TP queda vacio
 * y `renderSignatureBlock` imprime placeholder en esa linea — coherente con
 * el contrato historico.
 */
export function signatoriesFromCompany(company: {
  signatories?: {
    representanteLegal?: { nombre: string };
    revisorFiscal?: { nombre: string; tp: string };
    contadorPublico?: { nombre: string; tp: string };
  };
  legalRepresentative?: string;
  fiscalAuditor?: string;
  accountant?: string;
}): Signatories {
  const out: Signatories = {
    representanteLegal: null,
    revisorFiscal: null,
    contadorPublico: null,
  };

  // Forma canonica nueva primero.
  if (company.signatories) {
    if (company.signatories.representanteLegal?.nombre) {
      out.representanteLegal = {
        nombre: company.signatories.representanteLegal.nombre,
      };
    }
    if (
      company.signatories.revisorFiscal?.nombre &&
      company.signatories.revisorFiscal?.tp
    ) {
      out.revisorFiscal = {
        nombre: company.signatories.revisorFiscal.nombre,
        tp: company.signatories.revisorFiscal.tp,
      };
    }
    if (
      company.signatories.contadorPublico?.nombre &&
      company.signatories.contadorPublico?.tp
    ) {
      out.contadorPublico = {
        nombre: company.signatories.contadorPublico.nombre,
        tp: company.signatories.contadorPublico.tp,
      };
    }
  }

  // Fallback a legacy strings si no hay forma canonica.
  if (!out.representanteLegal && company.legalRepresentative) {
    out.representanteLegal = { nombre: company.legalRepresentative };
  }
  // Legacy NO traia TP — solo se acepta como senial cualitativa, no se rellena
  // el slot estructurado para no falsificar la TP. En su lugar dejamos null,
  // y el renderer pinta el placeholder de TP.
  // (Si en algun consumidor legacy hace falta no perder el nombre, abrir un
  // slot intermedio en una iteracion posterior.)

  return out;
}
