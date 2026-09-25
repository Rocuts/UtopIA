// ---------------------------------------------------------------------------
// Prueba de mutación de 1 centavo sobre un informe NIIF rico y coherente
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (niif-contrato-20): el fixture coherente del repo no
// ejercía comparativo, subtotales ni ECP matricial, y la prueba de mutación
// de la auditoría vivía fuera de la suite (fixture rico: 86/119 campos
// detectados; `curatorFlags.reclassifiedAmountCop` nunca — niif-contrato-23).
//
// El fixture de tres cortes (2023/2024/2025) tiene ESF y ERI comparativos,
// correctora 1592, reservas, aumento de capital, distribuciones, EFE con
// columna comparativa y ECP de los dos periodos. Cada campo MoneyCop del
// informe se mueve ±1 centavo y la combinación que corre en producción
// (validador anclado + invariantes del EFE) debe detectarlo: todos los
// campos, sin lista de excepciones.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  informeTresCortes,
  preprocesarTresCortes,
} from '../__fixtures__/tres-cortes-comparativo';
import { clonar } from '../__fixtures__/perdida-comparativo-w4a';
import { checkCashFlowInvariants } from '../contracts/deterministic-breakdown';
import type { NiifReportJson } from '../contracts/niif-report';
import { buildNiifValidatorOptions } from '../orchestrator';
import { validateNiifReportJson } from '../validators/niif-json-validator';

type Path = Array<string | number>;

/** Rutas de todas las cifras MoneyCop (string entero) del informe. */
function moneyPaths(value: unknown, path: Path = []): Path[] {
  if (typeof value === 'string') return /^-?\d+$/.test(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyPaths(v, [...path, i]));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      // Identificación de la empresa y del periodo: no son cifras.
      k === 'company' || k === 'account' ? [] : moneyPaths(v, [...path, k]),
    );
  }
  return [];
}

function setAt(obj: unknown, path: Path, next: string): void {
  let cur = obj as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  cur[path[path.length - 1]] = next;
}

function getAt(obj: unknown, path: Path): string {
  let cur = obj as Record<string | number, unknown>;
  for (const k of path) cur = cur[k] as Record<string | number, unknown>;
  return cur as unknown as string;
}

describe('mutación de 1 centavo — informe de tres cortes (niif-contrato-20/-23)', () => {
  const pp = preprocesarTresCortes();
  const options = buildNiifValidatorOptions(pp);
  const base = informeTresCortes(pp);
  const detect = (json: NiifReportJson) =>
    validateNiifReportJson(json, options).errors.length + checkCashFlowInvariants(json.cashFlow).length;

  it('el informe base es coherente: sin errores ni violaciones', () => {
    expect(validateNiifReportJson(base, options).errors).toEqual([]);
    expect(checkCashFlowInvariants(base.cashFlow)).toEqual([]);
  });

  it('todo campo MoneyCop mutado ±1 centavo se detecta', () => {
    const paths = moneyPaths(base);
    expect(paths.length).toBeGreaterThan(150);
    const undetected: string[] = [];
    for (const p of paths) {
      for (const delta of [BigInt(1), BigInt(-1)]) {
        const json = clonar(base);
        setAt(json, p, (BigInt(getAt(json, p)) + delta).toString());
        if (detect(json) === 0) undetected.push(`${p.join('.')} (${delta > BigInt(0) ? '+' : '-'}1)`);
      }
    }
    expect(undetected).toEqual([]);
  });

  it('niif-contrato-23: curatorFlags distintas de las del Curator → E26', () => {
    const json = clonar(base);
    json.curatorFlags.negativeAssetReclassified = true;
    const errors = validateNiifReportJson(json, options).errors;
    expect(errors.some((e) => e.startsWith('E26. curatorFlags.negativeAssetReclassified'))).toBe(true);
  });
});
