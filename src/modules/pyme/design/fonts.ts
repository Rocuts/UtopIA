/**
 * Tipografías del módulo Contabilidad Pyme, cargadas con `next/font/google`
 * y expuestas como variables CSS (`--font-nunito`, `--font-dm-mono`).
 *
 * Se mantienen DENTRO del módulo (no se toca el layout global): el shell
 * (`PymeShell`) aplica `${nunito.variable} ${dmMono.variable}` en su contenedor
 * raíz y las variables cascadean a todos los descendientes. `tokens.FONT` las
 * referencia.
 *
 * Nunito → UI y títulos. DM Mono → montos, tasas y todo valor técnico.
 */
import { Nunito, DM_Mono } from 'next/font/google';

// Nunito es fuente variable → no se fija `weight` (cubre todo el rango 200–1000).
export const nunito = Nunito({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nunito',
});

export const dmMono = DM_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-dm-mono',
});

/** Clase a poner en el contenedor raíz del shell para activar ambas variables. */
export const pymeFontVars = `${nunito.variable} ${dmMono.variable}`;
