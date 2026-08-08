/**
 * Contabilidad Pyme — Design tokens (única fuente de color del módulo).
 *
 * Regla dura del spec: CERO colores hardcodeados fuera de este archivo.
 * Todo componente toma su color de `PYME`, `RADIUS`, `FONT`, o lo deriva con
 * `rgba(PYME.x, alpha)`. No se escriben literales `#hex` ni `rgb()` en los
 * componentes — solo referencias a estos tokens.
 *
 * Valores EXACTOS — aprobados, no modificar.
 */
export const PYME = {
  // Fondos
  bg:          '#F2FBE8',   // fondo lima del módulo
  bgPale:      '#E8F8DC',   // verde pálido (chips, hover)
  bgPale2:     '#D4F0B8',   // verde pálido 2 (gradientes IA)
  card:        '#FFFFFF',
  // Verdes (identidad)
  greenDark:   '#1A5C06',   // títulos, texto fuerte
  green:       '#2D7A0A',   // primario, botones
  greenLight:  '#4DA820',   // acento
  // Oro (premium / financiero)
  gold:        '#D4B06A',
  // Oscuros (barras, hero, totales)
  ink:         '#0F1117',   // barra superior, footer
  navy:        '#1A1A2E',   // cards oscuras, totales
  navy2:       '#16213E',   // gradiente navy
  // Texto
  text:        '#374151',
  textSec:     '#6B7280',
  textHint:    '#9CA3AF',
  // Estados
  success:     '#0E9F6E',
  successDark: '#065F46',
  successBg:   '#D1FAE5',
  warn:        '#D97706',
  warnAmber:   '#EF9F27',
  warnText:    '#92400E',
  warnBg:      '#FEF3C7',
  danger:      '#C2410C',
  dangerDark:  '#7F1D1D',
  dangerText:  '#991B1B',
  dangerBg:    '#FEE2E2',
  // Morado (prestaciones)
  purpleDark:  '#312E81',
  purple:      '#534AB7',
  purpleLight: '#818CF8',
  // Azul (info)
  blue:        '#185FA5',
  blueText:    '#0369A1',
} as const;

/**
 * Stops pálidos y de alerta citados en las "reglas de estilo" del spec que no
 * viven en el palette base. Se centralizan aquí para que NINGÚN componente
 * escriba un literal de color (regla: cero hex fuera de tokens).
 */
export const SOFT = {
  aiFrom:          '#F0FBE8',  // burbuja IA / header card empleado (desde)
  aiTo:            '#E4F7D0',  // burbuja IA / header card empleado (hasta)
  alertRedBg:      '#FFF5F5',  // fondo alerta roja
  alertAmberBg:    '#FFFBF0',  // fondo alerta amarilla
  alertGreenBg:    '#F0FBF8',  // fondo alerta verde
  alertAmberTitle: '#78350F',  // título alerta amarilla
  iaText:          '#2D5A0A',  // texto cuerpo de burbuja IA
} as const;

export const RADIUS = { sm: '8px', md: '12px', lg: '14px', xl: '16px' } as const;

export const BORDER = '1.5px solid';                       // borde estándar de cards
export const BORDER_GREEN = '1.5px solid rgba(26,92,6,0.12)';

/** Blanco puro derivado del token de card (#FFFFFF) — para overlays translúcidos sobre oscuros. */
export const WHITE = PYME.card;

/** Tipografías del módulo (variables CSS inyectadas por design/fonts.ts en el shell). */
export const FONT = {
  ui:   "var(--font-nunito), 'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "var(--font-dm-mono), 'DM Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
} as const;

/**
 * Convierte un hex de token en `rgba(r,g,b,alpha)`. Único camino permitido para
 * translucidez: el color SIEMPRE viene de un token, el alpha es un número.
 * Acepta #RGB y #RRGGBB.
 */
export function rgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Gradiente lineal a partir de 2 tokens (ningún color crudo en componentes). */
export function gradient(angle: number, from: string, to: string): string {
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

export type PymeColor = keyof typeof PYME;
