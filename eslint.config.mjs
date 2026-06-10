import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node.js CJS utility scripts — not part of the Next.js build
    "scripts/convert-pdfs.js",
    // Agent git worktrees (git-ignored, multi-GB) — not source; linting them
    // floods the report with thousands of stale-checkout findings.
    ".claude/worktrees/**",
    // Self-contained mobile module with its own inline-hex palette and
    // module-scoped fonts (NOT the n-* token system) — out of lint scope.
    "src/modules/**",
  ]),
]);

export default eslintConfig;
