# Auditoría normativa de UtopIA — 2026-08-07

Verificación de **cada constante, tarifa, umbral en UVT y plazo** codificado en el repositorio
contra la normativa colombiana vigente. Diez auditores en paralelo, uno por dominio tributario,
con la instrucción de no dar por buena ninguna cifra de memoria y de citar fuente para cada
afirmación.

> **Por qué existe este informe.** UtopIA emite dictámenes fiscales y reportes NIIF que el
> cliente firma frente a la DIAN. Una tarifa, un umbral o una fecha de vencimiento
> desactualizada no es deuda técnica: es una sanción real para el cliente y responsabilidad
> profesional para la plataforma.

## Resumen

| Severidad | Discrepancias |
|---|---|
| P0 — cálculo de impuesto incorrecto, sanción, o recomendación de régimen errada | 46 |
| P1 — cifra desactualizada visible al usuario | 45 |
| P2 — riesgo latente | 34 |
| P3 — cosmético | 5 |
| **Total** | **130** |

Nivel de verificación declarado por los auditores:

| Confianza | Discrepancias |
|---|---|
| verificado-fuente-secundaria | 84 |
| verificado-fuente-oficial | 46 |

Además, **68 valores** quedaron marcados como no verificables contra fuente: no son
discrepancias probadas, pero son riesgo mientras alimenten una recomendación al usuario.

### Lo que sí está bien

- **UVT 2026 = $52.374** es correcta (Res. DIAN 000238 del 15-dic-2025), y la serie histórica
  2020–2026 coincide íntegramente con la resolución de cada año.
- La reforma tributaria radicada en septiembre de 2025 fue **hundida en el Senado el 09-dic-2025**,
  por lo que la Ley 2277/2022 sigue siendo el marco vigente y no hay cambios de umbrales por reforma.

## Discrepancias P0

### P0-1 · Tarifa de retención en la fuente por honorarios y comisiones a personas naturales (declarante vs. no declarante)

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:34`  
**Norma:** Art. 392, inciso 2 E.T. (mod. Ley 1819/2016 art. 75) y Decreto 1625/2016 Art. 1.2.4.3.1  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** La regla 10%/11% rige sin cambios desde el año gravable 2017 (Ley 1819/2016) y sigue vigente en 2026; el Decreto 0572/2025 no la modificó. No hay transición.

| | |
|---|---|
| En el repo | RTF_HONORARIOS_PN → tarifaDeclarante: '10%', tarifaNoDeclarante: '11%' |
| Según la norma | tarifaDeclarante: 11%, tarifaNoDeclarante: 10%. El 11% aplica al beneficiario obligado a declarar renta, y también al no declarante cuando los pagos acumulados del mismo agente retenedor en el año superan 3.300 UVT ($172.834.200 con UVT 2026). |

**Impacto.** El catálogo es la fuente que alimenta los dictámenes: el motor recomendará retener 10% a un contratista declarante (retención por defecto → responsabilidad solidaria del agente retenedor por la suma dejada de retener, Art. 370 E.T.) y 11% a un no declarante (retención en exceso → reintegro y reproceso). Ambos sentidos generan un dictamen firmado ante la DIAN con la tarifa equivocada.

**Fuente.** https://www.gerencie.com/retencion-en-la-fuente-por-honorarios.html y https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_901110_2021.htm y https://www.gerencie.com/tabla-de-retencion-en-la-fuente-2026.html

### P0-2 · Tarifas de la autorretención especial a título de renta por actividad económica (CIIU)

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:104`  
**Norma:** Decreto 0572/2025 art. 8, que sustituye el Art. 1.2.6.8 del Decreto 1625/2016; antecedentes: Decreto 2201/2016, Decreto 0261/2023, Decreto 242/2024  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente desde el 01-jul-2026 (primer día del mes siguiente a la ejecutoria del auto del Consejo de Estado del 02-jun-2026 que revocó la suspensión provisional). Entre el 08-may y el 30-jun-2026 rigieron las tarifas anteriores (0,55/1,1/2,2 del Decreto 242/2024) y lo practicado en esa ventana no debe corregirse. El proceso de nulidad de fondo sigue abierto.

| | |
|---|---|
| En el repo | RTF_AUTORETENCIONES_ESPECIALES_CIIU → tarifaDeclarante: '0.4% / 1.1% / 1.6% según CIIU'; comentario línea 107: 'Las tasas 0.4%, 1.1% y 1.6% aplican según el código CIIU'; normaRef: 'Decreto 1625/2016, Arts. 1.2.6.6 a 1.2.6.11' |
| Según la norma | Desde el 01-jul-2026 rigen las tarifas del art. 8 del Decreto 0572/2025, que sustituyó el art. 1.2.6.8 del DUR 1625/2016: 0,55%, 1,10%, 1,20%, 1,70%, 2,20%, 2,80%, 3,50% y 4,50% según CIIU (p. ej. transporte de carga y construcción residencial 3,50%; carbón, gas natural, oro y generación eléctrica 4,50%; comercio mayorista general 0,55%). El juego '0,4 / 0,8 / 1,6' es el del Decreto 2201/2016 (derogado) y '0,55 / 1,1 / 2,2' el de los Decretos 0261/2023 y 242/2024 (rigieron sólo hasta el 30-jun-2026). La combinación '0,4 / 1,1 / 1,6' que trae el repo no corresponde a ninguna versión de la norma. |

**Impacto.** La autorretención especial se liquida directamente sobre ingresos brutos y se declara mensual/cuatrimestralmente en el Formulario 350. Con 1,1% donde la norma exige 3,50% o 4,50% el contribuyente subdeclara la autorretención en más del 200%, lo que genera sanción por inexactitud (Art. 648 E.T.) e intereses moratorios; en el sentido inverso descapitaliza flujo de caja. Además el `normaRef` omite el Decreto 0572/2025, por lo que el dictamen cita una norma sustituida.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0572_2025.htm y https://actualicese.com/tabla-automatizada-con-las-tarifas-de-autorretencion-especial-en-renta/

### P0-3 · Sujetos no sometidos a retención: exclusión de autorretenedores, grandes contribuyentes autorretenedores y entidades no sujetas

**Ubicación:** `src/lib/accounting/tax-engine/rules-engine.ts:121`  
**Norma:** Art. 369 E.T. (pagos no sometidos a retención); Art. 368 par. 1 E.T. y Decreto 1625/2016 Arts. 1.2.6.1 y 1.2.6.2 (régimen de autorretenedores y resolución DIAN de autorización)  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Regla estructural vigente sin cambios en 2026. El Decreto 0572/2025 no la alteró.

| | |
|---|---|
| En el repo | const matches = triggers.supplierRegimes.some((r) => profileRegimes.includes(r)); if (!matches) continue; — con profileRegimes = [profile.regime, 'gran_contribuyente'?, 'autorretenedor'?, 'regimen_simple'?, 'no_responsable_iva'?] y triggers.supplierRegimes = ['regimen_comun','persona_natural'] en RTF_SVC_4 y RTF_HONO_11 (src/lib/db/seeds/tax-rules-co-2026.ts:102 y :117). El comentario del seed en :99-101 afirma que la regla 'Aplica cuando el proveedor es régimen común y NO es autorretenedor ni gran contribuyente'. |
| Según la norma | No hay lugar a retención en la fuente cuando el beneficiario del pago es autorretenedor del respectivo concepto, ni sobre los pagos a entidades no contribuyentes y demás sujetos expresamente excluidos. El agente retenedor debe abstenerse; practicarla es retención improcedente sujeta a reintegro. |

**Impacto.** El match es INCLUSIVO: un proveedor cuyo `regime` es 'regimen_comun' y que además tiene isAutorretenedor=true o isGranContribuyente=true sigue matcheando por 'regimen_comun', de modo que el motor le practica ReteFuente del 4% u 11%. No existe campo `excludeSupplierRegimes` en el JSONB `applicable_triggers` (src/lib/db/schema-tax.ts:156-157), por lo que la exclusión NO es expresable con el esquema actual: el comentario del seed describe un comportamiento que el código no implementa. Consecuencia: retención improcedente al proveedor, reclamo de reintegro, y comprobantes contables (cuenta 236525) que no cuadran con los certificados de retención emitidos.

**Fuente.** https://estatuto.co/369 y https://www.gerencie.com/tabla-de-retencion-en-la-fuente-2026.html

### P0-4 · Tarifa de dividendos para persona natural residente en el bloque de contexto normativo que se antepone a TODOS los agentes del pipeline financiero

**Ubicación:** `src/lib/agents/financial/prompts/colombia-2026-context.ts:57`  
**Norma:** Art. 242 E.T. modificado por el Art. 3 de la Ley 2277 de 2022; Art. 245 E.T. modificado por el Art. 4 de la Ley 2277 de 2022; Decreto 1103 de 2023  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** El régimen del Art. 241 + retención 15%/1.090 UVT rige desde el año gravable 2023 y sigue vigente en 2026. No hubo transición: la tarifa plana desapareció el 1-ene-2023. El Decreto Legislativo 1474/2025 no tocó dividendos y además fue declarado inexequible (C-079/2026).

| | |
|---|---|
| En el repo | **Ajustes al regimen de dividendos** (Art. 242 ET — 20% para personas naturales residentes, retencion en fuente mas tarifa especial; Art. 242-1 ET para sociedades nacionales). |
| Según la norma | Art. 242 E.T. (mod. Art. 3 Ley 2277/2022): los dividendos no gravados pagados a persona natural residente INTEGRAN la base gravable y tributan a la tarifa progresiva del Art. 241 (0% a 39%), con retención en la fuente del 15% sobre el exceso de 1.090 UVT ($57.087.660 en 2026) y descuento tributario del Art. 254-1 (19% sobre lo que exceda 1.090 UVT). El 20% NO es Art. 242: es la tarifa del Art. 245 para NO residentes. |

**Impacto.** Este bloque se antepone al system prompt del Agente 1 NIIF, Agente 2 Estrategia y Agente 3 Gobierno. Cualquier proyección de flujo de caja al socio, cálculo de carga tributaria por distribución o recomendación de reparto usará 20% en vez de la escala real (que puede llegar a 39% marginal, o a 0% para montos bajo 1.090 UVT). Sobreestima el impuesto en repartos pequeños y lo SUBESTIMA en repartos grandes, produciendo una recomendación de distribución errada y un dictamen firmado con una tarifa inexistente — expuesto al Art. 647 E.T.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm y https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883

### P0-5 · Misma tarifa falsa de dividendos en la versión en inglés del contexto normativo global

**Ubicación:** `src/lib/agents/financial/prompts/colombia-2026-context.ts:124`  
**Norma:** Art. 242 E.T. modificado por el Art. 3 de la Ley 2277 de 2022; Decreto 1103 de 2023  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente desde el año gravable 2023, aplicable en 2026.

| | |
|---|---|
| En el repo | **Adjustments to the dividend regime** (Art. 242 ET — 20% for resident individuals, withholding plus special rate; Art. 242-1 ET for domestic companies). |
| Según la norma | Art. 242 E.T.: resident individuals' non-taxed dividends are integrated into the ordinary tax base at the Art. 241 progressive scale (0%-39%), with 15% withholding on the excess over 1,090 UVT. The 20% rate belongs to Art. 245 (non-residents). |

**Impacto.** Idéntico al hallazgo anterior para cualquier cliente que corra el pipeline en inglés. Un reporte bilingüe emitirá dos cifras distintas para el mismo concepto si solo se corrige la versión ES.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm

### P0-6 · Macro-supuesto de tarifa de dividendos usado por el Director de Estrategia para construir los 3 escenarios financieros obligatorios

**Ubicación:** `src/lib/agents/financial/prompts/strategy-director.prompt.ts:195`  
**Norma:** Arts. 242, 242-1, 245 y 254-1 E.T. (Ley 2277 de 2022); Decreto 1103 de 2023  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Desde el año gravable 2023, vigente en 2026.

| | |
|---|---|
| En el repo | - Dividendos: 20% (Art. 242 E.T.). |
| Según la norma | No existe tarifa plana de 20% en el Art. 242. Persona natural residente: integración a la base con tarifa Art. 241 (0%-39%) + retención 15% sobre el exceso de 1.090 UVT + descuento Art. 254-1 (19%). Sociedad nacional receptora: 10% trasladable (Art. 242-1). No residente: 20% (Art. 245). |

**Impacto.** Los escenarios Conservative/Base/Aggressive proyectan el flujo neto al socio con una tarifa inexistente. La decisión estratégica de reparto vs retención de utilidades que el cliente toma sobre ese modelo queda mal fundamentada, y el reporte editorial firmado cita un artículo con una tarifa que la DIAN puede desvirtuar de inmediato.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm

### P0-7 · Tarifa de retención sobre dividendos gravados que el Auditor Legal debe afirmar en el dictamen societario

**Ubicación:** `src/lib/agents/financial/audit/prompts/legal-auditor.prompt.ts:69`  
**Norma:** Art. 242 inciso 2 E.T. (mod. Art. 3 Ley 2277 de 2022); Art. 240 E.T.; Decreto 1103 de 2023  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** La escala del 10% sobre el exceso de 300 UVT quedó derogada el 31-dic-2022; el régimen actual rige desde el año gravable 2023 y aplica en 2026.

| | |
|---|---|
| En el repo | - Dividendos: pago dentro del ano siguiente al decreto (Art. 156 C.Co.). Retencion 10% dividendos gravados (Art. 242 E.T.). |
| Según la norma | Los dividendos GRAVADOS (provenientes de utilidades gravadas conforme al parágrafo 2 del Art. 49 E.T.) pagados a persona natural residente están sujetos a la tarifa del Art. 240 E.T. (35%) y, una vez disminuido ese impuesto, el remanente se somete al régimen del inciso 1 del Art. 242 (Art. 241). No existe retención del 10%: el 10% era la escala derogada del Art. 242 pre-Ley 2277/2022 (10% sobre el exceso de 300 UVT). |

**Impacto.** Subestima la carga sobre dividendos gravados en 25 puntos porcentuales (10% vs 35%). El acta de asamblea y el dictamen legal que el cliente firma afirmarán una retención inexistente; si la sociedad practica retención al 10% queda como agente retenedor en falta con sanción del Art. 370 E.T. (responde por la suma no retenida) más intereses. Contradice directamente el propio prompt del dividend-optimizer, que prohíbe explícitamente el 10% legacy.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm ('Cuando provienen de utilidades gravadas conforme al parágrafo 2 del artículo 49 E.T., se aplica la tarifa general del artículo 240 E.T.')

### P0-8 · Instrucción que fuerza el campo impuestoDividendosComment del dictamen a repetir la retención del 10%

**Ubicación:** `src/lib/agents/financial/audit/prompts/legal-auditor.prompt.ts:89`  
**Norma:** Art. 242 E.T. (mod. Art. 3 Ley 2277 de 2022); Art. 240 E.T.; Decreto 1103 de 2023  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente desde el año gravable 2023.

| | |
|---|---|
| En el repo | impuestoDividendosComment SIEMPRE menciona Art. 242 E.T. (retencion 10% dividendos gravados). |
| Según la norma | El comentario debe reflejar: dividendos no gravados a PN residente = retención 15% sobre el exceso de 1.090 UVT (Art. 242 par.) e integración a la base del Art. 241; dividendos gravados = tarifa del Art. 240 (35%) y luego Art. 241 sobre el remanente. |

**Impacto.** Es un ALWAYS: garantiza que la cifra errada llegue al campo estructurado del reporte y al PDF firmado en el 100% de las corridas, no solo ocasionalmente. Los fixtures de test (src/lib/agents/financial/audit/__tests__/legal-auditor.render.test.ts:59 y :163) reproducen el mismo 'Retencion 10%', de modo que la regresión está blindada contra la corrección.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm

### P0-9 · Fórmula del impuesto al socio en el escenario 'distribuir 100%' del optimizador de dividendos

**Ubicación:** `src/lib/agents/financial/escudo-survival/prompts/dividend-optimizer.prompt.ts:48`  
**Norma:** Art. 242 E.T. y su parágrafo; Art. 241 E.T.; Art. 254-1 E.T. (adicionado por el Art. 5 de la Ley 2277 de 2022); Decreto 1103 de 2023  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente desde el año gravable 2023, aplicable a 2026. El Art. 254-1 existe desde el AG 2023 y el propio catálogo del repo lo reconoce (estatuto-tributario.ts:254) pero el optimizador no lo aplica.

| | |
|---|---|
| En el repo | data.escenarios.distribuirTotal: impuestoSocio = max(0, (utilidadDistribuible - 57.087.660) x 0.15); ahorroSocio = 0; netoSocio = utilidadDistribuible - impuestoSocio; fortPatrimonio = 0. |
| Según la norma | El 15% sobre el exceso de 1.090 UVT es RETENCIÓN EN LA FUENTE (parágrafo del Art. 242 E.T. y Decreto 1103 de 2023), es decir un anticipo imputable, no el impuesto definitivo. El impuesto definitivo del socio persona natural residente es el del Art. 241 E.T. sobre la renta líquida gravable con los dividendos integrados (marginal hasta 39%), menos el descuento tributario del Art. 254-1 E.T. (19% de la base cedular de dividendos que exceda 1.090 UVT). |

**Impacto.** Para un socio con otras rentas, el impuesto real puede superar el 15% modelado (la tarifa marginal del Art. 241 llega a 39%). El escenario 'distribuir 100%' aparece artificialmente barato frente a 'capitalizar', y como ahorroSocio del escenario de capitalización se define como el impuesto evitado en distribuirTotal, el beneficio de capitalizar también queda subestimado. La recomendación final del dictamen (campo data.recomendacion, validado por C2.6) se emite sobre una comparación numérica falsa.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm y https://estatuto.co/art-254-1-descuento-tributario-determinado-a-partir-de-la-renta-liquida-cedular-de-dividendos-y-participaciones-de-personas-naturales-residentes-y-sucesiones-iliquidas-de-causantes-residentes

### P0-10 · Umbral de personas naturales comerciantes que son agentes de retención (30.000 UVT) convertido a pesos con la UVT del año en curso en vez de la del año inmediatamente anterior

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:517`  
**Norma:** Art. 368-2 E.T. (adicionado por Ley 488/1998 art. 115); conversión conforme Art. 868 E.T.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente para todo el año gravable 2026. Cada enero el valor en pesos cambia porque se recalcula sobre la UVT del año que se está evaluando (el anterior), no la del año en que se practica la retención.

| | |
|---|---|
| En el repo | 'Personas naturales comerciantes son agentes de retención si en el año inmediatamente anterior tuvieron un patrimonio bruto o ingresos brutos superiores a 30.000 UVT (2026: $1.571.220.000).' |
| Según la norma | Para ser agente de retención durante 2026 el test se corre sobre el año 2025 y con la UVT de 2025: 30.000 × $49.799 = $1.493.970.000. El valor $1.571.220.000 (30.000 × UVT 2026) solo sería el umbral para determinar la calidad de retenedor en 2027. |

**Impacto.** Una persona natural comerciante con patrimonio o ingresos brutos 2025 entre $1.493.970.000 y $1.571.220.000 será clasificada por el catálogo como NO agente de retención cuando sí lo es. Deja de practicar y consignar retenciones durante todo 2026 → responsabilidad solidaria por el impuesto no retenido (Art. 370 E.T.) + sanción por no consignar retenciones (Art. 402 C.P. / Art. 634 intereses moratorios). Este texto alimenta el Motor Normativo del Escudo, que es fuente directa de los dictámenes.

**Fuente.** https://actualicese.com/personas-naturales-retenedoras-2026/ — 'Para el año gravable 2026 serán retenedoras las personas naturales comerciantes que en el año 2025 hayan tenido un patrimonio bruto o ingresos brutos superiores a 30.000 UVT (equivalentes para ese período a $1.493.970.000)'. Norma: https://estatuto.co/368-2

### P0-11 · Tope de ingresos del Régimen Simple de Tributación

**Ubicación:** `src/lib/tax/taxCalculator.ts:18`  
**Norma:** Art. 905 num. 2 E.T. (mod. Ley 2277 de 2022 art. 42); Corte Constitucional Sentencia C-540 de 2023 (inexequible el par. 2 del num. 2); Art. 437 par. 3 E.T. para las 3.500 UVT  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** 100.000 UVT rige desde el año gravable 2023 (Ley 2277/2022) y sigue vigente en 2026; el sublímite de 12.000 UVT quedó sin efecto desde la notificación de C-540/2023 (diciembre 2023).

| | |
|---|---|
| En el repo | export const TOPE_RST_UVT = 3500; // 3.500 UVT — IVA / INC bimestral = $183.309.000  (expuesto vía topeRST() y consumido por src/components/workspace/pyme/PymeHub.tsx:170, que en la línea 447 dice al usuario 'Sus ventas del año superan el tope del Régimen Simple. Revise su régimen con un asesor.') |
| Según la norma | El tope del Régimen Simple es 100.000 UVT = $5.237.400.000 para 2026. Las 3.500 UVT ($183.309.000) son el umbral para NO ser responsable de IVA (Art. 437 par. 3 E.T.), que es una responsabilidad distinta del régimen de tributación. El sublímite de 12.000 UVT que la Ley 2277/2022 había impuesto a profesiones liberales fue declarado INEXEQUIBLE, por lo que hoy no hay sublímite por actividad. |

**Impacto.** Recomendación de régimen errada y visible: una Pyme con ventas anuales entre $183.309.000 y $5.237.400.000 (el 99% del universo Pyme) recibe en el cockpit el mensaje en rojo 'superan el tope del Régimen Simple, revise su régimen' cuando está 28 veces por debajo del tope real. Puede empujar al cliente a salirse del SIMPLE y tributar en ordinario innecesariamente. Lo que el semáforo realmente mide es la responsabilidad de IVA, no el régimen.

**Fuente.** https://estatuto.co/905 ; https://www.corteconstitucional.gov.co/relatoria/2023/C-540-23.htm ; confirmación del valor 2026: https://rioconsultores.com/2026/01/07/topes-tributarios-2026-en-colombia-uvt-renta-iva-retenciones-y-facturacion-electronica-boletin-2/ ('Régimen Simple de Tributación — Límite máximo: 100.000 UVT = $5.237.400.000')

### P0-12 · Tope de ingresos brutos para pertenecer al Régimen Simple de Tributación

**Ubicación:** `src/lib/tax/taxCalculator.ts:18`  
**Norma:** Art. 905 num. 2 E.T. (modificado por art. 41 Ley 2155 de 2021); Corte Constitucional Sentencia C-540 de 2023 (declara inexequible el tope reducido de 12.000 UVT de la Ley 2277/2022); Art. 908 par. 4 E.T. para las 3.500 UVT  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** 100.000 UVT vigente desde el año gravable 2022 (Ley 2155/2021) y confirmado para todos los grupos de actividad desde C-540/2023 (05-dic-2023). Aplica plenamente al año gravable 2026. No hay transición pendiente.

| | |
|---|---|
| En el repo | export const TOPE_RST_UVT = 3500; // 3.500 UVT — IVA / INC bimestral = $183.309.000 |
| Según la norma | 100.000 UVT. Con UVT 2026 = $52.374 → $5.237.400.000. Las 3.500 UVT son otra cosa: el umbral bajo el cual la persona natural del SIMPLE NO es responsable de IVA ni de INC de restaurantes y bares (Art. 908 par. 4 E.T., texto Ley 2155/2021) y el umbral de no-responsable de IVA del Art. 437 par. 3 num. 6 E.T. No es el tope de pertenencia al régimen. |

**Impacto.** El constante nombrado TOPE_RST_UVT es la base de topeRST() y de semaforo(); un contribuyente con ventas de $200.000.000/año (≈3.818 UVT) es marcado como 'pasó el tope del Régimen Simple' cuando en realidad está 28 veces por debajo del tope. Consecuencia: recomendación de cambio de régimen errada, pérdida del beneficio del SIMPLE para el cliente y un dictamen firmable ante la DIAN con un umbral normativo falso.

**Fuente.** https://actualicese.com/regimen-simple/ ; https://micrositios.dian.gov.co/regimen-simple-tributacion/preguntas-frecuentes/ ; https://normograma.dian.gov.co/dian/compilacion/docs/c-540_2023.htm

### P0-13 · Semáforo fiscal de la UI Pyme: etiqueta y mensaje del tope del Régimen Simple

**Ubicación:** `src/components/workspace/pyme/PymeHub.tsx:471`  
**Norma:** Art. 905 num. 2 E.T.; Art. 908 par. 4 E.T. (Ley 2155/2021); Art. 437 par. 3 num. 6 E.T.  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente para el año gravable 2026.

| | |
|---|---|
| En el repo | <span>Tope: {copM(tope)} (3.500 UVT)</span> — renderiza "Tope: $183.309.000 (3.500 UVT)"; y en la línea 447: 'Sus ventas del año superan el tope del Régimen Simple. Revise su régimen con un asesor.' |
| Según la norma | El tope del Régimen Simple es 100.000 UVT = $5.237.400.000 (2026). Si lo que se quiere semaforizar es la responsabilidad de IVA/INC de la persona natural del SIMPLE, el texto debe decir 'tope de no-responsable de IVA/INC (3.500 UVT)', no 'tope del Régimen Simple'. |

**Impacto.** Es la cifra normativa más visible del área Pyme. Un tendero con ventas de $16M/mes ve la alerta roja 'Pasó el tope — toca revisar su régimen' y puede renunciar al SIMPLE (con el costo de tener que esperar al siguiente año gravable para reingresar, Art. 909 E.T.) por una alerta falsa. Además el mismo comentario erróneo se replica en src/lib/db/pyme.ts:584 y en el encabezado de PymeHub.tsx:9 y :407.

**Fuente.** https://actualicese.com/regimen-simple/ ; https://micrositios.dian.gov.co/regimen-simple-tributacion/preguntas-frecuentes/

### P0-14 · Tarifas consolidadas del SIMPLE para el grupo 'tiendas pequeñas, mini-mercados, micro-mercados y peluquería'

**Ubicación:** `src/lib/tax/taxCalculator.ts:34`  
**Norma:** Art. 908 num. 1 E.T., modificado por el art. 44 de la Ley 2277 de 2022 (numeral 1 NO afectado por C-540/2023)  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente desde el año gravable 2023 (Ley 2277/2022) y aplicable al año gravable 2026. La tabla anterior (Ley 2155/2021) para este grupo era 2,0/2,8/8,1/11,6 — ninguna coincide con la codificada.

| | |
|---|---|
| En el repo | tiendas: [{uvtMax:6000, rate:0.0188}, {uvtMax:15000, rate:0.024}, {uvtMax:30000, rate:0.029}, {uvtMax:Infinity, rate:0.034}] → 1,88% / 2,40% / 2,90% / 3,40% |
| Según la norma | Art. 908 num. 1 E.T. vigente: 0–6.000 UVT = 1,2%; 6.000–15.000 UVT = 2,8%; 15.000–30.000 UVT = 4,4%; 30.000–100.000 UVT = 5,6% |

**Impacto.** Subestima el impuesto unificado en todos los tramos salvo el primero: en el tramo 30.000–100.000 UVT liquida 3,40% frente al 5,6% legal, un 39% menos de impuesto. Alimenta la balanza 'Le conviene' de MisPagosView y el borrador del Formulario 260, con exposición a sanción por inexactitud (Art. 647 E.T., 100%) más intereses moratorios.

**Fuente.** https://actualicese.com/rutas/books/regimen-simple-tarifas-declaraciones-novedades-y-mucho-mas/page/capitulo-2-tarifas-del-regimen-simple ; https://actualicese.com/regimen-simple/

### P0-15 · Tarifas consolidadas del SIMPLE para servicios profesionales / profesiones liberales

**Ubicación:** `src/lib/tax/taxCalculator.ts:40`  
**Norma:** Art. 908 E.T. según art. 42 num. 3 de la Ley 2155 de 2021, revivido por la Sentencia C-540 de 2023 que declaró inexequibles los numerales 4º y 5º del Art. 908 introducidos por el art. 44 de la Ley 2277 de 2022; ratificado por DIAN Concepto 2766 de 2026  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Reviviscencia con efectos desde el año gravable 2023 (C-540 del 05-dic-2023); aplicable al año gravable 2026. Los anticipos bimestrales ya pagados bajo la ley anterior no se recalculan; el ajuste se hace en la declaración anual consolidada (Formulario 260).

| | |
|---|---|
| En el repo | servicios: [{uvtMax:6000, rate:0.059}, {uvtMax:15000, rate:0.075}, {uvtMax:30000, rate:0.086}, {uvtMax:Infinity, rate:0.095}] → 5,90% / 7,50% / 8,60% / 9,50% |
| Según la norma | Tabla revivida por C-540/2023 (numeral 3 del art. 42 de la Ley 2155 de 2021): 0–6.000 UVT = 5,9%; 6.000–15.000 UVT = 7,3%; 15.000–30.000 UVT = 12,0%; 30.000–100.000 UVT = 14,5% |

**Impacto.** Subestima gravemente el impuesto de profesionales liberales: 8,60% vs 12,0% legal en el tramo 15.000–30.000 UVT y 9,50% vs 14,5% en el tramo alto — hasta 34% menos impuesto liquidado. El propio repo ya sabe la cifra correcta: src/lib/agents/financial/tax-planning/prompts/tax-optimizer.prompt.ts:59 declara vigente el 14,5% del tramo superior, así que el motor de cálculo contradice al agente de planeación fiscal.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/c-540_2023.htm ; https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_2766_2026.htm ; https://actualicese.com/regimen-simple/

### P0-16 · Comparación RST vs Ordinario: tratamiento del IVA

**Ubicación:** `src/lib/tax/taxCalculator.ts:153`  
**Norma:** Art. 907 E.T. (impuestos que comprende el SIMPLE) y Art. 915 E.T. (régimen de IVA y de impuesto al consumo)  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente desde la Ley 2010 de 2019 (que sacó el IVA del impuesto unificado) y aplicable al año gravable 2026.

| | |
|---|---|
| En el repo | compare() = computeRST(ventas) vs computeOrdinario(ventas).total, donde computeOrdinario suma ivaNeto = ventas × 1,566% (línea 131) y computeRST no incluye IVA en ningún tramo |
| Según la norma | El IVA NO integra el impuesto unificado del SIMPLE. Los contribuyentes del SIMPLE responsables de IVA siguen liquidándolo conforme al régimen general y presentan declaración anual consolidada de IVA (Formulario 300), transfiriéndolo por el recibo electrónico SIMPLE. El SIMPLE solo integra: impuesto sobre la renta, INC de expendio de comidas y bebidas, e ICA consolidado (incluidos avisos y tableros y sobretasa bomberil). |

**Impacto.** Sesgo estructural a favor del RST: al cargar el IVA solo del lado ordinario, compare() infla el costo del régimen ordinario en 1,566% de las ventas y devuelve recommended='RST' con un 'ahorro' inexistente. Es exactamente la recomendación de régimen errada que la platform firma frente al cliente. La única excepción real (persona natural del SIMPLE con ingresos ≤ 3.500 UVT, no responsable de IVA ni INC — Art. 908 par. 4 E.T.) no está modelada como condición sino asumida para todos.

**Fuente.** https://estatuto.co/915 ; https://www.gerencie.com/regimen-simple-y-su-relacion-con-el-iva.html ; https://micrositios.dian.gov.co/regimen-simple-tributacion/preguntas-frecuentes/

### P0-17 · Tarifa de la regla sembrada de retención de ICA Bogotá (ICA_BOG_11) en el motor tributario

**Ubicación:** `src/lib/db/seeds/tax-rules-co-2026.ts:125`  
**Norma:** Acuerdo 65 de 2002 del Concejo de Bogotá D.C., art. 3 (tarifas por mil), modificado por Acuerdo 816 de 2021; Ley 14 de 1983; Decreto Distrital 271 de 2002 (retención de ICA)  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Acuerdo 65/2002 vigente en 2026 con la modificación del Acuerdo 816/2021 para el sector financiero. Sin transición: el error es aritmético (por mil convertido a decimal dividiendo dos veces entre 1.000).

| | |
|---|---|
| En el repo | rate: '0.001100'  // comentario en la misma línea 121 y en la línea 15: "ICA Bogotá: 11/1000 = 0.0011" |
| Según la norma | 11 por mil = 0,011. En Bogotá la tarifa de "otras actividades comerciales" del Acuerdo 65/2002 es 11,04 x 1.000 = 0,01104, y la tarifa de retención de ICA es la tarifa del ICA de la actividad del retenido. |

**Impacto.** Toda propuesta de asiento generada por el tax-engine retiene 10 veces menos ReteICA del debido. El agente retenedor responde por el mayor valor no retenido (Art. 370 E.T. por remisión municipal), más intereses y sanción de extemporaneidad/inexactitud en la declaración de retención de ICA de Bogotá. Además el comentario del código dice el valor correcto (0,011) mientras la constante dice otro, así que la revisión visual no lo detecta.

**Fuente.** https://www.haciendabogota.gov.co/es/sdh/conceptos-y-tarifas-asociadas-la-liquidacion-del-impuesto-de-industria-y-comercio-ica y https://bogota.eregulations.org/media/Acuerdo%20065%20de%202002.pdf

### P0-18 · Recargo dominical y festivo diurno usado para liquidar la nómina mensual

**Ubicación:** `src/modules/pyme/data/normativa2026.ts:35`  
**Norma:** Ley 2466 de 2025 (Reforma Laboral), art. que modifica el Art. 179 CST — gradualidad 80% (1-jul-2025), 90% (1-jul-2026), 100% (1-jul-2027)  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** 90% vigente desde el 1-jul-2026 (hoy, 7-ago-2026, aplica). Hay transición: liquidaciones de días trabajados antes del 1-jul-2026 llevan 80%, y antes del 1-jul-2025, 75%. El código no modela ninguna de las tres franjas.

| | |
|---|---|
| En el repo | dominicalDiurno: 0.75,  // $16.835/h  (consumido por calc.ts:128 dominicalDiurnoDia() y por LiquidarMes.tsx:56) |
| Según la norma | 90% desde el 1 de julio de 2026 (era 80% entre el 1-jul-2025 y el 30-jun-2026; será 100% desde el 1-jul-2027). El 75% del Art. 179 CST dejó de regir el 1-jul-2025. |

**Impacto.** Cada domingo o festivo trabajado se paga 15 puntos porcentuales por debajo de lo legal (el 20% de lo debido). Genera salarios insolutos, indemnización moratoria del Art. 65 CST (1 día de salario por día de mora tras la terminación) y contingencia ante inspección del Ministerio de Trabajo.

**Fuente.** https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676 y https://actualicese.com/horas-extra-y-recargos-2026-en-colombia/

### P0-19 · Provisión mensual de intereses a las cesantías

**Ubicación:** `src/modules/pyme/data/calc.ts:185`  
**Norma:** Ley 52 de 1975, arts. 1 y 2 (intereses del 12% anual sobre saldo de cesantías al 31-dic); Ley 50 de 1990 art. 99  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente sin cambios desde 1975. Pago al trabajador a más tardar el 31 de enero del año siguiente.

| | |
|---|---|
| En el repo | const intereses = Math.round((base / 12) * 0.01);  // con base = salario + auxilio. Constante espejo en normativa2026.ts:42 → interesesCesMensual: 1_667, y total normativa2026.ts:44 → totalMensual: 407_955 |
| Según la norma | Los intereses son el 12% anual sobre el saldo de cesantías. Provisión mensual correcta = (base/12) × 0,12 = base × 0,01. Al SMMLV+auxilio ($2.000.000) son $20.000/mes ($240.000/año), no $1.667/mes ($20.004/año). El total mensual de prestaciones correcto es $426.288, no $407.955. |

**Impacto.** Subprovisión de 12 veces el pasivo laboral por intereses a las cesantías: el empleador llega al 31 de enero con el 8% del efectivo necesario. El no pago oportuno de los intereses obliga a pagar, por una sola vez, una suma adicional igual a los intereses debidos (Ley 52/1975 art. 1 num. 3), es decir, duplica el costo. Nota: src/lib/payroll/prestaciones.ts:89 lo calcula bien (cesantiasCop * 0.12), así que los dos módulos del producto se contradicen 12x.

**Fuente.** https://www.gerencie.com/plazo-maximo-para-pagar-los-intereses-sobre-las-cesantias.html

### P0-20 · Prima de servicios proporcional en la liquidación definitiva del contrato

**Ubicación:** `src/modules/pyme/data/calc.ts:262`  
**Norma:** Art. 306 CST, modificado por la Ley 1788 de 2016 — treinta (30) días de salario por año, reconocidos en dos pagos  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente desde la Ley 1788 de 2016, sin cambio en 2026.

| | |
|---|---|
| En el repo | const primaProporcional = ((base * diasTotales) / 360) * 0.5; |
| Según la norma | La prima de servicios equivale a 30 días de salario por año (15 días por semestre, en dos pagos). La proporcional es (salario + auxilio de transporte) × díasTrabajados / 360, sin multiplicar por 0,5. El factor 0,5 confunde "15 días por semestre" con "medio salario al año". |

**Impacto.** Toda liquidación definitiva emitida por el módulo paga la mitad de la prima de servicios adeudada. Salarios insolutos + indemnización moratoria del Art. 65 CST (1 día de salario por cada día de retardo). La incoherencia es autoevidente en el mismo bloque: las cesantías (línea 259) usan la fórmula correcta base×días/360 y la prima, que tiene idéntica base anual de 30 días, se divide por dos.

**Fuente.** https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676 (marco CST vigente) — texto Art. 306 CST mod. Ley 1788/2016

### P0-21 · Interpretación del tope de 100 UVT del Art. 771-5 §2 E.T. en el prompt del auditor Anti-DIAN

**Ubicación:** `src/lib/agents/financial/escudo-survival/prompts/anti-dian-auditor.prompt.ts:29`  
**Norma:** Art. 771-5 parágrafo 2 E.T.; Consejo de Estado, Sección Cuarta, Sent. 11001-03-27-000-2022-00041-00 (26676) — nulidad parcial de los Oficios DIAN 0935 y 1275 de 2018; DIAN Concepto 010383 de 2026  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** La interpretación por transacción individual rige desde la ejecutoria de la sentencia (2023) y fue ratificada por la DIAN en 2026. Aplica plenamente al año gravable 2026.

| | |
|---|---|
| En el repo | "Tope individual Art. 771-5 §2 E.T.: pagos a un mismo NIT en efectivo no pueden exceder 100 UVT = $5.237.400 al ano" (reiterado en línea 55: "listar cada pago a un mismo NIT > $5.237.400", y en el catálogo estatuto-tributario.ts:853 "tope individual 100 UVT por NIT") |
| Según la norma | El límite de 100 UVT se determina sobre CADA transacción individualmente considerada, no sobre el acumulado anual por beneficiario. El Consejo de Estado anuló parcialmente los Oficios DIAN 0935 y 1275 de 2018 que sostenían la lectura acumulativa, y la DIAN acogió la corrección. |

**Impacto.** El agente marca como no deducible el acumulado anual pagado en efectivo a cada proveedor, cuando la ley solo desconoce los pagos individuales que superen $5.237.400. Sobre un proveedor al que se le pagaron 12 cuotas de $2.000.000 el agente rechaza $24.000.000 y proyecta $8.400.000 de mayor impuesto que no existe. Es una recomendación errada en un dictamen que el cliente firma: o lo lleva a corregir declaraciones sin causa, o destruye la confianza en el módulo cuando la DIAN no lo objeta.

**Fuente.** https://www.consejodeestado.gov.co/documentos/boletines/269/11001-03-27-000-2022-00041-00(26676).pdf y https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/07/dian-nuevas-precisiones-sobre-la-aplicacion-del-limite-de-100-uvt-para-pagos-en-efectivo/

### P0-22 · Régimen especial de bancarización para sector agropecuario, comerciantes del régimen SIMPLE y cooperativas de productores agrícolas

**Ubicación:** `src/lib/agents/financial/escudo-survival/prompts/anti-dian-auditor.prompt.ts:30`  
**Norma:** Art. 771-5 parágrafo 5 E.T.; DIAN Concepto 010383 de 2026 (exigir el límite de 100 UVT a los beneficiarios del §5 "dejaría sin efecto práctico el tratamiento especial")  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Parágrafo 5 aplicable desde el año gravable 2022 en adelante; ratificado por la DIAN en 2026.

| | |
|---|---|
| En el repo | El prompt solo modela §1 (40% / 40.000 UVT / 35% de costos) y §2 (100 UVT). No menciona el parágrafo 5 en ninguna línea; el catálogo (estatuto-tributario.ts:853) tampoco. |
| Según la norma | El parágrafo 5 del Art. 771-5 permite a los contribuyentes del sector agropecuario, a los comerciantes del régimen SIMPLE y a las cooperativas y asociaciones de productores agrícolas reconocer fiscalmente pagos en efectivo hasta el 70% de los costos, deducciones, pasivos o impuestos descontables totales, sin sujeción al límite de 100 UVT por pago ni a la regla del §1. |

**Impacto.** UtopIA tiene el Régimen Simple como caso de uso central (src/lib/tax/taxCalculator.ts). Para un comerciante del SIMPLE o un cliente agropecuario, el agente Anti-DIAN aplica el régimen general y desconoce costos que la ley sí reconoce hasta el 70%, produciendo un mayor impuesto estimado ficticio y una recomendación de bancarizar que el cliente no necesita. El error va firmado en el dictamen.

**Fuente.** https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/07/dian-nuevas-precisiones-sobre-la-aplicacion-del-limite-de-100-uvt-para-pagos-en-efectivo/

### P0-23 · Triggers de la regla de IVA diferencial 5% idénticos a los de IVA general 19% en el seed de reglas tributarias

**Ubicación:** `src/lib/db/seeds/tax-rules-co-2026.ts:65`  
**Norma:** Arts. 468, 468-1, 468-3, 477 y 424 E.T.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente desde 2017 (Ley 1819/2016) y sin cambio en 2026: la Ley de Financiamiento fue hundida el 09-dic-2025 y el Decreto 1474/2025 que tocaba IVA fue declarado inexequible el 09-abr-2026, de modo que la estructura tarifaria del E.T. sigue intacta.

| | |
|---|---|
| En el repo | IVA_5_PURCHASE → applicableTriggers: { transactionTypes: ['purchase', 'service_purchase'] } — exactamente los mismos triggers que IVA_19_PURCHASE (líneas 39-41). No hay campo discriminante (código de bien, partida arancelaria, categoría), ni prioridad ni exclusividad; matchRules() en src/lib/accounting/tax-engine/rules-engine.ts recorre TODAS las reglas y hace push de cada una que pase los filtros, y generateLines() acumula ambas sobre la misma base. |
| Según la norma | Las tarifas de IVA son mutuamente excluyentes por bien o servicio: 19% general (Art. 468), 5% únicamente para los bienes taxativamente listados en el Art. 468-1 y los servicios taxativos del Art. 468-3, 0% para exentos (Art. 477) y no causación para excluidos (Arts. 424 y 476). Una misma operación se grava con UNA sola tarifa. La regla del 5% debe llevar un discriminador de bien/servicio y ser excluyente frente a la del 19%. |

**Impacto.** Toda compra evaluada por el Smart-Tax Engine genera IVA descontable del 24% (19% + 5%) sobre la misma base, más una tercera propuesta al 0% por IVA_0_EXEMPT. Se contabilizan dos líneas a la cuenta 240810 y el 'total a pagar' al proveedor queda inflado en 5 puntos. En la declaración de IVA (Formulario 300) esto es un IVA descontable improcedente → mayor saldo a favor o menor saldo a pagar → sanción por inexactitud del 100% (Art. 648 E.T.) más intereses moratorios, sobre un dictamen que el cliente firma.

**Fuente.** https://www.contadia.com/estatuto-tributario/articulo-420-hechos-sobre-los-que-recae-el-impuesto (Libro Tercero E.T.); tarifa general 19% Art. 468 desde Ley 1819/2016; Art. 468-1 lista taxativa de bienes al 5%; Art. 468-3 lista taxativa de servicios al 5%

### P0-24 · El prompt del Revisor Fiscal instruye que el Régimen SIMPLE exime de IVA

**Ubicación:** `src/lib/agents/financial/audit/prompts/fiscal-reviewer.prompt.ts:76`  
**Norma:** Arts. 915 y 907 E.T.; Art. 437 parágrafo 4 E.T.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente desde Ley 2010/2019 (Arts. 903-916), sin modificación en 2026.

| | |
|---|---|
| En el repo | "status por entrada: ... 'no_aplica' (regimen no obliga, ej. SIMPLE exime IVA)" |
| Según la norma | El Art. 915 E.T. dispone lo contrario: los contribuyentes del SIMPLE SIGUEN siendo responsables de IVA y del impuesto nacional al consumo; los responsables de IVA presentan una declaración ANUAL CONSOLIDADA de IVA, sin perjuicio del traslado del IVA a pagar mediante el recibo electrónico SIMPLE bimestral. La única excepción es la del parágrafo 4 del Art. 437 E.T.: no son responsables de IVA los del SIMPLE que desarrollen ÚNICAMENTE actividades de tiendas pequeñas, mini-mercados, micro-mercados y peluquería. El SIMPLE sí integra el INC de bares y restaurantes (Art. 907 E.T.), pero nunca el IVA. |

**Impacto.** El dictamen de cumplimiento fiscal marcará la obligación de IVA como 'no_aplica' para cualquier contribuyente del SIMPLE. El cliente omite la declaración anual consolidada de IVA y los anticipos bimestrales → sanción por no declarar (Art. 643 E.T., 10% de ingresos brutos del período), extemporaneidad (Art. 641) e intereses (Art. 635), avalado por un dictamen firmado.

**Fuente.** https://www.contadia.com/estatuto-tributario/articulo-915-regimen-de-iva-y-de-impuesto-al-consumo y https://www.gerencie.com/regimen-simple-y-su-relacion-con-el-iva.html

### P0-25 · Sanción por inexactitud — tarifas agravadas del Art. 648 inciso 3º

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts:60`  
**Norma:** Art. 648 E.T., modificado por el Art. 288 de la Ley 1819 de 2016 (incisos 1º y 3º, numerales 1 a 4; par. 2: el numeral 1 aplica desde el año gravable 2018)  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente desde el año gravable 2017 (numeral 1 del inciso 3º desde el año gravable 2018). Sin modificaciones por Ley 2277/2022 ni por reformas 2024-2026; la Ley de Financiamiento 2026 no fue aprobada.

