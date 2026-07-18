#!/usr/bin/env tsx
// scripts/seed-demo-pyme.ts
//
// Crea 6 meses de datos de demostración para el módulo Pyme.
//
// USO:
//   1. El revisor se registra en la app con cualquier email/contraseña.
//   2. Ejecuta: npx tsx scripts/seed-demo-pyme.ts <email>
//   3. El revisor recarga la app en /workspace/pyme — todo estará poblado.
//
// Idempotente: detecta si el libro ya existe y salta la inserción de entradas.

import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, count } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import * as authSchema from '@/lib/db/schema-auth';

// ─── Configuración ────────────────────────────────────────────────────────────

const DEMO_BOOK_NAME = 'Contabilidad Demo 2026';

// Negocio ficticio: tienda de ropa pequeña en Bogotá
const DEMO_WORKSPACE = {
  nit: '900.123.456-7',
  name: 'Tienda Mi Ropa SAS (DEMO)',
};

// ─── Datos de las 6 categorías ───────────────────────────────────────────────

const CATEGORIES = [
  { name: 'Ventas', kind: 'ingreso' as const },
  { name: 'Servicios prestados', kind: 'ingreso' as const },
  { name: 'Otros ingresos', kind: 'ingreso' as const },
  { name: 'Arrendamiento', kind: 'egreso' as const },
  { name: 'Nómina', kind: 'egreso' as const },
  { name: 'Servicios públicos', kind: 'egreso' as const },
  { name: 'Inventario', kind: 'egreso' as const },
  { name: 'Publicidad', kind: 'egreso' as const },
  { name: 'Transporte', kind: 'egreso' as const },
];

// ─── Entradas: 6 meses (Enero – Junio 2026) ──────────────────────────────────

type Kind = 'ingreso' | 'egreso';

interface EntryData {
  entryDate: Date;
  description: string;
  kind: Kind;
  amount: string;
  category: string;
}

