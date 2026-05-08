// fonts.ts — Editorial font registration for @react-pdf/renderer.
// Server-only. Fonts live on disk under src/assets/fonts/. Idempotent: repeated
// calls are safe and cheap (single boolean guard).
// ───────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { existsSync } from 'node:fs';
import { Font } from '@react-pdf/renderer';
import { FONT_SANS, FONT_MONO, FONT_DISPLAY } from './tokens';

let registered = false;

function fontPath(filename: string): string {
  return path.join(process.cwd(), 'src', 'assets', 'fonts', filename);
}

/**
 * Resolve the best available font source for Fraunces variants.
 * Prefers .ttf (fully supported by fontkit TTFSubset) over .woff2.
 * woff2 has a known incompatibility with fontkit's TTFSubset loca-table
 * parsing that causes a DataView out-of-bounds error when subsetting
 * compound glyphs. The .ttf files are functionally equivalent.
 */
function frauncesPath(base: string): string {
  const ttf = fontPath(`${base}.ttf`);
  if (existsSync(ttf)) return ttf;
  return fontPath(`${base}.woff2`);
}

/**
 * Register Geist (sans + italic + bold), GeistMono Regular, and Fraunces
 * (regular + italic + bold) with @react-pdf/renderer's Font registry.
 *
 * Idempotent: safe to call from any entrypoint (page render, fixture, test).
 * Server-only — the disk paths assume `process.cwd()` is the repo root.
 */
export function registerEditorialFonts(): void {
  if (registered) return;

  Font.register({
    family: FONT_SANS,
    fonts: [
      { src: fontPath('Geist-Regular.ttf'), fontWeight: 'normal', fontStyle: 'normal' },
      { src: fontPath('Geist-Italic.ttf'), fontWeight: 'normal', fontStyle: 'italic' },
      { src: fontPath('Geist-Bold.ttf'), fontWeight: 'bold', fontStyle: 'normal' },
    ],
  });

  Font.register({
    family: FONT_MONO,
    fonts: [
      { src: fontPath('GeistMono-Regular.ttf'), fontWeight: 'normal', fontStyle: 'normal' },
    ],
  });

  // Several page components reference 'Geist Mono' (with a space) directly.
  // Register an alias so both spellings resolve to the same TTF.
  Font.register({
    family: 'Geist Mono',
    fonts: [
      { src: fontPath('GeistMono-Regular.ttf'), fontWeight: 'normal', fontStyle: 'normal' },
    ],
  });

  Font.register({
    family: FONT_DISPLAY,
    fonts: [
      { src: frauncesPath('Fraunces-Regular'), fontWeight: 'normal', fontStyle: 'normal' },
      { src: frauncesPath('Fraunces-Italic'), fontWeight: 'normal', fontStyle: 'italic' },
      { src: frauncesPath('Fraunces-Bold'), fontWeight: 'bold', fontStyle: 'normal' },
    ],
  });

  // Disable hyphenation by default — editorial layout flows manually.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

/** Test/dev helper — forces a re-register on next call. NEVER use in prod. */
export function __resetFontsForTesting(): void {
  registered = false;
}