| | |
|---|---|
| En el repo | tarifa: '100% del mayor valor del impuesto que se generó.'  /  tope: null |
| Según la norma | Base 100% (o 15% en declaraciones de ingresos y patrimonio). Inciso 3º: (1) 200% del mayor valor del impuesto cuando se omitan activos o se incluyan pasivos inexistentes; (2) 160% cuando la inexactitud provenga del numeral 5 del Art. 647 (proveedores ficticios) o de abuso en materia tributaria del Art. 869; (3) 20% en declaraciones de ingresos y patrimonio por esas mismas conductas; (4) 50% en monotributo. |

**Impacto.** El caso más auditado por la DIAN (omisión de activos y pasivos inexistentes) se dictamina al 100% cuando la norma impone 200%. Un cliente que firme un dictamen con esa cuantificación subestima su exposición exactamente a la mitad y toma decisiones de corrección voluntaria o de litigio sobre una cifra falsa. Lo mismo con el 160% por abuso o proveedores ficticios.

**Fuente.** https://actualicese.com/estatutotributario/648-2/ y https://www.contadia.com/estatuto-tributario/articulo-648-sancion-por-inexactitud

### P0-26 · Entrada ART_648_ET del catálogo normativo — tarifa consolidada

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:811`  
**Norma:** Art. 648 E.T., inciso 3º numerales 1 a 4 (mod. Art. 288 Ley 1819 de 2016)  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente para todos los años gravables desde 2017 (numeral 1 desde 2018).

| | |
|---|---|
| En el repo | 'Consolida la tarifa escalonada de la sanción por inexactitud en el 100% del mayor valor del impuesto que se generó o del menor saldo a favor declarado.' |
| Según la norma | El Art. 648 NO consolidó todo en 100%: mantiene un régimen escalonado con 100% general, 15% en ingresos y patrimonio, y las agravaciones de 200%, 160%, 20% y 50% del inciso 3º. |

**Impacto.** Es la entrada que el Motor Normativo inyecta a los prompts del Escudo y del Agente Fiscal. Al declarar que la tarifa 'se consolida en el 100%', el LLM queda instruido para negar la existencia del 200% aun si el hecho del cliente es omisión de activos, y el citation.validator marca la cita como VIGENTE_2026 dándole sello de calidad a una afirmación normativamente incompleta.

**Fuente.** https://actualicese.com/estatutotributario/648-2/

### P0-27 · Sanción por corrección — hito que hace pasar del 10% al 20%

**Ubicación:** `src/lib/tools/sanction-calculator.ts:165`  
**Norma:** Art. 644 E.T., numerales 1 y 2 (en concordancia con el Art. 685 E.T.)  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente sin cambios; redacción actual desde la Ley 49 de 1990 y ajustes posteriores. Aplica a 2026.

| | |
|---|---|
| En el repo | isVoluntary ? 'correccion voluntaria (antes de notificacion del requerimiento especial o pliego de cargos)' : 'correccion provocada (despues de notificacion del requerimiento especial o pliego de cargos de la DIAN)'  — replicado en registry.ts:141 ('voluntaria (10%) antes de requerimiento especial') y en app/api/chat/route.ts |
| Según la norma | 10% si la corrección se realiza después del vencimiento del plazo para declarar y ANTES del emplazamiento para corregir del Art. 685 o del auto que ordene visita de inspección tributaria. 20% si se realiza DESPUÉS de notificado el emplazamiento para corregir o el auto de inspección y antes del requerimiento especial o pliego de cargos. |

**Impacto.** Entre el emplazamiento para corregir y el requerimiento especial hay una ventana real en la que la sanción ya es del 20%. La herramienta le dice al cliente que sigue siendo del 10%, éste liquida la mitad al presentar la corrección, la DIAN rechaza la corrección por sanción mal liquidada y le impone la diferencia más intereses. Es un error que genera la sanción, no que la describe. Nótese que sanciones.ts:43 y estatuto-tributario.ts:771 sí dicen 'emplazamiento': el defecto está en la calculadora y en las descripciones de la herramienta que lee el LLM.

**Fuente.** https://www.gerencie.com/sancion-por-correccion.html

### P0-28 · Sanción por extemporaneidad sin impuesto a cargo — tope de 2.500 UVT

**Ubicación:** `src/lib/tools/sanction-calculator.ts:106`  
**Norma:** Art. 641 E.T., incisos 2º y 3º  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente 2026. Los topes en UVT no cambian; solo cambia su expresión en pesos con la UVT del año (2.500 UVT = $130.935.000 en 2026; $124.497.500 en 2025).

| | |
|---|---|
| En el repo | const maxAmount = grossIncome * 0.05; // 5% cap  — único tope aplicado cuando taxDue = 0 |
| Según la norma | La sanción es del 0,5% de los ingresos brutos por mes o fracción, 'sin exceder la cifra MENOR resultante de aplicar el 5% a dichos ingresos, o del doble del saldo a favor si lo hubiere, o de la suma de 2.500 UVT cuando no existiere saldo a favor'. Con UVT 2026, 2.500 UVT = $130.935.000. Falta además la rama del 1% sobre patrimonio líquido (tope: el menor entre 10% del patrimonio, el doble del saldo a favor y 2.500 UVT) para cuando no hubo ingresos en el período. |

**Impacto.** Para una empresa sin impuesto a cargo con $50.000 millones de ingresos brutos, la herramienta devuelve $2.500 millones de sanción cuando el tope legal es $130.935.000: un factor de casi 20x. Cualquier cliente al que se le entregue esa cifra sobredimensiona su contingencia, provisiona de más o acepta transacciones desventajosas. La rama de patrimonio líquido tampoco existe: si no hay ingresos, la función cae directo a la sanción mínima de 10 UVT, subestimando esta vez.

**Fuente.** https://www.gerencie.com/sancion-por-extemporaneidad.html

### P0-29 · Mapeo último dígito del NIT → N-ésimo día hábil en el calendario nacional estático

**Ubicación:** `src/data/calendars/nacional-2026.ts:44`  
**Norma:** Decreto 2229 de 2023 (modifica arts. 1.6.1.13.2.x del DUR 1625 de 2016): 'si el último dígito es 1, hasta el séptimo día hábil… si es 0, hasta el décimo sexto día hábil'  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Vigente desde el año gravable 2024 en adelante; aplica íntegramente al calendario 2026. Sin transición.

| | |
|---|---|
| En el repo | return digit === 0 ? 16 : 16 - digit;  // dígito 1 → 15º día hábil, dígito 9 → 7º |
| Según la norma | digit === 0 ? 16 : digit + 6  // dígito 1 → 7º día hábil, dígito 2 → 8º, …, dígito 9 → 15º, dígito 0 → 16º |

**Impacto.** Invierte TODO el calendario nacional estático (renta PJ, renta GC 3 cuotas, retención mensual, IVA bimestral y cuatrimestral, exógena, patrimonio, activos en el exterior). Un NIT terminado en 1 recibe 26-may-2026 para renta PJ cuando su plazo real es 12-may-2026: 14 días de extemporaneidad → sanción Art. 641 E.T. (5% del impuesto a cargo por mes o fracción) + intereses moratorios Art. 635 E.T. Además contradice a src/lib/scrapers/dian-scraper.ts:110, que sí tiene el mapeo correcto (digit + 6), por lo que el sistema devuelve fechas distintas según haya corrido o no el cron.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm ; tabla oficial 2026 en https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf (Renta PJ: dígito 1 = 12-may-2026, dígito 6 = 20-may, dígito 0 = 26-may)

### P0-30 · Set de días no hábiles 2026 usado por nthBusinessDay (base de todo el calendario generado)

**Ubicación:** `src/lib/scrapers/dian-scraper.ts:55`  
**Norma:** Decreto 500 de 2024, art. 1 y 2 — declara el tercer viernes de abril de cada año 'Día Cívico de la Paz con la Naturaleza' y ordena que sea considerado día NO HÁBIL laboralmente para las entidades de la Rama Ejecutiva del orden nacional  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Decreto 500 de 2024 vigente y de aplicación anual recurrente (también 2027: viernes 16-abr-2027). El PDF de calendario publicado el 31-dic-2025 aún mostraba 13–24 de abril; la DIAN confirmó el ajuste el 4-mar-2026.

| | |
|---|---|
| En el repo | FESTIVOS_2026 con 18 entradas; NO incluye '2026-04-17' |
| Según la norma | Debe incluir '2026-04-17' (tercer viernes de abril) como día NO hábil. Con él, los días hábiles 11º a 16º de abril 2026 corren un día: 11º=20-abr, 12º=21, 13º=22, 14º=23, 15º=24, 16º=27-abr |

**Impacto.** Todas las fechas de abril 2026 generadas para los dígitos que caen en los días hábiles 11º–16º salen un día hábil ANTES de lo real, y —peor— el sistema afirma como cierto un rango que ya no existe: 2ª cuota de grandes contribuyentes termina el 27-abr-2026, no el 24-abr. Lo mismo para la retención de marzo 2026. Como el error es hacia atrás no genera sanción por sí solo, pero invalida la afirmación 'verificado contra decreto oficial' y, combinado con el mapeo invertido de nacional-2026.ts, sí produce fechas posteriores a la real.

**Fuente.** https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=238215 ; DIAN Comunicado 058 de 2026 https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-058-2026.aspx ; corrimiento confirmado por INCP (mar-2026) y por Siempre Al Día (2ª cuota grandes contribuyentes: 13 al 27 de abril, no 13 al 24)

### P0-31 · Mes de vencimiento de la información exógena (medios magnéticos) año gravable 2025

**Ubicación:** `src/data/calendars/nacional-2026.ts:302`  
**Norma:** Resolución Única DIAN 000227 del 23-sep-2025, Título 3 (compila la Res. 000162 de 2023 y la Res. 000188 de 2024), modificada por la Resolución DIAN 000233 de 2025; plazos en días hábiles conforme al Decreto 2229 de 2023  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Plazos para el reporte del año gravable 2025 durante 2026. El comentario 'FIX' del repo revirtió un valor que estaba correcto (mayo) a uno incorrecto (septiembre).

| | |
|---|---|
| En el repo | ...buildPerDigit(2026, 9, (d, dueDate) => exogena(d, dueDate)) — con el comentario 'FIX: antes estaba en mayo; lo oficial es septiembre 9–22'. Idéntico error en src/lib/scrapers/dian-scraper.ts:349 (buildExogena → mes 9). |
| Según la norma | Grandes contribuyentes: 27/28-abr-2026 (último dígito 1) a 13-may-2026 (dígito 0). Personas jurídicas y naturales: 14-may-2026 (últimos dos dígitos 01–05) a 12-jun-2026 (96–00). |

**Impacto.** El sistema le dice al contribuyente que su exógena vence entre el 9 y el 22 de septiembre de 2026 cuando venció, a más tardar, el 12 de junio de 2026 — casi cuatro meses tarde. Sanción por no enviar información o enviarla extemporánea: Art. 651 E.T., hasta 15.000 UVT ($785.610.000 con UVT 2026), más el desconocimiento de costos y deducciones. Es el error de mayor exposición económica del dominio.

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf (sección INFORMACIÓN EXÓGENA TRIBUTARIA) ; https://siemprealdia.co/colombia/calendario-tributario-2026/

### P0-32 · Extracción del 'último dígito del NIT' para indexar el calendario en el Fiscal Anchor

**Ubicación:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:57`  
**Norma:** Decreto 2229 de 2023 / DUR 1625 de 2016, arts. 1.6.1.13.2.x: '…atendiendo el último dígito del Número de Identificación Tributaria -NIT- del declarante que conste en el certificado del Registro Único Tributario -RUT-, sin tener en cuenta el dígito de verificación'  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Regla constante en todos los decretos de plazos; vigente para 2026 sin transición.

| | |
|---|---|
| En el repo | const dashMatch = trimmed.match(/-\s*(\d)\s*$/); if (dashMatch) return parseInt(dashMatch[1], 10);  // docstring: '901714014-6 → 6 … ese dígito ES el último dígito a usar contra el calendario DIAN' |
| Según la norma | Debe tomarse el último dígito del NIT que consta en el RUT SIN el dígito de verificación. Para 901714014-6 el dígito de calendario es 4, no 6. |

**Impacto.** Selecciona la fila equivocada del calendario para prácticamente todos los NIT (el DV coincide con el último dígito del cuerpo solo por azar, ~10% de los casos). Para 901714014-6 el sistema devuelve las fechas del dígito 6 (renta PJ 20-may-2026) cuando corresponden las del dígito 4 (15-may-2026): 5 días de extemporaneidad → sanción Art. 641 E.T. El override NIT6_2026 (línea 138) fue construido sobre este mismo error, así que la única tabla 'verificada' del módulo está indexada por el DV.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm ; https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=227310

### P0-33 · Vencimiento de enero de 2027 en la tabla verificada del NIT dígito 6 (retención de diciembre 2026 e IVA bimestre Nov-Dic 2026)

**Ubicación:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:142`  
**Norma:** Decreto 2229 de 2023 (dígito 6 → 12º día hábil del mes). Días hábiles de enero 2027 descontando 1-ene y el traslado de Reyes al lunes 11-ene (Ley 51 de 1983): 4,5,6,7,8,12,13,14,15,18,19,20…  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Aplica al vencimiento de enero de 2027 (período diciembre 2026 / bimestre Nov-Dic 2026).

| | |
|---|---|
| En el repo | '2027-01-26' (última entrada de retencionMensual, línea 142, y de ivaBimestral, línea 146) |
| Según la norma | 2027-01-20 (12º día hábil de enero de 2027, que es el que corresponde al dígito 6). El 26-ene-2027 es el 16º día hábil, es decir la fecha del dígito 0. |

**Impacto.** Seis días calendario de retraso presentados como fecha verificada. La retención en la fuente extemporánea acarrea sanción Art. 641 E.T. y, además, la declaración de retención se tiene por NO PRESENTADA si no se paga dentro de los dos meses siguientes (Art. 580-1 E.T.), con el riesgo penal del Art. 402 C.P. por no consignar lo retenido. Es un outlier evidente: las otras once entradas de la misma tabla sí caen en el 12º día hábil.

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf — columna 'Enero 2027' de retención y de IVA bimestral: dígito 6 = 20, dígito 0 = 26 ; regla en https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm

### P0-34 · Meses de vencimiento cubiertos por el calendario del Fiscal Anchor (retención mensual e IVA bimestral)

**Ubicación:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:112`  
**Norma:** Arts. 376 y 382 E.T. (declaración y consignación mensual de retenciones) y art. 600 E.T. (IVA bimestral), con plazos del Decreto 2229 de 2023 / DUR 1625 de 2016  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Estructural: se repite cada mes de enero.

| | |
|---|---|
| En el repo | const MESES_RETENCION = [2,3,4,5,6,7,8,9,10,11,12]; const MESES_IVA_BIMESTRAL = [3,5,7,9,11];  // la tabla override NIT6_2026 también arranca en 2026-02-17 / 2026-03-17 |
| Según la norma | El año calendario tiene 12 vencimientos de retención (el de enero corresponde al período diciembre del año anterior) y 6 de IVA bimestral (el de enero corresponde al bimestre Nov-Dic del año anterior). Enero 2026: retención dígito 6 → 20-ene-2026; IVA B6 2025 dígito 6 → 20-ene-2026. |

**Impacto.** Durante todo enero el Fiscal Anchor responde que el próximo vencimiento de retención es en febrero y el de IVA en marzo, ocultando por completo el vencimiento de enero (período diciembre anterior). El contribuyente que confíe en el módulo presenta extemporáneamente → sanción Art. 641 E.T., intereses Art. 635 E.T., y para retención el riesgo del Art. 580-1 E.T. / Art. 402 C.P.

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf — la tabla de retenciones incluye la columna 'Dic → Ene 2027'; la de IVA bimestral incluye 'Nov-Dic → Enero 2027'

### P0-35 · Fecha y número de cuotas de la declaración de renta de personas jurídicas en el fallback heurístico del Fiscal Anchor