function d(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

const ENTRIES: EntryData[] = [
  // ── ENERO 2026 (arranque lento post-navidad) ───────────────────────────────
  // Ingresos: $3,800,000 | Egresos: $3,320,000 | Margen: +$480,000
  { entryDate: d(2026, 1, 5),  description: 'Venta al por menor semana 1',            kind: 'ingreso', amount: '1800000.00', category: 'Ventas' },
  { entryDate: d(2026, 1, 12), description: 'Venta al por menor semana 2',            kind: 'ingreso', amount: '1400000.00', category: 'Ventas' },
  { entryDate: d(2026, 1, 20), description: 'Comisión servicio sastre externo',       kind: 'ingreso', amount: '600000.00',  category: 'Servicios prestados' },
  { entryDate: d(2026, 1, 3),  description: 'Arrendamiento local enero',              kind: 'egreso',  amount: '1200000.00', category: 'Arrendamiento' },
  { entryDate: d(2026, 1, 5),  description: 'Nómina vendedora enero',                kind: 'egreso',  amount: '1800000.00', category: 'Nómina' },
  { entryDate: d(2026, 1, 10), description: 'Servicios públicos enero',              kind: 'egreso',  amount: '320000.00',  category: 'Servicios públicos' },

  // ── FEBRERO 2026 (San Valentín — pico de ventas) ───────────────────────────
  // Ingresos: $4,900,000 | Egresos: $4,480,000 | Margen: +$420,000
  { entryDate: d(2026, 2, 8),  description: 'Ventas San Valentín semana 1',          kind: 'ingreso', amount: '2500000.00', category: 'Ventas' },
  { entryDate: d(2026, 2, 15), description: 'Ventas San Valentín semana 2',          kind: 'ingreso', amount: '2000000.00', category: 'Ventas' },
  { entryDate: d(2026, 2, 22), description: 'Servicio uniformes colegio San Juan',   kind: 'ingreso', amount: '400000.00',  category: 'Servicios prestados' },
  { entryDate: d(2026, 2, 3),  description: 'Arrendamiento local febrero',           kind: 'egreso',  amount: '1200000.00', category: 'Arrendamiento' },
  { entryDate: d(2026, 2, 5),  description: 'Nómina vendedora febrero',              kind: 'egreso',  amount: '1800000.00', category: 'Nómina' },
  { entryDate: d(2026, 2, 10), description: 'Compra inventario San Valentín',        kind: 'egreso',  amount: '1200000.00', category: 'Inventario' },
  { entryDate: d(2026, 2, 12), description: 'Servicios públicos febrero',            kind: 'egreso',  amount: '280000.00',  category: 'Servicios públicos' },

  // ── MARZO 2026 (mes flojo — margen negativo) ───────────────────────────────
  // Ingresos: $3,200,000 | Egresos: $3,710,000 | Margen: -$510,000
  { entryDate: d(2026, 3, 7),  description: 'Ventas al por menor semana 1',          kind: 'ingreso', amount: '1200000.00', category: 'Ventas' },
  { entryDate: d(2026, 3, 14), description: 'Ventas al por menor semana 2',          kind: 'ingreso', amount: '1100000.00', category: 'Ventas' },
  { entryDate: d(2026, 3, 21), description: 'Ventas al por menor semana 3',          kind: 'ingreso', amount: '600000.00',  category: 'Ventas' },
  { entryDate: d(2026, 3, 25), description: 'Devolución tela proveedor (estado malo)', kind: 'ingreso', amount: '300000.00', category: 'Otros ingresos' },
  { entryDate: d(2026, 3, 3),  description: 'Arrendamiento local marzo',             kind: 'egreso',  amount: '1200000.00', category: 'Arrendamiento' },
  { entryDate: d(2026, 3, 5),  description: 'Nómina vendedora marzo',               kind: 'egreso',  amount: '1800000.00', category: 'Nómina' },
  { entryDate: d(2026, 3, 8),  description: 'Servicios públicos marzo',             kind: 'egreso',  amount: '310000.00',  category: 'Servicios públicos' },
  { entryDate: d(2026, 3, 15), description: 'Publicidad redes sociales marzo',      kind: 'egreso',  amount: '400000.00',  category: 'Publicidad' },

  // ── ABRIL 2026 (Semana Santa — recuperación) ───────────────────────────────
  // Ingresos: $5,900,000 | Egresos: $4,680,000 | Margen: +$1,220,000
  { entryDate: d(2026, 4, 4),  description: 'Ventas Semana Santa',                  kind: 'ingreso', amount: '2800000.00', category: 'Ventas' },
  { entryDate: d(2026, 4, 11), description: 'Ventas post-festivo',                  kind: 'ingreso', amount: '1500000.00', category: 'Ventas' },
  { entryDate: d(2026, 4, 25), description: 'Ventas fin de mes',                    kind: 'ingreso', amount: '800000.00',  category: 'Ventas' },
  { entryDate: d(2026, 4, 10), description: 'Servicio confección uniformes empresa', kind: 'ingreso', amount: '800000.00', category: 'Servicios prestados' },
  { entryDate: d(2026, 4, 3),  description: 'Arrendamiento local abril',            kind: 'egreso',  amount: '1200000.00', category: 'Arrendamiento' },
  { entryDate: d(2026, 4, 5),  description: 'Nómina vendedora abril',               kind: 'egreso',  amount: '1800000.00', category: 'Nómina' },
  { entryDate: d(2026, 4, 12), description: 'Compra inventario temporada verano',   kind: 'egreso',  amount: '1500000.00', category: 'Inventario' },
  { entryDate: d(2026, 4, 18), description: 'Transporte mercancía Medellín',        kind: 'egreso',  amount: '180000.00',  category: 'Transporte' },

  // ── MAYO 2026 (Día de la Madre — buen mes) ─────────────────────────────────
  // Ingresos: $5,500,000 | Egresos: $4,750,000 | Margen: +$750,000
  { entryDate: d(2026, 5, 2),  description: 'Ventas al por menor semana 1',         kind: 'ingreso', amount: '1500000.00', category: 'Ventas' },
  { entryDate: d(2026, 5, 10), description: 'Ventas Día de la Madre',               kind: 'ingreso', amount: '2200000.00', category: 'Ventas' },
  { entryDate: d(2026, 5, 17), description: 'Ventas semana 3',                      kind: 'ingreso', amount: '1100000.00', category: 'Ventas' },
  { entryDate: d(2026, 5, 24), description: 'Servicio arreglos y dobladillos',      kind: 'ingreso', amount: '700000.00',  category: 'Servicios prestados' },
  { entryDate: d(2026, 5, 3),  description: 'Arrendamiento local mayo',             kind: 'egreso',  amount: '1200000.00', category: 'Arrendamiento' },
  { entryDate: d(2026, 5, 5),  description: 'Nómina vendedora mayo',                kind: 'egreso',  amount: '1800000.00', category: 'Nómina' },
  { entryDate: d(2026, 5, 8),  description: 'Servicios públicos mayo',              kind: 'egreso',  amount: '350000.00',  category: 'Servicios públicos' },
  { entryDate: d(2026, 5, 10), description: 'Reposición inventario básico',         kind: 'egreso',  amount: '900000.00',  category: 'Inventario' },
  { entryDate: d(2026, 5, 20), description: 'Publicidad Instagram + TikTok mayo',  kind: 'egreso',  amount: '500000.00',  category: 'Publicidad' },

  // ── JUNIO 2026 (liquidación temporada — mejor mes del semestre) ────────────
  // Ingresos: $7,300,000 | Egresos: $5,850,000 | Margen: +$1,450,000
  { entryDate: d(2026, 6, 6),  description: 'Ventas liquidación temporada',         kind: 'ingreso', amount: '2500000.00', category: 'Ventas' },
  { entryDate: d(2026, 6, 13), description: 'Ventas semana 2 nueva colección',      kind: 'ingreso', amount: '1800000.00', category: 'Ventas' },
  { entryDate: d(2026, 6, 20), description: 'Ventas fin de temporada',              kind: 'ingreso', amount: '1900000.00', category: 'Ventas' },
  { entryDate: d(2026, 6, 10), description: 'Confección especial pedido corporativo', kind: 'ingreso', amount: '1100000.00', category: 'Servicios prestados' },
  { entryDate: d(2026, 6, 3),  description: 'Arrendamiento local junio',            kind: 'egreso',  amount: '1200000.00', category: 'Arrendamiento' },
  { entryDate: d(2026, 6, 5),  description: 'Nómina vendedora junio',               kind: 'egreso',  amount: '1800000.00', category: 'Nómina' },
  { entryDate: d(2026, 6, 7),  description: 'Compra nueva colección segundo semestre', kind: 'egreso', amount: '2000000.00', category: 'Inventario' },
  { entryDate: d(2026, 6, 15), description: 'Publicidad lanzamiento nueva temporada', kind: 'egreso', amount: '600000.00', category: 'Publicidad' },
  { entryDate: d(2026, 6, 20), description: 'Transporte nueva colección desde Itagüí', kind: 'egreso', amount: '250000.00', category: 'Transporte' },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('\n  USO: npx tsx scripts/seed-demo-pyme.ts <email>\n');
    console.error('  Ejemplo: npx tsx scripts/seed-demo-pyme.ts demo@pyme-utopia.co\n');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('\n  ERROR: DATABASE_URL no está definido.\n');
    console.error('  Corre primero: vercel env pull .env.local --yes\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema: { ...schema, ...authSchema } });

  console.log('\n🌱 UtopIA Pyme — Seed de datos de demostración');
  console.log('─'.repeat(50));

  // 1. Buscar usuario
  const [user] = await db
    .select()
    .from(authSchema.authUsers)
    .where(eq(authSchema.authUsers.email, email))
    .limit(1);

  if (!user) {
    console.error(`\n  ❌ No existe una cuenta con el email: ${email}`);
    console.error('\n  Pasos:\n');
    console.error('  1. Abre la app en el navegador');
    console.error('  2. Crea una cuenta con ese email');
    console.error('  3. Vuelve a correr este script\n');
    await pool.end();
    process.exit(1);
  }

  console.log(`  ✅ Usuario: ${user.name} <${user.email}>`);

  // 2. Buscar o crear workspace
  let [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.userId, user.id))
    .limit(1);

  if (!workspace) {
    [workspace] = await db
      .insert(schema.workspaces)
      .values({ ...DEMO_WORKSPACE, userId: user.id })
      .returning();
    console.log(`  ✅ Workspace creado: ${workspace.name} (NIT ${workspace.nit})`);
  } else {
    // Actualizar el nombre/NIT para el demo si el workspace ya existe pero sin datos
    console.log(`  ✅ Workspace existente: ${workspace.name ?? '(sin nombre)'}`);
  }

  // 3. Buscar o crear libro
  let [book] = await db
    .select()
    .from(schema.pymeBooks)
    .where(
      and(
        eq(schema.pymeBooks.workspaceId, workspace.id),
        eq(schema.pymeBooks.name, DEMO_BOOK_NAME),
      ),
    )
    .limit(1);

  if (!book) {
    [book] = await db
      .insert(schema.pymeBooks)
      .values({ workspaceId: workspace.id, name: DEMO_BOOK_NAME, currency: 'COP' })
      .returning();
    console.log(`  ✅ Libro creado: "${book.name}"`);
  } else {
    console.log(`  ✅ Libro existente: "${book.name}"`);
  }

  // 4. Categorías (idempotente — solo si no existen ya para este libro)
  const existingCats = await db
    .select({ cnt: count() })
    .from(schema.pymeCategories)
    .where(eq(schema.pymeCategories.bookId, book.id));

  if ((existingCats[0]?.cnt ?? 0) === 0) {
    await db.insert(schema.pymeCategories).values(
      CATEGORIES.map((c) => ({ ...c, bookId: book.id })),
    );
    console.log(`  ✅ Categorías insertadas: ${CATEGORIES.length}`);
  } else {
    console.log(`  ✅ Categorías ya existentes — se omiten`);
  }

  // 5. Entradas (idempotente — solo si no existen ya)
  const existingEntries = await db
    .select({ cnt: count() })
    .from(schema.pymeEntries)
    .where(eq(schema.pymeEntries.bookId, book.id));

  if ((existingEntries[0]?.cnt ?? 0) === 0) {
    await db.insert(schema.pymeEntries).values(
      ENTRIES.map((e) => ({
        bookId: book.id,
        entryDate: e.entryDate,
        description: e.description,
        kind: e.kind,
        amount: e.amount,
        category: e.category,
        status: 'confirmed' as const,
        confidence: '1.000',
      })),
    );
    console.log(`  ✅ Entradas insertadas: ${ENTRIES.length} (6 meses, status=confirmed)`);
  } else {
    console.log(`  ✅ Entradas ya existentes (${existingEntries[0]?.cnt}) — se omiten`);
  }

  // 6. Resumen
  const totalIngresos = ENTRIES.filter((e) => e.kind === 'ingreso')
    .reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalEgresos = ENTRIES.filter((e) => e.kind === 'egreso')
    .reduce((s, e) => s + parseFloat(e.amount), 0);
  const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

  console.log('\n─'.repeat(50));
  console.log('  📊 Resumen de datos de demo:');
  console.log(`     Período: Enero – Junio 2026`);
  console.log(`     Ingresos: ${fmt(totalIngresos)} COP`);
  console.log(`     Egresos:  ${fmt(totalEgresos)} COP`);
  console.log(`     Margen:   ${fmt(totalIngresos - totalEgresos)} COP`);
  console.log('\n  🎉 Listo. El revisor puede abrir:');
  console.log('     /workspace/pyme          → panel principal');
  console.log('     /workspace/pyme/historico → comparativo 6 meses');
  console.log('     /workspace/pyme/reporte   → reporte + Descargar PDF');
  console.log('     /workspace/pyme/fechas    → notificaciones DIAN\n');

  await pool.end();
}

main().catch((err) => {
  console.error('\n  ERROR:', err);
  process.exit(1);
});
