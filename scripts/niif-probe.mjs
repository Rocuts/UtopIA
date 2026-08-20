/**
 * niif-probe.mjs — prueba el camino del Informe NIIF en un despliegue real.
 *
 * Abre el workspace, pulsa «Informe NIIF Elite» y registra TODO lo que ocurre:
 * peticiones de red a /api/financial-report/**, sus códigos y cuerpos de error,
 * los errores de consola y una captura en cada paso. Sin esto, cualquier
 * diagnóstico del pipeline es una conjetura.
 *
 * Uso: node scripts/niif-probe.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/Windows/AppData/Local/npm-cache/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);

const BASE = process.argv[2] ?? 'https://utopia-delta-bay.vercel.app';
const OUT = path.join('docs', 'audit-2026-08-10', 'niif-probe');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-CO' });
const page = await ctx.newPage();

const net = [];
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push(`pageerror: ${String(e.message).slice(0, 300)}`));
page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('/api/')) return;
  const rec = { url: u.replace(BASE, ''), status: r.status(), method: r.request().method() };
  if (r.status() >= 400) {
    try { rec.body = (await r.text()).slice(0, 600); } catch { rec.body = '(sin cuerpo)'; }
  }
  net.push(rec);
});

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  · captura ${name}`);
};

console.log(`Abriendo ${BASE}/workspace …`);
await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
await shot('01-workspace');

// El botón lleva el rótulo visible "INFORME NIIF ELITE".
const btn = page.getByRole('button', { name: /informe niif/i }).first();
const link = page.getByRole('link', { name: /informe niif/i }).first();
let target = null;
if (await btn.count().catch(() => 0)) target = btn;
else if (await link.count().catch(() => 0)) target = link;

if (!target) {
  console.log('NO se encontró el botón «Informe NIIF Elite».');
} else {
  console.log('Pulsando «Informe NIIF Elite» …');
  await target.click();
  await page.waitForTimeout(4000);
  await shot('02-tras-pulsar');
  console.log('  URL ahora:', page.url());

  // El pipeline puede pedir un balance antes de arrancar: se busca el disparador real.
  const texts = await page.locator('button, [role="button"]').allInnerTexts().catch(() => []);
  console.log('  Botones visibles:', texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 24).join(' | '));

  // Se espera un rato largo por si arranca el streaming del pipeline.
  await page.waitForTimeout(12000);
  await shot('03-espera');
}

const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500)).catch(() => '');

fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify({
  base: BASE, url: page.url(), net, errs: [...new Set(errs)].slice(0, 12), bodyText: body,
}, null, 2));

console.log(`\n— Peticiones a /api (${net.length}) —`);
for (const n of net) console.log(`  ${n.status} ${n.method} ${n.url}${n.body ? `\n      ${n.body.slice(0, 240)}` : ''}`);
console.log(`\n— Errores de consola (${new Set(errs).size}) —`);
for (const e of [...new Set(errs)].slice(0, 8)) console.log(`  ${e.slice(0, 200)}`);
console.log(`\nTexto en pantalla: ${body.slice(0, 400)}`);

await browser.close();