**Ubicación:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:99`  
**Norma:** Decreto 2229 de 2023, que modifica el art. 1.6.1.13.2.12 del Decreto 1625 de 2016; art. 591 E.T.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Año gravable 2025, declaración y pago en 2026.

| | |
|---|---|
| En el repo | DIA_RENTA_PJ: dígito 0 → 8-abr, dígito 1 → 9-abr, … dígito 9 → 6-may; una sola obligación 'Declaración de Renta — Persona Jurídica' (línea 232-238), norma citada 'Art. 240 E.T. + Decreto calendario tributario (aprox.)' |
| Según la norma | Dos cuotas: Declaración + 1ª cuota entre el 12-may-2026 (dígito 1) y el 26-may-2026 (dígito 0); 2ª cuota entre el 9-jul-2026 (dígito 1) y el 23-jul-2026 (dígito 0). Norma de plazos: art. 1.6.1.13.2.12 del DUR 1625/2016 modificado por el Decreto 2229 de 2023 (el Art. 240 E.T. es la tarifa, no el plazo). |

**Impacto.** Se aplica a 9 de cada 10 dígitos (todos los que no tienen override). Presenta el vencimiento de renta PJ en abril, mes equivocado, y omite por completo la SEGUNDA CUOTA de julio. El contribuyente no ve nunca la cuota 2 → mora en el pago del 50% del impuesto, intereses del Art. 635 E.T. y pérdida del beneficio de pago oportuno. Adicionalmente cita como fundamento el Art. 240 E.T., que no regula plazos: debilita la defensa documental frente a la DIAN.

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf ('Declaración de renta de personas jurídicas y demás contribuyentes — Declaración y pago 1.a cuota / Pago 2.a cuota') ; https://siemprealdia.co/colombia/calendario-tributario-2026/

### P0-36 · Marcado de procedencia (verified / estado) de fechas que el sistema CALCULA en vez de leer de la fuente oficial

**Ubicación:** `src/lib/scrapers/dian-scraper.ts:202`  
**Norma:** No es una norma tributaria sino el deber de diligencia del Art. 641 E.T. / Art. 651 E.T.: quien firma la declaración responde por la fecha. El propio repo lo reconoce en src/data/calendars/types.ts ('verified false = fecha inferida por patrón histórico (NO oficial)')  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** Presente desde la introducción del cron de calendar-sync.

| | |
|---|---|
| En el repo | verified: true en buildRange (línea 202), buildRentaPN (304) y buildPatrimonioCuota2 (385), pese a que el propio encabezado del archivo dice 'El scraping en sentido estricto NO extrae fechas del HTML/PDF'. En paralelo, dian-calendar.ts:293 solo devuelve estado 'verificar' cuando proyecta al año siguiente, de modo que las heurísticas de día fijo salen como 'pendiente'/'proximo'. |
| Según la norma | Una fecha derivada de un modelo interno no está verificada contra el decreto. Solo puede marcarse verified: true si el hash del payload oficial fue efectivamente parseado y las fechas coinciden con la tabla publicada. |

**Impacto.** El cron persiste las fechas calculadas en verified_calendars, source.ts las devuelve como 'postgres-verified', y el tool las presenta al LLM —y por tanto al cliente— como verificadas contra el decreto oficial, suprimiendo el disclaimer de extemporaneidad. Como esas mismas fechas arrastran el 17-abr-2026 faltante y (en el fallback estático) el mapeo invertido, el sistema afirma con certeza fechas que producen sanción. En el Fiscal Anchor ocurre lo equivalente: la tabla DIA_RETENCION_POR_DIGITO/DIA_IVA_POR_DIGITO son días fijos que ignoran los días hábiles y salen con estado 'pendiente', es decir, como ciertas.

**Fuente.** Inconsistencia interna verificable: src/lib/scrapers/dian-scraper.ts:6-15 vs :202 ; src/lib/tools/tax-calendar.ts:81 imprime '## Obligaciones Nacionales (verificadas contra decreto oficial)' sin advertencia cuando verified === true

### P0-37 · Tabla de exógena para personas jurídicas y naturales por últimos DOS dígitos del NIT en el documento RAG

**Ubicación:** `src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:218`  
**Norma:** Resolución Única DIAN 000227 del 23-sep-2025, Título 3, modificada por la Resolución DIAN 000233 de 2025  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Reporte del año gravable 2025 durante 2026.

| | |
|---|---|
| En el repo | \| 96-00 \| 14-may-2026 \|  …  \| 01-05 \| 12-jun-2026 \|  (orden descendente: 96-00 primero, 01-05 último) |
| Según la norma | \| 01 al 05 \| 14 de mayo de 2026 \| … \| 96 al 00 \| 12 de junio de 2026 \|  (orden ascendente: 01-05 primero) |

**Impacto.** El documento está indexado en el RAG, así que el agente responde con la fecha invertida. Una empresa con NIT terminado en 01-05 recibe 12-jun-2026 cuando su plazo real era el 14-may-2026: 29 días de extemporaneidad en exógena → sanción del Art. 651 E.T. (hasta 15.000 UVT = $785.610.000 con UVT 2026).

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf (INFORMACIÓN EXÓGENA — Personas jurídicas y naturales: '01 al 05 → 14 de mayo', '96 al 00 → 12 de junio') ; https://siemprealdia.co/colombia/calendario-tributario-2026/ confirma que el dígito 1 vence primero

### P0-38 · Regla y rangos de vencimiento de la retención en la fuente mensual en el documento RAG

**Ubicación:** `src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:264`  
**Norma:** Decreto 2229 de 2023, que modifica el art. 1.6.1.13.2.34 y ss. del DUR 1625 de 2016; art. 382 E.T.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Calendario 2026.

| | |
|---|---|
| En el repo | 'Vencimiento: dentro de los 10 primeros días hábiles del mes siguiente al período' (línea 264); tabla: 'Agosto 2026 → 9-sep a 23-sep-2026' (línea 275) y 'Septiembre 2026 → 13-oct a 26-oct-2026' (línea 276) |
| Según la norma | El plazo va del 7º al 16º día hábil del mes siguiente, no de los 10 primeros. Período agosto 2026: 9-sep (dígito 1) a 22-sep-2026 (dígito 0). Período septiembre 2026: 9-oct (dígito 1) a 23-oct-2026 (dígito 0). |

**Impacto.** El RAG afirma que el período septiembre 2026 vence hasta el 26-oct-2026 cuando el último plazo real es el 23-oct-2026, y que agosto vence hasta el 23-sep cuando el real es el 22-sep. Son fechas POSTERIORES a la legal: el contribuyente que las siga presenta extemporáneamente → sanción Art. 641 E.T., intereses Art. 635 E.T. y, en retención, riesgo del Art. 580-1 E.T. La regla enunciada ('10 primeros días hábiles') es además el fundamento equivocado y desalinea todas las demás filas de la tabla.

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf — tabla RETENCIONES Y AUTORRETENCIONES: columna Sep (período Ago): dígito 1 = 9, dígito 0 = 22; columna Oct (período Sep): dígito 1 = 9, dígito 0 = 23

### P0-39 · Vencimiento de la declaración anual del Régimen Simple de Tributación (AG 2025) en el documento RAG

**Ubicación:** `src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:307`  
**Norma:** Arts. 903 a 916 E.T. (Régimen Simple, Ley 2277 de 2022); plazos en el art. 1.6.1.13.2.50 del DUR 1625 de 2016 modificado por el Decreto 2229 de 2023  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Declaración del año gravable 2025 presentada en 2026.

| | |
|---|---|
| En el repo | 'Anual, por NIT al 26-jun-2026 a 25-jun-2026 (rango por dígito) más anticipos bimestrales (mismas fechas IVA bimestral).' |
| Según la norma | Declaración anual consolidada del SIMPLE AG 2025: por los DOS últimos dígitos del NIT, del 17 al 23 de abril de 2026 (1y2 → 17-abr, 3y4 → 20-abr, 5y6 → 21-abr, 7y8 → 22-abr, 9y0 → 23-abr; con el 17-abr declarado no hábil por el Decreto 500 de 2024 el primer grupo corre al 20-abr y los siguientes un día hábil). Los anticipos bimestrales del SIMPLE NO coinciden con el IVA bimestral: vencen en mayo, junio, julio, septiembre, noviembre de 2026 y enero de 2027. |

**Impacto.** Dos meses de retraso presentados como fecha cierta, sobre un rango además internamente incoherente ('al 26-jun a 25-jun'). Un contribuyente del SIMPLE que declare en junio incurre en sanción por extemporaneidad (Art. 641 E.T.) y puede perder la permanencia en el régimen. La afirmación de que los anticipos bimestrales coinciden con el IVA bimestral desplaza además cada uno de los seis anticipos.

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf — sección RÉGIMEN SIMPLE DE TRIBUTACIÓN (declaración anual 17–23 de abril; tabla propia de anticipos bimestrales)

### P0-40 · Compresión por bandas del calendario de renta de personas naturales (dos últimos dígitos del NIT)

**Ubicación:** `src/data/calendars/nacional-2026.ts:245`  
**Norma:** Decreto 2229 de 2023, que modifica el art. 1.6.1.13.2.15 del DUR 1625 de 2016; art. 592 E.T.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Año gravable 2025, declaración en 2026. Aplica también a la declaración de activos en el exterior de personas naturales.

| | |
|---|---|
| En el repo | rentaPN(9,'2026-08-25','90-99') … rentaPN(0,'2026-10-26','00-09')  — la banda 90-99 en agosto y la 00-09 en octubre. Mismo error invertido en src/lib/scrapers/dian-scraper.ts:275-285 (banda 9 → 2026-08-12, banda 0 → 2026-10-26). |
| Según la norma | 01 y 02 → 12-ago-2026 (primeros); la banda 00-09 vence entre el 12 y el 19 de agosto de 2026. 89 y 90 → 19-oct; 99 y 00 → 26-oct-2026 (últimos); la banda 90-99 vence entre el 19 y el 26 de octubre de 2026. |

**Impacto.** El sentido del calendario está al revés: a un NIT/cédula terminado en 01-09 se le informa el 26-oct-2026 cuando su plazo real venció entre el 12 y el 19 de agosto de 2026 — más de dos meses de extemporaneidad → sanción Art. 641 E.T. (5% mensual sobre el impuesto a cargo, mínimo 10 UVT) más intereses. Afecta a socios y representantes legales que consultan su renta personal en la plataforma.

**Fuente.** https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf — tabla 'Declaración de renta de personas naturales y sucesiones ilíquidas': 01y02 = 12 de agosto … 99y00 = 26 de octubre

### P0-41 · Tarifa de renta de empresas editoriales (Ley 98 de 1993)

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178`  
**Norma:** Art. 240 par. 7 E.T., adicionado por el Art. 10 de la Ley 2277 de 2022 (antes par. 4 al 9%). Concepto DIAN 11622 de 2023.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** El 15% aplica desde el año gravable 2023 (Ley 2277/2022, en vigor desde el 13-dic-2022). Hasta el AG 2022 la tarifa fue 9% (par. 4). La tarifa 0% no está vigente para ningún año gravable reciente. No hay transición.

| | |
|---|---|
| En el repo | 'Editoriales 0% (Ley 98/1993).' |
| Según la norma | 15% — parágrafo 7 del Art. 240 E.T.: la tarifa del impuesto sobre la renta de las empresas editoriales constituidas en Colombia como personas jurídicas cuya actividad económica y objeto social sea exclusivamente la edición de libros, revistas, folletos o coleccionables seriados de carácter científico o cultural, en los términos de la Ley 98 de 1993, es del 15%. |

**Impacto.** Un dictamen que aplique 0% a una editorial produce una declaración con impuesto cero frente a un impuesto real del 15% de la renta líquida gravable: inexactitud del 100% del impuesto a cargo, con sanción del 100% de la diferencia (Art. 648 E.T.) más intereses moratorios. También convierte cualquier recomendación de 'régimen editorial' en una asesoría inducida a error.

**Fuente.** https://actualicese.com/esta-sera-la-nueva-tarifa-del-impuesto-de-renta-para-empresas-editoriales/ y https://www.contadia.com/estatuto-tributario/articulo-240-tarifa-general-para-personas-juridicas

### P0-42 · Entrada de catálogo de la Ley 98 de 1993 (ley del libro) — tarifa de renta de editoriales

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/leyes-reformas.ts:100`  
**Norma:** Art. 240 par. 7 E.T. (Art. 10 Ley 2277 de 2022); Ley 98 de 1993 como norma de remisión subjetiva.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Desde AG 2023. Es la segunda fuente del repo que repite el error del 0%, por lo que el fix del catálogo de artículos no lo corrige.

| | |
|---|---|
| En el repo | titulo: 'Ley del libro — tarifa renta 0% para editoriales'; resumen (línea 102): 'Establece el beneficio de tarifa cero (0%) en renta para empresas editoriales de libros, revistas, folletos y coleccionables. Beneficio temporal que ha sido prorrogado.' |
| Según la norma | La tarifa aplicable no la fija hoy la Ley 98 de 1993 sino el par. 7 del Art. 240 E.T.: 15%. Adicionalmente el beneficio solo cobija a personas jurídicas cuya actividad económica Y objeto social sea EXCLUSIVAMENTE la edición de libros. |

**Impacto.** Duplica el error anterior en la capa de leyes/reformas, que es la que el motor normativo cita cuando el usuario pregunta por la 'ley del libro'. Además el resumen omite el requisito de exclusividad, ampliando el beneficio a editoriales con actividades mixtas que no califican.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_11622_2023.htm (Concepto DIAN 11622 de 2023)

### P0-43 · Sobretasa a la generación de energía eléctrica con recursos hídricos (alcance subjetivo y umbral)

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:197`  
**Norma:** Art. 240 par. 4 E.T. (Art. 10 Ley 2277 de 2022); Sentencia C-389 de 2023 (exequibilidad condicionada: la sobretasa solo grava la actividad de generación hídrica); Sentencia C-050 de 2026 (exequible; el umbral de 30.000 UVT responde a capacidad contributiva).  
**Confianza:** verificado-fuente-oficial  
**Vigencia:** AG 2023 a 2026 inclusive (2026 es el último año). El umbral de 30.000 UVT se evalúa año a año con la UVT del respectivo año gravable.

| | |
|---|---|
| En el repo | 'Par. 2 Art. 240: sobretasa entidades financieras, aseguradoras, bolsa de valores y reaseguradoras +5pp = 40% hasta 2027. Sobretasa hidroeléctricas y acueductos +3pp = 38% hasta 2026.' |
| Según la norma | La sobretasa de 3 puntos está en el PARÁGRAFO 4 (no el 2) del Art. 240 E.T., aplica únicamente a personas jurídicas cuya actividad económica principal sea la generación de energía eléctrica A TRAVÉS DE RECURSOS HÍDRICOS, para los años gravables 2023 a 2026, y SOLO cuando la renta gravable del año sea igual o superior a 30.000 UVT (2026: $1.571.220.000). No aplica a plantas menores a 1.000 kW. Los acueductos NO están sujetos a esta sobretasa. |

**Impacto.** Tres errores acumulados: (1) una empresa de acueducto/alcantarillado sería liquidada al 38% en lugar del 35% — 3 puntos de sobreimposición sobre una base inexistente; (2) un generador hidroeléctrico con renta gravable menor a 30.000 UVT, o con plantas < 1.000 kW, sería gravado al 38% cuando la ley lo excluye; (3) por la condicionalidad de C-389/23, la sobretasa no puede aplicarse a rentas de actividades distintas de la generación hídrica, distinción que el catálogo no registra. Cualquiera de los tres produce un impuesto incorrecto en un dictamen firmado.

**Fuente.** https://www.corteconstitucional.gov.co/relatoria/2023/c-389-23.htm , https://gestornormativo.creg.gov.co/gestor/entorno/docs/C-050_2026.htm y https://www.contadia.com/estatuto-tributario/articulo-240-tarifa-general-para-personas-juridicas

### P0-44 · Condición de aplicación de la sobretasa del 5% al sector financiero

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178`  
**Norma:** Art. 240 par. 2 E.T. (Art. 10 Ley 2277 de 2022), años gravables 2023 a 2027.  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** AG 2023–2027. El umbral de 120.000 UVT se evalúa con la UVT de cada año gravable. La exequibilidad de la sobretasa para el sector asegurador y bursátil fue confirmada por la Corte Constitucional en julio de 2026.

| | |
|---|---|
| En el repo | 'financieras/seguros/bolsa/reaseguros +5pp = 40% hasta 2027 (par. 2 del Art. 240)' — sin condición alguna. Se repite en normative/catalog/index.ts:70 ('par. 2 sobretasa financiera 40% y hidroeléctricas 38%'). |
| Según la norma | Los 5 puntos adicionales (tarifa total 40%) para instituciones financieras, aseguradoras y reaseguradoras, sociedades comisionistas de bolsa de valores, comisionistas agropecuarios, bolsas de bienes y productos agropecuarios y agroindustriales y proveedores de infraestructura del mercado de valores SOLO son aplicables a las personas jurídicas que en el año gravable correspondiente tengan una RENTA GRAVABLE IGUAL O SUPERIOR A 120.000 UVT (2026: $6.284.880.000). La sobretasa está sujeta además a un anticipo del 100% de su valor, liquidado sobre la base gravable del año gravable inmediatamente anterior y pagadero en dos cuotas iguales. |

**Impacto.** Una comisionista de bolsa, aseguradora o entidad financiera pequeña con renta gravable inferior a $6.284.880.000 sería liquidada al 40% cuando la ley le fija el 35%: 5 puntos de sobreimposición sobre la renta líquida gravable. Y al omitir el anticipo del 100% en dos cuotas, la proyección de caja fiscal de las entidades que sí superan el umbral subestima la salida de efectivo del año.

**Fuente.** https://www.contadia.com/estatuto-tributario/articulo-240-tarifa-general-para-personas-juridicas y https://actualicese.com/estatutotributario/240-2/

### P0-45 · Sobretasa del par. 3 Art. 240 E.T. — extracción de petróleo crudo y de carbón

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178`  
**Norma:** Art. 240 par. 3 E.T. (Art. 10 Ley 2277 de 2022); Decreto 261 de 2023 y Decreto 242 de 2024 (precios promedio y percentiles).  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente desde AG 2023. Los puntos adicionales del año gravable 2026 dependen del decreto de precios y percentiles que expida el Gobierno para ese año; el catálogo debe leer la resolución/decreto anual, no una cifra fija.

| | |
|---|---|
| En el repo | 'Sobretasas vigentes: hidroeléctricas +3pp = 38% hasta 2026; financieras/seguros/bolsa/reaseguros +5pp = 40% hasta 2027' — enunciado como lista cerrada de sobretasas vigentes. No existe ninguna entrada de catálogo para el par. 3 del Art. 240. |
| Según la norma | El parágrafo 3 del Art. 240 E.T. impone puntos adicionales variables a las personas jurídicas que desarrollen las actividades CIIU 0610 (extracción de petróleo crudo) y CIIU 0510/0520 (extracción de hulla y carbón lignito), determinados según la posición del precio promedio del año frente a percentiles del precio promedio mensual de los últimos 120 meses: 0, 5, 10 o 15 puntos para petróleo crudo (hasta 50% de tarifa total) y 0, 5 o 10 puntos para carbón (hasta 45%). Solo aplica a contribuyentes con renta gravable igual o superior a 50.000 UVT (2026: $2.618.700.000). Los precios y percentiles los certifica anualmente el Gobierno/DIAN por decreto (p. ej. Decreto 261 de 2023 y Decreto 242 de 2024). |

**Impacto.** Un contribuyente de extracción de hidrocarburos o carbón recibiría un dictamen que liquida su renta al 35% cuando la tarifa efectiva puede ser 40%, 45% o 50%. En una petrolera mediana esto es una subdeclaración de hasta 15 puntos de la renta líquida gravable, con sanción por inexactitud del 100% (Art. 648 E.T.) e intereses. Es el hueco más grande del dominio porque el catálogo presenta su lista de sobretasas como exhaustiva, lo que impide que el agente detecte la omisión.

**Fuente.** https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0242_2024.htm y https://www.contadia.com/estatuto-tributario/articulo-240-tarifa-general-para-personas-juridicas

### P0-46 · Fórmula de la Utilidad Depurada (UD) de la Tasa de Tributación Depurada — tasa mínima del 15%

