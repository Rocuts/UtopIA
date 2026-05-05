// scripts/smoke-test-1plus1/reporter.ts
// Terminal reporter con colores ANSI y secciones por workstream.
// No usa chalk ni kleur — códigos ANSI directos.
// Respeta NO_COLOR=1 y !process.stdout.isTTY.

const USE_COLOR = process.stdout.isTTY && process.env.NO_COLOR !== '1';

const C = {
  reset: USE_COLOR ? '\x1b[0m' : '',
  bold: USE_COLOR ? '\x1b[1m' : '',
  dim: USE_COLOR ? '\x1b[2m' : '',
  green: USE_COLOR ? '\x1b[32m' : '',
  yellow: USE_COLOR ? '\x1b[33m' : '',
  red: USE_COLOR ? '\x1b[31m' : '',
  cyan: USE_COLOR ? '\x1b[36m' : '',
  gray: USE_COLOR ? '\x1b[90m' : '',
  white: USE_COLOR ? '\x1b[97m' : '',
};

export interface StepResult {
  ok: boolean;
  warn?: boolean;
  message: string;
  detail?: string;
  durationMs: number;
}

export interface SectionSummary {
  name: string;
  skipped: boolean;
  flagLabel?: string;
  steps: Array<{ name: string; result: StepResult }>;
}

export function printHeader(base: string, workspaceId: string): void {
  const w = 68;
  const line = (s: string) => `║  ${s.padEnd(w - 4)}║`;
  console.log(`╔${'═'.repeat(w)}╗`);
  console.log(line(`${C.bold}${C.cyan}1+1 Élite — Smoke Test Runner${C.reset}`));
  console.log(line(`Base: ${C.white}${base}${C.reset}`));
  console.log(line(`Workspace: ${C.dim}${workspaceId}${C.reset}`));
  console.log(`╚${'═'.repeat(w)}╝`);
  console.log('');
}

export function printSection(summary: SectionSummary): void {
  const flag = summary.skipped
    ? `${C.gray}[flag OFF, saltado]${C.reset}`
    : summary.flagLabel
      ? `${C.green}[flag ON]${C.reset}`
      : '';

  console.log(`${C.bold}▸ ${summary.name}${C.reset}  ${flag}`);

  if (summary.skipped) {
    console.log('');
    return;
  }

  for (const { name, result } of summary.steps) {
    const icon = result.ok
      ? `${C.green}✓${C.reset}`
      : result.warn
        ? `${C.yellow}⚠${C.reset}`
        : `${C.red}✗${C.reset}`;

    const dur = `${C.dim}[${String(result.durationMs).padStart(5)} ms]${C.reset}`;
    const stepName = result.ok
      ? `${C.white}${name}${C.reset}`
      : result.warn
        ? `${C.yellow}${name}${C.reset}`
        : `${C.red}${name}${C.reset}`;

    const label = `  ${icon} ${stepName}`;
    const padLen = Math.max(0, 62 - name.length - 4);
    console.log(`${label}${' '.repeat(padLen)}${dur}`);

    if (result.detail) {
      for (const line of result.detail.split('\n')) {
        console.log(`    ${C.dim}└ ${line}${C.reset}`);
      }
    }
    if (!result.ok && !result.warn) {
      console.log(`    ${C.red}└ ${result.message}${C.reset}`);
    }
  }
  console.log('');
}

export function printFooter(
  totalOk: number,
  totalWarn: number,
  totalFail: number,
  durationMs: number,
  passed: boolean,
): void {
  const bar = '═'.repeat(69);
  console.log(bar);

  const durSec = (durationMs / 1000).toFixed(1);
  const counts = [
    `${C.green}${totalOk} ✓${C.reset}`,
    `${C.yellow}${totalWarn} ⚠${C.reset}`,
    `${C.red}${totalFail} ✗${C.reset}`,
  ].join('   ');

  console.log(`  Total: ${counts}      Duración: ${durSec} s`);

  const verdict =
    totalFail > 0
      ? `${C.bold}${C.red}FAILED${C.reset}`
      : totalWarn > 0
        ? `${C.bold}${C.yellow}PASSED (con warnings)${C.reset}`
        : `${C.bold}${C.green}PASSED${C.reset}`;

  console.log(`  Resultado: ${verdict}`);
  console.log(bar);
}
