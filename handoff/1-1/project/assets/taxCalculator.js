/* ============================================================
   1+1 · taxCalculator.js  — Régimen Simple (RST) vs Ordinario
   Colombia · UVT 2026. Funciones puras, sin dependencias.
   Funciona en navegador (window.TaxCalc) y en Node (module.exports),
   por lo que el mismo archivo sirve para el prototipo y para tests.

   ⚠️ TARIFAS ILUSTRATIVAS: las tasas RST por grupo CIIU y la carga
   del régimen ordinario están calibradas para demostración. Antes de
   producción, reemplace RST_GROUPS y los componentes de
   computeOrdinario() con las tablas oficiales DIAN vigentes.
   ============================================================ */
(function (root) {
  'use strict';

  // ---- Constantes 2026 (Res. DIAN 000238 del 15-dic-2025) ----
  var UVT_2026 = 52374;
  var SMMLV_2026 = 1750905;
  var TOPE_RST_UVT = 3500;   // 3.500 UVT — IVA / INC bimestral = $183.309.000
  var TOPE_ORD_UVT = 1400;   // 1.400 UVT — renta ordinaria      = $73.323.600
  var RENTA_EXENTA_UVT = 1090; // Art. 241 E.T. — primer tramo a 0%

  // ---- Tarifas RST consolidadas por grupo CIIU (ilustrativas) ----
  // Grupo "tiendas, minimercados, micromercados y peluquería".
  var RST_GROUPS = {
    tiendas: [
      { uvtMax: 6000,     rate: 0.0188 },
      { uvtMax: 15000,    rate: 0.0240 },
      { uvtMax: 30000,    rate: 0.0290 },
      { uvtMax: Infinity, rate: 0.0340 }
    ],
    servicios: [
      { uvtMax: 6000,     rate: 0.0590 },
      { uvtMax: 15000,    rate: 0.0750 },
      { uvtMax: 30000,    rate: 0.0860 },
      { uvtMax: Infinity, rate: 0.0950 }
    ]
  };

  function uvt(cop) { return cop / UVT_2026; }
  function topeRST() { return TOPE_RST_UVT * UVT_2026; }      // 183.309.000
  function topeOrdinario() { return TOPE_ORD_UVT * UVT_2026; } // 73.323.600

  // RST = ingresos × tarifa_grupo_CIIU − aportes_pension_PILA
  function computeRST(annualSales, group, aportesPension) {
    group = group || 'tiendas';
    aportesPension = aportesPension || 0;
    var brackets = RST_GROUPS[group] || RST_GROUPS.tiendas;
    var u = uvt(annualSales), rate = brackets[brackets.length - 1].rate;
    for (var i = 0; i < brackets.length; i++) {
      if (u <= brackets[i].uvtMax) { rate = brackets[i].rate; break; }
    }
    return Math.max(0, annualSales * rate - aportesPension);
  }

  // Ordinario = renta (Art.241) + ICA municipal + IVA bimestral neto
  function computeOrdinario(annualSales, opts) {
    opts = opts || {};
    var margin = opts.margin != null ? opts.margin : 0.35; // utilidad / ventas
    var icaRate = opts.icaRate != null ? opts.icaRate : 0.011; // 11‰ comercio
    var ivaNetRate = opts.ivaNetRate != null ? opts.ivaNetRate : 0.01566;

    var ica = annualSales * icaRate;
    var utilidad = annualSales * margin;
    var utilidadUVT = uvt(utilidad);
    var renta = utilidadUVT <= RENTA_EXENTA_UVT
      ? 0
      : (utilidadUVT - RENTA_EXENTA_UVT) * UVT_2026 * 0.19; // tramo Art.241
    var ivaNeto = annualSales * ivaNetRate;
    return { total: ica + renta + ivaNeto, ica: ica, renta: renta, iva: ivaNeto };
  }

  // Semáforo fiscal: verde hasta 80% del tope, amarillo hasta el tope, rojo encima.
  function semaforo(annualSales, topeUVT) {
    var tope = (topeUVT || TOPE_RST_UVT) * UVT_2026;
    var pct = annualSales / tope;
    var level = pct < 0.8 ? 'verde' : (pct < 1 ? 'amarillo' : 'rojo');
    var message = {
      verde: 'Va bien — todavía no llega al tope donde le empiezan a cobrar más.',
      amarillo: 'Ojo — está cerca del tope. Pronto podría cambiar de régimen.',
      rojo: 'Pasó el tope. Toca revisar su régimen tributario.'
    }[level];
    return { level: level, pct: pct, tope: tope, sales: annualSales, message: message };
  }

  // Comparación RST vs Ordinario → recomendación + ahorro anual.
  function compare(annualSales, opts) {
    opts = opts || {};
    var rst = computeRST(annualSales, opts.group, opts.aportesPension);
    var ord = computeOrdinario(annualSales, opts).total;
    var recommended = rst <= ord ? 'RST' : 'Ordinario';
    return {
      rst: rst,
      ordinario: ord,
      recommended: recommended,
      savings: Math.abs(ord - rst),
      semaforo: semaforo(annualSales, TOPE_RST_UVT)
    };
  }

  var api = {
    UVT_2026: UVT_2026, SMMLV_2026: SMMLV_2026,
    TOPE_RST_UVT: TOPE_RST_UVT, TOPE_ORD_UVT: TOPE_ORD_UVT,
    RST_GROUPS: RST_GROUPS,
    uvt: uvt, topeRST: topeRST, topeOrdinario: topeOrdinario,
    computeRST: computeRST, computeOrdinario: computeOrdinario,
    semaforo: semaforo, compare: compare
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaxCalc = api;
})(typeof window !== 'undefined' ? window : null);
