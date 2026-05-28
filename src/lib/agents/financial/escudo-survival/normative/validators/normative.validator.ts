// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Orquestador
// ---------------------------------------------------------------------------
//
// Entrada unificada del módulo de validación normativa. Compone:
//   - validateCitations (L1+L2): extracción + catálogo.
//   - checkBlacklist   (L3)    : citas tóxicas independientes del catálogo.
//
// Produce un `NormativeValidationReport` con veredicto global y resumen.
//
// Veredicto global:
//   - bloqueo      → ≥1 cita en bloqueo OR ≥1 blacklist CRITICA/ALTA.
//   - advertencia  → ≥1 advertencia OR ≥1 blacklist MEDIA, sin bloqueos.
//   - valida       → todo validó (incluye texto vacío sin blacklist).
// ---------------------------------------------------------------------------

import type { NormativeCatalogue, CitationCheckResult } from '../types';
import { validateCitations } from './citation.validator';
import {
  checkBlacklist,
  summarizeBlacklistViolations,
  type BlacklistViolation,
} from './blacklist.validator';

// ---------------------------------------------------------------------------
// Tipo de salida
// ---------------------------------------------------------------------------

export interface NormativeValidationReport {
  /** Texto auditado (eco del input — útil para debugging). */
  readonly text: string;
  /** Citas extraídas y validadas contra el catálogo. */
  readonly citations: readonly CitationCheckResult[];
  /** Violaciones blacklist detectadas. */
  readonly blacklistViolations: readonly BlacklistViolation[];
  /** Veredicto global del reporte. */
  readonly veredictoGlobal: 'valida' | 'advertencia' | 'bloqueo';
  /** Resumen agregado para UI / telemetría. */
  readonly resumen: {
    readonly totalCitas: number;
    readonly citasValidas: number;
    readonly citasAdvertencia: number;
    readonly citasBloqueo: number;
    readonly violacionesBlacklist: number;
    readonly violacionesCriticas: number;
  };
}

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

/**
 * Valida un texto contra el catálogo normativo completo.
 *
 * @param text       Respuesta del Agente Fiscal a auditar.
 * @param catalogue  Catálogo inyectado (el módulo nunca importa el catálogo).
 * @returns          Reporte agregado con veredicto global.
 */
export function validateNormativeResponse(
  text: string,
  catalogue: NormativeCatalogue,
): NormativeValidationReport {
  // Capa 1 + Capa 2: citas extraídas y validadas
  const citations = validateCitations(text, catalogue);

  // Capa 3: blacklist scan
  const blacklistViolations = checkBlacklist(text, catalogue.blacklist);

  // Resumen
  const totalCitas = citations.length;
  const citasValidas = citations.filter((c) => c.veredicto === 'valida').length;
  const citasAdvertencia = citations.filter((c) => c.veredicto === 'advertencia').length;
  const citasBloqueo = citations.filter((c) => c.veredicto === 'bloqueo').length;
  const bl = summarizeBlacklistViolations(blacklistViolations);
  const violacionesCriticas = bl.critica + bl.alta;

  // Veredicto global
  let veredictoGlobal: 'valida' | 'advertencia' | 'bloqueo';
  if (citasBloqueo > 0 || violacionesCriticas > 0) {
    veredictoGlobal = 'bloqueo';
  } else if (citasAdvertencia > 0 || bl.media > 0) {
    veredictoGlobal = 'advertencia';
  } else {
    veredictoGlobal = 'valida';
  }

  return {
    text,
    citations,
    blacklistViolations,
    veredictoGlobal,
    resumen: {
      totalCitas,
      citasValidas,
      citasAdvertencia,
      citasBloqueo,
      violacionesBlacklist: bl.total,
      violacionesCriticas,
    },
  };
}
