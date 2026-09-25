---
slug: decreto_572_2025_autorretenciones
title: "Decreto 572 de 2025 — Aumento autorretención de renta y bases mínimas"
docType: tax_decree
entity: MinHacienda
year: 2025
normCode: "Decreto 572 de 2025"
normUrl: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260016
status: vigente
effectiveFrom: 2025-06-01
lastVerified: 2026-05-02
tags: [autorretencion, renta, dian, retenciones, 2025, 2026]
relatedNorms: ["Ley 2155 de 2021", "Ley 2277 de 2022", "Decreto 1625 de 2016", "ET Art. 365"]
fetch_failed: false
---

# Decreto 572 de 2025 — Aumento de autorretención de renta y bases mínimas

## Resumen ejecutivo

El Decreto 572 del 28 de mayo de 2025 modifica las tarifas de autorretención de renta del impuesto sobre la renta de personas jurídicas y ajusta las bases mínimas para la práctica de retención en la fuente. Entró en vigor el **1 de junio de 2025** y aplica para todo el ejercicio gravable 2025 en adelante. Se enmarca dentro de las medidas para acercar el recaudo anticipado al impuesto a cargo, liquidado con la tarifa general del 35 % del Art. 240 E.T. (fijada por el art. 7 de la Ley 2155 de 2021 a partir del año gravable 2022 y conservada por el art. 10 de la Ley 2277 de 2022).

## Cambios principales

### 1. Autorretención de renta (Art. 1)
Las tarifas se incrementan según código CIIU. Tarifas representativas:
- **Servicios financieros y de seguros**: aumento al 4,80% (antes 2,40%)
- **Actividades industriales y manufactureras**: rangos entre 0,80% y 1,60%
- **Comercio al por mayor y menor**: 0,55% — 1,10%
- **Sector minero-energético**: tarifas específicas con sobretasa Decreto 1474/2025
- **Servicios profesionales y técnicos**: 1,10% — 2,20%

> Las tarifas exactas se publican en el Anexo del Decreto. El cliente debe consultar su CIIU principal y aplicar la tarifa correspondiente.

### 2. Bases mínimas (Arts. 2 y 6)
El decreto **reduce** las bases mínimas en UVT (texto primario en `decreto_0572_2025.md`):
- **Servicios**: no se practica retención cuando la cuantía individual es inferior a **2 UVT** (art. 2 → DUR 1625/2016 Art. 1.2.4.4.1; antes 4 UVT). 2 UVT ≈ $104.748 con UVT 2026.
- **Compras y demás otros ingresos tributarios**: excluidos los pagos inferiores a **10 UVT** (art. 6 → literal i del Art. 1.2.4.9.1; antes 27 UVT). 10 UVT ≈ $523.740 con UVT 2026.
- Honorarios: sin base mínima.

Vigencia: desde el 01-jun-2025 (art. 9: primer día del mes siguiente a la publicación). Entre el 08-may y el 30-jun-2026 rigieron de nuevo las bases anteriores (4 / 27 UVT) por suspensión provisional del Consejo de Estado; las bases reducidas se restablecieron desde el 01-jul-2026 (auto CE 30229 del 02-jun-2026).

> Corrección auditoría 2026-09: la versión anterior de este resumen afirmaba que el decreto mantenía las bases de 27 y 4 UVT, en contradicción con su propio texto.

### 3. Excluidos
- Régimen SIMPLE de tributación (Arts. 903-916 ET) — no aplican autorretención.
- Pequeñas empresas inscritas en Ley 1429/2010 durante los primeros años de progresividad (consultar Art. 4 del Decreto).

## Aplicación práctica para clientes 1+1

| Sector cliente | Tarifa autorretención post-Dec 572 | Recordatorio |
|----------------|------------------------------------|--------------|
| Comercio | 0,55% – 1,10% | Verificar CIIU exacto en RUT |
| Servicios profesionales | 1,10% – 2,20% | |
| Construcción | 0,80% – 2,20% | Tarifas más altas en obra civil |
| Industria manufacturera | 0,80% – 1,60% | |
| Financiero | 4,80% | + sobretasa 5pp Decreto 1474/2025 |

**Implementación contable**: el asiento mensual de autorretención afecta:
- DB 5405 Impuesto de renta (provisión)
- CR 2367 Retención en la fuente — autorretención

Acreditación contra impuesto de renta del año al presentar la declaración (Form. 110 o 210).

## Modificaciones recientes
- **Decreto 1474/2025** (29-dic-2025): suma sobretasa al sector financiero (50%); aplica además del Decreto 572.
- **Decreto 1625/2016** (DUR): texto consolidado del régimen, Decreto 572 lo modifica.

## Notas para 1+1

1. El motor de reglas fiscales debe leer el CIIU del workspace (campo `taxRegime` o complementario) para aplicar la tarifa correcta.
2. La provisión mensual del impuesto de renta debe usar la tarifa de autorretención aumentada para que el saldo a pagar al cierre del año sea menor.
3. Si el cliente está en SIMPLE: NO aplicar autorretención (validar regime en `third_parties.taxRegime = 'simple'`).
4. Para Conceptos DIAN sobre interpretación: ver Concepto DIAN 100208192-117/2026 (sobre Decreto 1474/2025) y futuros conceptos.

## Fuente

- **URL canónica**: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260016
- **Fuentes secundarias** (verificación cruzada):
  - INCP — Análisis Decreto 572/2025
  - Holland & Knight — Alerta tributaria mayo 2025
  - Actualícese — Calendario tributario 2026
- **Fecha de consulta**: 2026-05-02
