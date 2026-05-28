/**
 * Shared translation-prop types for Fiscal Agent card components.
 * These mirror the i18n keys under `escudo.fiscalAgent.*`.
 */

export interface FiscalCcvT {
  title: string;
  subtitle: string;
  f01: string;
  f02: string;
  f03: string;
  f04: string;
  f05: string;
  f06: string;
  f07: string;
  f08: string;
  f09: string;
  f10: string;
  colConcepto: string;
  colValor: string;
  colNorma: string;
  tableLabel: string;
  alertaTasaMinima: string;
  eficiencia: string;
}

export interface FiscalRiskScoreT {
  title: string;
  topFactores: string;
  survivalBanner: string;
  survivalCta: string;
}

export interface FiscalConciliacionT {
  title: string;
  subtitle: string;
  draftBadge: string;
  draftBanner: string;
  tableLabel: string;
  colConcepto: string;
  colMonto: string;
  colNorma: string;
}

export interface FiscalPlaneacionT {
  title: string;
  subtitle: string;
  razonRecomendacion: string;
}

export interface FiscalDefensaDianT {
  title: string;
  tipoLabel: string;
  plazoLabel: string;
  posicionLabel: string;
  reduccionesLabel: string;
  previewLabel: string;
  downloadLabel: string;
}

export interface FiscalDevolucionesT {
  title: string;
  saldoLabel: string;
  documentosLabel: string;
}
