/**
 * Punto de entrada del módulo Contabilidad Pyme.
 * El Centro de Comando monta <PymeShell /> donde quiera embeber el módulo
 * (columna mobile ≤480px). Las pantallas internas se navegan vía la tab bar.
 */
export { PymeShell, default } from './PymeShell';
export type { PymeView, ScreenProps } from './PymeShell';
export { MiEquipoNomina } from './MiEquipoNomina';
export { Cifras2026 } from './Cifras2026';
export { LiquidarMes } from './LiquidarMes';
export { Prestaciones } from './Prestaciones';
export { LiquidarContrato } from './LiquidarContrato';
