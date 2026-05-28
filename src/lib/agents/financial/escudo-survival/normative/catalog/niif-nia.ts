// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: NIIF / NIC / NIA
// ---------------------------------------------------------------------------
//
// Normas de información financiera y de auditoría aplicables en Colombia 2026.
// Decreto 2420/2015 (Decreto Único Reglamentario Contable) y modificatorios.
// ---------------------------------------------------------------------------

import type { AuditStandardEntry } from '../types';

export const NORMAS_AUDITORIA: readonly AuditStandardEntry[] = [
  // ─── NIIF PARA PYMES ──────────────────────────────────────────────────────
  {
    id: 'NIIF_PYMES_S29',
    cita: 'NIIF para PYMES §29',
    familia: 'NIIF_PYMES',
    numero: '29',
    titulo: 'Impuesto a las ganancias',
    resumen:
      'Regula el reconocimiento del impuesto corriente y diferido para entidades bajo el marco NIIF para PYMES (Grupo 2 en Colombia). Requiere presentación separada de activos y pasivos por impuesto diferido. El impuesto diferido se reconoce sobre diferencias temporarias entre la base contable y la base fiscal (E.T.).',
    decretoAdopcion: 'Decreto 2420/2015, Anexo 2 (NIIF para PYMES)',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'NIIF_PYMES_S35',
    cita: 'NIIF para PYMES §35',
    familia: 'NIIF_PYMES',
    numero: '35',
    titulo: 'Transición a la NIIF para PYMES',
    resumen:
      'Regula los ajustes de transición al adoptar NIIF para PYMES por primera vez. El saldo de transición (patrimonio fiscal vs patrimonio NIIF) puede generar diferencias temporarias con impacto en impuesto diferido.',
    decretoAdopcion: 'Decreto 2420/2015, Anexo 2',
    estado: 'VIGENTE_2026',
  },

  // ─── NIC (NIIF PLENAS) ────────────────────────────────────────────────────
  {
    id: 'NIC_12',
    cita: 'NIC 12',
    familia: 'NIC',
    numero: '12',
    titulo: 'Impuesto a las ganancias',
    resumen:
      'Método del pasivo basado en balance (Grupo 1 — NIIF Plenas). El impuesto diferido se reconoce sobre TODAS las diferencias temporarias entre el valor contable de activos/pasivos y su base fiscal. Distinción entre diferencias temporarias imponibles (pasivo diferido) y deducibles (activo diferido).',
    decretoAdopcion: 'Decreto 2420/2015, Anexo 1 (NIIF Plenas)',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'NIC_16',
    cita: 'NIC 16',
    familia: 'NIC',
    numero: '16',
    titulo: 'Propiedades, planta y equipo',
    resumen:
      'Modelo de reconocimiento y medición de PPE bajo NIIF Plenas. Las tasas de depreciación NIIF (vida útil económica) difieren de las tasas fiscales máximas (Art. 137 E.T.), generando diferencias temporarias sujetas a impuesto diferido NIC 12.',
    decretoAdopcion: 'Decreto 2420/2015, Anexo 1',
    estado: 'VIGENTE_2026',
  },

  // ─── NIA ──────────────────────────────────────────────────────────────────
  {
    id: 'NIA_240',
    cita: 'NIA 240',
    familia: 'NIA',
    numero: '240',
    titulo: 'Responsabilidades del auditor en la auditoría de estados financieros con respecto al fraude',
    resumen:
      'Define la responsabilidad del auditor para identificar y evaluar los riesgos de incorrección material debida a fraude. Incluye riesgos tributarios (manipulación de ingresos, gastos ficticios) como riesgos significativos.',
    decretoAdopcion: 'Decreto 2420/2015 (NIA incorporadas)',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'NIA_700',
    cita: 'NIA 700',
    familia: 'NIA',
    numero: '700',
    titulo: 'Formación de la opinión y emisión del informe de auditoría sobre estados financieros',
    resumen:
      'Regula la formación de la opinión del auditor (sin salvedades, con salvedades, adversa o con abstención). Base para el dictamen del revisor fiscal sobre estados financieros.',
    decretoAdopcion: 'Decreto 2420/2015',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'NIA_705',
    cita: 'NIA 705',
    familia: 'NIA',
    numero: '705',
    titulo: 'Opinión modificada en el informe de auditoría',
    resumen:
      'Regula los tres tipos de opinión modificada: con salvedades (incorrección material pero no generalizada), adversa (incorrección generalizada) y abstención (imposibilidad de obtener evidencia suficiente). Aplicable cuando hay incertidumbres tributarias materiales.',
    decretoAdopcion: 'Decreto 2420/2015',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'NIA_706',
    cita: 'NIA 706',
    familia: 'NIA',
    numero: '706',
    titulo: 'Párrafos de énfasis y párrafos sobre otras cuestiones',
    resumen:
      'Permite al auditor incluir párrafos de énfasis (para llamar la atención sobre asuntos críticos sin modificar la opinión) y párrafos sobre otras cuestiones. Relevante para declaraciones de contingencias tributarias significativas.',
    decretoAdopcion: 'Decreto 2420/2015',
    estado: 'VIGENTE_2026',
  },
] as const;
