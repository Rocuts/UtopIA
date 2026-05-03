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
relatedNorms: ["Ley 2277 de 2022", "Decreto 1625 de 2016", "ET Art. 365"]
fetch_failed: false
---

# Decreto 572 de 2025 — Aumento de autorretención de renta y bases mínimas

## Resumen ejecutivo

El Decreto 572 del 28 de mayo de 2025 modifica las tarifas de autorretención de renta del impuesto sobre la renta de personas jurídicas y ajusta las bases mínimas para la práctica de retención en la fuente. Entró en vigor el **1 de junio de 2025** y aplica para todo el ejercicio gravable 2025 en adelante. Se enmarca dentro de las medidas para acercar el recaudo anticipado del impuesto al 35% efectivo dispuesto por la Ley 2277/2022 (Art. 240 ET).

## Cambios principales

### 1. Autorretención de renta (Art. 1)
Las tarifas se incrementan según código CIIU. Tarifas representativas:
- **Servicios financieros y de seguros**: aumento al 4,80% (antes 2,40%)
- **Actividades industriales y manufactureras**: rangos entre 0,80% y 1,60%
- **Comercio al por mayor y menor**: 0,55% — 1,10%
- **Sector minero-energético**: tarifas específicas con sobretasa Decreto 1474/2025
- **Servicios profesionales y técnicos**: 1,10% — 2,20%

> Las tarifas exactas se publican en el Anexo del Decreto. El cliente debe consultar su CIIU principal y aplicar la tarifa correspondiente.

### 2. Bases mínimas (Art. 2)
Se mantienen las bases mínimas históricas en **UVT** (no en pesos):
- Compras: 27 UVT (≈ $1.414.098 con UVT 2026 = $52.374)
- Servicios generales: 4 UVT (≈ $209.496)
- Honorarios: sin base mínima

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
