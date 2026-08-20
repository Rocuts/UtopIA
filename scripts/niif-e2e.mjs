/**
 * niif-e2e.mjs — recorre el Informe NIIF de punta a punta en un despliegue real.
 *
 * Sube un balance de prueba por el asistente, avanza los cuatro pasos y observa
 * las tres fases del pipeline, registrando cada petición a /api/financial-report,
 * su código y su cuerpo de error, más los eventos que llegan por streaming.
 *
 * Es la única forma de saber si «el informe funciona»: el código puede estar
 * bien y romperse en el navegador, y al revés.
 *
 * Uso: node scripts/niif-e2e.mjs [baseUrl] [--wait 240]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = 'C:/Users/Windows/AppData/Local/npm-cache/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) ?? 'https://utopia-delta-bay.vercel.app';
const WAIT = Number(args[args.indexOf('--wait') + 1]) || 300;
const FIXTURE = 'src/lib/preprocessing/__fixtures__/elite-pulido-diamante.csv';
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
  const rec = { t: new Date().toISOString().slice(11, 19), url: u.replace(BASE, ''), status: r.status(), method: r.request().method() };
  if (r.status() >= 400) { try { rec.body = (await r.text()).slice(0, 700); } catch { rec.body = '(sin cuerpo)'; } }
  net.push(rec);
  console.log(`  [net] ${rec.status} ${rec.method} ${rec.url}${rec.body ? ` — ${rec.body.slice(0, 200)}` : ''}`);
});

const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `e2e-${n}.png`) }); };
const seen = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '');

console.log(`1) Abriendo ${BASE}/workspace`);
await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

console.log('2) Abriendo el asistente del informe');
await page.getByRole('button', { name: /informe niif/i }).first().click();
await page.waitForTimeout(2500);
await shot('01-wizard');

console.log(`3) Subiendo ${FIXTURE}`);
// El input del ASISTENTE, no el clip del chat: la página tiene varios
// input[type=file] y el primero es el de la barra lateral, que sólo adjunta el
// documento a la conversación y deja el wizard sin balance.
const dialog = page.locator('[role="dialog"]').first();
const scope = (await dialog.count().catch(() => 0)) ? dialog : page;
const inputs = scope.locator('input[type="file"]');
console.log(`   inputs de archivo en el asistente: ${await inputs.count()}`);
await inputs.first().setInputFiles(FIXTURE, { timeout: 20000 });
await page.waitForTimeout(6000);
await shot('02-subido');
console.log('   texto:', (await seen()).slice(0, 260));

// Paso 2 «Revisar» pide los datos que el balance no trae (razón social, NIT).
// Sin ellos «Siguiente» queda deshabilitado y el pipeline no arranca nunca.
const REQUIRED = [
  [/raz[oó]n social/i, 'Comercializadora Diamante S.A.S.'],
  [/^nit/i, '901456789-3'],
];
for (const [label, value] of REQUIRED) {
  const field = page.getByLabel(label).first();
  if (await field.count().catch(() => 0)) {
    await field.fill(value).catch(() => {});
    console.log(`   campo «${label}» = ${value}`);
  }
}
await page.waitForTimeout(1200);

// Avanza por los pasos que queden habilitados.
for (let step = 0; step < 4; step++) {
  const next = page.getByRole('button', { name: /siguiente|generar|continuar|iniciar/i }).first();
  const n = await next.count().catch(() => 0);
  if (!n) { console.log(`4.${step}) sin botón de avance`); break; }
  const disabled = await next.isDisabled().catch(() => true);
  const label = (await next.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  if (disabled) { console.log(`4.${step}) «${label}» deshabilitado — se detiene aquí`); break; }
  console.log(`4.${step}) pulsando «${label}»`);
  await next.click();
  await page.waitForTimeout(4500);
  await shot(`03-paso${step}`);
}

console.log(`5) Observando el pipeline hasta ${WAIT}s`);
const t0 = Date.now();
let last = '';
while ((Date.now() - t0) / 1000 < WAIT) {
  const txt = await seen();
  const m = txt.match(/Fase \d de \d[^.]*\./);
  const cur = m ? m[0] : '';
  if (cur && cur !== last) { console.log(`   [${Math.round((Date.now() - t0) / 1000)}s] ${cur}`); last = cur; }
  if (/error|falló|fallo|no se pudo|intente/i.test(txt) && !/sin errores/i.test(txt)) {
    console.log(`   [${Math.round((Date.now() - t0) / 1000)}s] posible error en pantalla`);
  }
  if (/descargar informe|vista previa lista|informe listo|reporte listo|completado con éxito/i.test(txt)) { console.log('   ¡Informe terminado!'); break; }
  await page.waitForTimeout(5000);
}
await shot('04-final');

const finalText = await seen();
fs.writeFileSync(path.join(OUT, 'e2e.json'), JSON.stringify({
  base: BASE, net, errs: [...new Set(errs)].slice(0, 15), finalText: finalText.slice(0, 3000),
}, null, 2));

console.log('\n— Resumen de red —');
for (const n of net) console.log(`  ${n.status} ${n.method} ${n.url}${n.body ? `\n      ${n.body.slice(0, 300)}` : ''}`);
console.log('\n— Errores —');
for (const e of [...new Set(errs)].slice(0, 10)) console.log(`  ${e.slice(0, 220)}`);
console.log('\n— Pantalla final —\n', finalText.slice(0, 1200));

await browser.close();
