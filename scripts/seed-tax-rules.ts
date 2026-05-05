// scripts/seed-tax-rules.ts
//
// Siembra las 6 reglas tributarias built-in Colombia 2026 y los valores UVT
// 2025/2026 en la base de datos.
//
// Idempotente: usa ON CONFLICT DO UPDATE — re-ejecutar no duplica filas.
//
// Requisito: las migraciones 0005_smart_tax.sql deben estar aplicadas.
//
// Uso:
//   npx tsx scripts/seed-tax-rules.ts
//
// O vía npm (agregar en package.json si se desea):
//   "db:seed-tax": "dotenv -e .env.local -- tsx scripts/seed-tax-rules.ts"

import { seedTaxRulesCo2026 } from '@/lib/db/seeds/tax-rules-co-2026';

async function main() {
  console.log('=== Seed: reglas tributarias Colombia 2026 ===');
  try {
    await seedTaxRulesCo2026();
    console.log('=== Seed completado exitosamente ===');
    process.exit(0);
  } catch (err) {
    console.error('Error durante el seed:', err);
    process.exit(1);
  }
}

main();
