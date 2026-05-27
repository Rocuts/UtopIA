// ---------------------------------------------------------------------------
// Fiscal Anchor Block — Tipos compartidos backend + validator + UI
// ---------------------------------------------------------------------------
// Contrato estable. NO renombrar campos sin coordinar las tres ramas.
// Cifras monetarias como string de centavos (BigInt-safe).
// ---------------------------------------------------------------------------

/**
 * Las 10 cifras fiscales clave (F01-F10) extraídas del balance PUC.
 * F01-F08 son strings de centavos (BigInt-safe).
 * F09 y F10 son porcentajes con 1 decimal.
 */
export type FiscalAnchorBlock = {
  /** F01 — Utilidad Antes de Impuestos (UAI) en centavos. Fuente: suma Clase 4 − Clase 5 sin grupo 54. */
  f01: string;
  /** F02 — Impuesto Referencia = round(F01 × 35 / 100) en centavos. Art. 240 E.T. */
  f02: string;
  /** F03 — Retenciones Acumuladas (Cta. 1355.*) en centavos. Crédito fiscal contra F02. */
  f03: string;
  /** F04 — Neto a Pagar / Saldo a Favor = F02 − F03 en centavos (negativo = saldo a favor). Art. 850 E.T. */
  f04: string;
  /** F05 — Provisión IVA por Pagar (abs Cta. 2408) en centavos. */
  f05: string;
  /** F06 — Provisión ICA por Pagar (abs Cta. 2365) en centavos. */
  f06: string;
  /** F07 — Provisión Predial / Vehículos (abs Cta. 2368) en centavos. */
  f07: string;
  /** F08 — Total Pasivos Fiscales (abs Grupo 24 completo) en centavos. */
  f08: string;
  /** F09 — % Carga Impuesto sobre Utilidad Neta (Clase 54 / F01 × 100, 1 decimal). */
  f09: number;
  /** F10 — % Cobertura Retenciones (F03 / F02 × 100, 1 decimal). */
  f10: number;
  /** Calendario DIAN personalizado por NIT (último dígito). */
  calendarioDian: CalendarioDian;
  /** Alertas fiscales generadas por el motor. */
  alertas: FiscalAlerta[];
  /** Metadatos de trazabilidad. */
  fuente: { periodo: string; balanceHash: string };
};

export type CalendarioDian = {
  /** NIT con o sin dígito de verificación (ej. "9017140146" o "901714014-6"). */
  nit: string;
  /** Último dígito del NIT (0–9). */
  ultimoDigito: number;
  /** Período fiscal (ej. "2025"). */
  periodo: string;
  /** Lista de vencimientos fiscales relevantes. */
  vencimientos: VencimientoDian[];
  /** Días de anticipación para alerta temprana. Siempre 15. */
  alertaAnticipacionDias: 15;
};

export type VencimientoDian = {
  /** Nombre de la obligación (ej. "Retención en la fuente"). */
  obligacion: string;
  /** Frecuencia de presentación. */
  frecuencia: 'mensual' | 'bimestral' | 'anual';
  /** Fecha límite ISO 8601 (YYYY-MM-DD). */
  proximoVencimiento: string;
  /** Días naturales restantes desde la fecha de generación del bloque. */
  diasRestantes: number;
  /** Estado calculado. */
  estado: 'pendiente' | 'proximo' | 'verificar' | 'vencido';
  /** Campo F## de referencia para estimar el valor. */
  baseCcv: 'F03' | 'F04' | 'F05' | 'F06' | 'F07';
  /** Valor estimado de la obligación en centavos (string BigInt-safe). */
  valorEstimado: string;
  /** Norma legal de respaldo. */
  norma: string;
};

export type FiscalAlerta = {
  codigo:
    | 'A5_SIN_PROVISION'
    | 'SALDO_A_FAVOR'
    | 'VENCIMIENTO_15D'
    | 'F10_BAJA'
    | 'ICA_ESTIMACION_SIN_CIIU';
  severidad: 'error' | 'warning' | 'info';
  mensaje: string;
  norma: string;
};

// ---------------------------------------------------------------------------
// Alias de tipos para compatibilidad con dian-calendar.ts
// ---------------------------------------------------------------------------

/** Alias de los valores posibles de VencimientoDian.baseCcv. */
export type VencimientoBaseCcv = VencimientoDian['baseCcv'];

/** Alias de los valores posibles de VencimientoDian.estado. */
export type VencimientoEstado = VencimientoDian['estado'];

/** Alias de los valores posibles de VencimientoDian.frecuencia. */
export type VencimientoFrecuencia = VencimientoDian['frecuencia'];
