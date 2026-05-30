/* =============================================================================
 * DIAGNOSTICO_CONSOLA.js — Verificador del puente 1+1 (WindowBridge)
 * =============================================================================
 *
 * CÓMO USARLO
 *   1. Abre la app en el navegador, idealmente en una ruta de workspace
 *      (p.ej. /workspace/escudo, /workspace/valor, /workspace/verdad,
 *      /workspace/futuro). El âncora se espeja apenas hay un reporte NIIF
 *      completado en la sesión.
 *   2. Abre la consola del navegador (DevTools → Console).
 *   3. Pega TODO este archivo y presiona Enter.
 *
 * QUÉ VERIFICA
 *   Las APIs `window.sendPrompt` y `window.storage`, la clave espejo
 *   `ancora_completo_2025`, las variables CSS y los íconos Tabler. Todo eso lo
 *   provee `src/components/system/WindowBridge.tsx`, montado dentro de
 *   <WorkspaceProvider> en `src/app/workspace/layout.tsx`. El espejo del âncora
 *   sale de datos REALES (`useAncoraView`), nunca de cifras inventadas — por eso
 *   si no hay reporte, varios tests reportan "Sin âncora para verificar".
 * ========================================================================== */

(async () => {
  const ok = (m) => console.log('%c✅ ' + m, 'color:#4F7A4C;font-weight:600');
  const bad = (m) => console.log('%c❌ ' + m, 'color:#A83838;font-weight:600');
  const warn = (m) => console.log('%c⚠️  ' + m, 'color:#C48A2E;font-weight:600');
  const head = (m) =>
    console.log('%c\n── ' + m + ' ' + '─'.repeat(Math.max(0, 48 - m.length)),
      'color:#B8934A;font-weight:700');

  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass, detail: detail || '' });
    (pass === true ? ok : pass === 'warn' ? warn : bad)(
      name + (detail ? ' — ' + detail : ''),
    );
  };

  console.log(
    '%c🩺 Diagnóstico de consola 1+1 — puente WindowBridge',
    'color:#B8934A;font-size:14px;font-weight:800',
  );

  // ── Test 1: window.storage (shim async sobre localStorage, shape { value }) ──
  head('Test 1 · window.storage');
  try {
    if (typeof window.storage === 'undefined') {
      record('window.storage existe', false, 'no definido (¿estás dentro de /workspace?)');
    } else {
      await window.storage.set('_test_diag', 'ok');
      const got = await window.storage.get('_test_diag');
      const roundtrip = got && got.value === 'ok';
      await window.storage.delete('_test_diag');
      const gone = await window.storage.get('_test_diag');
      record(
        'window.storage get/set/delete',
        roundtrip && gone === null,
        roundtrip ? (gone === null ? 'round-trip OK' : 'delete no limpió') : 'set/get falló',
      );
    }
  } catch (e) {
    record('window.storage', false, String(e));
  }

  // ── Test 2: âncora espejada (ancora_completo_2025) ───────────────────────────
  head('Test 2 · âncora (ancora_completo_2025)');
  let ancora = null;
  try {
    const saved = window.storage ? await window.storage.get('ancora_completo_2025') : null;
    if (!saved) {
      record('ancora_completo_2025 presente', 'warn', 'Sin âncora para verificar (no hay reporte NIIF en sesión)');
    } else {
      ancora = JSON.parse(saved.value);
      const hasEmpresa = 'empresa' in ancora;
      const hasA07 = 'A07' in ancora;
      const hasF01 = 'F01' in ancora;
      record(
        'estructura espejo (empresa, A07, F01)',
        hasEmpresa && hasA07 && hasF01,
        `empresa=${JSON.stringify(ancora.empresa)} A07=${ancora.A07} F01=${ancora.F01}`,
      );
    }
  } catch (e) {
    record('ancora_completo_2025', false, String(e));
  }

  // ── Test 3: valores derivados (honestos, sin forzar si falta âncora) ─────────
  head('Test 3 · valores derivados');
  if (!ancora) {
    record('crecimiento de ingresos', 'warn', 'Sin âncora para verificar');
    record('score DIAN', 'warn', 'Sin âncora para verificar');
    record('cobertura retenciones (F10)', 'warn', 'Sin âncora para verificar');
    record('variación de caja A19', 'warn', 'Sin âncora para verificar');
  } else {
    // Crecimiento de ingresos: (A07 - A08) / A08 * 100
    if (typeof ancora.A07 === 'number' && typeof ancora.A08 === 'number' && ancora.A08 !== 0) {
      const calc = ((ancora.A07 - ancora.A08) / ancora.A08) * 100;
      const espejo = ancora.crecimientoIngresosPct;
      const coincide = espejo == null || Math.abs(calc - espejo) < 0.5;
      record('crecimiento de ingresos', coincide,
        `calc=${calc.toFixed(2)}% espejo=${espejo == null ? 'null' : espejo + '%'}`);
    } else {
      record('crecimiento de ingresos', 'warn', 'A07/A08 no numéricos o A08=0');
    }

    // Score DIAN: si existe, se espera 68 en el escenario base.
    if (typeof ancora.scoreRiesgoDIAN === 'number') {
      record('score DIAN', ancora.scoreRiesgoDIAN === 68 ? true : 'warn',
        `valor=${ancora.scoreRiesgoDIAN}${ancora.scoreRiesgoDIAN === 68 ? '' : ' (esperado base: 68)'}`);
    } else {
      record('score DIAN', 'warn', 'no disponible en el espejo');
    }

    // Cobertura de retenciones F10 ≈ 5.9 % (escenario base).
    if (typeof ancora.F10 === 'number') {
      record('cobertura retenciones (F10)', Math.abs(ancora.F10 - 5.9) < 0.5 ? true : 'warn',
        `F10=${ancora.F10}% (referencia base ≈ 5.9%)`);
    } else {
      record('cobertura retenciones (F10)', 'warn', 'F10 no disponible');
    }

    // A19 = variación de caja del período (NO es Free Cash Flow).
    record('variación de caja A19',
      'A19' in ancora ? true : 'warn',
      'A19' in ancora ? `A19=${ancora.A19} (variación de caja, no FCF)` : 'no disponible');
  }

  // ── Test 4: window.sendPrompt ────────────────────────────────────────────────
  head('Test 4 · window.sendPrompt');
  record('window.sendPrompt es función', typeof window.sendPrompt === 'function',
    typeof window.sendPrompt === 'function'
      ? 'cableado al orquestador (setPendingChatSeed + router.push)'
      : 'no definido (¿estás dentro de /workspace?)');

  // ── Test 5: variables CSS (alias del diagnóstico + tokens reales) ────────────
  head('Test 5 · variables CSS');
  const cs = getComputedStyle(document.documentElement);
  const readVar = (n) => cs.getPropertyValue(n).trim();
  const aliasVars = [
    '--color-background-primary',
    '--color-text-primary',
    '--color-text-secondary',
    '--color-border-tertiary',
  ];
  const realVars = ['--n-0', '--n-1000', '--n-700'];
  const aliasPresent = aliasVars.filter((v) => readVar(v) !== '');
  const realPresent = realVars.filter((v) => readVar(v) !== '');
  record('alias de compatibilidad',
    aliasPresent.length === aliasVars.length ? true : 'warn',
    `${aliasPresent.length}/${aliasVars.length} (${aliasPresent.join(', ')})`);
  record('tokens reales --n-*',
    realPresent.length === realVars.length,
    realPresent.map((v) => `${v}=${readVar(v)}`).join('  '));

  // ── Test 6: Tabler Icons ─────────────────────────────────────────────────────
  head('Test 6 · Tabler Icons');
  try {
    const i = document.createElement('i');
    i.className = 'ti ti-check';
    i.style.position = 'absolute';
    i.style.visibility = 'hidden';
    document.body.appendChild(i);
    const ff = getComputedStyle(i).fontFamily.toLowerCase();
    document.body.removeChild(i);
    record('fuente tabler cargada', ff.includes('tabler'),
      `font-family="${ff}"${ff.includes('tabler') ? '' : ' (¿stylesheet aún cargando?)'}`);
  } catch (e) {
    record('Tabler Icons', false, String(e));
  }

  // ── Test 7: módulos en el DOM (data-modulo) ──────────────────────────────────
  head('Test 7 · módulos en el DOM');
  ['escudo', 'valor', 'verdad', 'futuro'].forEach((m) => {
    const el = document.querySelector(`[data-modulo='${m}']`);
    record(`módulo ${m}`, el ? true : 'warn',
      el ? 'presente en esta vista' : 'no en esta vista (navega a su área)');
  });

  // ── Resumen ──────────────────────────────────────────────────────────────────
  head('Resumen');
  const pass = results.filter((r) => r.pass === true).length;
  const warns = results.filter((r) => r.pass === 'warn').length;
  const fail = results.filter((r) => r.pass === false).length;
  console.log(
    `%c${pass} ✅   ${warns} ⚠️   ${fail} ❌   (de ${results.length} checks)`,
    'font-weight:800;font-size:13px',
  );

  // ── Tabla de soluciones ────────────────────────────────────────────────────
  head('Tabla de soluciones');
  console.table([
    { Síntoma: 'window.storage / sendPrompt no existe', Causa: 'No estás dentro de /workspace (WindowBridge solo monta ahí)', Solución: 'Navega a /workspace/* y reejecuta' },
    { Síntoma: 'Sin âncora para verificar', Causa: 'No hay reporte NIIF completado en sesión', Solución: 'Genera un reporte NIIF; el espejo es de datos reales, no se inventa' },
    { Síntoma: 'score DIAN ≠ 68 / F10 ≠ 5.9', Causa: 'Tus cifras reales difieren del escenario base', Solución: 'Es informativo (warn), no un error' },
    { Síntoma: 'fuente tabler no cargada', Causa: 'Stylesheet CDN aún descargando o bloqueado', Solución: 'Espera y reejecuta; revisa red/CSP (lucide sigue siendo primario)' },
    { Síntoma: 'módulo X no en esta vista', Causa: 'data-modulo solo existe en su propia área', Solución: 'Navega a /workspace/<área> correspondiente' },
  ]);

  return { pass, warns, fail, results };
})();