**Ubicación:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:483`  
**Norma:** Art. 240 par. 6 E.T., adicionado por el Art. 10 de la Ley 2277 de 2022; Concepto Unificado DIAN 202(006038) de 2024 (metodología TTD).  
**Confianza:** verificado-fuente-secundaria  
**Vigencia:** Vigente desde el año gravable 2023, sin transición. Exequible (Corte Constitucional, 2024). El numeral 12 del Concepto Unificado DIAN quedó plenamente vigente tras revocarse su suspensión provisional en 2025.

| | |
|---|---|
| En el repo | 'UD = Utilidad Depurada (UAI − INCRGNO − rentas exentas − diferencias permanentes + gastos no deducibles)' |
| Según la norma | UD = UC + DPARL − INCRNGO − VIMPP − VNGO − RE − C, donde UC = utilidad contable o financiera antes de impuestos; DPARL = diferencias permanentes consagradas en la ley que AUMENTAN la renta líquida (se SUMAN, no se restan); INCRNGO = ingresos no constitutivos de renta ni ganancia ocasional que afectan la UC; VIMPP = valor del ingreso por método de participación patrimonial del año; VNGO = valor neto de los ingresos por ganancia ocasional que afectan la UC; RE = únicamente las rentas exentas por tratados para evitar la doble imposición (CAN/CDI), las del régimen de Compañías Holding Colombianas (CHC) y las de los literales a) y b) del numeral 4 y el numeral 7 del Art. 235-2 E.T. — NO todas las rentas exentas; C = compensación de pérdidas fiscales o excesos de renta presuntiva tomados en el año y que no afectaron la utilidad contable. El impuesto a adicionar es IA = (UD × 15%) − ID, con ID = INR + DTC − IRP. |

**Impacto.** El signo de las diferencias permanentes está invertido: restar DPARL en lugar de sumarlo reduce artificialmente la UD y por tanto el impuesto a adicionar por tasa mínima. Restar TODAS las rentas exentas (cuando la ley solo permite restar un subconjunto taxativo) amplifica el mismo sesgo. Omitir VIMPP y VNGO deja dentro de la UD ingresos que la ley excluye, y omitir C ignora las compensaciones. El resultado es una TTD calculada mal en ambas direcciones y un impuesto adicional del par. 6 mal cuantificado en el dictamen que el cliente firma.

**Fuente.** https://www.consultorcontable.com/tasa-minima-de-tributacion-paragrafo-6-art-240-et/ y https://actualicese.com/rutas/books/tasa-minima-de-tributacion-normativa-calculos-y-obligados/page/capitulo-1-generalidades

## Todas las discrepancias por dominio

### Retención en la fuente a título de renta y autorretención (Colombia, año gravable 2026)

El repo acertó en lo más volátil: las bases mínimas reducidas (servicios 2 UVT, compras/otros ingresos 10 UVT) SÍ están vigentes desde el 01-jul-2026 porque el Consejo de Estado revocó el 02-jun-2026 la suspensión provisional del Decreto 0572/2025 que había decretado el 07-may-2026; también son correctas las tarifas de compras 2,5%/3,5%, servicios 4%/6%, arrendamiento muebles 4%, inmuebles 3,5% y rendimientos financieros 7%, y el UVT 2026 = $52.374. Pero quedaron dos errores de cifra que producen cálculo incorrecto: el catálogo invierte las tarifas de honorarios a persona natural (declarante 11% / no declarante 10%, no al revés) y publica un juego de tarifas de autorretención especial ("0,4% / 1,1% / 1,6%") que nunca existió como conjunto y que en todo caso quedó derogado por el art. 8 del Decreto 0572/2025, hoy en vigor con tarifas entre 0,55% y 4,50%. En el motor de reglas se confirma el hallazgo de la auditoría previa: no existe forma de excluir un régimen — el match por `supplierRegimes` es inclusivo (`some`), de modo que un proveedor autorretenedor o gran contribuyente sigue matcheando por su régimen base y se le practica retención improcedente, pese a que el comentario del seed afirma lo contrario. Además el seed fija el umbral de 2 UVT sin `valid_from`, aplicándolo retroactivamente a períodos (2025 y 08-may–30-jun-2026) en que regían 4/27 UVT. La retención sobre pagos laborales (Arts. 383/386) y la renta exenta del 25% con tope 790 UVT no están codificadas en ninguna parte.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Tarifa de retención en la fuente por honorarios y comisiones a personas naturales (declarante vs. no declarante) | `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:34` | RTF_HONORARIOS_PN → tarifaDeclarante: '10%', tarifaNoDeclarante: '11%' | tarifaDeclarante: 11%, tarifaNoDeclarante: 10%. El 11% aplica al beneficiario obligado a declarar renta, y también al no declarante cuando los pagos acumulados del mismo agente retenedor en el año sup | Art. 392, inciso 2 E.T. (mod. Ley 1819/2016 art. 75) y Decreto 1625/2016 Art. 1.2.4.3.1 |
| P0 | Tarifas de la autorretención especial a título de renta por actividad económica (CIIU) | `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:104` | RTF_AUTORETENCIONES_ESPECIALES_CIIU → tarifaDeclarante: '0.4% / 1.1% / 1.6% según CIIU'; comentario línea 107: 'Las tasas 0.4%, 1.1% y 1.6% aplican según el cód | Desde el 01-jul-2026 rigen las tarifas del art. 8 del Decreto 0572/2025, que sustituyó el art. 1.2.6.8 del DUR 1625/2016: 0,55%, 1,10%, 1,20%, 1,70%, 2,20%, 2,80%, 3,50% y 4,50% según CIIU (p. ej. tra | Decreto 0572/2025 art. 8, que sustituye el Art. 1.2.6.8 del Decreto 1625/2016; antecedentes: Decreto 2201/2016, Decreto 0261/2023, Decreto 242/2024 |
| P0 | Sujetos no sometidos a retención: exclusión de autorretenedores, grandes contribuyentes autorretenedores y entidades no sujetas | `src/lib/accounting/tax-engine/rules-engine.ts:121` | const matches = triggers.supplierRegimes.some((r) => profileRegimes.includes(r)); if (!matches) continue; — con profileRegimes = [profile.regime, 'gran_contribu | No hay lugar a retención en la fuente cuando el beneficiario del pago es autorretenedor del respectivo concepto, ni sobre los pagos a entidades no contribuyentes y demás sujetos expresamente excluidos | Art. 369 E.T. (pagos no sometidos a retención); Art. 368 par. 1 E.T. y Decreto 1625/2016 Arts. 1.2.6.1 y 1.2.6.2 (régimen de autorretenedores y resolución DIAN de autorización) |
| P1 | Vigencia temporal del umbral mínimo de retención por servicios (2 UVT) y por compras/otros ingresos (10 UVT) | `src/lib/db/seeds/tax-rules-co-2026.ts:96` | RTF_SVC_4 → applyThresholdUvt: '2.0000', insertado sin valores para valid_from / valid_until (el INSERT de las líneas 172-197 no incluye esas columnas, pese a q | Las bases reducidas (servicios 2 UVT, compras/otros ingresos 10 UVT) rigen desde el 01-jun-2025 hasta el 07-may-2026 y de nuevo desde el 01-jul-2026. Entre el 08-may-2026 y el 30-jun-2026 (suspensión | Decreto 0572/2025 arts. 2 y 6 (vigencia 01-jun-2025); auto del Consejo de Estado de 07-may-2026 (suspensión provisional arts. 2 a 8) y auto de 02-jun-2026 (revocatoria, restablecimiento desde el 01-jul-2026); Decreto 1625/2016 Arts. 1.2.4.4.1, 1.2.4.6.9 y 1.2.4.9.1 en su redacción anterior |
| P1 | Tarifa aplicada por el motor contable a honorarios pagados a personas naturales | `src/lib/db/seeds/tax-rules-co-2026.ts:111` | RTF_HONO_11 → rate: '0.110000' con applicableTriggers.supplierRegimes: ['regimen_comun','persona_natural'] (línea 117); una sola regla, sin variante de tarifa s | 11% para personas jurídicas y para personas naturales declarantes (o cuyos pagos acumulados del mismo agente superen 3.300 UVT en el año); 10% para personas naturales no declarantes por debajo de ese | Art. 392, inciso 2 E.T.; Decreto 1625/2016 Art. 1.2.4.3.1 |
| P2 | Retención en la fuente sobre pagos laborales (procedimientos 1 y 2) y renta exenta del 25% | `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:19` | Ausente. TARIFAS_RETENCION no contiene ninguna entrada de rentas de trabajo; el catálogo del E.T. (estatuto-tributario.ts) tampoco incluye los Arts. 206, 383 ni | Art. 383 E.T.: tabla marginal de 7 rangos en UVT que arranca en 95 UVT ($4.975.530 con UVT 2026) y llega a una tarifa marginal máxima del 39% por encima de 2.300 UVT. Art. 386 E.T.: procedimiento 2, c | Arts. 383 y 386 E.T.; Art. 206 num. 10 E.T., modificado por el art. 2 de la Ley 2277 de 2022 (que sustituyó el tope mensual de 240 UVT por 790 UVT anuales) |
| P2 | Retención en la fuente por servicio de transporte de carga y de transporte terrestre de pasajeros | `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:19` | Ausente. No hay entrada RTF_TRANSPORTE_* en TARIFAS_RETENCION; el concepto tampoco aparece en el seed de reglas del motor contable. | Transporte de carga: 1%. Transporte terrestre de pasajeros: 3,5% con base mínima de 10 UVT (mismo mínimo que otros ingresos tributarios tras el Decreto 0572/2025). | Art. 392 E.T.; Decreto 1625/2016 Arts. 1.2.4.4.6 y 1.2.4.4.8 (transporte); base mínima conforme al Decreto 0572/2025 |
| P2 | Referencia normativa de la resolución DIAN que fija el UVT (campo decree_ref persistido en la tabla uvt_constants) | `src/lib/db/seeds/tax-rules-co-2026.ts:139` | { year: 2025, decreeRef: 'Resolución DIAN 000187/2024-12-19' } y { year: 2026, decreeRef: 'Resolución DIAN 000187/2025-12-19' } — el mismo número de resolución | UVT 2026 ($52.374): Resolución DIAN 000238 del 15 de diciembre de 2025. UVT 2025 ($49.799): Resolución DIAN 000193 del 4 de diciembre de 2024. Estos son los valores que el propio repo documenta correc | Resolución DIAN 000238 del 15-dic-2025 (UVT 2026); Resolución DIAN 000193 del 04-dic-2024 (UVT 2025); base legal Art. 868 E.T. |

**No verificables contra fuente en esta pasada.**

- Número de radicado/expediente 'providencia CE 30229' citado en src/lib/accounting/tax-engine/constants.ts:51 y en el encabezado de tarifas-retencion.ts:11 como identificador del auto del Consejo de Estado. La SUSTANCIA sí quedó verificada (el 02-jun-2026 el Consejo de Estado revocó la suspensión provisional de los arts. 2 a 8 del Decreto 0572/2025 y fijó el restablecimiento desde el 01-jul-2026), pero no logré confirmar contra fuente el número de expediente exacto. Si el radicado real es otro, la cita del dictamen es incorrecta.
- src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:104 — la asignación concreta de cada tarifa de autorretención a cada código CIIU. El Decreto 0572/2025 art. 8 trae una tabla de varios cientos de filas CIIU→tarifa; verifiqué el rango de tarifas (0,55% a 4,50%) y una muestra de asignaciones, no la tabla completa. El repo no codifica el mapeo CIIU→tarifa en absoluto, sólo la cadena de texto, así que no hay mapeo que auditar fila por fila.
- src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:75 — base mínima de 10 UVT asignada al arrendamiento de bienes INMUEBLES. Las tablas de firmas confirman 10 UVT para 2026, pero no localicé el artículo del DUR 1625/2016 que el Decreto 0572/2025 modifique específicamente para arrendamiento de inmuebles (el art. 6 del decreto trata enajenación de bienes raíces, no arrendamiento). El tratamiento como 'otros ingresos tributarios' del Art. 401 E.T. es la interpretación estándar y probablemente correcta, pero no la confirmé contra el texto del decreto.
- src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:66 — ausencia de umbral mínimo (umbralUVT: null) para arrendamiento de bienes MUEBLES al 4%. Coincide con la práctica y con las tablas consultadas, pero no lo confirmé contra el artículo del DUR.
- Tarifa del 0,1% de retención en la fuente sobre operaciones de transporte terrestre de carga que la DIAN estaría reglamentando en 2026 (aparece en un boletín INCP de marzo-2026). No pude establecer si llegó a expedirse la resolución ni cómo interactúa con la tarifa general del 1%. Si se expidió, el catálogo tendría un concepto adicional faltante.
- src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:113-122 — ReteIVA 15% (Art. 437-1 E.T.) y ReteIVA 100% (Arts. 437-4 y 437-5). Quedan fuera del dominio de renta que me correspondía auditar; no los verifiqué contra fuente en esta pasada.
- src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:91-99 — RTF_DIVIDENDOS_PN_RESIDENTE, marcado con estado 'MODIFICADO' y descrito en prosa libre en lugar de tarifas estructuradas. La tabla del Art. 242 E.T. es dominio de renta de personas naturales, no de retención por conceptos; no la verifiqué.

<details><summary>Fuentes consultadas (15)</summary>

- https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0572_2025.htm — texto oficial DIAN del Decreto 572 de 2025 (art. 2 base servicios 2 UVT; art. 6 base 10 UVT; art. 8 sustituye DUR 1.2.6.8, tarifas de autorretención por CIIU)
- https://www.presidencia.gov.co/prensa/Paginas/Obligacion-de-retencion-en-la-fuente-y-autorretencion-se-mantiene-con-normas-260509.aspx — comunicado DIAN/Presidencia sobre la suspensión provisional del Decreto 0572/2025 (08-may-2026)
- https://accounter.co/noticias/editorial/el-decreto-572-de-2025-recupera-vigencia-plena-el-consejo-de-estado-revoca-la-suspension-provisional-y-fija-julio-como-fecha-de-restablecimiento.html — Consejo de Estado revoca la suspensión el 02-jun-2026; restablecimiento desde el 01-jul-2026
- https://www.bdo.com.co/es-co/publicaciones/boletines-tax/tax-alert-consejo-de-estado-revoca-la-suspension-provisional-del-decreto-572-de-2025 — BDO, confirmación de la revocatoria y de la vigencia desde julio 2026
- https://actualicese.com/tabla-automatizada-con-las-tarifas-de-autorretencion-especial-en-renta/ — comparativo de tarifas de autorretención: Decreto 2201/2016 (0,4/0,8/1,6), Decreto 0261/2023 y 242/2024 (0,55/1,1/2,2), Decreto 0572/2025 (1,2/3,5/4,5 y minero 1,7/2,7/2,8)
- https://tower-consulting.com/consejo-de-estado-revoca-suspension-del-decreto-572-de-2025/ — vigencia de tarifas de autorretención tras la revocatoria
- https://www.gerencie.com/tabla-de-retencion-en-la-fuente-2026.html — tabla de retención en la fuente 2026 (tarifas y bases mínimas UVT por concepto)
- https://www.gerencie.com/retencion-en-la-fuente-por-honorarios.html — honorarios PN: 10% no declarante / 11% declarante o al superar 3.300 UVT (Art. 392 inc. 2 E.T., DUR 1.2.4.3.1)
- https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_901110_2021.htm — doctrina DIAN sobre tarifa de honorarios a personas naturales
- https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/ — UVT 2026 = $52.374 fijado por Resolución DIAN 000238 del 15-dic-2025
- https://actualicese.com/uvt-2026/ — confirmación UVT 2026 y Resolución 000238/2025
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883 — Ley 2277 de 2022, art. 2: renta exenta 25% limitada a 790 UVT anuales (Art. 206 num. 10 E.T.)
- https://estatuto.co/206 — Art. 206 num. 10 E.T. vigente
- https://estatuto.co/383 — Art. 383 E.T., tabla de retención por rentas de trabajo (7 rangos, marginal máxima 39%, desde 95 UVT)
- https://actualicese.com/retencion-en-la-fuente-por-compras-2026/ — base mínima de retención por compras 2026 (10 UVT)

</details>

### Dividendos (Arts. 242, 242-1, 245, 49, 254-1 E.T.), ganancia ocasional (Arts. 299-317, 307, 311-1 E.T.) e impuesto al patrimonio (Arts. 292-3 a 298-8 E.T. + Decreto 0173 de 2026)

La UVT 2026 = $52.374 del repo es CORRECTA (Resolución DIAN 000238 del 15-dic-2025) y todas las conversiones derivadas que revisé cuadran (1.090 UVT = $57.087.660; 72.000 UVT = $3.770.928.000; 2.500 UVT = $130.935.000). El bloque de ganancia ocasional del catálogo está bien: 15% general (Art. 313), 20% loterías (Art. 317) y 13.000 UVT del Art. 307 num. 1 se confirman vigentes tras Ley 2277/2022. El problema grave está en DIVIDENDOS: el repo convive con tres versiones contradictorias del Art. 242 — la correcta en el dividend-optimizer, una falsa de "20% para personas naturales residentes" en el contexto normativo global que se antepone a TODOS los agentes del pipeline financiero y en el strategy-director, y una falsa de "retención 10% dividendos gravados" que el legal-auditor está obligado a imprimir en el acta/dictamen que el cliente firma. Además el dividend-optimizer presenta la retención del 15% como si fuera el impuesto definitivo del socio (lo es el Art. 241 progresivo hasta 39% menos descuento Art. 254-1), y asume sin calcular que todo el dividendo es no gravado (omite el Art. 49 E.T.), sesgando sistemáticamente la recomendación "distribuir vs capitalizar" hacia distribuir. En impuesto al patrimonio el umbral de 72.000 UVT del calendario es correcto para personas naturales, pero el repo no tiene rastro del impuesto TEMPORAL al patrimonio para personas jurídicas del Decreto 0173 de 2026 (200.000 UVT al 1-mar-2026, 0,5% / 1,6%), vigente y con plazos ya vencidos en abril-mayo de 2026.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Tarifa de dividendos para persona natural residente en el bloque de contexto normativo que se antepone a TODOS los agentes del pipeline financiero | `src/lib/agents/financial/prompts/colombia-2026-context.ts:57` | **Ajustes al regimen de dividendos** (Art. 242 ET — 20% para personas naturales residentes, retencion en fuente mas tarifa especial; Art. 242-1 ET para sociedad | Art. 242 E.T. (mod. Art. 3 Ley 2277/2022): los dividendos no gravados pagados a persona natural residente INTEGRAN la base gravable y tributan a la tarifa progresiva del Art. 241 (0% a 39%), con reten | Art. 242 E.T. modificado por el Art. 3 de la Ley 2277 de 2022; Art. 245 E.T. modificado por el Art. 4 de la Ley 2277 de 2022; Decreto 1103 de 2023 |
| P0 | Misma tarifa falsa de dividendos en la versión en inglés del contexto normativo global | `src/lib/agents/financial/prompts/colombia-2026-context.ts:124` | **Adjustments to the dividend regime** (Art. 242 ET — 20% for resident individuals, withholding plus special rate; Art. 242-1 ET for domestic companies). | Art. 242 E.T.: resident individuals' non-taxed dividends are integrated into the ordinary tax base at the Art. 241 progressive scale (0%-39%), with 15% withholding on the excess over 1,090 UVT. The 20 | Art. 242 E.T. modificado por el Art. 3 de la Ley 2277 de 2022; Decreto 1103 de 2023 |
| P0 | Macro-supuesto de tarifa de dividendos usado por el Director de Estrategia para construir los 3 escenarios financieros obligatorios | `src/lib/agents/financial/prompts/strategy-director.prompt.ts:195` | - Dividendos: 20% (Art. 242 E.T.). | No existe tarifa plana de 20% en el Art. 242. Persona natural residente: integración a la base con tarifa Art. 241 (0%-39%) + retención 15% sobre el exceso de 1.090 UVT + descuento Art. 254-1 (19%). S | Arts. 242, 242-1, 245 y 254-1 E.T. (Ley 2277 de 2022); Decreto 1103 de 2023 |
| P0 | Tarifa de retención sobre dividendos gravados que el Auditor Legal debe afirmar en el dictamen societario | `src/lib/agents/financial/audit/prompts/legal-auditor.prompt.ts:69` | - Dividendos: pago dentro del ano siguiente al decreto (Art. 156 C.Co.). Retencion 10% dividendos gravados (Art. 242 E.T.). | Los dividendos GRAVADOS (provenientes de utilidades gravadas conforme al parágrafo 2 del Art. 49 E.T.) pagados a persona natural residente están sujetos a la tarifa del Art. 240 E.T. (35%) y, una vez | Art. 242 inciso 2 E.T. (mod. Art. 3 Ley 2277 de 2022); Art. 240 E.T.; Decreto 1103 de 2023 |
| P0 | Instrucción que fuerza el campo impuestoDividendosComment del dictamen a repetir la retención del 10% | `src/lib/agents/financial/audit/prompts/legal-auditor.prompt.ts:89` | impuestoDividendosComment SIEMPRE menciona Art. 242 E.T. (retencion 10% dividendos gravados). | El comentario debe reflejar: dividendos no gravados a PN residente = retención 15% sobre el exceso de 1.090 UVT (Art. 242 par.) e integración a la base del Art. 241; dividendos gravados = tarifa del A | Art. 242 E.T. (mod. Art. 3 Ley 2277 de 2022); Art. 240 E.T.; Decreto 1103 de 2023 |
| P0 | Fórmula del impuesto al socio en el escenario 'distribuir 100%' del optimizador de dividendos | `src/lib/agents/financial/escudo-survival/prompts/dividend-optimizer.prompt.ts:48` | data.escenarios.distribuirTotal: impuestoSocio = max(0, (utilidadDistribuible - 57.087.660) x 0.15); ahorroSocio = 0; netoSocio = utilidadDistribuible - impuest | El 15% sobre el exceso de 1.090 UVT es RETENCIÓN EN LA FUENTE (parágrafo del Art. 242 E.T. y Decreto 1103 de 2023), es decir un anticipo imputable, no el impuesto definitivo. El impuesto definitivo de | Art. 242 E.T. y su parágrafo; Art. 241 E.T.; Art. 254-1 E.T. (adicionado por el Art. 5 de la Ley 2277 de 2022); Decreto 1103 de 2023 |
| P1 | Determinación de qué porción de la utilidad distribuible es dividendo no gravado (máximo no gravado del Art. 49 E.T.) | `src/lib/agents/financial/escudo-survival/prompts/dividend-optimizer.prompt.ts:47` | Asumir socio persona natural residente, dividendo NO gravado en cabeza de la sociedad (caso PYME mas comun) salvo que el user content indique lo contrario. | El Art. 49 E.T. obliga a calcular la máxima utilidad susceptible de distribuirse como ingreso no constitutivo de renta ni ganancia ocasional: renta líquida gravable + ganancias ocasionales gravables, | Art. 49 E.T. (numerales 1 a 5 y parágrafo 2); Art. 242 inciso 2 E.T. |
| P1 | Entrada del catálogo de tarifas de retención para dividendos a personas naturales residentes | `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:94` | 'Tabla progresiva Art. 242 E.T. — desde 0% hasta 15% sobre los no gravados; los gravados a tarifa marginal Art. 241 E.T.' | Los dividendos GRAVADOS se someten primero a la tarifa del Art. 240 E.T. (35% general), no a la tarifa marginal del Art. 241; solo el remanente, una vez disminuido ese impuesto, entra al régimen del A | Art. 242 incisos 1 y 2 E.T. (mod. Art. 3 Ley 2277 de 2022); Art. 240 E.T.; Decreto 1103 de 2023 |
| P1 | Impuesto temporal al patrimonio para personas jurídicas, año gravable 2026 | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:290` | (ausente) — el catálogo normativo no tiene ninguna entrada de impuesto al patrimonio; la única referencia en todo el repo es el calendario src/data/calendars/na | El Decreto 173 del 24-feb-2026 creó un impuesto al patrimonio TEMPORAL, exclusivo del año gravable 2026, a cargo de personas jurídicas y sociedades de hecho declarantes de renta con patrimonio líquido | Decreto 173 del 24 de febrero de 2026 (Art. 215 C.P., emergencia económica, social y ecológica declarada por el Decreto 0150 de 2026) |
| P3 | Artículo citado como fuente de la tarifa de ganancia ocasional para personas naturales | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:330` | titulo: 'Tarifa del impuesto sobre ganancias ocasionales — PJ y PN' / resumen: 'Tarifa general GO para PJ y PN: 15% (modificado por Art. 32 Ley 2277/2022...)' | El Art. 313 E.T. fija la tarifa de ganancias ocasionales únicamente para las SOCIEDADES Y ENTIDADES nacionales y extranjeras (15%). La tarifa para personas naturales residentes está en el Art. 314 E.T | Arts. 313, 314 y 316 E.T., modificados por la Ley 2277 de 2022 |

**No verificables contra fuente en esta pasada.**

- src/data/calendars/nacional-2026.ts:174 y src/lib/scrapers/dian-scraper.ts:50 — la base legal de los plazos de 2026 se cita como 'Decreto 2229 de 2023'. Las FECHAS del impuesto al patrimonio de personas naturales que produce el repo (declaración + cuota 1 en mayo de 2026, cuota 2 el 14-sep-2026) coinciden con lo publicado por fuentes secundarias, pero no pude confirmar contra el decreto oficial que el Decreto 2229 de 2023 siga siendo la norma que fija el calendario del año gravable 2026; podría haber sido sustituido o modificado por un decreto de plazos posterior. Riesgo: cita normativa desactualizada en un dictamen, no error de fecha.
- src/data/calendars/nacional-2026.ts:170-183 — las entradas de impuesto al patrimonio no distinguen sujeto (persona natural vs jurídica) ni advierten que la causación del régimen permanente es al 1 de enero mientras que la del Decreto 0173 de 2026 es al 1 de marzo. No pude verificar si algún consumidor del calendario aplica estas fechas indiscriminadamente a personas jurídicas.
- src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:250-267 (ART_242_ET) — el campo textoLiteral es null y estado es 'MODIFICADO' sin fecha de corte. El resumen es sustancialmente correcto, pero al no tener texto literal ni fecha de última verificación no hay forma de comprobar que el motor normativo esté detectando la versión vigente frente a una futura reforma. Mismo patrón en ART_245_ET, ART_299_317_ET, ART_307_ET, ART_313_ET y ART_317_ET.
- No existe en el repo ninguna constante ni entrada de catálogo para: la tabla de tarifas del impuesto al patrimonio de personas naturales (Art. 296-3 E.T.: 0% / 0,5% / 1,0% / 1,5%, con el tramo del 1,5% vigente solo hasta 2026), la exención de 5.000 UVT del Art. 311-1 E.T. en venta de vivienda de habitación, los numerales 2, 3 y 4 del Art. 307 E.T. (6.500 / 3.250 / 1.625 UVT), ni el descuento tributario del Art. 254-1 E.T. Son vacíos de cobertura, no discrepancias, pero cualquier dictamen que toque estos temas se emitirá sin anclaje en el catálogo.

<details><summary>Fuentes consultadas (12)</summary>

- Resolución DIAN 000238 del 15-dic-2025 — UVT 2026 = $52.374 (vía INCP y actualicese.com/uvt-2026/)
- https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm — Decreto 1103 de 2023 (retención en la fuente sobre dividendos: Art. 242 tabla 0%/15% sobre el exceso de 1.090 UVT; Art. 242-1 = 10%; Art. 245 = 20%; gravados a tarifa Art. 240)
- https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0173_2026.htm — Decreto 173 del 24-feb-2026 (impuesto temporal al patrimonio personas jurídicas)
- Art. 254-1 E.T. (adicionado por Art. 5 Ley 2277/2022) — descuento tributario 19% sobre la base cedular de dividendos que exceda 1.090 UVT — https://estatuto.co/art-254-1-descuento-tributario-determinado-a-partir-de-la-renta-liquida-cedular-de-dividendos-y-participaciones-de-personas-naturales-residentes-y-sucesiones-iliquidas-de-causantes-residentes
- Art. 49 E.T. — determinación de dividendos y participaciones no gravados (máxima utilidad susceptible de distribuirse como INCRGNO) — https://estatuto.co/49 y https://www.gerencie.com/calculo-de-los-dividendos-no-gravados-articulo-49-e-t.html
- Art. 296-3 E.T. — tabla del impuesto al patrimonio: 0-72.000 UVT 0%; 72.000-122.000 0,5%; 122.000-239.000 1,0%; >239.000 1,5% (esta última solo 2023-2026; desde 2027 baja a 1,0%) — https://estatuto.co/296-3
- Art. 307 E.T. tras Ley 2277/2022: num.1 = 13.000 UVT vivienda urbana del causante; num.2 = 6.500 UVT inmueble rural; num.3 = 3.250 UVT; num.4 = 20% con tope 1.625 UVT — https://www.gerencie.com/cuales-son-las-ganancias-ocasionales-exentas.html
- Art. 311-1 E.T. (mod. Art. 31 Ley 2277/2022) — exención 5.000 UVT en venta de casa o apartamento de habitación — https://estatuto.co/311-1
- Ley 2277 de 2022 — https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883
- Corte Constitucional, Sentencia C-079 de 2026 — declaró INEXEQUIBLE el Decreto Legislativo 1474 del 29-dic-2025 (que pretendía bajar el umbral del impuesto al patrimonio de 72.000 a 40.000 UVT); dicho umbral NUNCA entró en vigor — https://www.perezllorca.com/es-co/actualidad/boletin/corte-constitucional-tumba-el-decreto-1474-se-caen-las-medidas-tributarias-de-la-emergencia-economica/
- Corte Constitucional, expediente RE-391 (M.P. Lina Marcela Escobar Martínez) — control automático del Decreto 0173 de 2026; suspensión provisional parcial solo para ESAL del RTE y personas jurídicas en liquidación — https://www.perezllorca.com/es-co/actualidad/boletin/decision-clave-de-la-corte-suspension-parcial-del-impuesto-al-patrimonio-en-el-marco-de-la-emergencia/
- https://actualicese.com/impuesto-al-patrimonio/ — impuesto al patrimonio obligados, plazos y declaración AG 2026

</details>

### UVT y umbrales generales (Colombia, año gravable 2026)

El valor nuclear está bien: UVT 2026 = $52.374 (Res. DIAN 000238 del 15-dic-2025) es correcto en CLAUDE.md, en src/lib/accounting/tax-engine/constants.ts y en todos los prompts financieros, y la serie histórica UVT_BY_YEAR 2020-2026 (35.607 / 36.308 / 38.004 / 42.412 / 47.065 / 49.799 / 52.374) coincide íntegramente con las resoluciones DIAN de cada año. La reforma tributaria radicada en sept-2025 fue hundida en el Senado el 09-dic-2025, así que la Ley 2277/2022 sigue siendo el marco y no hay cambios de umbrales por reforma. Lo que NO está alineado: (a) el módulo Pyme (src/modules/pyme) todavía trae UVT = 49.799 en un archivo llamado NORMATIVA_2026 y lo pinta en la pantalla "Cifras 2026"; (b) el catálogo normativo convierte el umbral de agentes de retención PN (Art. 368-2, 30.000 UVT) con la UVT del año en curso en vez de la del año inmediatamente anterior, sobrestimando el tope en $77M; (c) taxCalculator.ts llama "TOPE_RST" (Régimen Simple) al umbral de responsable de IVA de 3.500 UVT, y el cockpit Pyme le dice literalmente al usuario que superó el tope del Régimen Simple cuando ese tope es 100.000 UVT; (d) el umbral SAGRILAFT está expresado en UVT cuando la norma lo fija en SMMLV, con un error de escala de ~8x; (e) el redondeo obligatorio del Art. 868 E.T. (múltiplo de mil para resultados > $10.000) no se aplica en ninguna conversión UVT→COP del repo. La degradación por año no tabulado es parcialmente correcta (histórico sí, futuro no: usa UVT 2026 en silencio y hardcodea el año).

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Umbral de personas naturales comerciantes que son agentes de retención (30.000 UVT) convertido a pesos con la UVT del año en curso en vez de la del año inmediatamente anterior | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:517` | 'Personas naturales comerciantes son agentes de retención si en el año inmediatamente anterior tuvieron un patrimonio bruto o ingresos brutos superiores a 30.00 | Para ser agente de retención durante 2026 el test se corre sobre el año 2025 y con la UVT de 2025: 30.000 × $49.799 = $1.493.970.000. El valor $1.571.220.000 (30.000 × UVT 2026) solo sería el umbral p | Art. 368-2 E.T. (adicionado por Ley 488/1998 art. 115); conversión conforme Art. 868 E.T. |
| P0 | Tope de ingresos del Régimen Simple de Tributación | `src/lib/tax/taxCalculator.ts:18` | export const TOPE_RST_UVT = 3500; // 3.500 UVT — IVA / INC bimestral = $183.309.000  (expuesto vía topeRST() y consumido por src/components/workspace/pyme/PymeH | El tope del Régimen Simple es 100.000 UVT = $5.237.400.000 para 2026. Las 3.500 UVT ($183.309.000) son el umbral para NO ser responsable de IVA (Art. 437 par. 3 E.T.), que es una responsabilidad disti | Art. 905 num. 2 E.T. (mod. Ley 2277 de 2022 art. 42); Corte Constitucional Sentencia C-540 de 2023 (inexequible el par. 2 del num. 2); Art. 437 par. 3 E.T. para las 3.500 UVT |
| P1 | Valor de la UVT usado por el módulo Contabilidad Pyme | `src/modules/pyme/data/normativa2026.ts:17` | UVT: 49_799,                 // OJO: pendiente confirmar Resolución DIAN 2026 | UVT 2026 = $52.374 | Resolución DIAN 000238 del 15-12-2025, expedida conforme al Art. 868 E.T. (IPC ingresos medios 01-oct-2024 a 01-oct-2025 certificado por DANE en 5,17%) |
| P1 | Umbral de obligados a implementar SAGRILAFT / PTEE (SuperSociedades) | `src/lib/agents/financial/fiscal-opinion/prompts/compliance-checker.prompt.ts:45` | 'Circular Externa 100-000016 SuperSociedades (SAGRILAFT/PTEE): umbral 160.000 UVT en activos o ingresos.' (repetido como regla de decisión en la línea 52: 'If a | El umbral está fijado en SMMLV, no en UVT: ingresos totales o activos iguales o superiores a 40.000 SMMLV al 31 de diciembre del año anterior = $70.036.200.000 con el SMMLV 2026 de $1.750.905. Entre 9 | SuperSociedades, Circular Externa 100-000016 de 2020 (Cap. X Circular Básica Jurídica) y Circular Externa 100-000011 de 2021 (PTEE), ambas derogadas por Circular Externa 100-000020 del 02-07-2026; SMMLV fijado por Decreto 1469 del 29-12-2025 |
| P1 | Sanción mínima tributaria (10 UVT) expresada sin la aproximación obligatoria al múltiplo de mil | `src/lib/tools/sanction-calculator.ts:23` | const MIN_SANCTION = MIN_SANCTION_UVT * UVT_2026; // $523.740 COP  (mismo valor replicado en src/lib/agents/tools/registry.ts:124, src/lib/agents/financial/escu | $524.000. El producto 10 × $52.374 = $523.740 debe aproximarse al múltiplo de mil más cercano por ser superior a $10.000. | Art. 639 E.T. (sanción mínima 10 UVT) en concordancia con el inciso final del Art. 868 E.T., literal c) — 'se aproximará al múltiplo de mil más cercano cuando el resultado fuere superior a diez mil pesos ($10.000)'; DIAN Concepto 65791 de 16-10-2013 |
| P2 | Función de conversión UVT → COP: no implementa el procedimiento de aproximaciones del Art. 868 E.T. | `src/lib/accounting/tax-engine/constants.ts:40` | export function uvtToCopByYear(uvtAmount, year) { const exact = UVT_BY_YEAR[year]; if (exact !== undefined) return Math.round(uvtAmount * exact); ... }  — redon | El resultado debe aproximarse: a) < $100 → entero más próximo; b) entre $100 y $10.000 → múltiplo de cien más cercano; c) > $10.000 → múltiplo de mil más cercano. Ejemplos 2026: 2 UVT = 104.748 → $105 | Art. 868 E.T., inciso final, literales a), b) y c) (texto vigente según Ley 1111 de 2006 art. 50); DIAN Concepto 65791 de 2013 |
| P2 | Referencia normativa (decree_ref) de las resoluciones DIAN que fijan la UVT, persistida en la tabla uvt_constants | `src/lib/db/seeds/tax-rules-co-2026.ts:138` | { year: 2025, ... decreeRef: 'Resolución DIAN 000187/2024-12-19' }, { year: 2026, ... decreeRef: 'Resolución DIAN 000187/2025-12-19' } | UVT 2025 → Resolución DIAN 000193 del 04-12-2024. UVT 2026 → Resolución DIAN 000238 del 15-12-2025. (La Resolución 000187 es del 28-11-2023 y fijó la UVT 2024 en $47.065; ninguna de las dos fechas '12 | Resolución DIAN 000193 de 2024; Resolución DIAN 000238 de 2025; ambas expedidas conforme al Art. 868 E.T. |
| P2 | Degradación de uvtToCopByYear para años no tabulados (futuros) | `src/lib/accounting/tax-engine/constants.ts:41` | if (year > 2026) return Math.round(uvtAmount * UVT_2026_COP);  — sin console.warn, con el año 2026 y la constante UVT_2026_COP escritos a mano en vez de derivar | No existe norma que autorice usar la UVT de un año para otro: el Art. 868 E.T. obliga a la DIAN a publicar por resolución, antes del 1 de enero, el valor aplicable a cada año, reajustado por el IPC de | Art. 868 E.T., incisos 2 y 3 (reajuste anual por IPC y publicación por resolución antes del 1 de enero) |
| P3 | Tope de ingresos brutos para declarar renta de personas naturales (1.400 UVT) expresado sin aproximación | `src/lib/tax/taxCalculator.ts:19` | export const TOPE_ORD_UVT = 1400; // 1.400 UVT — renta ordinaria      = $73.323.600   (topeOrdinario() devuelve 73.323.600; el test src/lib/tax/__tests__/taxCal | El número de UVT (1.400) es correcto para el año gravable 2026, pero el valor absoluto debe expresarse aproximado al múltiplo de mil: $73.324.000. Nota adicional: la etiqueta 'renta ordinaria' es impr | Art. 592 num. 1 E.T. y Art. 594-3 E.T. (topes de 1.400 UVT); Decreto Único 1625/2016 art. 1.6.1.13.2.7 (plazos y topes AG 2026); aproximación conforme Art. 868 E.T. literal c) |
| P3 | Decreto que fija el salario mínimo 2026 citado en el módulo Pyme | `src/modules/pyme/data/normativa2026.ts:9` | SMMLV: 1_750_905,            // Decreto 2673/2025 | El monto $1.750.905 es correcto, pero el decreto es el 1469 del 29-12-2025. El auxilio de transporte de $249.095 (línea 10, sin cita) lo fija el Decreto 1470 del 29-12-2025. El resto del repo cita cor | Decreto 1469 del 29-12-2025 (salario mínimo legal mensual vigente 2026) y Decreto 1470 del 29-12-2025 (auxilio de transporte 2026) |

**No verificables contra fuente en esta pasada.**

- src/lib/accounting/tax-engine/constants.ts:49-53 y src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:11-14 — la línea de tiempo del Decreto 0572/2025 (bases 2 UVT servicios / 10 UVT compras, suspendidas, restablecidas por providencia CE 30229 del 02-jun-2026 con vigencia 01-jul-2026, con las bases 4 / 27 UVT rigiendo entre el 08-may y el 30-jun-2026) es exactamente la que el repo documenta, pero las fuentes secundarias consultadas se contradicen entre sí: actualicese sigue publicando la cuantía mínima de compras 2026 en 27 UVT ($1.414.000) mientras alegra/siemprealdia publican 10 UVT desde el 01-jul-2026. No pude leer el auto del Consejo de Estado ni la parte resolutiva. Es el dominio de otro auditor (retención en la fuente), pero queda anotado: cualquier retención practicada en 2026 depende de qué régimen aplique en cada tramo de fechas.
- src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:704 — 'IVA bimestral para contribuyentes con ingresos ≥ 92.000 UVT al 31-dic del año anterior'. El número de UVT y la eliminación del período anual están confirmados (Art. 600 E.T.), pero el catálogo no dice con qué UVT se convierte. Aplica el mismo defecto que el Art. 368-2: para 2026 el test se corre sobre ingresos 2025 con UVT 2025 (92.000 × $49.799 = $4.581.508.000), no con UVT 2026. Como el texto no trae cifra en pesos no lo cuento como discrepancia probada, pero el LLM que lo consuma tenderá a usar la UVT 2026 del encabezado.
- src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts:21 — tope de 2.500 UVT = $130.935.000 COP 2026 para la sanción de extemporaneidad sin impuesto a cargo. El número de UVT del Art. 641 E.T. es correcto, pero no verifiqué contra fuente si el valor absoluto debe aproximarse a $130.935.000 (ya es múltiplo de mil, luego probablemente esté bien) ni si el desglose 'post-emplazamiento se duplican (1% mensual, topes 10% / 5.000 UVT)' refleja el texto literal del Art. 642. Dominio de sanciones.
- Umbral de 4.000 UVT del Art. 437 par. 3 E.T. para personas naturales prestadoras de servicios cuyos ingresos provengan de contratos con el Estado — NO está codificado en ninguna parte del repo. No es una discrepancia de valor (no hay valor errado) sino una regla ausente: el semáforo de src/lib/tax/taxCalculator.ts y PymeHub aplicará 3.500 UVT a un contratista estatal y lo marcará como responsable de IVA antes de tiempo.
- Topes de facturación electrónica — el repo no codifica ningún umbral en UVT para facturación electrónica, documento equivalente POS (límite de 5 UVT por tiquete, Resolución DIAN 000165 de 2023) ni documento soporte. Solo aparece la palabra 'facturacion electronica' como categoría del clasificador (src/lib/agents/prompts/classifier.prompt.ts:46). No hay nada que contrastar; se anota como cobertura faltante, no como discrepancia.
- src/lib/tax/taxCalculator.ts:33-46 — las tarifas RST_GROUPS ('tiendas' 1,88/2,4/2,9/3,4% y 'servicios' 5,9/7,5/8,6/9,5%) no corresponden a ninguno de los cinco grupos del Art. 908 E.T. tras la Ley 2277/2022. El propio archivo las declara ILUSTRATIVAS en el encabezado, así que no las reporto como discrepancia normativa, pero alimentan compare() que emite una recomendación RST vs Ordinario en producción. Requiere verificación por el auditor del dominio Régimen Simple.

<details><summary>Fuentes consultadas (16)</summary>

- DIAN, Resolución 000238 del 15-12-2025 (fija UVT 2026 = $52.374) — https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000238%20de%2015-12-2025.pdf
- DIAN, Resolución 000193 del 04-12-2024 (fija UVT 2025 = $49.799) — https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000193%20de%2004-12-2024.pdf
- DIAN, Comunicado de Prensa No. 128 de 2025 — https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-128-2025.aspx
- Art. 868 E.T. (UVT y procedimiento de aproximaciones, literales a/b/c) — https://estatuto.co/868 y https://www.contadia.com/estatuto-tributario/articulo-868-unidad-de-valor-tributario-uvt
- DIAN, Concepto 65791 de 16-10-2013 (aproximación de valores en declaraciones tributarias)
- Art. 905 E.T. (sujetos pasivos RST, tope 100.000 UVT) — https://estatuto.co/905
- Corte Constitucional, Sentencia C-540 de 2023 (inexequible el límite de 12.000 UVT para profesiones liberales en el RST) — https://www.corteconstitucional.gov.co/relatoria/2023/C-540-23.htm
- Art. 437 par. 3 E.T. / no responsables de IVA 2026 (3.500 UVT; 4.000 UVT contratistas del Estado) — https://actualicese.com/montos-para-ser-no-responsables-de-iva-en-2026/
- Art. 368-2 E.T. — personas naturales retenedoras 2026 (30.000 UVT del año 2025 = $1.493.970.000) — https://actualicese.com/personas-naturales-retenedoras-2026/ y https://estatuto.co/368-2
- Art. 639 E.T. — sanción mínima 2026 = 10 UVT = $524.000 — https://actualicese.com/esta-es-la-sancion-minima-tributaria-2026/ y https://www.buk.co/blog/sancion-minima-2026-en-colombia
- Art. 600 E.T. — periodicidad IVA (bimestral ≥ 92.000 UVT del año anterior) — https://estatuto.co/600 y https://actualicese.com/declaraciones-de-iva-en-2026-periodicidad-bimestral-cuatrimestral-y-anual/
- Topes para declarar renta AG 2026 (1.400 UVT ingresos / 4.500 UVT patrimonio) — https://rioconsultores.com/2026/01/07/topes-tributarios-2026-en-colombia-uvt-renta-iva-retenciones-y-facturacion-electronica-boletin-2/ y https://www.siigo.com/blog/obligaciones-fiscales/nuevos-topes-para-declarar-renta/
- Serie histórica UVT 2020-2026 con resolución por año — https://actualicese.com/uvt-2026/
- SuperSociedades, Circular Externa 100-000016 de 2020 (SAGRILAFT, umbral 40.000 SMMLV) y su derogatoria por Circular Externa 100-000020 del 02-07-2026 — https://www.crowe.com/co/news/obligados-al-cumplimiento-del-sagrilaft-y-el-ptee y https://www.hklaw.com/en/insights/publications/2026/07/cambios-en-sagrilaft-y-ptee-en-colombia-por-la-circular-externa
- Decretos 1469 y 1470 del 29-12-2025 (SMMLV 2026 = $1.750.905; auxilio de transporte = $249.095) — https://www.hklaw.com/en/insights/publications/2025/12/colombia-decreta-aumento-del-salario-minimo-y-auxilio-de-transporte
- Estado de la reforma tributaria 2025-2026 (proyecto hundido en Senado el 09-12-2025; rige Ley 2277/2022) — https://www.pwc.com/co/es/pwc-insights/reforma-tributaria-2026-ley-de-financiamiento.html

</details>

### Régimen Simple de Tributación (RST/SIMPLE) — Arts. 903 a 916 E.T., año gravable 2026

El motor RST del repo (src/lib/tax/taxCalculator.ts, portado de un handoff y autodeclarado "ilustrativo") está desalineado con el Art. 905 y el Art. 908 E.T. vigentes: usa 3.500 UVT como tope de pertenencia al Régimen Simple cuando la norma fija 100.000 UVT (≈ $5.237.400.000 con UVT 2026), un error de factor ~28x que llega literalmente a la UI de Pyme ("Sus ventas del año superan el tope del Régimen Simple"). Las dos tablas de tarifas codificadas no coinciden con ningún numeral del Art. 908 vigente tras la Sentencia C-540/2023, y la comparación RST vs Ordinario suma IVA solo del lado ordinario pese a que el IVA no integra el SIMPLE (Arts. 907 y 915 E.T.), lo que sesga sistemáticamente la recomendación de régimen hacia el RST. Está correcto y verificado: UVT 2026 = $52.374 (Res. DIAN 000238 del 15-dic-2025), y los prompts de tax-planning (tax-optimizer.prompt.ts) que ya citan bien el umbral de 100.000 UVT y la inexequibilidad del tope de 12.000 UVT por C-540/2023. El catálogo normativo del Escudo (estatuto-tributario.ts) no contiene ningún artículo del Título del RST (903–916), por lo que los dictámenes no tienen anclaje normativo propio en este dominio. La auditoría previa de 2026-07 detectó el 3.500 UVT pero no lo corrigió: sigue en código, en la UI y fijado por un test.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Tope de ingresos brutos para pertenecer al Régimen Simple de Tributación | `src/lib/tax/taxCalculator.ts:18` | export const TOPE_RST_UVT = 3500; // 3.500 UVT — IVA / INC bimestral = $183.309.000 | 100.000 UVT. Con UVT 2026 = $52.374 → $5.237.400.000. Las 3.500 UVT son otra cosa: el umbral bajo el cual la persona natural del SIMPLE NO es responsable de IVA ni de INC de restaurantes y bares (Art. | Art. 905 num. 2 E.T. (modificado por art. 41 Ley 2155 de 2021); Corte Constitucional Sentencia C-540 de 2023 (declara inexequible el tope reducido de 12.000 UVT de la Ley 2277/2022); Art. 908 par. 4 E.T. para las 3.500 UVT |
| P0 | Semáforo fiscal de la UI Pyme: etiqueta y mensaje del tope del Régimen Simple | `src/components/workspace/pyme/PymeHub.tsx:471` | <span>Tope: {copM(tope)} (3.500 UVT)</span> — renderiza "Tope: $183.309.000 (3.500 UVT)"; y en la línea 447: 'Sus ventas del año superan el tope del Régimen Sim | El tope del Régimen Simple es 100.000 UVT = $5.237.400.000 (2026). Si lo que se quiere semaforizar es la responsabilidad de IVA/INC de la persona natural del SIMPLE, el texto debe decir 'tope de no-re | Art. 905 num. 2 E.T.; Art. 908 par. 4 E.T. (Ley 2155/2021); Art. 437 par. 3 num. 6 E.T. |
| P0 | Tarifas consolidadas del SIMPLE para el grupo 'tiendas pequeñas, mini-mercados, micro-mercados y peluquería' | `src/lib/tax/taxCalculator.ts:34` | tiendas: [{uvtMax:6000, rate:0.0188}, {uvtMax:15000, rate:0.024}, {uvtMax:30000, rate:0.029}, {uvtMax:Infinity, rate:0.034}] → 1,88% / 2,40% / 2,90% / 3,40% | Art. 908 num. 1 E.T. vigente: 0–6.000 UVT = 1,2%; 6.000–15.000 UVT = 2,8%; 15.000–30.000 UVT = 4,4%; 30.000–100.000 UVT = 5,6% | Art. 908 num. 1 E.T., modificado por el art. 44 de la Ley 2277 de 2022 (numeral 1 NO afectado por C-540/2023) |
| P0 | Tarifas consolidadas del SIMPLE para servicios profesionales / profesiones liberales | `src/lib/tax/taxCalculator.ts:40` | servicios: [{uvtMax:6000, rate:0.059}, {uvtMax:15000, rate:0.075}, {uvtMax:30000, rate:0.086}, {uvtMax:Infinity, rate:0.095}] → 5,90% / 7,50% / 8,60% / 9,50% | Tabla revivida por C-540/2023 (numeral 3 del art. 42 de la Ley 2155 de 2021): 0–6.000 UVT = 5,9%; 6.000–15.000 UVT = 7,3%; 15.000–30.000 UVT = 12,0%; 30.000–100.000 UVT = 14,5% | Art. 908 E.T. según art. 42 num. 3 de la Ley 2155 de 2021, revivido por la Sentencia C-540 de 2023 que declaró inexequibles los numerales 4º y 5º del Art. 908 introducidos por el art. 44 de la Ley 2277 de 2022; ratificado por DIAN Concepto 2766 de 2026 |
| P0 | Comparación RST vs Ordinario: tratamiento del IVA | `src/lib/tax/taxCalculator.ts:153` | compare() = computeRST(ventas) vs computeOrdinario(ventas).total, donde computeOrdinario suma ivaNeto = ventas × 1,566% (línea 131) y computeRST no incluye IVA | El IVA NO integra el impuesto unificado del SIMPLE. Los contribuyentes del SIMPLE responsables de IVA siguen liquidándolo conforme al régimen general y presentan declaración anual consolidada de IVA ( | Art. 907 E.T. (impuestos que comprende el SIMPLE) y Art. 915 E.T. (régimen de IVA y de impuesto al consumo) |
| P1 | Descuento de los aportes del empleador al Sistema General de Pensiones contra el impuesto SIMPLE | `src/lib/tax/taxCalculator.ts:112` | return Math.max(0, annualSales * rate - aportesPension); — resta el aporte contra el impuesto unificado total, sin tope distinto de cero | El aporte del empleador al SGP se toma como descuento tributario en los recibos electrónicos del anticipo bimestral SIMPLE, pero 'la parte que corresponda al impuesto de industria y comercio consolida | Art. 903 par. 4 E.T. y Art. 912 E.T.; DIAN Concepto 988(906531) de 2021 |
| P1 | Límite superior del último tramo de tarifa del SIMPLE | `src/lib/tax/taxCalculator.ts:38` | { uvtMax: Infinity, rate: 0.034 } (y equivalente en 'servicios', línea 44) — la tarifa RST se aplica a cualquier nivel de ingresos, sin techo | El último tramo del Art. 908 E.T. es 'superiores a 30.000 UVT e inferiores a 100.000 UVT'. Por encima de 100.000 UVT no existe tarifa SIMPLE: el contribuyente queda excluido del régimen y debe pasar a | Art. 908 E.T. (tramos) en concordancia con Art. 905 num. 2 y Art. 914 E.T. (exclusión del SIMPLE) |
| P1 | Grupos de actividad económica del Art. 908 E.T. modelados en el motor | `src/lib/tax/taxCalculator.ts:33` | export type RstGroup = 'tiendas' \| 'servicios'; RST_GROUPS solo define esos dos grupos; MisPagosView.tsx:117 fija group: 'tiendas' hardcodeado para todos los us | El Art. 908 E.T. vigente (tras C-540/2023) tiene cuatro grupos de actividad: (1) tiendas pequeñas, mini-mercados, micro-mercados y peluquería; (2) comercio al por mayor y detal, servicios técnicos y m | Art. 908 E.T., numerales 1 a 3 (art. 44 Ley 2277/2022) y numeral revivido (art. 42 num. 3 Ley 2155/2021) por C-540/2023; parágrafo sobre CIIU 4665/3830/3811 |
| P2 | Test de regresión que congela el tope RST incorrecto | `src/lib/tax/__tests__/taxCalculator.test.ts:19` | it('tope RST = 3.500 UVT = $183.309.000', () => { ... expect(topeRST()).toBe(183_309_000); }) | topeRST() debe devolver 100.000 UVT × $52.374 = $5.237.400.000 para el año gravable 2026 (Art. 905 num. 2 E.T.). | Art. 905 num. 2 E.T. (Ley 2155 de 2021); Sentencia C-540 de 2023 |
| P2 | Cobertura del Régimen Simple en el catálogo normativo que alimenta los dictámenes | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:18` | El catálogo cubre Arts. 26, 45, 47, 107, 108, 115, 122, 137, 140, 158-3, 240, 240-1, 241, 242, 245, 254-258-1, 299-317, 365, 368-2, 376, 392, 395, 401, 420, 424 | El Régimen Simple está regulado en los Arts. 903 a 916 E.T. Los artículos operativos mínimos para un dictamen son: 903 (creación y hecho generador), 905 (sujetos pasivos, 100.000 UVT), 906 (quiénes NO | Arts. 903 a 916 E.T., Libro Octavo, adicionados por la Ley 1943/2018 y reincorporados por la Ley 2010/2019, modificados por las Leyes 2155/2021 y 2277/2022 y por la Sentencia C-540/2023 |
| P2 | Anticipos bimestrales del SIMPLE y su excepción por 3.500 UVT | `src/components/workspace/areas/data/escudo-capabilities.ts:47` | Se anuncia la capacidad 'RST · Simulador comparativo — Anticipo bimestral + comparación RST vs ordinario'. No existe en el repo ninguna implementación de antici | Art. 910 E.T.: los contribuyentes del SIMPLE presentan declaración anual consolidada (Formulario 260) y deben pagar anticipos bimestrales mediante recibo electrónico SIMPLE (Formulario 2593), calculad | Art. 910 E.T. y Art. 908 par. 4 E.T.; Art. 909 E.T. (inscripción hasta el último día hábil de febrero); decreto anual de plazos DIAN para 2026 |

**No verificables contra fuente en esta pasada.**

- Tarifas exactas del grupo de servicios profesionales / profesiones liberales tras la reviviscencia de C-540/2023 (5,9% / 7,3% / 12,0% / 14,5%): confirmadas por Actualícese en dos páginas distintas y coherentes con la nota del propio repo en tax-planning/prompts/tax-optimizer.prompt.ts:59, pero NO pude leer el texto primario — estatuto.co devolvió HTTP 403 y secretariasenado.gov.co ECONNREFUSED. Una fuente secundaria (siemprealdia.co) publicó una tabla distinta (7,3/8,3/8,3/8,3) que no concuerda con ninguna versión del Art. 908; requiere confirmación contra el texto oficial antes de codificar.
- Ubicación normativa exacta, tras C-540/2023, de las actividades de EDUCACIÓN y ATENCIÓN DE LA SALUD HUMANA Y ASISTENCIA SOCIAL: al caer el numeral 4 de la Ley 2277/2022, no logré confirmar si migran al numeral residual de comercio/industria (1,6/2,0/3,5/4,5) o al de servicios profesionales. Impacta directamente a clientes de esos sectores.
- UVT aplicable para medir el tope de 100.000 UVT del Art. 905: el repo (tax-optimizer.prompt.ts:60) usa UVT 2026 → $5.237.400.000, pero la norma habla de ingresos del AÑO ANTERIOR, lo que sugiere UVT 2025 ($49.799 → $4.979.900.000). No encontré doctrina DIAN concluyente en esta pasada; diferencia de ~$257 millones en la frontera de elegibilidad.
- src/lib/tax/taxCalculator.ts:19 — TOPE_ORD_UVT = 1400 ('tope renta ordinaria'). Corresponde al umbral de obligación de declarar renta de personas naturales (Art. 592 E.T. / decreto de plazos), no a un 'tope de régimen'. Fuera del dominio RST; no verificado en esta auditoría.
- src/lib/tax/taxCalculator.ts:20 — RENTA_EXENTA_UVT = 1090 y el 19% plano de computeOrdinario(): el Art. 241 E.T. es una tabla marginal progresiva (0/19/28/33/35/37/39%), no una tarifa plana. Fuera del dominio RST pero contamina la comparación RST vs Ordinario.
- src/lib/tax/taxCalculator.ts:52-54 — parámetros por defecto de computeOrdinario: margin 0,35; icaRate 0,011 (11‰); ivaNetRate 0,01566. Son supuestos de negocio sin respaldo normativo posible (el ICA es municipal y el IVA neto depende de la estructura de costos); no son verificables contra ninguna fuente y sin embargo determinan la recomendación de régimen.
- Fechas exactas del calendario DIAN 2026 para el Formulario 2593 (anticipos bimestrales) y el Formulario 260 (declaración anual del SIMPLE) por último dígito del NIT: no pude leer el decreto de plazos 2026 en fuente primaria. El repo no las codifica, así que hoy no es discrepancia, pero sí un vacío si se implementa el calendario.
- Decreto 0572/2025, marcado como litigioso por la auditoría de 2026-07: no logré determinar en esta pasada si tiene algún efecto sobre el Régimen Simple.

<details><summary>Fuentes consultadas (11)</summary>

- Art. 905 E.T. — sujetos pasivos del SIMPLE, ingresos brutos año anterior < 100.000 UVT (vía Actualícese, https://actualicese.com/regimen-simple/ y capítulo 1 de la ruta 'Régimen simple: tarifas, declaraciones, novedades')
- Art. 908 E.T. — tarifas consolidadas por grupo de actividad (https://actualicese.com/rutas/books/regimen-simple-tarifas-declaraciones-novedades-y-mucho-mas/page/capitulo-2-tarifas-del-regimen-simple)
- Corte Constitucional, Sentencia C-540 de 2023 — inexequibles numerales 4º y 5º del Art. 908 E.T. y numerales 4º y 5º de su parágrafo 4º (modificación del art. 44 Ley 2277/2022); reviviscencia del numeral 3º del art. 42 de la Ley 2155/2021 (https://normograma.dian.gov.co/dian/compilacion/docs/c-540_2023.htm)
- DIAN, Oficio/Concepto 2766 de 2026 — aplicación de tarifas revividas tras C-540/2023 (https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_2766_2026.htm)
- DIAN, Micrositio Régimen Simple de Tributación — preguntas frecuentes (https://micrositios.dian.gov.co/regimen-simple-tributacion/preguntas-frecuentes/)
- Art. 907 E.T. y Art. 915 E.T. — impuestos que integran el SIMPLE; el IVA NO lo integra, declaración anual consolidada de IVA (https://www.gerencie.com/regimen-simple-y-su-relacion-con-el-iva.html; https://estatuto.co/915)
- Art. 903 par. 4 y Art. 912 E.T. — descuento por aportes del empleador al SGP y descuento 0,5% por pagos electrónicos; 'la parte que corresponda al impuesto de industria y comercio consolidado no podrá ser cubierta con dicho descuento' (DIAN Concepto 988(906531) de 2021, https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_906531_2021.htm)
- Art. 906 E.T. — sujetos que no pueden optar por el SIMPLE (DIAN micrositio RST; Gerencie.com)
- Art. 909/910 E.T. — inscripción hasta el último día hábil de febrero (27-feb-2026), anticipos bimestrales Formulario 2593, declaración anual Formulario 260 (https://siemprealdia.co/colombia/impuestos/regimen-simple-de-tributacion/)
- Resolución DIAN 000238 del 15-dic-2025 — UVT 2026 = $52.374 (https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/; https://actualicese.com/uvt-2026/)
- Holland & Knight — 'Corte Constitucional declaró inexequibles límites al Régimen Simple de Tributación' (https://www.hklaw.com/en/insights/publications/2023/12/corte-constitucional-declaro-inexequibles-limites-al-regimen)

</details>

### Nómina, seguridad social, parafiscales, ICA y bancarización (Colombia, año gravable 2026)

El núcleo de nómina de producción (src/lib/payroll/prestaciones.ts) está bien: SMMLV 2026 $1.750.905, ARL clases I–V, exoneración Art. 114-1 con umbral "< 10 SMMLV", caja 4% no exonerada, pensión 12%, salud 8,5%, prima/cesantías 1/12, intereses 12% anual y vacaciones 15/360 son todos correctos. También son correctos UVT 2026 = $52.374 (Res. DIAN 000238 del 15-dic-2025), el 50% deducible del GMF (Art. 115 E.T.) y los topes numéricos del Art. 771-5 (100 UVT individual y 40%/40.000 UVT/35% general). El problema grave está fuera de ese núcleo: (1) la regla sembrada de retención de ICA Bogotá tiene tarifa 0,0011 cuando el propio comentario dice 11/1000 = 0,011 — un error de 10x que genera retención incorrecta; (2) el módulo src/modules/pyme (normativa2026.ts + calc.ts) usa UVT 2025, ARL mínima 0,348% en vez de 0,522%, recargo dominical 75% cuando desde el 1-jul-2026 es 90% (Ley 2466/2025), intereses a las cesantías 12 veces subprovisionados y prima proporcional de liquidación al 50% de lo legal; (3) el prompt Anti-DIAN afirma que el tope de 100 UVT del Art. 771-5 §2 es acumulado anual por NIT, interpretación que el Consejo de Estado anuló (Sent. 26676/2023) y la DIAN corrigió (Concepto 010383/2026), y omite el parágrafo 5 (agro/SIMPLE, 70%) — justo el perfil de cliente de UtopIA. El catálogo normativo del Escudo no tiene ninguna entrada de nómina, seguridad social, parafiscales ni ICA: solo Art. 108, Art. 115 y Art. 771-5 tocan el dominio de refilón.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Tarifa de la regla sembrada de retención de ICA Bogotá (ICA_BOG_11) en el motor tributario | `src/lib/db/seeds/tax-rules-co-2026.ts:125` | rate: '0.001100'  // comentario en la misma línea 121 y en la línea 15: "ICA Bogotá: 11/1000 = 0.0011" | 11 por mil = 0,011. En Bogotá la tarifa de "otras actividades comerciales" del Acuerdo 65/2002 es 11,04 x 1.000 = 0,01104, y la tarifa de retención de ICA es la tarifa del ICA de la actividad del rete | Acuerdo 65 de 2002 del Concejo de Bogotá D.C., art. 3 (tarifas por mil), modificado por Acuerdo 816 de 2021; Ley 14 de 1983; Decreto Distrital 271 de 2002 (retención de ICA) |
| P0 | Recargo dominical y festivo diurno usado para liquidar la nómina mensual | `src/modules/pyme/data/normativa2026.ts:35` | dominicalDiurno: 0.75,  // $16.835/h  (consumido por calc.ts:128 dominicalDiurnoDia() y por LiquidarMes.tsx:56) | 90% desde el 1 de julio de 2026 (era 80% entre el 1-jul-2025 y el 30-jun-2026; será 100% desde el 1-jul-2027). El 75% del Art. 179 CST dejó de regir el 1-jul-2025. | Ley 2466 de 2025 (Reforma Laboral), art. que modifica el Art. 179 CST — gradualidad 80% (1-jul-2025), 90% (1-jul-2026), 100% (1-jul-2027) |
| P0 | Provisión mensual de intereses a las cesantías | `src/modules/pyme/data/calc.ts:185` | const intereses = Math.round((base / 12) * 0.01);  // con base = salario + auxilio. Constante espejo en normativa2026.ts:42 → interesesCesMensual: 1_667, y tota | Los intereses son el 12% anual sobre el saldo de cesantías. Provisión mensual correcta = (base/12) × 0,12 = base × 0,01. Al SMMLV+auxilio ($2.000.000) son $20.000/mes ($240.000/año), no $1.667/mes ($2 | Ley 52 de 1975, arts. 1 y 2 (intereses del 12% anual sobre saldo de cesantías al 31-dic); Ley 50 de 1990 art. 99 |
| P0 | Prima de servicios proporcional en la liquidación definitiva del contrato | `src/modules/pyme/data/calc.ts:262` | const primaProporcional = ((base * diasTotales) / 360) * 0.5; | La prima de servicios equivale a 30 días de salario por año (15 días por semestre, en dos pagos). La proporcional es (salario + auxilio de transporte) × díasTrabajados / 360, sin multiplicar por 0,5. | Art. 306 CST, modificado por la Ley 1788 de 2016 — treinta (30) días de salario por año, reconocidos en dos pagos |
| P0 | Interpretación del tope de 100 UVT del Art. 771-5 §2 E.T. en el prompt del auditor Anti-DIAN | `src/lib/agents/financial/escudo-survival/prompts/anti-dian-auditor.prompt.ts:29` | "Tope individual Art. 771-5 §2 E.T.: pagos a un mismo NIT en efectivo no pueden exceder 100 UVT = $5.237.400 al ano" (reiterado en línea 55: "listar cada pago a | El límite de 100 UVT se determina sobre CADA transacción individualmente considerada, no sobre el acumulado anual por beneficiario. El Consejo de Estado anuló parcialmente los Oficios DIAN 0935 y 1275 | Art. 771-5 parágrafo 2 E.T.; Consejo de Estado, Sección Cuarta, Sent. 11001-03-27-000-2022-00041-00 (26676) — nulidad parcial de los Oficios DIAN 0935 y 1275 de 2018; DIAN Concepto 010383 de 2026 |
| P0 | Régimen especial de bancarización para sector agropecuario, comerciantes del régimen SIMPLE y cooperativas de productores agrícolas | `src/lib/agents/financial/escudo-survival/prompts/anti-dian-auditor.prompt.ts:30` | El prompt solo modela §1 (40% / 40.000 UVT / 35% de costos) y §2 (100 UVT). No menciona el parágrafo 5 en ninguna línea; el catálogo (estatuto-tributario.ts:853 | El parágrafo 5 del Art. 771-5 permite a los contribuyentes del sector agropecuario, a los comerciantes del régimen SIMPLE y a las cooperativas y asociaciones de productores agrícolas reconocer fiscalm | Art. 771-5 parágrafo 5 E.T.; DIAN Concepto 010383 de 2026 (exigir el límite de 100 UVT a los beneficiarios del §5 "dejaría sin efecto práctico el tratamiento especial") |
| P1 | Valor de la UVT usado por el módulo de nómina/contabilidad Pyme | `src/modules/pyme/data/normativa2026.ts:17` | UVT: 49_799,  // OJO: pendiente confirmar Resolución DIAN 2026 | UVT 2026 = $52.374. $49.799 es la UVT del año gravable 2025. | Resolución DIAN 000238 del 15 de diciembre de 2025 (UVT 2026 = $52.374); Resolución DIAN 000193 del 4 de diciembre de 2024 (UVT 2025 = $49.799); Art. 868 E.T. |
| P1 | Tarifa ARL clase de riesgo I aplicada por defecto en la PILA del empleador | `src/modules/pyme/data/normativa2026.ts:22` | arlClaseI:{ empleador: 0.00348, empleado: 0 },  // Decreto 1607/2002 | La cotización inicial (la que aplica a todo empleador nuevo o sin reclasificación) de la clase I es 0,522%. El 0,348% es el valor MÍNIMO de la tabla, alcanzable solo tras reclasificación favorable por | Decreto 1772 de 1994, arts. 12 y 13 (tabla de cotización: clase I mínimo 0,348% / inicial 0,522% / máximo 0,696%), compilado en el Decreto 1072 de 2015 |
| P1 | Factor de recargo para la hora dominical nocturna / hora extra nocturna dominical | `src/modules/pyme/data/normativa2026.ts:36` | heDominicalNocturna: 1.10,  // $20.202/h — consumida en calc.ts:112 como `extraDominicalNocturna` y mostrada en Cifras2026.tsx:177 | 1,10 = 0,75 (dominical) + 0,35 (nocturno) es el recargo de la hora ORDINARIA nocturna en dominical bajo el 75% derogado. Con el dominical al 90% vigente desde el 1-jul-2026, el recargo dominical noctu | Arts. 168, 179 y 192 CST; Ley 2466 de 2025 (dominical 90% desde el 1-jul-2026) |
| P1 | Aplicación de la exoneración del Art. 114-1 E.T. al aporte de salud del empleador (8,5%) | `src/modules/pyme/data/calc.ts:75` | const salud = base * p.salud.empleador;  // 8,5% siempre, sin verificar exoneración. `exentoParafiscal` (línea 79) solo apaga SENA e ICBF. Constante espejo: nor | El Art. 114-1 exonera de forma conjunta el aporte a SALUD del empleador (8,5%), SENA (2%) e ICBF (3%) por los trabajadores que devenguen individualmente menos de 10 SMMLV. No se puede exonerar SENA/IC | Art. 114-1 E.T. (adicionado por la Ley 1819 de 2016, con antecedente en la Ley 1607 de 2012 y ajustes de la Ley 2010 de 2019); Ley 21 de 1982 (CCF, NO exonerada) |
| P1 | Tarifa de ICA usada por el comparador Régimen Simple vs. Ordinario | `src/lib/tax/taxCalculator.ts:121` | const icaRate = opts.icaRate ?? 0.011;  // declarada en línea 51 como "Tarifa ICA municipal (default 11‰ comercio)" | El ICA es un tributo territorial cuya tarifa la fija cada concejo municipal dentro de los rangos de la Ley 14/1983 (2 a 7 x mil industrial; 2 a 10 x mil comercial y de servicios, con excepciones distr | Ley 14 de 1983, arts. 32-33 (rangos tarifarios y competencia municipal); Decreto 1333 de 1986; Art. 907 E.T. (el SIMPLE integra el ICA consolidado); Acuerdo 65 de 2002 de Bogotá |
| P2 | Decreto citado como fuente del SMMLV 2026 | `src/modules/pyme/data/normativa2026.ts:9` | SMMLV: 1_750_905,   // Decreto 2673/2025 | El valor $1.750.905 es correcto, pero fue fijado por el Decreto 1469 del 29 de diciembre de 2025 (y el auxilio de transporte de $249.095 por el Decreto 1470 de 2025). El Decreto 1469/2025 fue suspendi | Decreto 1469 de 2025 (SMMLV 2026); Decreto 1470 de 2025 (auxilio de transporte 2026); Decreto 0159 de 2026 (transitorio, tras auto de suspensión del Consejo de Estado, Sección Segunda, 12-feb-2026) |
| P2 | Resolución DIAN citada como fuente de los valores de UVT 2025 y 2026 persistidos en base de datos | `src/lib/db/seeds/tax-rules-co-2026.ts:139` | { year: 2025, ... decreeRef: 'Resolución DIAN 000187/2024-12-19' }, { year: 2026, valueCop: '52374.00', decreeRef: 'Resolución DIAN 000187/2025-12-19' } | UVT 2026 = $52.374 → Resolución DIAN 000238 del 15 de diciembre de 2025. UVT 2025 = $49.799 → Resolución DIAN 000193 del 4 de diciembre de 2024. El número 000187 no corresponde a ninguna de las dos. | Resolución DIAN 000238 de 15-dic-2025; Resolución DIAN 000193 de 04-dic-2024; Art. 868 E.T. |
| P2 | Divisor mensual para calcular el valor de la hora ordinaria | `src/modules/pyme/data/normativa2026.ts:13` | HORAS_MES: 182,  // 42 × 52 / 12   →  HORA_ORDINARIA: 9_620  (línea 14, SMMLV / 182) | El divisor para liquidar el valor de la hora es 210 desde el 15 de julio de 2026 (jornada máxima de 42 h: 7 h/día × 30 días) y era 220 entre el 1-ene-2026 y el 14-jul-2026 (jornada de 44 h). Al SMMLV | Ley 2101 de 2021 (reducción gradual de la jornada, 42 h desde el 15-jul-2026); Ministerio del Trabajo, Concepto 08SI2023120300000016177 y Circular Externa 101 de 2025 |
| P2 | Mapeo de cuentas PUC del pasivo para las provisiones de prima y cesantías en el seed contable | `src/lib/db/seeds/provisions-config-co-2026.ts:57` | prima → liabilityCode '261005' ('Prima de Servicios por pagar'); cesantias → liabilityCode '261020' ('Cesantías consolidadas por pagar'); intereses_cesantias → | En el PUC del Decreto 2650/1993 el grupo 2610 (Obligaciones laborales) asigna 261005 a Cesantías consolidadas, 261010 a Intereses sobre cesantías, 261015 a Vacaciones consolidadas y 261020 a Prima de | Decreto 2650 de 1993 (PUC para comerciantes), grupo 2610 Obligaciones laborales |
| P2 | Tope máximo del ingreso base de cotización a seguridad social | `src/lib/payroll/prestaciones.ts:81` | const pensionCop = salario * 0.12; ... arlCop = salario * ARL_RATES[...]  — sin tope superior. Igual en src/modules/pyme/data/calc.ts:46 → ibc() aplica piso de | El IBC no puede exceder 25 SMMLV = $43.772.625 en 2026 (25 × $1.750.905), tope aplicable a salud, pensión y riesgos laborales, y al IBC consolidado de todos los empleadores. El Decreto 2322 de 2022 pr | Ley 100 de 1993, arts. 18 (mod. Ley 797/2003 art. 5) y 204; Decreto 1072 de 2015; Decreto 2322 de 2022 (aumento condicionado a 45 SMLMV, aún no operante) |

**No verificables contra fuente en esta pasada.**

- src/lib/db/seeds/tax-rules-co-2026.ts:121 — `applicableTriggers: { cityCode: '11001' }` para ICA_BOG_11: la regla aplica retención de ICA a toda compra cuyo tercero esté en Bogotá. No pude confirmar contra el Decreto Distrital 271/2002 quiénes son agentes de retención de ICA en Bogotá ni si la retención procede sin calidad de agente retenedor; la regla podría estar practicando retenciones que no corresponden con independencia del error de tarifa.
- src/lib/db/seeds/tax-rules-co-2026.ts:125 — la tarifa correcta de reteICA Bogotá depende de la actividad CIIU del retenido (4,14 / 6,9 / 9,66 / 11,04 / 13,8 / 14 x mil). No pude verificar el listado completo y actualizado a 2026 de tarifas por actividad en la fuente oficial de la SDH; el hallazgo reportado se limita al error aritmético de 10x, que sí es concluyente.
- src/modules/pyme/data/calc.ts:147 `incapacidadComun()` — aplica 66,67% de forma indefinida y solo distingue días 1-2 (empleador) vs 3+ (EPS). No pude verificar contra fuente oficial si en 2026 sigue vigente la reducción al 50% a partir del día 91 (Art. 227 CST / Decreto 780/2016) ni el piso de 1 SMMLV para la prestación económica. Marcado como riesgo latente, no como discrepancia probada.
- src/modules/pyme/data/calc.ts:265-274 `liquidacion()` — la indemnización del Art. 64 CST se calcula siempre con la tabla de 30 días + 20 días por año adicional, sin distinguir el régimen aplicable a trabajadores que devengan 10 SMMLV o más (20 días + 15 por año adicional) ni el contrato a término fijo (salarios del tiempo faltante). No pude confirmar si la Ley 2466 de 2025 modificó esas tablas.
- src/lib/agents/financial/escudo-survival/prompts/anti-dian-auditor.prompt.ts:57 — la fórmula usa `pagosEfectivoTotal` como base del 40% del Art. 771-5 §1. No pude confirmar contra doctrina DIAN vigente si "el 40% de lo pagado" se calcula sobre el total de pagos del contribuyente por todos los medios o solo sobre los pagos en efectivo; la lectura del repo hace que el 40% nunca se supere por construcción (exceso = 60% del efectivo siempre), lo que sugiere un error de base pero no lo pude probar contra fuente.
- src/lib/agents/financial/escudo-survival/prompts/anti-dian-auditor.prompt.ts:30 — la etiqueta "(4° ano+)" describe una gradualidad de transición que terminó; los porcentajes 40% / 40.000 UVT / 35% sí son los permanentes desde el año gravable 2021 (Ley 2010/2019 art. 136). No verifiqué si el redactado induce al modelo a aplicar gradualidades anteriores.
- El catálogo normativo del Escudo (src/lib/agents/financial/escudo-survival/normative/catalog/) no contiene NINGUNA entrada de nómina, seguridad social, parafiscales, ICA ni GMF: solo Art. 108 (deducción de salarios condicionada al pago de aportes), Art. 115 (ICA/GMF deducibles) y Art. 771-5 tocan el dominio. No hay Art. 114-1, ni Ley 100/1993, ni Ley 21/1982, ni CST, ni Ley 14/1983, ni Ley 2466/2025. No es una discrepancia de valor, pero significa que los dictámenes no tienen fuente normativa propia para este dominio.
- Art. 114-1 E.T. — el repo (src/lib/payroll/prestaciones.ts:79 y src/modules/pyme/data/calc.ts:79) decide la exoneración únicamente por el salario individual (< 10 SMMLV). No modela las condiciones subjetivas: ser contribuyente declarante del impuesto sobre la renta, tener 2 o más empleados si es persona natural, y la exclusión de entidades del Régimen Tributario Especial, cajas de compensación, propiedades horizontales comerciales y entidades públicas. Verifiqué la norma pero no pude determinar si el repo captura ese perfil del cliente en otra capa antes de invocar el cálculo.

<details><summary>Fuentes consultadas (23)</summary>

- Decreto 1469 de 2025 (Mintrabajo) — SMMLV 2026 $1.750.905: https://www.suin-juriscol.gov.co/viewDocument.asp?id=30055940
- Decreto 0159 de 2026 (transitorio, tras suspensión del 1469/2025 por el Consejo de Estado): https://dapre.presidencia.gov.co/normativa/normativa/DECRETO%20No.%200159%20DEL%2019%20DE%20FEBRERO%20DE%202026.pdf
- Holland & Knight — Colombia decreta aumento del salario mínimo y auxilio de transporte para 2026 (Decretos 1469 y 1470 de 2025; aux. transporte $249.095): https://www.hklaw.com/en/insights/publications/2025/12/colombia-decreta-aumento-del-salario-minimo-y-auxilio-de-transporte
- Holland & Knight — Suspensión provisional del decreto que fijó el salario mínimo 2026: https://www.hklaw.com/en/insights/publications/2026/02/suspension-provisional-del-decreto-que-fijo-el-salario-minimo
- Resolución DIAN 000238 del 15-dic-2025 — UVT 2026 = $52.374: https://crconsultorescolombia.com/fijacion-del-valor-de-la-unidad-de-valor-tributario-uvt-dian-resolucion-000238.php
- INCP — DIAN fijó en $52.374 el valor de la UVT para el año gravable 2026: https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/
- Resolución DIAN 000193 del 04-dic-2024 — UVT 2025 = $49.799: https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000193%20de%2004-12-2024.pdf
- Decreto 1772 de 1994 (Gestor Normativo, Función Pública) — tarifas ARL art. 13 y límites art. 12: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=8803
- Decreto 1772 de 1994 (texto ARL Sura) — tabla de cotización clase I..V: https://www.arlsura.com/index.php/decretos/130-decreto-1772-agosto-3-de-1994
- Ley 2466 de 2025 (Reforma Laboral) — Gestor Normativo, Función Pública: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676
- ANDI/CESLA — ABC de la reforma laboral Ley 2466 de 2025 (gradualidad dominical 80/90/100%, jornada nocturna desde 7 p.m. el 25-dic-2025): https://www.andi.com.co/Uploads/ANDI-CESLA.%20El%20ABC%20de%20la%20reforma%20laboral.%20Ley%202466%20de%202025.pdf
- Actualícese — Horas extra y recargos 2026 (divisor 220 hasta 14-jul-2026 y 210 desde 15-jul-2026; dominical 90% desde 1-jul-2026; dominical nocturno 125%): https://actualicese.com/horas-extra-y-recargos-2026-en-colombia/
- Consejo de Estado, Sent. 11001-03-27-000-2022-00041-00 (26676) — anula interpretación DIAN: el límite de 100 UVT del Art. 771-5 §2 es por transacción individual: https://www.consejodeestado.gov.co/documentos/boletines/269/11001-03-27-000-2022-00041-00(26676).pdf
- INCP — DIAN, Concepto 010383 de 2026: nuevas precisiones sobre el límite de 100 UVT y el parágrafo 5 (agro / régimen SIMPLE / cooperativas, 70%): https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/07/dian-nuevas-precisiones-sobre-la-aplicacion-del-limite-de-100-uvt-para-pagos-en-efectivo/
- Secretaría Distrital de Hacienda de Bogotá — conceptos y tarifas ICA (Acuerdo 65/2002): https://www.haciendabogota.gov.co/es/sdh/conceptos-y-tarifas-asociadas-la-liquidacion-del-impuesto-de-industria-y-comercio-ica
- Acuerdo 65 de 2002 del Concejo de Bogotá D.C. (tarifas por mil ICA): https://bogota.eregulations.org/media/Acuerdo%20065%20de%202002.pdf
- Acuerdo 816 de 2021 — modifica literal d) art. 3 Acuerdo 65/2002 (financiero 14 x mil)
- Decreto 2322 de 2022 — aumento condicionado del tope de cotización de 25 a 45 SMLMV (condiciones no cumplidas; rige 25 SMLMV en 2026): https://cms.law/es/col/publication/aumento-en-el-tope-maximo-para-efectos-de-cotizacion-al-sistema-de-seguridad-social-integral-pasara-de-25-smlmv-a-45-smlmv
- UGPP — ABC trabajadores dependientes con salario integral / calculadora IBC (tope 25 SMLMV): https://www.ugpp.gov.co/calculadora-ibc
- Art. 114-1 E.T. — exoneración de aportes (requisitos: contribuyente declarante de renta; PN con 2+ empleados; ESAL del RTE y cajas de compensación excluidas): https://estatuto.co/114-1
- Gerencie.com — Exoneración de aportes a seguridad social y parafiscales (Art. 114-1): https://www.gerencie.com/exoneracion-de-aportes-a-seguridad-social-y-parafiscales.html
- Ley 50 de 1990 art. 99 + Ley 52 de 1975 — plazos: intereses a las cesantías 31 de enero, consignación de cesantías 14 de febrero, sanción de 1 día de salario por día de mora: https://www.gerencie.com/plazo-maximo-para-pagar-los-intereses-sobre-las-cesantias.html
- Buk — Salario mínimo 2026 y auxilio de transporte: https://www.buk.co/blog/salario-minimo-2026-en-colombia

</details>

### IVA e Impuesto Nacional al Consumo (INC) — Colombia, año gravable 2026

Lo que está bien: la tarifa general de IVA 19% (Art. 468), la tarifa de ReteIVA general 15% (Art. 437-1), el umbral de 92.000 UVT del Art. 600, la distinción excluidos (Art. 424/476) vs exentos (Art. 477) y el valor de la UVT 2026 ($52.374) están correctamente codificados; el repo tampoco arrastra "días sin IVA" (derogados por el Art. 96 de la Ley 2277/2022), lo cual es correcto. Lo que está mal es estructural y grave: el seed `tax-rules-co-2026.ts` da a la regla de IVA 5% exactamente los mismos triggers que a la de 19% y a la de 0%, de modo que toda compra dispara las tres reglas y el motor acumula 19%+5% = 24% de IVA descontable sobre la misma base, algo que ninguna norma permite (las tarifas de los Arts. 468, 468-1, 468-3 y 477 son excluyentes entre sí). El Impuesto Nacional al Consumo simplemente NO existe en el catálogo normativo: cero referencias a los Arts. 512-1 a 512-13, y tampoco está el INC del 16% sobre juegos de suerte y azar operados exclusivamente por internet creado por el Decreto Legislativo 0240 del 12-mar-2026 (emergencia avalada condicionalmente por la Corte el 26-jun-2026), pese a que `schema-tax.ts` declara el tipo 'INC'. El catálogo además describe mal el Art. 437-4 (es retención 100% sobre chatarra vendida a siderúrgicas, no compras a no responsables), omite la exclusión de IVA para loterías y juegos por internet del Art. 420 lit. e), atribuye la proporcionalidad al Art. 485 cuando es el Art. 490, y omite que los responsables de los Arts. 477 y 481 declaran bimestralmente sin importar sus ingresos. Por último, el prompt del revisor fiscal instruye que "SIMPLE exime IVA", lo cual contradice frontalmente el Art. 915 E.T. y puede llevar a omitir la declaración anual consolidada de IVA.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Triggers de la regla de IVA diferencial 5% idénticos a los de IVA general 19% en el seed de reglas tributarias | `src/lib/db/seeds/tax-rules-co-2026.ts:65` | IVA_5_PURCHASE → applicableTriggers: { transactionTypes: ['purchase', 'service_purchase'] } — exactamente los mismos triggers que IVA_19_PURCHASE (líneas 39-41) | Las tarifas de IVA son mutuamente excluyentes por bien o servicio: 19% general (Art. 468), 5% únicamente para los bienes taxativamente listados en el Art. 468-1 y los servicios taxativos del Art. 468- | Arts. 468, 468-1, 468-3, 477 y 424 E.T. |
| P0 | El prompt del Revisor Fiscal instruye que el Régimen SIMPLE exime de IVA | `src/lib/agents/financial/audit/prompts/fiscal-reviewer.prompt.ts:76` | "status por entrada: ... 'no_aplica' (regimen no obliga, ej. SIMPLE exime IVA)" | El Art. 915 E.T. dispone lo contrario: los contribuyentes del SIMPLE SIGUEN siendo responsables de IVA y del impuesto nacional al consumo; los responsables de IVA presentan una declaración ANUAL CONSO | Arts. 915 y 907 E.T.; Art. 437 parágrafo 4 E.T. |
| P1 | La regla de IVA 5% se aplica a compras de servicios citando el Art. 468-1, que solo regula bienes | `src/lib/db/seeds/tax-rules-co-2026.ts:59` | description: 'IVA descontable tarifa diferencial 5% (Art. 468-1 ET)' con transactionTypes que incluyen 'service_purchase' | El Art. 468-1 E.T. lista exclusivamente BIENES gravados al 5%. Los SERVICIOS gravados al 5% están en el Art. 468-3 E.T. (planes de medicina prepagada y complementarios, pólizas de seguros de cirugía y | Arts. 468-1 y 468-3 E.T. |
| P1 | Una sola regla IVA_0_EXEMPT trata igual exentos y excluidos, y no capitaliza el IVA no descontable | `src/lib/db/seeds/tax-rules-co-2026.ts:72` | code: 'IVA_0_EXEMPT', description: 'Operación excluida/exenta de IVA — no genera contabilización (Art. 476 ET)', rate '0.000000', taxAccountCode null, triggers | Son tres tratamientos distintos: EXENTO (Art. 477, tarifa 0%, el responsable SÍ tiene derecho a impuestos descontables y a devolución bimestral de saldos a favor); EXCLUIDO (Arts. 424 bienes y 476 ser | Arts. 424, 476, 477, 488 y 490 E.T. |
| P1 | El catálogo normativo no contiene el Impuesto Nacional al Consumo (Arts. 512-1 a 512-13 E.T.) pese a que el motor lo declara como tipo de impuesto | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:604` | La sección '─── IVA ───' del catálogo va del Art. 420 al Art. 600. Cero ocurrencias de '512' en todo src/lib/agents/financial/escudo-survival/normative/catalog/ | Tarifas INC vigentes 2026: 4% servicios de telefonía, datos, internet y navegación móvil (Art. 512-2); 8% servicio de restaurantes y bares (Arts. 512-1 num. 3 y 512-9); 8% vehículos familiares y campe | Arts. 512-1, 512-2, 512-3, 512-4, 512-9 y 512-13 E.T. |
| P1 | No está el INC del 16% sobre juegos de suerte y azar operados exclusivamente por internet, vigente en 2026 | `src/lib/agents/financial/escudo-survival/normative/catalog/leyes-reformas.ts:38` | El catálogo de leyes y reformas llega hasta la Ley 2277/2022. No hay ninguna entrada para los decretos legislativos de emergencia de 2025-2026 (1390/2025, 1474/ | El Decreto Legislativo 0240 del 12-mar-2026 creó, para la vigencia fiscal 2026, un Impuesto Nacional al Consumo del 16% sobre los juegos de suerte y azar operados exclusivamente por internet. Hecho ge | Decreto Legislativo 0240 de 2026 (12-mar-2026), expedido bajo el estado de emergencia del Decreto Legislativo 150 de 2026; Art. 420 lit. e) E.T. |
| P1 | Descripción del Art. 437-4 E.T. (ReteIVA 100%) en el catálogo normativo | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:595` | "ReteIVA del 100% del impuesto generado en casos especiales: bienes o servicios adquiridos a no responsables del IVA que por cuantía deben retener, entre otros. | Art. 437-4 E.T.: el IVA generado en la venta de CHATARRA identificada con las nomenclaturas arancelarias andinas 72.04, 74.04 y 76.02 se genera cuando esta sea vendida a las SIDERÚRGICAS, y será reten | Arts. 437-4 y 437-5 E.T. |
| P1 | Hecho generador del IVA (Art. 420 E.T.) sin la exclusión de loterías y juegos operados exclusivamente por internet | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:610` | "El IVA se genera en la venta de bienes muebles corporales no excluidos, prestación de servicios en territorio nacional, importación de bienes, y circulación, v | Art. 420 lit. e) E.T.: "La circulación, venta u operación de juegos de suerte y azar, con excepción de las loterías y de los juegos de suerte y azar operados exclusivamente por internet". Además el li | Art. 420 literales a), b), c), d) y e) E.T. (modificado por Ley 1819/2016) |
| P1 | Periodicidad del IVA: la regla codificada omite a los responsables de los Arts. 477 y 481, que declaran siempre bimestralmente | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:704` | "Periodos gravables IVA 2026: bimestral para contribuyentes con ingresos ≥ 92.000 UVT al 31-dic del año anterior; cuatrimestral para los demás." | Art. 600 num. 1 E.T.: declaran y pagan BIMESTRALMENTE los grandes contribuyentes, las personas jurídicas y naturales con ingresos brutos a 31-dic del año gravable anterior iguales o superiores a 92.00 | Art. 600 numerales 1 y 2 E.T. (modificado por Ley 1819/2016) |
| P1 | El calendario DIAN heurístico solo genera 5 de los 6 vencimientos del IVA bimestral y no contempla la periodicidad cuatrimestral | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:113` | const MESES_IVA_BIMESTRAL = [3, 5, 7, 9, 11] as const; — usado en la rama fallback (línea 223) para todos los NIT cuyo último dígito no sea 6. El override verif | El Art. 600 num. 1 E.T. define SEIS períodos bimestrales: enero-febrero, marzo-abril, mayo-junio, julio-agosto, septiembre-octubre y noviembre-diciembre. El vencimiento del sexto (nov-dic) cae en ener | Art. 600 numerales 1 y 2 E.T. |
| P2 | La proporcionalidad del IVA descontable se atribuye al Art. 485 en lugar del Art. 490 | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:691` | ART_485_ET: "El IVA pagado en la adquisición de bienes y servicios necesarios para la actividad gravada puede descontarse del IVA generado. Sujeto a proporciona | Art. 485 E.T. define cuáles son los impuestos descontables y su límite tarifario. Art. 488 E.T.: solo otorga derecho a descuento el IVA que se destine a operaciones gravadas. Art. 490 E.T.: cuando los | Arts. 485, 488, 489, 490 y 496 E.T.; Concepto DIAN 1241 de 2024 |
| P2 | El catálogo de ReteIVA omite la retención del 100% sobre servicios prestados desde el exterior | `src/lib/agents/financial/escudo-survival/normative/catalog/tarifas-retencion.ts:126` | RTF_RETEIVA_ESPECIAL_100: 'ReteIVA — retención 100% casos especiales (Arts. 437-4 y 437-5)', normaRef: 'Art. 437-4 E.T. / Art. 437-5 E.T.' | El parágrafo 1 del Art. 437-1 E.T. establece que en el caso de los servicios gravados a que se refieren los numerales 3 y 8 del Art. 437-2 E.T. la retención será equivalente al 100% del valor del impu | Art. 437-1 parágrafo 1 E.T. y Art. 437-2 numerales 3 y 8 E.T. |
| P2 | El seed de reglas built-in no incluye ninguna regla de ReteIVA pese a que el motor la soporta | `src/lib/db/seeds/tax-rules-co-2026.ts:29` | BUILT_IN_RULES contiene 6 reglas: IVA_19_PURCHASE, IVA_19_SALE, IVA_5_PURCHASE, IVA_0_EXEMPT, RTF_SVC_4, RTF_HONO_11, ICA_BOG_11. Ninguna de tipo RETEIVA, aunqu | Art. 437-1 E.T.: tarifa general de ReteIVA del 15% del valor del impuesto. Art. 437-2 E.T.: son agentes de retención de IVA, entre otros, las entidades estatales, los grandes contribuyentes designados | Arts. 437-1 y 437-2 E.T. |
| P2 | El comparador RST vs Ordinario imputa el IVA como carga exclusiva del régimen ordinario | `src/lib/tax/taxCalculator.ts:122` | const ivaNetRate = opts.ivaNetRate ?? 0.01566; ... const ivaNeto = annualSales * ivaNetRate; return { total: ica + renta + ivaNeto, ... } — computeOrdinario() s | El Art. 907 E.T. lista los impuestos que el SIMPLE integra: renta, impuesto nacional al consumo de bares y restaurantes, e ICA consolidado (con avisos y tableros y sobretasa bomberil). El IVA NO está | Arts. 905, 907, 915 y 437 parágrafo 3 E.T.; Art. 512-13 E.T. |
| P2 | Referencia de la resolución DIAN que fijó la UVT 2026 (el valor $52.374 sí es correcto) | `src/lib/agents/financial/escudo-survival/normative/prompts/motor-normativo.prompt.ts:154` | "UVT 2026: $52.374 COP (Resolución DIAN 000187 / 2025-12-19)" — misma cita errada en src/lib/db/seeds/tax-rules-co-2026.ts:139 ('Resolución DIAN 000187/2025-12- | La UVT 2026 de $52.374 fue fijada por la Resolución DIAN 000238 del 15 de diciembre de 2025. La UVT 2025 de $49.799 fue fijada por la Resolución DIAN 000193 del 4 de diciembre de 2024. | Resolución DIAN 000238 de 2025-12-15 (Art. 868 E.T.) |

**No verificables contra fuente en esta pasada.**

- src/lib/tax/taxCalculator.ts:53,122 — ivaNetRate por defecto 0.01566 (IVA bimestral neto como 1,566% de las ventas). No tiene ninguna base normativa: es un promedio sectorial arbitrario. No hay norma contra la cual verificarlo; el propio archivo lo declara ilustrativo.
- src/lib/tax/taxCalculator.ts:33-46 — tarifas RST por grupo CIIU (1,88%-3,4% tiendas; 5,9%-9,5% servicios). Dominio de Régimen Simple, no lo audité contra el Art. 908 E.T.; el archivo las declara ilustrativas.
- src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:91-93 — DIA_IVA_POR_DIGITO [9,10,13,14,15,16,17,20,21,22]. Días heurísticos de vencimiento del IVA bimestral. No pude confirmar el decreto de plazos aplicable a 2026: el archivo cita 'Decreto 2229/2023' y 'Decreto 1778', pero el Decreto 2229 de 2023 fijó los plazos de 2024, no los de 2026. El decreto de plazos vigente para 2026 no lo verifiqué.
- src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:138-152 — tabla NIT6_2026 (fechas exactas 2026-03-17, 2026-05-20, ..., 2027-01-26). Es el único dígito con override 'verificado'; no pude contrastarlo contra el PDF oficial del calendario tributario DIAN 2026.
- src/lib/accounting/tax-engine/constants.ts:83-85 y seed líneas 35,48,61 — códigos PUC 240805 (IVA generado) y 240810 (IVA descontable). Son la convención habitual del PUC comercial (Decreto 2650/1993), pero el repo declara usar el PUC PYMES del Decreto 2706/2012, cuyo catálogo no verifiqué; además el comentario de constants.ts:84 describe el IVA descontable como 'activo (mayor valor del gasto/activo)', lo que contradice tanto la naturaleza de la cuenta 2408 (pasivo) como el tratamiento del Art. 485 E.T.
- Estado constitucional del Decreto Legislativo 0240 de 2026 (INC 16% juegos por internet): la Corte Constitucional avaló condicionalmente la emergencia habilitante (Decreto 150 de 2026) el 26-jun-2026, pero no encontré una decisión de fondo publicada sobre el Decreto 0240 a 07-ago-2026. Debe codificarse como norma temporal de alta volatilidad, con el precedente del Decreto 1474/2025 declarado inexequible el 09-abr-2026 con orden de devolución.
- Bienes y servicios concretos de cada tarifa: el repo no codifica listado alguno de las partidas de los Arts. 424, 468-1, 468-3, 476 ni 477 — solo referencias genéricas. Al no haber valores codificados no hay discrepancia probada, pero tampoco hay forma de que el motor clasifique correctamente una operación al 5%, exenta o excluida.

<details><summary>Fuentes consultadas (16)</summary>

- https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0240_2026.htm — Decreto Legislativo 0240 del 12-mar-2026 (INC 16% juegos de suerte y azar por internet: hecho generador, base GGR, tarifa, periodicidad bimestral, vigencia 2026)
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=273176 — Gestor Normativo, Decreto 240 de 2026
- https://www.contadia.com/estatuto-tributario/articulo-420-hechos-sobre-los-que-recae-el-impuesto — Art. 420 E.T. lit. a) a e), exclusión de loterías y juegos operados exclusivamente por internet
- https://www.contadia.com/estatuto-tributario/articulo-600-periodo-gravable-del-impuesto-sobre-las-ventas — Art. 600 E.T., umbral 92.000 UVT bimestral/cuatrimestral
- https://estatuto.co/437-4 y https://www.contadia.com/estatuto-tributario/articulo-437-4-retencion-de-iva-para-venta-de-chatarra-y-otros-bienes — Art. 437-4 E.T. (chatarra 72.04/74.04/76.02 vendida a siderúrgicas, retención 100%)
- https://leyes.co/se_expide_el_estatuto_tributario_de_los_impuestos_administrados_por_la_direccion_general_de_impuestos_nacionales/437-5.htm — Art. 437-5 E.T. (tabaco 24.01, retención 100%)
- https://actualicese.com/estatutotributario/437-1/ — Art. 437-1 E.T.: tarifa general ReteIVA 15%; parágrafo 1: 100% para servicios de los nums. 3 y 8 del Art. 437-2 (prestados desde el exterior)
- https://www.contadia.com/estatuto-tributario/articulo-915-regimen-de-iva-y-de-impuesto-al-consumo y https://www.gerencie.com/regimen-simple-y-su-relacion-con-el-iva.html — Art. 915 E.T.: el SIMPLE NO exime de IVA; declaración anual consolidada + anticipo bimestral
- https://accounter.co/normatividad/proporcionalidad-art-490-etsobre-ingresos-netos-de-operaciones-excluidas-exentas-y-gravadas-o-brutos-de-dichas-operaciones-concepto-dian-1241-de-2024.html — Art. 490 E.T. proporcionalidad / prorrateo (Concepto DIAN 1241 de 2024)
- https://rioconsultores.com/2026/07/15/consejo-estado-reafirma-proporcion-iva-articulo-490-estatuto-tributario-no-puede-modificarse/ — Consejo de Estado, jul-2026, sobre la proporción del Art. 490
- https://actualicese.com/dian-resuelve-interrogantes-sobre-derogatorias-de-la-ley-2277-de-2022/ — Art. 96 Ley 2277/2022 derogó Arts. 37, 38 y 39 Ley 2155/2021 (días sin IVA)
- https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/ — Resolución DIAN 000238 del 15-dic-2025, UVT 2026 = $52.374
- https://siemprealdia.co/colombia/impuestos/impuesto-nacional-al-consumo/ — Tarifas INC 2026: 4% telefonía/datos, 8% restaurantes y bares, 8%/16% vehículos; no responsables INC bares/restaurantes < 3.500 UVT
- https://www.perezllorca.com/es-co/actualidad/boletin/corte-constitucional-tumba-el-decreto-1474-se-caen-las-medidas-tributarias-de-la-emergencia-economica/ — Corte Constitucional 09-abr-2026 declaró inexequible el Decreto 1474/2025 (que gravaba licores, cigarrillos y ajustaba IVA/INC)
- https://www.reyesaa.com/en/la-corte-constitucional-avalo-de-manera-condicionada-la-emergencia-economica-declarada-en-febrero-de-2026-se-mantiene-el-impuesto-al-patrimonio-a-cargo-de-las-personas-juridicas/ — Corte Constitucional 26-jun-2026: exequibilidad condicionada del Decreto 150 de 2026
- https://www.presidencia.gov.co/prensa/Paginas/Gobierno-decreta-impuesto-a-juegos-de-suerte-y-azar-y-nuevas-medidas-para-atender-emergencia-por-inundaciones-260313.aspx — comunicado oficial Presidencia sobre Decretos 0240/0241 de 2026

</details>

### Sanciones, procedimiento tributario e intereses (Arts. 634-655, 685-720 E.T.)

El núcleo está bien: UVT 2026 = $52.374 (Resolución DIAN 000238 del 15-dic-2025) es correcto, la sanción mínima de 10 UVT = $523.740 (Art. 639) es correcta, la base del 100% de inexactitud, los 5%/10% y topes 100%/200% de extemporaneidad y el 10%/20% de corrección están bien enunciados en el catálogo, y la fórmula de interés moratorio implementada (simple diario, usura − 2 pp ÷ 365) coincide con la fórmula DIAN vigente. Lo que NO está alineado es grave y concentrado en cuatro focos. Primero, el Art. 648 está reducido al 100% plano: el catálogo omite por completo los casos agravados del inciso 3º (200% por activos omitidos o pasivos inexistentes, 160% por proveedores ficticios o abuso del Art. 869, 20% en ingresos y patrimonio, 50% en monotributo), de modo que un dictamen sobre omisión de activos subestima la sanción a la mitad. Segundo, el Art. 640 está mal descrito en los dos archivos que lo definen: se atribuyen las reducciones al 50%/75% a "aceptar el cargo" o "subsanar antes del pliego" cuando en realidad dependen del historial (2/1 años si la liquida el contribuyente; 4/2 años si la impone la DIAN) y no se registra el parágrafo 3 que excluye los numerales 1-3 del inciso 3º del Art. 648. Tercero, la calculadora tiene dos defectos de cálculo verificables: identifica mal el hito 10%→20% del Art. 644 (usa el requerimiento especial en vez del emplazamiento para corregir o auto de inspección) y omite el tope de 2.500 UVT en extemporaneidad sin impuesto a cargo, lo que sobreestima la sanción hasta en un orden de magnitud. Cuarto, la tasa de interés moratorio está triplemente desincronizada: el código usa 25,44%, tres esquemas de herramienta documentan 27,44% etiquetándolo además como "tasa de usura", y la tasa vigente para agosto de 2026 es 27,66% E.A. (usura 29,66% − 2 pp, Resolución SFC 1139 del 31-jul-2026). Adicionalmente, los Arts. 634, 635, 642, 643, 651, 655 y 714 no existen en ARTICULOS_ET, y como el citation.validator bloquea con NO_VERIFICADO toda cita ausente del catálogo, el Escudo no puede citar los artículos sancionatorios que más necesita. Menores no listados por límite de cupo: sanciones.ts:21 reparte mal los topes del Art. 641 (las 2.500 UVT aplican a ambas ramas y la rama patrimonio tiene tope del 10%), estatuto-tributario.ts:794 cita "Art. 647 par." cuando la defensa de diferencia de criterio está en el parágrafo 2, y compliance-validator.prompt.ts:46 dice que la inexactitud es "reducible al 50% si corrige" cuando la aceptación reduce al 25% (Art. 709) o al 50% (Art. 713).

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Sanción por inexactitud — tarifas agravadas del Art. 648 inciso 3º | `src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts:60` | tarifa: '100% del mayor valor del impuesto que se generó.'  /  tope: null | Base 100% (o 15% en declaraciones de ingresos y patrimonio). Inciso 3º: (1) 200% del mayor valor del impuesto cuando se omitan activos o se incluyan pasivos inexistentes; (2) 160% cuando la inexactitu | Art. 648 E.T., modificado por el Art. 288 de la Ley 1819 de 2016 (incisos 1º y 3º, numerales 1 a 4; par. 2: el numeral 1 aplica desde el año gravable 2018) |
| P0 | Entrada ART_648_ET del catálogo normativo — tarifa consolidada | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:811` | 'Consolida la tarifa escalonada de la sanción por inexactitud en el 100% del mayor valor del impuesto que se generó o del menor saldo a favor declarado.' | El Art. 648 NO consolidó todo en 100%: mantiene un régimen escalonado con 100% general, 15% en ingresos y patrimonio, y las agravaciones de 200%, 160%, 20% y 50% del inciso 3º. | Art. 648 E.T., inciso 3º numerales 1 a 4 (mod. Art. 288 Ley 1819 de 2016) |
| P0 | Sanción por corrección — hito que hace pasar del 10% al 20% | `src/lib/tools/sanction-calculator.ts:165` | isVoluntary ? 'correccion voluntaria (antes de notificacion del requerimiento especial o pliego de cargos)' : 'correccion provocada (despues de notificacion del | 10% si la corrección se realiza después del vencimiento del plazo para declarar y ANTES del emplazamiento para corregir del Art. 685 o del auto que ordene visita de inspección tributaria. 20% si se re | Art. 644 E.T., numerales 1 y 2 (en concordancia con el Art. 685 E.T.) |
| P0 | Sanción por extemporaneidad sin impuesto a cargo — tope de 2.500 UVT | `src/lib/tools/sanction-calculator.ts:106` | const maxAmount = grossIncome * 0.05; // 5% cap  — único tope aplicado cuando taxDue = 0 | La sanción es del 0,5% de los ingresos brutos por mes o fracción, 'sin exceder la cifra MENOR resultante de aplicar el 5% a dichos ingresos, o del doble del saldo a favor si lo hubiere, o de la suma d | Art. 641 E.T., incisos 2º y 3º |
| P1 | Art. 640 E.T. — condiciones de la reducción al 50% y al 75% | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:744` | 'Principios de gradualidad, proporcionalidad y favorabilidad para sanciones. Reducción del 50% si se acepta cargo sin pliego de cargos; 75% si subsana antes del | Cuando la sanción la liquida el contribuyente: se reduce AL 50% si en los 2 años anteriores no cometió la misma conducta y la DIAN no ha proferido pliego de cargos, requerimiento especial ni emplazami | Art. 640 E.T., numerales 1 a 4 y parágrafos 3 y 4 (mod. Art. 282 Ley 1819 de 2016) |
| P1 | Art. 640 E.T. como reducción de las sanciones de extemporaneidad e inexactitud | `src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts:30` | reducción: '50% si primer incumplimiento documentado; 75% si subsana antes de pliego' (SANCION_EXTEMPORANEIDAD_ART641) y 'Hasta 50% adicional si se cumplen cond | Ni 'primer incumplimiento documentado' ni 'subsanar antes del pliego' son los criterios legales: son los períodos limpios de 2/1 años (sanción autoliquidada) o 4/2 años (sanción impuesta por la DIAN), | Art. 640 E.T., numerales 1 a 4 (mod. Art. 282 Ley 1819 de 2016) |
| P1 | Sanción por no enviar información exógena — tarifa | `src/lib/agents/financial/tax-planning/prompts/compliance-validator.prompt.ts:46` | 'Art. 651 (no reportar exógena hasta 5% montos)' | 1% de las sumas respecto de las cuales no se suministró la información; 0,7% de las suministradas de forma errónea; 0,5% de las suministradas extemporáneamente; y 0,5 UVT por cada dato no suministrado | Art. 651 E.T., modificado por el Art. 80 de la Ley 2277 de 2022 |
| P1 | Sanción por inexactitud derivada de abuso en materia tributaria | `src/lib/agents/financial/tax-planning/prompts/compliance-validator.prompt.ts:46` | 'Art. 869 (recaracterización + 200% si dolo)' | La inexactitud originada en abuso en materia tributaria del Art. 869 (o en el numeral 5 del Art. 647, proveedores ficticios) se sanciona con el 160% de la diferencia. El 200% está reservado a la omisi | Art. 648 E.T., inciso 3º, numerales 1 y 2 (mod. Art. 288 Ley 1819 de 2016), en concordancia con el Art. 869 E.T. |
| P1 | Firmeza de las declaraciones tributarias — términos especiales | `src/lib/agents/prompts/strategy-agent.prompt.ts:84` | 'Firmeza de declaraciones (Art. 714): Plazos de 3 anos (general), 5 anos (precios de transferencia), 12 anos (activos omitidos)' | 3 años desde el vencimiento del plazo para declarar (o desde la presentación si fue extemporánea, o desde la solicitud de devolución/compensación). 5 años para declaraciones en las que se determinen o | Art. 714 E.T. y Art. 147 E.T., ambos en la redacción del Art. 117 de la Ley 2010 de 2019 |
| P1 | Tasa de interés moratorio tributario — valor de referencia 2026 | `src/lib/agents/prompts/tax-agent.prompt.ts:105` | '- **Tasa de interes moratorio**: ~27.44% EA (tasa de usura vigente)' | Para agosto de 2026 la tasa de interés moratorio DIAN es 27,66% E.A., resultado de restar 2 puntos porcentuales a la tasa de usura de 29,66% E.A. certificada por la Superintendencia Financiera. La tas | Art. 635 E.T. (mod. Art. 279 Ley 1819 de 2016); Resolución 1139 del 31 de julio de 2026 de la Superintendencia Financiera de Colombia |
| P1 | Tasa de interés moratorio por defecto de la calculadora | `src/lib/tools/sanction-calculator.ts:30` | const DEFAULT_ANNUAL_RATE_EA = 25.44;  — mientras que app/api/chat/route.ts:500 documenta 'Default: 27.44% (tasa de usura aprox 2026)', app/api/realtime/route.t | 27,66% E.A. para agosto de 2026 (usura 29,66% − 2 pp). El parámetro debe recibir siempre la tasa certificada del mes de la mora menos 2 pp, y si la mora cruza varios meses debe segmentarse por mes. | Art. 635 E.T. (mod. Art. 279 Ley 1819 de 2016); Resolución 1139 del 31-jul-2026 de la Superfinanciera |
| P1 | Tope de la sanción por extemporaneidad después del emplazamiento | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:757` | 'Extemporaneidad: 5% mensual antes de emplazamiento, 10% mensual después de emplazamiento, tope 100% del impuesto a cargo.' — con el comentario de la línea 763: | Art. 641: 5% mensual, tope 100% del impuesto o retención a cargo. Art. 642 (después de emplazamiento o auto de inspección): 10% mensual, tope 200% del impuesto o retención a cargo. Son dos artículos c | Arts. 641 y 642 E.T. |
| P2 | Sanción por no declarar — supuestos y reducción del parágrafo 2 | `src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts:117` | '20% de las consignaciones bancarias o ingresos brutos del periodo (declaración de renta). Para IVA: 10% de los ingresos brutos del periodo no declarado.'  — to | Renta: 20% del valor de las consignaciones bancarias o de los ingresos brutos del período, o de los ingresos brutos de la última declaración de renta presentada, EL QUE FUERE SUPERIOR. IVA y consumo: | Art. 643 E.T., numerales 1 a 9 y parágrafo 2 (mod. Art. 284 Ley 1819 de 2016) |
| P2 | Cobertura del catálogo ARTICULOS_ET para el régimen sancionatorio y de intereses | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:966` | ARTICULOS_ET contiene 639, 640, 641, 644, 647, 647 par., 648, 709, 713, 685, 702, 715, 720, 752 — pero NO contiene 634, 635, 642, 643, 651, 655, 638, 703, 705 n | Todos esos artículos están vigentes en 2026 y son citados por los prompts del sistema: Art. 634-635 (intereses moratorios), 642 (extemporaneidad post-emplazamiento), 643 (no declarar), 651 (exógena, 1 | Arts. 634, 635, 638, 642, 643, 651 (mod. Art. 80 Ley 2277/2022), 655, 703, 705 y 714 E.T. |
| P2 | Numeración de los actos del procedimiento de determinación | `src/lib/agents/prompts/strategy-agent.prompt.ts:80` | '- **Requerimientos**: Ordinarios (Art. 684), Especiales (Art. 685), de informacion'  y línea 81: '- **Liquidaciones Oficiales**: De revision (Art. 702), de afo | El requerimiento especial está regulado en el Art. 703 E.T. (su término de notificación en el Art. 705). El Art. 685 es el emplazamiento para corregir. La liquidación de aforo está en el Art. 717 E.T. | Arts. 703, 705, 717 E.T. (frente a los Arts. 685 y 715 citados) |

**No verificables contra fuente en esta pasada.**

- src/lib/tools/sanction-calculator.ts:30 — DEFAULT_ANNUAL_RATE_EA como constante estática: NINGÚN valor fijo puede ser correcto, porque la Superfinanciera certifica la tasa mensualmente (jul-2026: 26,79%; ago-2026: 27,66%). Es un defecto de diseño más que un valor errado: requiere consulta en vivo o segmentación por mes, no un fallback.
- src/lib/agents/financial/tax-planning/prompts/compliance-validator.prompt.ts:46 — sanciones del RUB por Arts. 631-5 / 631-6 remitidas al Art. 658-3 E.T. (1 UVT por día de retraso; 100 UVT por información errónea o incompleta): no logré confirmar contra la Resolución DIAN que reglamenta el Registro Único de Beneficiarios Finales cuál numeral del Art. 658-3 aplica ni si las cuantías son esas.
- src/lib/agents/financial/tax-planning/prompts/compliance-validator.prompt.ts:46 — Art. 434A C.P. (omisión de activos / pasivos inexistentes): pena de 48 a 108 meses y umbral de 1.000 SMLMV atribuido a la Ley 2277/2022. No verifiqué el texto vigente del Código Penal ni si sentencias de la Corte Constitucional posteriores afectaron el umbral o la condición de procedibilidad.
- src/lib/agents/financial/transfer-pricing/prompts/tp-analyst.prompt.ts:56-58 y tp-documentation.prompt.ts:41-44 — topes sancionatorios de precios de transferencia de 20.000 UVT y la extemporaneidad del 1% mensual: la aritmética (20.000 × 52.374 = $1.047.480.000) es correcta, pero no verifiqué los topes contra el Art. 260-11 E.T. vigente, que maneja varios topes distintos (1.500 UVT, 25.000 UVT y otros) según el supuesto. Corresponde al dominio de precios de transferencia.
- src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts:99 — SANCION_RETENCIONES_NO_CONSIGNADAS remite al Art. 402 del Código Penal (omisión del agente retenedor). No verifiqué el umbral temporal (dos meses siguientes al plazo de consignación) ni la causal de extinción de la acción penal por pago, que la entrada describe de forma genérica.
- src/lib/agents/prompts/litigation.prompt.ts:119 — beneficio de auditoría del Art. 689-3 E.T. citado sin cifras. No verifiqué si sigue disponible para el año gravable 2026 ni los porcentajes de incremento del impuesto neto de renta que activan los términos de firmeza de 6 y 12 meses.

<details><summary>Fuentes consultadas (20)</summary>

- Art. 648 E.T. (mod. Art. 288 Ley 1819/2016) — https://actualicese.com/estatutotributario/648-2/
- Art. 648 E.T. incisos agravados 200%/160%/20%/50% — https://www.contadia.com/estatuto-tributario/articulo-648-sancion-por-inexactitud
- Art. 640 E.T. numerales 1-4 y parágrafos — https://www.gerencie.com/gradualidad-de-las-sanciones-tributarias.html
- Art. 640 par. 3 E.T. (exclusión numerales 1,2,3 del inciso 3º del Art. 648) — https://www.contadia.com/estatuto-tributario/articulo-640-aplicacion-de-los-principios-de-lesividad-proporcionalidad-gradualidad-y-favorabilidad-en-el-regimen-sancionatorio
- Sanciones excluidas de la reducción del Art. 640 — https://actualicese.com/estas-son-las-sanciones-que-no-pueden-reducirse/
- Arts. 641 y 642 E.T. — topes 100%/200%, 2.500 UVT y 5.000 UVT — https://www.gerencie.com/sancion-por-extemporaneidad.html
- Art. 644 E.T. numerales 1 y 2 (hito emplazamiento para corregir / auto de inspección) — https://www.gerencie.com/sancion-por-correccion.html
- Art. 643 E.T. numerales y parágrafo 2 (reducción 50%) — https://www.gerencie.com/sancion-por-no-declarar.html
- Art. 647 E.T. numerales 1-6 y parágrafo 2 (interpretación razonable) — https://www.gerencie.com/sancion-por-inexactitud.html
- Art. 651 E.T. (mod. Art. 80 Ley 2277/2022): 1% / 0,7% / 0,5%, 0,5 UVT por dato, tope 7.500 UVT, reducciones 50%/70% — https://www.gerencie.com/sancion-por-no-enviar-informacion-tributaria.html
- Art. 651 E.T. reducciones — https://actualicese.com/reducciones-de-la-sancion-de-exogena-por-no-suministrar-informacion/
- Art. 655 E.T.: 0,5% del mayor valor entre patrimonio líquido e ingresos netos, tope 20.000 UVT — https://actualicese.com/estatutotributario/655-2/
- Art. 714 E.T. y Art. 117 Ley 2010/2019: firmeza general 3 años; 5 años por pérdidas fiscales o precios de transferencia — https://www.gerencie.com/firmeza-de-las-declaraciones-tributarias.html
- Art. 714 E.T. — https://actualicese.com/firmeza-de-la-declaracion-de-renta-esto-es-lo-que-necesitas-saber-para-entenderla/
- Art. 635 E.T. — tasa de interés moratorio agosto 2026 = 27,66% E.A. (usura 29,66% − 2 pp), Resolución SFC 1139 del 31-jul-2026 — https://siemprealdia.co/colombia/finanzas/tasa-de-interes-moratorio/
- Tabla TIM DIAN 2026 — https://www.dian.gov.co/normatividad/TIM/Otros%20documentos%20%20de%2029-05-2026.pdf
- UVT 2026 = $52.374, Resolución DIAN 000238 del 15-dic-2025 (IPC ingresos medios 5,17%) — https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/
- Resolución DIAN 000238 de 2025 — https://cijuf.org.co/normatividad/resolucion/2025/resolucion-000238.html
- Art. 703 E.T. (requerimiento especial) y Art. 717 E.T. (liquidación de aforo) — https://www.gerencie.com/liquidacion-de-aforo.html
- Estado de la reforma tributaria 2026 (Ley de Financiamiento NO aprobada; régimen sancionatorio sin cambios en 2026) — https://www.pwc.com/co/es/pwc-insights/reforma-tributaria-2026-ley-de-financiamiento.html

</details>

### Calendario tributario DIAN y plazos (Decreto 2229 de 2023 / DUR 1625 de 2016; Resolución Única DIAN 000227 de 2025)

El marco normativo que el repo cita (Decreto 2229 de 2023, que fija los plazos en DÍAS HÁBILES de forma permanente sobre el DUR 1625/2016) es el correcto y la UVT 2026 = $52.374 está bien. Todo lo demás del dominio está roto en algún grado. El error estructural es que `src/data/calendars/nacional-2026.ts` INVIERTE el mapeo dígito→día hábil (usa `16 - digit` cuando la norma es dígito 1 → 7º día hábil … dígito 0 → 16º), de modo que cada fecha del calendario estático — el fallback que alimenta el tool LLM — sale hasta 14 días tarde; el scraper (`dian-scraper.ts`) tiene el mapeo correcto pero contradice al estático, y ninguno de los dos excluye el 17-abr-2026, declarado día NO hábil por el Decreto 500 de 2024, lo que corre todo abril. La información exógena fue movida por un "fix" previo a septiembre 2026 cuando la Resolución 000227 de 2025 la ubica entre el 27-abr y el 12-jun-2026. El `fiscal-anchor/dian-calendar.ts` toma el dígito de VERIFICACIÓN en vez del último dígito del NIT (la norma dice expresamente "sin tener en cuenta el dígito de verificación"), omite el vencimiento de retención de enero, pone renta PJ en abril con una sola cuota, y presenta fechas heurísticas de día fijo con estado 'pendiente'/'proximo' (es decir, como ciertas). El scraper marca `verified: true` sobre fechas que él mismo CALCULA — no parsea — y el tool las imprime como "verificadas contra decreto oficial". El doc RAG `resolucion_dian_188_2024_calendario_2026.md` tiene la tabla de exógena PJ/PN invertida y varias fechas de retención posteriores a las oficiales.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Mapeo último dígito del NIT → N-ésimo día hábil en el calendario nacional estático | `src/data/calendars/nacional-2026.ts:44` | return digit === 0 ? 16 : 16 - digit;  // dígito 1 → 15º día hábil, dígito 9 → 7º | digit === 0 ? 16 : digit + 6  // dígito 1 → 7º día hábil, dígito 2 → 8º, …, dígito 9 → 15º, dígito 0 → 16º | Decreto 2229 de 2023 (modifica arts. 1.6.1.13.2.x del DUR 1625 de 2016): 'si el último dígito es 1, hasta el séptimo día hábil… si es 0, hasta el décimo sexto día hábil' |
| P0 | Set de días no hábiles 2026 usado por nthBusinessDay (base de todo el calendario generado) | `src/lib/scrapers/dian-scraper.ts:55` | FESTIVOS_2026 con 18 entradas; NO incluye '2026-04-17' | Debe incluir '2026-04-17' (tercer viernes de abril) como día NO hábil. Con él, los días hábiles 11º a 16º de abril 2026 corren un día: 11º=20-abr, 12º=21, 13º=22, 14º=23, 15º=24, 16º=27-abr | Decreto 500 de 2024, art. 1 y 2 — declara el tercer viernes de abril de cada año 'Día Cívico de la Paz con la Naturaleza' y ordena que sea considerado día NO HÁBIL laboralmente para las entidades de la Rama Ejecutiva del orden nacional |
| P0 | Mes de vencimiento de la información exógena (medios magnéticos) año gravable 2025 | `src/data/calendars/nacional-2026.ts:302` | ...buildPerDigit(2026, 9, (d, dueDate) => exogena(d, dueDate)) — con el comentario 'FIX: antes estaba en mayo; lo oficial es septiembre 9–22'. Idéntico error en | Grandes contribuyentes: 27/28-abr-2026 (último dígito 1) a 13-may-2026 (dígito 0). Personas jurídicas y naturales: 14-may-2026 (últimos dos dígitos 01–05) a 12-jun-2026 (96–00). | Resolución Única DIAN 000227 del 23-sep-2025, Título 3 (compila la Res. 000162 de 2023 y la Res. 000188 de 2024), modificada por la Resolución DIAN 000233 de 2025; plazos en días hábiles conforme al Decreto 2229 de 2023 |
| P0 | Extracción del 'último dígito del NIT' para indexar el calendario en el Fiscal Anchor | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:57` | const dashMatch = trimmed.match(/-\s*(\d)\s*$/); if (dashMatch) return parseInt(dashMatch[1], 10);  // docstring: '901714014-6 → 6 … ese dígito ES el último díg | Debe tomarse el último dígito del NIT que consta en el RUT SIN el dígito de verificación. Para 901714014-6 el dígito de calendario es 4, no 6. | Decreto 2229 de 2023 / DUR 1625 de 2016, arts. 1.6.1.13.2.x: '…atendiendo el último dígito del Número de Identificación Tributaria -NIT- del declarante que conste en el certificado del Registro Único Tributario -RUT-, sin tener en cuenta el dígito de verificación' |
| P0 | Vencimiento de enero de 2027 en la tabla verificada del NIT dígito 6 (retención de diciembre 2026 e IVA bimestre Nov-Dic 2026) | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:142` | '2027-01-26' (última entrada de retencionMensual, línea 142, y de ivaBimestral, línea 146) | 2027-01-20 (12º día hábil de enero de 2027, que es el que corresponde al dígito 6). El 26-ene-2027 es el 16º día hábil, es decir la fecha del dígito 0. | Decreto 2229 de 2023 (dígito 6 → 12º día hábil del mes). Días hábiles de enero 2027 descontando 1-ene y el traslado de Reyes al lunes 11-ene (Ley 51 de 1983): 4,5,6,7,8,12,13,14,15,18,19,20… |
| P0 | Meses de vencimiento cubiertos por el calendario del Fiscal Anchor (retención mensual e IVA bimestral) | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:112` | const MESES_RETENCION = [2,3,4,5,6,7,8,9,10,11,12]; const MESES_IVA_BIMESTRAL = [3,5,7,9,11];  // la tabla override NIT6_2026 también arranca en 2026-02-17 / 20 | El año calendario tiene 12 vencimientos de retención (el de enero corresponde al período diciembre del año anterior) y 6 de IVA bimestral (el de enero corresponde al bimestre Nov-Dic del año anterior) | Arts. 376 y 382 E.T. (declaración y consignación mensual de retenciones) y art. 600 E.T. (IVA bimestral), con plazos del Decreto 2229 de 2023 / DUR 1625 de 2016 |
| P0 | Fecha y número de cuotas de la declaración de renta de personas jurídicas en el fallback heurístico del Fiscal Anchor | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:99` | DIA_RENTA_PJ: dígito 0 → 8-abr, dígito 1 → 9-abr, … dígito 9 → 6-may; una sola obligación 'Declaración de Renta — Persona Jurídica' (línea 232-238), norma citad | Dos cuotas: Declaración + 1ª cuota entre el 12-may-2026 (dígito 1) y el 26-may-2026 (dígito 0); 2ª cuota entre el 9-jul-2026 (dígito 1) y el 23-jul-2026 (dígito 0). Norma de plazos: art. 1.6.1.13.2.12 | Decreto 2229 de 2023, que modifica el art. 1.6.1.13.2.12 del Decreto 1625 de 2016; art. 591 E.T. |
| P0 | Marcado de procedencia (verified / estado) de fechas que el sistema CALCULA en vez de leer de la fuente oficial | `src/lib/scrapers/dian-scraper.ts:202` | verified: true en buildRange (línea 202), buildRentaPN (304) y buildPatrimonioCuota2 (385), pese a que el propio encabezado del archivo dice 'El scraping en sen | Una fecha derivada de un modelo interno no está verificada contra el decreto. Solo puede marcarse verified: true si el hash del payload oficial fue efectivamente parseado y las fechas coinciden con la | No es una norma tributaria sino el deber de diligencia del Art. 641 E.T. / Art. 651 E.T.: quien firma la declaración responde por la fecha. El propio repo lo reconoce en src/data/calendars/types.ts ('verified false = fecha inferida por patrón histórico (NO oficial)') |
| P0 | Tabla de exógena para personas jurídicas y naturales por últimos DOS dígitos del NIT en el documento RAG | `src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:218` | \| 96-00 \| 14-may-2026 \|  …  \| 01-05 \| 12-jun-2026 \|  (orden descendente: 96-00 primero, 01-05 último) | \| 01 al 05 \| 14 de mayo de 2026 \| … \| 96 al 00 \| 12 de junio de 2026 \|  (orden ascendente: 01-05 primero) | Resolución Única DIAN 000227 del 23-sep-2025, Título 3, modificada por la Resolución DIAN 000233 de 2025 |
| P0 | Regla y rangos de vencimiento de la retención en la fuente mensual en el documento RAG | `src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:264` | 'Vencimiento: dentro de los 10 primeros días hábiles del mes siguiente al período' (línea 264); tabla: 'Agosto 2026 → 9-sep a 23-sep-2026' (línea 275) y 'Septie | El plazo va del 7º al 16º día hábil del mes siguiente, no de los 10 primeros. Período agosto 2026: 9-sep (dígito 1) a 22-sep-2026 (dígito 0). Período septiembre 2026: 9-oct (dígito 1) a 23-oct-2026 (d | Decreto 2229 de 2023, que modifica el art. 1.6.1.13.2.34 y ss. del DUR 1625 de 2016; art. 382 E.T. |
| P0 | Vencimiento de la declaración anual del Régimen Simple de Tributación (AG 2025) en el documento RAG | `src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:307` | 'Anual, por NIT al 26-jun-2026 a 25-jun-2026 (rango por dígito) más anticipos bimestrales (mismas fechas IVA bimestral).' | Declaración anual consolidada del SIMPLE AG 2025: por los DOS últimos dígitos del NIT, del 17 al 23 de abril de 2026 (1y2 → 17-abr, 3y4 → 20-abr, 5y6 → 21-abr, 7y8 → 22-abr, 9y0 → 23-abr; con el 17-ab | Arts. 903 a 916 E.T. (Régimen Simple, Ley 2277 de 2022); plazos en el art. 1.6.1.13.2.50 del DUR 1625 de 2016 modificado por el Decreto 2229 de 2023 |
| P0 | Compresión por bandas del calendario de renta de personas naturales (dos últimos dígitos del NIT) | `src/data/calendars/nacional-2026.ts:245` | rentaPN(9,'2026-08-25','90-99') … rentaPN(0,'2026-10-26','00-09')  — la banda 90-99 en agosto y la 00-09 en octubre. Mismo error invertido en src/lib/scrapers/d | 01 y 02 → 12-ago-2026 (primeros); la banda 00-09 vence entre el 12 y el 19 de agosto de 2026. 89 y 90 → 19-oct; 99 y 00 → 26-oct-2026 (últimos); la banda 90-99 vence entre el 19 y el 26 de octubre de | Decreto 2229 de 2023, que modifica el art. 1.6.1.13.2.15 del DUR 1625 de 2016; art. 592 E.T. |
| P1 | Meses y fechas de vencimiento del ICA bimestral y del ReteICA de Bogotá | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:114` | const MESES_ICA_BIMESTRAL = [2,4,6,8,10,12] (febrero, abril, junio, agosto, octubre, diciembre), con el día tomado de DIA_IVA_POR_DIGITO. En src/data/calendars/ | ICA bimestral Bogotá 2026: B1 (ene-feb) 10-abr-2026; B2 (mar-abr) 12-jun-2026; B3 (may-jun) 21-ago-2026; B4 (jul-ago) 9-oct-2026; B5 (sep-oct) 11-dic-2026; B6 (nov-dic) 12-feb-2027. ReteICA: 20-mar, 2 | Resolución SDH-000195 del 12 de diciembre de 2025, Secretaría Distrital de Hacienda de Bogotá (calendario tributario distrital 2026); Acuerdo Distrital 65 de 2002 |
| P1 | Número de períodos del IVA cuatrimestral en el calendario nacional | `src/data/calendars/nacional-2026.ts:296` | Solo dos cuatrimestres: C1 (Ene-Abr 2026) → mayo y C2 (May-Ago 2026) → septiembre. El helper ivaCuatrimestral (línea 131) solo define periods = ['Ene-Abr 2026', | Tres cuatrimestres: Ene-Abr → mayo 2026 (12 a 26); May-Ago → septiembre 2026 (9 a 22); Sep-Dic → enero 2027 (13 a 26). | Art. 600 num. 2 E.T.; plazos en el art. 1.6.1.13.2.30 del DUR 1625 de 2016 modificado por el Decreto 2229 de 2023 |
| P2 | Construcción y comparación de fechas del calendario respecto de 'hoy' | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:250` | daysBetween usa Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) sobre el `hoy` que el orchestrator pasa como new Date(); pickNextOrProjec | Los términos tributarios corren en hora legal colombiana (UTC-5, sin horario de verano). El día calendario debe calcularse en America/Bogota, no en UTC. | Decreto 4131 de 2004 y Ley 1715 de 2014 (hora legal colombiana, UTC-5); cómputo de términos del art. 62 de la Ley 4 de 1913 y art. 1.6.1.13.2.1 del DUR 1625 de 2016 |

**No verificables contra fuente en esta pasada.**

- src/data/calendars/index.ts:22 — 'Resolución DIAN 000238 del 15 de diciembre de 2025' como norma que fija la UVT 2026. El VALOR ($52.374) sí está confirmado por el calendario oficial 2026, pero no logré confirmar el número exacto de la resolución en fuente primaria (la DIAN suele expedirla en la segunda quincena de diciembre). Riesgo bajo pero se cita en dictámenes firmados.
- src/data/calendars/index.ts:26 y src/lib/calendars/source.ts:113 — decreeNumber = 'Decreto 2229 de 2023'. Confirmado como marco vigente de plazos en días hábiles, pero NO logré confirmar si durante 2025 se expidió un decreto adicional que ajuste artículos puntuales del DUR 1625/2016 para el período 2026; el calendario oficial 2026 se apoya además en la Resolución Única DIAN 000227 de 2025, que el repo no cita en ninguno de los archivos de calendario.
- src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:200-211 — tabla de exógena de GRANDES CONTRIBUYENTES (dígito 1 = 28-abr-2026 … dígito 0 = 13-may-2026). Las fuentes secundarias se contradicen: el PDF de Actualícese da 27-abr para el dígito 1 y Siempre Al Día da 28-abr. No pude resolverlo contra la Resolución 000227/000233 de 2025 en fuente primaria. Si el inicio real es el 27-abr, toda la fila del dígito 1 está un día tarde.
- src/data/calendars/municipal-2026.ts — todo el calendario municipal fuera de Bogotá (Medellín, y las demás ciudades del archivo). Solo verifiqué Bogotá contra la Resolución SDH-000195 de 2025; las fechas de Medellín y del resto de ciudades no las pude contrastar contra el decreto o resolución municipal correspondiente y llevan lastVerified '2026-01-15' sin fuente citada.
- src/data/calendars/municipal-2026.ts:41 — 'ICA Anual, régimen Simplificado, ingresos < 3.500 UVT' para Bogotá. El criterio distrital vigente para 2026 es el impuesto a cargo del año anterior frente a 391 UVT, no un umbral de ingresos de 3.500 UVT; no pude confirmar si en Bogotá subsiste la denominación 'régimen simplificado' ni la fecha 2026-03-20 (la fuente secundaria indica 26-feb-2027 para la anual).
- src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:317-322 — fechas de precios de transferencia (Formulario 120, documentación comprobatoria, informe maestro: 7 al 21 de septiembre de 2026; CbC: 31-dic-2026). No las contrasté contra la sección correspondiente del calendario oficial.
- src/data/tax_docs/resolucion_dian_188_2024_calendario_2026.md:293-300 — impuesto al patrimonio 2ª cuota '8-sep a 22-sep-2026'. El calendario oficial 2026 y src/data/calendars/nacional-2026.ts:189 coinciden en fecha ÚNICA del 14-sep-2026 para todos los NIT, lo que sugiere que el doc RAG está mal; no lo reporto como discrepancia formal por no haberlo confirmado en fuente primaria, pero la contradicción interna del repo es real y debe resolverse.

<details><summary>Fuentes consultadas (9)</summary>

- Decreto 2229 de 2023 (MinHacienda) — Gestor Normativo Función Pública: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=227310 y compilación DIAN https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm — fija los plazos en días hábiles, dígito 1 = 7º día hábil, dígito 0 = 16º día hábil, 'sin tener en cuenta el dígito de verificación'
- Decreto 500 de 2024 — Gestor Normativo Función Pública: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=238215 — declara el tercer viernes de abril de cada año Día Cívico y día NO HÁBIL laboralmente para la Rama Ejecutiva del orden nacional
- DIAN, Comunicado de Prensa No. 058 de 2026 (15-abr-2026): https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-058-2026.aspx — suspensión de servicios el viernes 17-abr-2026 por Día Cívico (Decreto 500 de 2024)
- INCP — 'DIAN informó cambios en los plazos para declaración y pago de algunos impuestos' (mar-2026): https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/03/dian-informo-cambios-en-los-plazos-para-declaracion-y-pago-de-algunos-impuestos/ — el 17-abr-2026 no hábil corre los vencimientos posteriores de abril
- Actualícese — Calendario Tributario 2026 (PDF, publicado 01-dic-2025, actualizado 31-dic-2025; base: Decreto 2229 de 2023 + Resolución 000227 de 23-sep-2025): https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf — tablas completas por último dígito del NIT
- Siempre Al Día — Calendario tributario 2026: https://siemprealdia.co/colombia/calendario-tributario-2026/ — confirma dígito 1 vence primero y el corrimiento de la 2ª cuota de grandes contribuyentes a 13–27 de abril
- Siempre Al Día — Calendario tributario distrital de Bogotá 2026 (Resolución SDH-000195 del 12-dic-2025): https://siemprealdia.co/colombia/impuestos/calendario-tributario-distrital-de-bogota/
- Corte Constitucional, Sentencia C-079 de 2026 — declara INEXEQUIBLE el Decreto Legislativo 1474 de 2025 (vía INCP: https://incp.org.co/publicaciones/infoincp-publicaciones/2026/04/corte-constitucional-declaro-inexequible-el-decreto-legislativo-1474-de-2025/ y Pérez-Llorca) — el umbral de patrimonio vuelve a 72.000 UVT, que es lo que el repo ya tiene: NO es discrepancia
- DIAN — Comunicado de Prensa 128 de 2025 (calendario tributario 2026): https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-128-2025.aspx

</details>

### Marco técnico contable colombiano (NIIF) — grupos de preparadores, versión de NIIF para PYMES incorporada, citas NIC/NIIF/Secciones, marco de aseguramiento (NIA) y PUC

El repo ancla correctamente el marco en el Decreto 2420/2015 y acierta en varias citas puntuales (NIC 1 §112-138, NIC 7 §18, NIC 12 §58, NIC 10 §17, NIIF para PYMES §29.4 y §35, títulos de NIA 240/700/705/706, y el hecho de que la versión de NIIF para PYMES vigente en Colombia sigue siendo la de 35 secciones — la tercera edición de 2025 aún está en discusión pública, con vigencia propuesta 2028). Lo que NO está alineado es grave y sistemático: (1) los criterios de pertenencia a los Grupos 1/2/3 codificados en la UI y en el contexto normativo son los DEROGADOS — el art. 1.1.3.1 del DUR 2420 fue modificado por el Decreto 1670/2021, que derogó los párrafos 1.1 a 1.4 del Anexo 3 y remitió la clasificación de microempresa al Decreto 1074/2015 (Cap. 13), y el criterio de Grupo 1 en el repo omite la condición conjuntiva de vínculo internacional, lo que empuja a Grupo 1 a empresas que son Grupo 2; (2) la lista de modificatorios del DUR 2420 se detuvo en 2021 y omite el Decreto 0701 del 7-jul-2026 (vigente desde el 9-jul-2026), que modifica los marcos de Grupo 1 y 2 y afecta los estados financieros del propio ejercicio 2026 que el producto dictamina; (3) el producto afirma en una nota obligatoria de los EEFF que la NIIF 18 tiene "vigencia 2027 para Grupo 1 Colombia", cuando a la fecha la NIIF 18 no ha sido incorporada al DUR 2420 (solo hay proyecto de decreto) y la vigencia propuesta es 2028 con anticipada voluntaria en 2027. Además hay citas normativas erradas que viajan a documentos firmados: NIC 12 §80 invocado como fundamento del reconocimiento del pasivo por impuesto corriente (es el §12), y NIC 17 citada como norma viva para el arrendador (derogada en Colombia desde 2019). Por último, el tratamiento del PUC es incorrecto: se afirma que el Anexo 2 del DUR 2420 contiene un PUC, cuando ese anexo es la NIIF para las PYMES y bajo NIIF no existe catálogo obligatorio.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P1 | Criterios de pertenencia al Grupo 3 (microempresas / contabilidad simplificada) en el contexto normativo que se inyecta a todos los agentes del pipeline | `src/lib/agents/financial/prompts/colombia-2026-context.ts:35` | **Grupo 3 — Contabilidad Simplificada:** microempresas que cumplen criterios del Decreto 2706 de 2012 (compilado). | El Grupo 3 lo conforman las personas naturales y jurídicas obligadas a llevar contabilidad (y quienes sin estarlo pretendan hacerla valer como prueba) que se clasifiquen como microempresa conforme al | Art. 1.1.3.1 del Decreto 2420 de 2015, modificado por el Decreto 1670 de 2021 (que derogó los párrafos 1.1 a 1.4 del Anexo 3); Decreto 1074 de 2015 Cap. 13 Tít. 1 Parte 2 Libro 2, adicionado por el Decreto 957 de 2019 |
| P1 | Criterio de pertenencia al Grupo 1 (NIIF Plenas) mostrado al usuario en el intake del reporte NIIF | `src/components/workspace/intake/NiifReportIntake.tsx:63` | 'Emisores de valores, entidades de interés público, entidades con activos > 30.000 SMLMV o empleados > 200.' | Además de emisores de valores y entidades de interés público, el Grupo 1 exige que la entidad cumpla la condición de tamaño (planta > 200 trabajadores O activos totales > 30.000 SMMLV) Y ADEMÁS, de fo | Art. 1.1.1.1 del Decreto 2420 de 2015 (ámbito de aplicación Grupo 1), numeral 3 y sus literales |
| P1 | Criterio de pertenencia al Grupo 2 (NIIF para PYMES) mostrado al usuario en el intake | `src/components/workspace/intake/NiifReportIntake.tsx:70` | 'Empresas que no son emisores ni de interés público, con activos entre 500 y 30.000 SMLMV o 11-200 empleados.' | El Grupo 2 es residual: lo integran las entidades que no cumplen los requisitos del art. 1.1.1.1 (Grupo 1) ni los del art. 1.1.3.1 (Grupo 3), más las que siendo elegibles a Grupo 3 optan voluntariamen | Art. 1.1.2.1 del Decreto 2420 de 2015, modificado por el Decreto 1670 de 2021 |
| P1 | Criterio de pertenencia al Grupo 3 (microempresas) mostrado al usuario en el intake | `src/components/workspace/intake/NiifReportIntake.tsx:77` | 'Microempresas con activos < 500 SMLMV y empleados <= 10. Contabilidad simplificada.' | La condición de microempresa se determina por los ingresos por actividades ordinarias anuales según macrosector (manufacturero ≤ 23.563 UVT, servicios ≤ 32.988 UVT, comercio ≤ 44.769 UVT), no por acti | Art. 1.1.3.1 del Decreto 2420 de 2015 (mod. Decreto 1670 de 2021); Decreto 1074 de 2015, Cap. 13 Tít. 1 Parte 2 Libro 2, adicionado por el Decreto 957 de 2019. Los párrafos 1.1 a 1.4 del Anexo 3 (Decreto 2706/2012) fueron derogados. |
| P1 | Lista de decretos modificatorios del Decreto Único Reglamentario 2420 de 2015 declarada como el anclaje normativo del ejercicio 2026 | `src/lib/agents/financial/prompts/colombia-2026-context.ts:31` | 'Este es el anclaje oficial; sus modificatorios relevantes incluyen el Decreto 2270 de 2019 y el Decreto 938 de 2021.' | La cadena de modificatorios relevantes vigente incluye además: Decreto 2483 de 2018 (compila y actualiza los Anexos 1 y 2 — el Anexo 2, NIIF para PYMES, hoy aplicable proviene de este decreto), Decret | Decreto 0701 de 2026 (art. 5 — vigencia); Decreto 1271 de 2024; Decreto 1611 de 2022; Decreto 1670 de 2021; Decreto 2483 de 2018 |
| P1 | Fecha de entrada en vigencia de la NIIF 18 en Colombia, afirmada en la nota 14 obligatoria de los estados financieros y en el contexto normativo | `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:185` | '14 Preparación IFRS 18 — NUNCA omitir esta nota... body que cita IFRS 18 (vigencia 2027 para Grupo 1 Colombia)... la entidad DEBE iniciar preparación en 2026 p | A agosto de 2026 la NIIF 18 NO ha sido incorporada al Decreto 2420 de 2015: existe únicamente un proyecto de decreto publicado por MinCIT el 28 de abril de 2026 (comentarios hasta el 13 de mayo de 202 | Proyecto de decreto MinCIT del 28-04-2026 que modificaría el anexo técnico de las NIF Grupo 1 del Decreto 2420 de 2015 (NIIF 18 + enmiendas NIIF 7 y 9); recomendación CTCP de diciembre de 2025 |
| P1 | Párrafo de la NIC 12 invocado como fundamento de la obligación de reconocer el pasivo por impuesto corriente en el texto legal del Escudo | `src/lib/agents/financial/escudo-survival/legal-strings.ts:46` | 'Bajo NIIF para PYMES Sección 29.4 (o NIC 12 §80 para Grupo 1) la empresa está obligada a reconocer un pasivo por impuesto corriente equivalente al impuesto cau | El fundamento del reconocimiento es la NIC 12 párrafo 12: 'El impuesto corriente, correspondiente al periodo presente y a los anteriores, debe ser reconocido como un pasivo en la medida en que no haya | NIC 12 §12 (reconocimiento) vs NIC 12 §80 (revelación de componentes) — Anexo 1 del Decreto 2420 de 2015 |
| P2 | Norma citada como aplicable a la contabilidad del arrendador en el bloque de conocimiento NIIF que se inyecta a los agentes que miden partidas | `src/lib/agents/financial/prompts/niif-colombia-knowledge.ts:86` | '- Arrendador: sigue modelo NIC 17 — operativo vs. financiero.' (idéntico en la versión inglesa, línea 136: 'Lessor: still follows IAS 17 model') | La NIC 17 fue derogada en Colombia con la entrada en vigencia de la NIIF 16 el 1 de enero de 2019 y ya no forma parte del Anexo 1 del Decreto 2420 de 2015. La contabilidad del arrendador está regulada | NIIF 16 Arrendamientos, §61-97; deroga la NIC 17, la CINIIF 4, la SIC 15 y la SIC 27 — Anexo 1 del Decreto 2420 de 2015 (vía Decreto 2170 de 2017 / Decreto 2483 de 2018) |
| P2 | Denominación de la nota de políticas contables exigida por la NIC 1 tras la enmienda 'Información a Revelar sobre Políticas Contables' | `src/lib/agents/financial/prompts/niif-colombia-knowledge.ts:149` | '2. Resumen de politicas contables significativas.' (replicado en la línea 210 'Politicas contables — contenido minimo', en el checklist línea 221 'Politicas co | La enmienda a la NIC 1 sustituyó 'políticas contables significativas' por 'información sobre políticas contables materiales (o con importancia relativa)', modificó los párrafos 7, 10, 114, 117 y 122, | NIC 1 §117 y §117A-117E (enmienda 'Disclosure of Accounting Policies'), incorporada al Anexo 1 del Decreto 2420 de 2015 por el Decreto 1611 de 2022 |
| P2 | Checklist de revelaciones mínimas obligatorias que guía la composición de las notas a los estados financieros del ejercicio 2026 | `src/lib/agents/financial/prompts/niif-colombia-knowledge.ts:217` | Lista de verificación de 11 ítems (cumplimiento NIIF, base de preparación, moneda, políticas, juicios NIC 1 §122-133, segmentos, partes relacionadas, NIIF 7, NI | Para los estados financieros del ejercicio 2026 son adicionalmente exigibles, según el grupo: revelaciones sobre acuerdos de financiación con proveedores (NIC 7 y NIIF 7); clasificación de pasivos com | Decreto 0701 del 7 de julio de 2026, que modifica los anexos técnicos de las NIF Grupo 1 y de la NIIF para las PYMES Grupo 2 del Decreto 2420 de 2015 |
| P2 | Fuente normativa declarada del catálogo de cuentas (PUC) que el producto siembra y con el que clasifica el balance | `src/lib/accounting/chart-of-accounts/types.ts:13` | '- Decreto 2420/2015 Anexo 2 (PUC para preparadores Grupo 2 NIIF PYMES).' (la misma afirmación se exporta al corpus RAG en src/lib/accounting/chart-of-accounts/ | El Anexo 2 del Decreto 2420 de 2015 contiene la NIIF para las Pymes (marco de reconocimiento, medición, presentación y revelación); no establece ni contiene un Plan Único de Cuentas. Bajo los marcos d | Anexo 2 del Decreto 2420 de 2015 (incorporado por el Decreto 2483 de 2018) — NIIF para las Pymes; CTCP Concepto 2018-0157 |
| P2 | Marco normativo del Plan Único de Cuentas mostrado como vigente en la pantalla de plan de cuentas | `src/app/workspace/contabilidad/cuentas/page.tsx:422` | 'Plan Único de Cuentas · Decreto 2650' (encabezado de la pantalla; pie de página línea 526: 'Saldos de demostración — Decreto 2650 · PUC Colombia') | El Decreto 2650 de 1993 perdió aplicabilidad para la preparación y presentación de estados financieros con la Ley 1314 de 2009 y sus decretos reglamentarios. Subsiste en la práctica únicamente como ca | Ley 1314 de 2009 y decretos reglamentarios (DUR 2420 de 2015); CTCP Concepto 2018-0157; CTCP Concepto 2025-0121 (no existe catálogo uniforme obligatorio bajo NIIF) |
| P2 | Obligatoriedad de las Normas Internacionales de Auditoría (NIA) para el dictamen del Revisor Fiscal | `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:141` | '- MUST: el dictamen del Revisor Fiscal (cuando applies=true) cita NIA 700/705/706 + Art. 207-209 C.Co. + Ley 43 de 1990.' (reforzado en línea 180 y en colombia | Las Normas de Aseguramiento de la Información (incluidas las NIA) son de aplicación obligatoria únicamente para los contadores públicos que prestan servicios de revisoría fiscal en entidades del Grupo | Art. 1.2.1.1 del Decreto 2420 de 2015 y su parágrafo (ámbito de aplicación de las NAI); Anexo 4 del DUR 2420 |
| P2 | Campo `decretoAdopcion` y estado `VIGENTE_2026` de las entradas del catálogo normativo NIIF/NIA que alimenta los dictámenes | `src/lib/agents/financial/escudo-survival/normative/catalog/niif-nia.ts:21` | 'decretoAdopcion: Decreto 2420/2015, Anexo 2 (NIIF para PYMES)' (líneas 21 y 32); 'Decreto 2420/2015, Anexo 1 (NIIF Plenas)' (líneas 45 y 56); 'Decreto 2420/201 | El Anexo 1 (NIIF Plenas) y el Anexo 2 (NIIF para las Pymes) hoy aplicables fueron incorporados por el Decreto 2483 de 2018 y posteriormente modificados por los Decretos 938 de 2021, 1611 de 2022, 1271 | Decreto 2483 de 2018 (Anexos 1 y 2); Decreto 2270 de 2019 (Anexo 4 – 2019); Decretos 938/2021, 1611/2022, 1271/2024 y 0701/2026 (enmiendas) |
| P3 | Descripción del marco de aseguramiento adoptado en Colombia | `src/lib/agents/financial/prompts/colombia-2026-context.ts:66` | '**NIA (Normas Internacionales de Auditoria) vigentes** adoptadas en Colombia — ISA 200 a 706 (marco para opinion, procedimientos sustantivos, riesgo, empresa e | Lo adoptado en Colombia es el conjunto de Normas de Aseguramiento de la Información del Anexo 4 del DUR 2420 (Anexo Técnico Compilatorio y Actualizado 4 – 2019, incorporado por el Decreto 2270 de 2019 | Anexo 4 del Decreto 2420 de 2015 — 'Anexo Técnico Compilatorio y Actualizado 4 – 2019', incorporado por el Decreto 2270 de 2019 (antecedentes: Decretos 2496/2015, 2132/2016 y 2170/2017, anexos 4.1 y 4.2) |

**No verificables contra fuente en esta pasada.**

- governance-specialist.prompt.ts:182 y :293 — cita literal exigida de 'NIIF for SMEs §3.14, §10.21' como sustento de comparativos impracticables. El §3.14 sí trata de información comparativa, pero no pude confirmar contra el texto del Anexo 2 que el §10.21 (impracticabilidad en la corrección de errores de periodos anteriores) sea el párrafo correcto para justificar la omisión de columnas comparativas. Riesgo de cita literal errada en un documento firmado.
- governance-specialist.prompt.ts:185 y :251 — 'Sec. 32.9 PYMES' citada como el párrafo de fecha de autorización para publicación en la NIIF para las Pymes. No logré verificar la numeración contra el texto oficial del Anexo 2 (Decreto 2483 de 2018). La contraparte NIC 10 §17 sí quedó verificada.
- governance-specialist.prompt.ts:185 y :250 — 'NIC 24 §13-22' como rango de revelaciones de partes vinculadas y personal clave directivo. No verifiqué párrafo por párrafo que el rango cubra exactamente las revelaciones exigidas (la compensación al personal clave y las transacciones se distribuyen en párrafos que podrían exceder el §22).
- Estado exacto de adopción en Colombia de las NIGC 1 y 2 (gestión de la calidad) y de las versiones revisadas de NIA 220, 315 (2019), 540 y 600. Encontré el proyecto de decreto de MinCIT (2022) y la recomendación del CTCP, pero no hallé decreto expedido que actualice el Anexo 4 – 2019, ni una confirmación oficial de que siga pendiente a agosto de 2026. Si ya fue expedido, las referencias del producto a 'NICC 1' y a las NIA sin versión quedarían desactualizadas.
- Conversión a UVB (Unidad de Valor Básico, Ley 2277 de 2022) de los topes de microempresa del Decreto 957 de 2019 para la clasificación del Grupo 3. Una fuente secundaria afirma que los topes hoy se miden en UVB y no en UVT; no pude confirmarlo contra el decreto reglamentario. Los valores 23.563 / 32.988 / 44.769 sí están verificados como los topes originales en UVT.
- Fecha de aplicación de la NIIF 17 en Colombia (Decreto 1271 de 2024): las fuentes secundarias consultadas dan fechas distintas (1-ene-2027 con ESFA desde 1-ene-2026, frente a 1-ene-2028). No afecta a ninguna constante del repo hoy, pero quedará relevante si el producto atiende entidades aseguradoras.
- src/lib/accounting/chart-of-accounts/types.ts:12 y rag-export.ts:82 — afirmación de que el Decreto 2706 de 2012 es la 'base PUC PYMES'. No pude confirmar si el anexo del Decreto 2706/2012 contiene efectivamente un catálogo de cuentas. Sí está confirmado que ese decreto corresponde al Grupo 3 (microempresas), no al Grupo 2, y que sus párrafos 1.1 a 1.4 fueron derogados por el Decreto 1670 de 2021.
- src/lib/accounting/tax-engine/constants.ts:51 y estatuto-tributario.ts:569 — referencias a la 'providencia CE 30229 del 02-jun-2026' del Consejo de Estado que habría restablecido tarifas del Decreto 0572/2025 desde el 01-jul-2026. Queda fuera de mi dominio (NIIF) y no la verifiqué; la señalo porque la auditoría previa dejó ese decreto marcado como litigioso y el valor sigue codificado.

<details><summary>Fuentes consultadas (21)</summary>

- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=76745 — Decreto 2420 de 2015 (Gestor Normativo, Función Pública)
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=174053 — Decreto 1670 de 2021 (Gestor Normativo)
- https://niif.com.co/decreto-2420-2015/normatividad-grupo-1 — texto compilado art. 1.1.1.1 DUR 2420 (ámbito Grupo 1)
- https://actualicese.com/archivo/simplificacion-contable-modificaciones-al-dur-2420-y-al-marco-normativo-para-el-grupo-3/ — Decreto 1670/2021: nuevo art. 1.1.3.1, art. 1.1.2.1 y derogatoria de párrafos del Anexo 3
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=94550 — Decreto 957 de 2019 (clasificación por ingresos de actividades ordinarias, Cap. 13 Decreto 1074/2015)
- https://dapre.presidencia.gov.co/normativa/normativa/DECRETO%200701%20DEL%2007%20DE%20JULIO%20DE%202026.pdf — Decreto 0701 del 7 de julio de 2026
- https://siemprealdia.co/colombia/contabilidad/decreto-0701-de-2026-enmiendas-niif-grupo-1-y-2/ — análisis del Decreto 0701/2026 (enmiendas incorporadas y vigencia 9-jul-2026)
- https://www.ambitojuridico.com/noticias/blog-contable-yo-tributario/decreto-701-de-2026-modificacion-de-los-marcos-contables-de — Ámbito Jurídico sobre Decreto 701/2026
- https://www.mincit.gov.co/normatividad/proyectos-de-normatividad/proyectos-de-decreto-2026/28-04-2026-pd-normas-y-enmiendas-niif.aspx — proyecto de decreto MinCIT (NIIF 18 y enmiendas NIIF 7/9), comentarios hasta 13-may-2026
- https://incp.org.co/publicaciones/2026/05/se-incorporaria-la-niif-18-al-marco-normativo-contable-colombiano/ — NIIF 18: obligatoria 1-ene-2028, anticipada voluntaria 1-ene-2027
- https://incp.org.co/publicaciones/infoincp-publicaciones/informacion-para-empresas/2026/06/ctcp-somete-a-discusion-publica-la-tercera-edicion-de-la-niif-para-pymes/ — tercera edición NIIF PYMES en discusión pública, vigencia propuesta 2028
- https://www.ctcp.gov.co/noticias/2025/sale-a-la-luz-la-tercera-edicion-de-la-niif-para-l — CTCP sobre la tercera edición de la NIIF para las PYMES (feb-2025)
- https://www.mincit.gov.co/temas-interes/convergencias-niifs-y-nias/normatividad-vigente — MinCIT, normatividad vigente de convergencia (decretos modificatorios del DUR 2420)
- https://www.icjce-madrid.org/nic-12 — NIC 12: párrafo 12 (reconocimiento pasivo impuesto corriente) vs párrafo 80 (componentes del gasto a revelar)
- https://www.icac.gob.es/sites/default/files/2023-12/NIC%2012.noviembre%2023.Regl%202023-2468.pdf — texto oficial NIC 12
- https://nexiamya.com.co/vigencia-decreto-2650-de-1993-puc/ — CTCP Concepto 2018-0157: cada entidad define su propio catálogo de cuentas bajo NIIF
- https://incp.org.co/publicaciones/infoincp-publicaciones/2022/09/decreto-modificaria-las-normas-internacionales-de-aseguramiento/ — proyecto de actualización del Anexo 4 (NIGC 1/2, NIA 220/315/540/600 revisadas)
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=76026 — Anexo 4 del Decreto 2420 de 2015 (Normas de Aseguramiento de la Información)
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=169128 — Decreto 938 de 2021
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=253256 — Decreto 1271 de 2024 (NIIF 17)
- https://www.ctcp.gov.co/publicaciones-ctcp/presentaciones/2019/panel-niif-16-capitulo-medellin/4-lhmm-presentacion-niif-16 — CTCP: NIIF 16 vigente en Colombia desde 1-ene-2019, deroga NIC 17

</details>

### Impuesto sobre la renta de personas jurídicas (Colombia, año gravable 2026)

La tarifa general del 35% (Art. 240 E.T.) está correcta en todo el repo y la UVT 2026 = $52.374 (Res. DIAN 000238 del 15-dic-2025) también se verificó como exacta; la renta presuntiva al 0% desde 2021 y el umbral de la TTD al 15% están bien codificados, y el bloqueo del Decreto 1474/2025 (emergencia económica tumbada por la Corte) es materialmente correcto. El problema está en el catálogo normativo que alimenta los dictámenes: las tarifas especiales del Art. 240 quedaron congeladas en su redacción pre-Ley 2277/2022 (editoriales al 0% cuando el par. 7 dice 15%; hoteles al 9% cuando el par. 5 dice 15%), las sobretasas sectoriales se atribuyen todas al par. 2 sin los umbrales de renta gravable en UVT que las condicionan (120.000 UVT financiero, 30.000 UVT hidroeléctricas, 50.000 UVT hidrocarburos/carbón) y extienden indebidamente la sobretasa hidroeléctrica a "acueductos". Falta por completo la sobretasa del par. 3 (petróleo crudo CIIU 0610 y carbón CIIU 0510/0520), que puede llevar la tarifa hasta el 50%. La fórmula de la Utilidad Depurada del par. 6 está mal transcrita: invierte el signo de las diferencias permanentes y omite VIMPP, VNGO y C, lo que sesga sistemáticamente el impuesto adicional por tasa mínima. Adicionalmente, ni el catálogo ni el motor de caja fiscal modelan el anticipo del Art. 807 E.T., por lo que las proyecciones de salida de caja hacia la DIAN se subestiman.

| Sev | Concepto | Ubicación | En el repo | Según la norma | Norma |
|---|---|---|---|---|---|
| P0 | Tarifa de renta de empresas editoriales (Ley 98 de 1993) | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178` | 'Editoriales 0% (Ley 98/1993).' | 15% — parágrafo 7 del Art. 240 E.T.: la tarifa del impuesto sobre la renta de las empresas editoriales constituidas en Colombia como personas jurídicas cuya actividad económica y objeto social sea exc | Art. 240 par. 7 E.T., adicionado por el Art. 10 de la Ley 2277 de 2022 (antes par. 4 al 9%). Concepto DIAN 11622 de 2023. |
| P0 | Entrada de catálogo de la Ley 98 de 1993 (ley del libro) — tarifa de renta de editoriales | `src/lib/agents/financial/escudo-survival/normative/catalog/leyes-reformas.ts:100` | titulo: 'Ley del libro — tarifa renta 0% para editoriales'; resumen (línea 102): 'Establece el beneficio de tarifa cero (0%) en renta para empresas editoriales | La tarifa aplicable no la fija hoy la Ley 98 de 1993 sino el par. 7 del Art. 240 E.T.: 15%. Adicionalmente el beneficio solo cobija a personas jurídicas cuya actividad económica Y objeto social sea EX | Art. 240 par. 7 E.T. (Art. 10 Ley 2277 de 2022); Ley 98 de 1993 como norma de remisión subjetiva. |
| P0 | Sobretasa a la generación de energía eléctrica con recursos hídricos (alcance subjetivo y umbral) | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:197` | 'Par. 2 Art. 240: sobretasa entidades financieras, aseguradoras, bolsa de valores y reaseguradoras +5pp = 40% hasta 2027. Sobretasa hidroeléctricas y acueductos | La sobretasa de 3 puntos está en el PARÁGRAFO 4 (no el 2) del Art. 240 E.T., aplica únicamente a personas jurídicas cuya actividad económica principal sea la generación de energía eléctrica A TRAVÉS D | Art. 240 par. 4 E.T. (Art. 10 Ley 2277 de 2022); Sentencia C-389 de 2023 (exequibilidad condicionada: la sobretasa solo grava la actividad de generación hídrica); Sentencia C-050 de 2026 (exequible; el umbral de 30.000 UVT responde a capacidad contributiva). |
| P0 | Condición de aplicación de la sobretasa del 5% al sector financiero | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178` | 'financieras/seguros/bolsa/reaseguros +5pp = 40% hasta 2027 (par. 2 del Art. 240)' — sin condición alguna. Se repite en normative/catalog/index.ts:70 ('par. 2 s | Los 5 puntos adicionales (tarifa total 40%) para instituciones financieras, aseguradoras y reaseguradoras, sociedades comisionistas de bolsa de valores, comisionistas agropecuarios, bolsas de bienes y | Art. 240 par. 2 E.T. (Art. 10 Ley 2277 de 2022), años gravables 2023 a 2027. |
| P0 | Sobretasa del par. 3 Art. 240 E.T. — extracción de petróleo crudo y de carbón | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178` | 'Sobretasas vigentes: hidroeléctricas +3pp = 38% hasta 2026; financieras/seguros/bolsa/reaseguros +5pp = 40% hasta 2027' — enunciado como lista cerrada de sobre | El parágrafo 3 del Art. 240 E.T. impone puntos adicionales variables a las personas jurídicas que desarrollen las actividades CIIU 0610 (extracción de petróleo crudo) y CIIU 0510/0520 (extracción de h | Art. 240 par. 3 E.T. (Art. 10 Ley 2277 de 2022); Decreto 261 de 2023 y Decreto 242 de 2024 (precios promedio y percentiles). |
| P0 | Fórmula de la Utilidad Depurada (UD) de la Tasa de Tributación Depurada — tasa mínima del 15% | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:483` | 'UD = Utilidad Depurada (UAI − INCRGNO − rentas exentas − diferencias permanentes + gastos no deducibles)' | UD = UC + DPARL − INCRNGO − VIMPP − VNGO − RE − C, donde UC = utilidad contable o financiera antes de impuestos; DPARL = diferencias permanentes consagradas en la ley que AUMENTAN la renta líquida (se | Art. 240 par. 6 E.T., adicionado por el Art. 10 de la Ley 2277 de 2022; Concepto Unificado DIAN 202(006038) de 2024 (metodología TTD). |
| P1 | Tarifa de renta de servicios hoteleros, parques temáticos, ecoturismo y agroturismo | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178` | 'Hoteles 9% (par. 5 del mismo artículo).' | 15% por 10 años — par. 5 del Art. 240 E.T.: rentas provenientes de servicios prestados en nuevos hoteles, hoteles remodelados/ampliados y parques temáticos de ecoturismo y/o agroturismo, construidos e | Art. 240 par. 5 E.T., modificado por el Art. 10 de la Ley 2277 de 2022. |
| P1 | Entrada de catálogo de la ley de turismo — tarifa reducida hotelera | `src/lib/agents/financial/escudo-survival/normative/catalog/leyes-reformas.ts:90` | 'La tarifa reducida del 9% para hoteles está en el parágrafo 5 del Art. 240 E.T.' | El parágrafo 5 del Art. 240 E.T. vigente fija 15%, no 9%. | Art. 240 par. 5 E.T. (Art. 10 Ley 2277 de 2022). |
| P1 | Sujetos excluidos de la tasa mínima de tributación (par. 6 Art. 240 E.T.) | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:483` | La entrada de catálogo no enumera ninguna exclusión: 'TTD = ID/UD ≥ 15% ... Vigente desde año gravable 2023.' | El par. 6 no aplica a: sociedades constituidas como ZESE durante el período en que su tarifa de renta es 0% (Ley 1955/2019 Art. 268); sociedades beneficiarias del incentivo ZOMAC; contribuyentes de lo | Art. 240 par. 6 E.T. (Art. 10 Ley 2277 de 2022). |
| P1 | Anticipo del impuesto de renta del año siguiente (Art. 807 E.T.) | `src/lib/agents/financial/escudo-survival/fiscal-anchor/calculator.ts:12` | 'F04 = F02 − F03  (positivo = a pagar, negativo = saldo a favor Art. 850).' — la posición fiscal proyectada se compone solo del impuesto de referencia menos ret | Los contribuyentes del impuesto sobre la renta deben liquidar un anticipo del impuesto del año siguiente equivalente al 25% en el primer año en que declaran, 50% en el segundo y 75% a partir del terce | Art. 807 E.T. (cálculo y aplicación del anticipo). |
| P2 | Constante de tarifa para la provisión contable del impuesto de renta | `src/lib/accounting/adjustments/provisions/income-tax.ts:75` | /** Tasa renta 2026 — Art. 240 E.T. */ export const INCOME_TAX_RATE_2026 = '0.350000'; // 35.0000%  — aplicada de forma plana sobre la utilidad contable antes d | El 35% es correcto solo como tarifa general. El Art. 240 E.T. contempla además: 9% (par. 1, empresas industriales y comerciales del Estado con monopolio rentístico), 15% (par. 5 hoteles/ecoturismo y p | Art. 240 E.T. y Art. 240-1 E.T. (Arts. 10 y 11 Ley 2277 de 2022). |
| P2 | Base sobre la que se aplica la tarifa del 35% en la proyección de salidas fiscales del cockpit | `src/app/workspace/comando/page.tsx:106` | const taxOutflowMes = Math.max(0, ct.utilidadNeta * 0.35) / 12;  // comentario: 'impuesto renta proyectado en mayo del año siguiente' | La tarifa del Art. 240 E.T. se aplica sobre la renta líquida gravable, que parte de la utilidad ANTES de impuestos (Arts. 26 y 178 E.T.), no sobre la utilidad neta (que ya está depurada del impuesto). | Arts. 26, 178 y 240 E.T. |
| P2 | Renta presuntiva como criterio de determinación del impuesto de PJ | `src/lib/agents/prompts/tax-agent.prompt.ts:81` | '**Renta Personas Juridicas**: Tarifa 35%, presuntiva vs ordinaria, descuentos tributarios, compensacion de perdidas' | El porcentaje de renta presuntiva es 0% desde el año gravable 2021 (0,5% en 2020). No existe comparación 'presuntiva vs ordinaria' para el AG 2026: la renta presuntiva se reporta en cero. El repo ya l | Art. 188 E.T., modificado por el Art. 90 de la Ley 2010 de 2019. |
| P2 | Megainversiones y descuento del 50% de ICA presentados como reformas vigentes | `src/lib/agents/prompts/tax-agent.prompt.ts:78` | Bajo el encabezado '### 3. Reformas Tributarias Vigentes': '- **Ley 2010 de 2019**: Mega-inversion, descuento de ICA en renta, normalizacion' | El régimen de megainversiones (Arts. 235-3 y 235-4 E.T.) fue derogado por la Ley 2277 de 2022, salvo derechos adquiridos de quienes obtuvieron la calificación antes de su entrada en vigencia. El descu | Ley 2277 de 2022 (derogatorias); Art. 115 E.T.; Arts. 235-3 y 235-4 E.T. derogados. |
| P3 | Entrada de jurisprudencia sobre la caída de la emergencia económica 2025-2026 | `src/lib/agents/financial/escudo-survival/normative/catalog/jurisprudencia.ts:19` | fecha: '2026-01-01'; tesis: 'Declara INEXEQUIBLE el Decreto 1474 de 2025 que declaró emergencia económica y estableció medidas tributarias temporales (sobretasa | El decreto que DECLARÓ el Estado de Emergencia Económica, Social y Ecológica fue el Decreto 1390 del 22 de diciembre de 2025; el Decreto 1474 del 29 de diciembre de 2025 fue el decreto legislativo de | Decreto 1390 de 2025 (declaratoria); Decreto 1474 de 2025 (medidas tributarias); Sentencias C-075 de 2026 y C-079 de 2026, Corte Constitucional. |

**No verificables contra fuente en esta pasada.**

- src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:178 — 'Zonas francas: régimen híbrido Ley 2277/2022 (20% sobre renta de exportación + 35% otras)'. La estructura dual es correcta (Art. 240-1 E.T., Art. 11 Ley 2277/2022, exequibilidad condicionada en Sentencia C-384 de 2023, que preserva el régimen del Art. 101 Ley 1819/2016 para quienes cumplieron condiciones antes del 13-dic-2022). Lo que NO logré verificar es cómo opera el requisito del plan de internacionalización y anual de ventas para el año gravable 2026, dado que la norma lo ancló a acuerdos suscritos en 2023 o 2024; el catálogo no lo documenta y no pude acceder al texto literal vigente del Art. 240-1 ni a la reglamentación posterior.
- src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:374 (ART_254_ET) — 'Exceso aplicable hasta 4 años siguientes' para el descuento por impuestos pagados en el exterior. No pude confrontar el texto literal del Art. 254 E.T. vigente (estatuto.co devolvió 403 y secretariasenado.gov.co no respondió), por lo que el plazo de arrastre y el alcance exacto de la ampliación a dividendos de fuente extranjera introducida por la Ley 2277/2022 quedan sin verificar.
- src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:463 (ART_258_1_ET) — atribución del descuento del 100% del IVA en activos fijos reales productivos a modificaciones de la Ley 2010/2019 y la Ley 2155/2021. Verifiqué que el descuento sigue vigente al 100% y que el tope del Art. 258 no lo cobija, pero no pude confirmar que la Ley 2155 de 2021 haya modificado efectivamente el Art. 258-1.
- Puntos adicionales concretos de la sobretasa del par. 3 Art. 240 E.T. (petróleo crudo y carbón) aplicables al AÑO GRAVABLE 2026. Dependen del decreto anual de precios promedio y percentiles; solo pude verificar los decretos 261 de 2023 y 242 de 2024. El decreto correspondiente a 2026 no fue localizado en esta auditoría, por lo que cualquier cifra que el sistema emita para ese sector en 2026 es no verificable hoy.
- Identidad exacta de la Sentencia C-079 de 2026 citada en jurisprudencia.ts:14. Las fuentes secundarias asocian la caída de la declaratoria de emergencia (Decreto 1390 de 2025) a la Sentencia C-075 de 2026 y el comunicado No. 15 del 15-abr-2026 a la C-079 de 2026, pero no logré abrir el texto de ninguna de las dos para confirmar cuál recae sobre el Decreto 1474 de 2025. La conclusión sustantiva (medidas no vigentes en 2026) sí está verificada.
- src/lib/agents/financial/tax-planning/prompts/tax-optimizer.prompt.ts:45 — 'SIMPLE 1,2%-14,5% por grupo (Arts. 903-916 — estructura Ley 2155/2021 revivida por Sentencia C-540/2023)' y 'Art. 245 no residentes = 20%'. Ambos quedan fuera del dominio de renta de personas jurídicas del régimen ordinario y no los verifiqué; deben auditarse en sus dominios respectivos (Régimen Simple y pagos al exterior).
- src/lib/agents/financial/escudo-survival/fiscal-agent/tools/ccv-calculator.ts:37-45 — el impuesto adicional por TTD se estima con la UAI contable como proxy de la Utilidad Depurada, con la advertencia en el código de que 'la TTD real usa Utilidad Depurada (UD), no UAI bruta'. No pude verificar si el 'Módulo 8 (Supervivencia)' al que el comentario delega el cálculo refinado implementa efectivamente la fórmula legal de UD; si no lo hace, el sesgo del proxy nunca se corrige y la cifra llega al usuario como 'impuesto adicional estimado'.

<details><summary>Fuentes consultadas (23)</summary>

- https://actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas/ — tarifa general PJ 2026 = 35% (Art. 240 E.T. mod. Art. 10 Ley 2277/2022)
- https://www.contadia.com/estatuto-tributario/articulo-240-tarifa-general-para-personas-juridicas — texto vigente Art. 240 E.T., parágrafos 1 a 7 (sobretasas, umbrales UVT, tarifas especiales)
- https://leyes.co/se_expide_el_estatuto_tributario_de_los_impuestos_administrados_por_la_direccion_general_de_impuestos_nacionales/240.htm — Art. 240 E.T. vigente 2026
- https://leyes.co/se_expide_el_estatuto_tributario_de_los_impuestos_administrados_por_la_direccion_general_de_impuestos_nacionales/188.htm — Art. 188 E.T. renta presuntiva
- https://leyes.co/se_expide_el_estatuto_tributario_de_los_impuestos_administrados_por_la_direccion_general_de_impuestos_nacionales/807.htm — Art. 807 E.T. cálculo y aplicación del anticipo
- https://www.corteconstitucional.gov.co/relatoria/2023/c-389-23.htm — Sentencia C-389/23 (sobretasa hidroeléctricas, par. 4 Art. 240, exequible condicionada)
- https://gestornormativo.creg.gov.co/gestor/entorno/docs/C-050_2026.htm — Sentencia C-050/26 (sobretasa hidroeléctricas, umbral 30.000 UVT, exequible)
- https://www.corteconstitucional.gov.co/relatoria/2023/c-384-23.htm — Sentencia C-384/23 (Art. 240-1 zonas francas, exequibilidad condicionada)
- https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883 — Ley 2277 de 2022 (Gestor Normativo, Función Pública)
- https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0242_2024.htm — Decreto 242 de 2024 DIAN (puntos adicionales par. 3 Art. 240: carbón CIIU 0510/0520 y petróleo crudo CIIU 0610)
- https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/ — UVT 2026 = $52.374 (Res. DIAN 000238 del 15-dic-2025)
- https://actualicese.com/uvt-2026/ — UVT 2026 $52.374, variación IPC 5,17% sobre UVT 2025 $49.799
- https://actualicese.com/esta-sera-la-nueva-tarifa-del-impuesto-de-renta-para-empresas-editoriales/ — editoriales pasan de 9% (par. 4) a 15% (par. 7) por Ley 2277/2022
- https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_11622_2023.htm — Concepto DIAN 11622 de 2023 (tarifa 15% empresas editoriales)
- https://www.consultorcontable.com/tasa-minima-de-tributacion-paragrafo-6-art-240-et/ — fórmulas par. 6 Art. 240: TTD=ID/UD, UD=UC+DPARL−INCRNGO−VIMPP−VNGO−RE−C, IA=(UD×15%)−ID, sujetos excluidos
- https://actualicese.com/rutas/books/tasa-minima-de-tributacion-normativa-calculos-y-obligados/page/capitulo-1-generalidades — exclusiones de la tasa mínima (ZESE, ZOMAC, par. 5 hoteles, par. 7 editoriales, UD ≤ 0)
- https://www.hklaw.com/en/insights/publications/2026/01/nuevas-medidas-tributarias-en-colombia-para-2026-declaratoria — Decreto 1474 de 2025 (medidas tributarias de la emergencia económica, sobretasa financiera 50%)
- https://www.semana.com/amp/economia/macroeconomia/articulo/con-la-caida-de-la-emergencia-economica-en-la-corte-que-sigue-ahora-con-los-impuestos/202657/ — caída de la emergencia económica ante la Corte Constitucional
- https://www.infobae.com/colombia/2026/04/09/la-corte-constitucional-tumbo-la-emergencia-economica-decretada-por-el-gobierno-petro/ — 9-abr-2026: Corte declara inexequible el Decreto 1390 de 2025 (declaratoria de emergencia), Sentencia C-075 de 2026
- https://incp.org.co/wp-content/uploads/2026/04/Comunicado20de20prensa20No.201520de20202620C3A2C280C29320Corte20Constitucional.pdf — Comunicado de prensa No. 15 del 15-abr-2026 (Sentencia C-079/26)
- https://poderlegislativo.camara.gov.co/2025/12/23/hundida-ley-de-financiamiento/ — hundimiento de la Ley de Financiamiento en diciembre de 2025 (no hubo reforma que cambiara la tarifa 2026)
- https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/07/gobierno-nacional-saliente-radico-proyecto-de-reforma-tributaria-ante-la-camara-de-representantes/ — proyecto de reforma radicado el 20-jul-2026 (aún no es ley; no afecta AG 2026)
- https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/07/se-declaro-exequible-la-sobretasa-del-5-aplicable-a-empresas-del-sector-asegurador-y-bursatil/ — jul-2026: exequibilidad de la sobretasa del 5% sector asegurador y bursátil

</details>
