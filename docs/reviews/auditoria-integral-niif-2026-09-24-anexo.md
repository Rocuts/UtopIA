# Anexo — índice de hallazgos confirmados (auditoría integral 2026-09-24)

Complementa [el informe](auditoria-integral-niif-2026-09-24.md). Incluye los hallazgos confirmados por la verificación
adversarial (duplicados absorbidos en su hallazgo canónico) y los de la re-auditoría sobre el código corregido. El
estado sale de los reportes de corrección de cada paquete y de las olas de integración posteriores; "corregido"
significa cambio con prueba de regresión (o, para rótulos y documentación, cambio verificado por la suite).
Los títulos son los del auditor (abreviados); los hallazgos de seguridad se describen en términos genéricos.

Resumen de estado: Corregido: 259; Corregido en parte (ver Pendientes): 10

| ID | Área | Severidad | Hallazgo | Estado |
|---|---|---|---|---|
| auditoria-calidad-01 | auditoria-calidad | crítica | El acta de asamblea muestra una pérdida neta como 'Utilidad Neta del Ejercicio' positiva | Corregido |
| contab-nomina-01 | contab-nomina | crítica | Reverso deja el libro con efecto neto −original: el original pasa a status=reversed y queda fuera de todos los filtros status=posted, mientras el reverso sí… | Corregido |
| e2e-niif-01 | re-auditoría e2e-niif | crítica | Un renglón del LLM rotulado 'UTILIDAD NETA DEL PERÍODO' sustituye el total determinista del ERI: una pérdida de $40M sale como utilidad de $40M en PDF, Excel… | Corregido |
| ingesta-01 | ingesta | crítica | El rawData que la UI envía al pipeline NIIF no es re-parseable: el informe corre sin preprocesado ni totales vinculantes | Corregido |
| ingesta-03 | ingesta | crítica | XLSX: forcePeriod por hoja colapsa columnas multiperiodo; la última columna de saldo sobrescribe (2024 etiquetado como 2025) | Corregido |
| ingesta-05 | ingesta | crítica | XLSX → CSV sin escapar celdas: una coma en el nombre de cuenta desplaza columnas y cambia saldos en silencio | Corregido |
| ingesta-06 | ingesta | crítica | Encabezados 'Saldo Inicial … Saldo Final': el saldo inicial se toma como cifra del periodo (upload) o el saldo final se descarta (API v1) | Corregido |
| ingesta-13 | ingesta | crítica | Aislamiento de sesiones de conectores ERP entre empresas | Corregido |
| niif-preproceso-07 | niif-preproceso | crítica | La API pública v1 persiste y devuelve status 'balanced' calculado después del tapón de R8, aunque el balance de prueba no cuadre | Corregido |
| pipeline-flujo-01 | pipeline-flujo | crítica | Âncora 'vacío' con ceros sentinela se presenta como dato real: dashboard con $0 y Score NIIF 80/100 inventado | Corregido |
| ratios-kpis-01 | ratios-kpis | crítica | Áreas Valor, Verdad y Futuro muestran KPIs fijos del mockup como si fueran del cliente | Corregido |
| ratios-kpis-02 | ratios-kpis | crítica | Escudo: 'Tasa Efectiva de Tributación' muestra F10 (cobertura de retenciones) con tendencia y saldos a favor ficticios | Corregido |
| ratios-kpis-03 | ratios-kpis | crítica | Comando, Sentinel y ERP: el mes comparativo sobrescribe al actual (etiqueta de periodo = año) y el balance usa solo movimientos del mes | Corregido |
| ratios-kpis-05 | ratios-kpis | crítica | EBITDA: cuatro fórmulas distintas; la tarjeta y el PDF omiten el impuesto 5405 y la depreciación de ventas 5260 | Corregido |
| ratios-kpis-06 | ratios-kpis | crítica | Comando con datos reales: el treemap DuPont muestra segmentos inventados | Corregido |
| reportes-export-01 | reportes-export | crítica | PDF Élite imprime los TOTALES en valor absoluto: una pérdida neta, un EBIT negativo y un patrimonio negativo salen como cifras positivas | Corregido |
| tributario-modulos-01 | tributario-modulos | crítica | F03 suma a 'retenciones de renta' subcuentas de 1355 que no son crédito de renta (135510 anticipo ICA, 135530 impuestos descontables, 135525, 135520, 135595)… | Corregido |
| valoracion-01 | valoracion | crítica | ValorArea: 'VALOR DE SALIDA · DCF' muestra promedio de EV/EBIT×6 y patrimonio contable (sin DCF, sin restar deuda), con tendencia, múltiplo y WACC fijos | Corregido |
| NM-01 | re-auditoría normativa-metricas | alta | Dos bases de anualización: monthsCovered sólo reconoce 'AAAA-MM'; el preprocesador (mesesDelPeriodo) reconoce 'AAAA-Qn', rangos y rangos incompletos | Corregido |
| NM-04 | re-auditoría normativa-metricas | alta | Excel (pestañas KPIs y Resumen) y apéndice del PDF usan snapshot.summary previo al curator: Total Activo/Pasivo distintos del balance y del PDF cuando R1 rec… | Corregido |
| NM-05 | re-auditoría normativa-metricas | alta | Sin grupo 54 el Escudo persiste una alerta CRÍTICA 'Provisionar impuesto de renta' con impacto = F02 = 35 % × UAI | Corregido |
| V7a-extra-01 | verificación | alta | Las subpáginas de área montadas son maquetas estáticas con cifras literales sin rótulo de demo. En El Escudo: saldo a favor $890M, ahorro $420M, TEF 24 %, TE… | Corregido |
| auditoria-calidad-04 | auditoria-calidad | alta | Si falla el Revisor Fiscal, la opinión formal se inventa a partir del score de los otros auditores | Corregido |
| auditoria-calidad-07 | auditoria-calidad | alta | La Auditoría Parte IV corre sólo sobre el contenido NIIF (sin Estrategia ni Gobierno) y sin contexto del preprocesador | Corregido |
| contab-nomina-02 | contab-nomina | alta | PDF de cierre mensual: la consulta de saldos suma movimientos de TODOS los períodos, borradores y reversados (filtro de período en el ON del LEFT JOIN) | Corregido |
| contab-nomina-04 | contab-nomina | alta | El cierre mensual traslada el resultado a patrimonio dentro del mismo período: los KPI y el P&L de todo mes cerrado quedan en cero; la clase 7 va directo a p… | Corregido |
| contab-nomina-05 | contab-nomina | alta | El paso runAdjustments del cierre postea depreciación/amortización sin actualizar el activo, y provisiones sin idempotencia: se deprecia para siempre y se du… | Corregido |
| contab-nomina-06 | contab-nomina | alta | Seed de provisiones laborales incoherente con el PUC del propio repo: base 0 para la nómina real y pasivos/gastos con otro significado (renta → IVA generado) | Corregido |
| contab-nomina-09 | contab-nomina | alta | Conciliación bancaria compara el movimiento del período del libro con el saldo final acumulado del extracto (y el último extracto de cualquier período) | Corregido |
| contab-nomina-18 | contab-nomina | alta | PUC sembrado contradice el PUC Decreto 2650 y a otros módulos del repo (IVA en 2404, ICA en 2408, 2365 bajo grupo 24, 236510, 5160) | Corregido |
| e2e-niif-02 | re-auditoría e2e-niif | alta | Renglones sin código del ERI de nivel ≤ 2 con cifra libre: 'EBITDA $55.555.555,00' dentro del Estado de Resultados (el determinista es −$20.000.000) | Corregido |
| e2e-niif-03 | re-auditoría e2e-niif | alta | Regresión: /consolidate cablea detectInflatedCash (en cuarentena por 'ROTO'), que lee '4.2' del encabezado '### 4.2 Saldo Inicial Depurado'. Todo informe hon… | Corregido |
| e2e-niif-04 | re-auditoría e2e-niif | alta | Regresión: /consolidate lee '($20.000.000,00)' como +$2.000.000.000 y declara 'Ecuación contable descuadrada': ningún informe honesto con patrimonio negativo… | Corregido |
| e2e-niif-05 | re-auditoría e2e-niif | alta | Renglones del ESF no anclados por grupo PUC (salvo el 11): el LLM mueve importes entre 13 y 15 o entre 21 y 22, y también en la columna comparativa, sin sello | Corregido |
| e2e-niif-06 | re-auditoría e2e-niif | alta | Renglones del ERI no anclados: ingresos 41 y costo 61 inflados en la misma cifra, o 51↔52, pasan con UB/EBIT/UN intactos. El mismo PDF imprime dos 'ingresos' | Corregido |
| e2e-niif-07 | re-auditoría e2e-niif | alta | EFE: E18 cruza subtotales pero no renglones ni rótulos. Se exportan una depreciación inflada y una 'distribución a los accionistas' fabricada | Corregido |
| e2e-niif-08 | re-auditoría e2e-niif | alta | ECP: E19 cruza sólo el total de apertura. El LLM desplaza componentes de apertura y fabrica dividendos y capitalización con total 0 | Corregido |
| ingesta-02 | ingesta | alta | parseNumber interpreta números crudos con >2 decimales como separador de miles: XLSX con resultados de fórmula se inflan ×10^n | Corregido |
| ingesta-04 | ingesta | alta | XLSX multihoja: hojas del mismo año se pisan y mezclan cuentas; hojas sin año eligen el periodo primario por orden alfabético | Corregido |
| ingesta-08 | ingesta | alta | Detección de columnas frágil (tildes, Windows-1252, filas de título): el balance no se preprocesa y el upload lo oculta | Corregido |
| ingesta-10 | ingesta | alta | API v1 `rows` no normaliza la convención de signos; la misma data por `csv` da totales distintos | Corregido |
| ingesta-14 | ingesta | alta | Siigo (alliances), Alegra, World Office, SAP B1, Dynamics y Odoo arman el 'balance de prueba' sólo con movimientos del mes (sin saldo inicial) | Corregido en parte (ver Pendientes) |
| niif-contrato-01 | niif-contrato | alta | Utilidad Bruta y EBIT anclados incluyen los ingresos NO operacionales (grupo 42) y el validador obliga a presentarlos así | Corregido |
| niif-contrato-02 | niif-contrato | alta | El EFE que emite el LLM no se cruza contra el EFE determinista: secciones reclasificadas, efectivo inicial inventado o dividendos fabricados pasan todos los… | Corregido |
| niif-contrato-03 | niif-contrato | alta | EFE determinista ('EFE VINCULANTE'): apropiación de reservas y capitalización de utilidades (no monetarias) se presentan como flujos de financiación | Corregido |
| niif-contrato-04 | niif-contrato | alta | Dividendos decretados y pagados en el mismo año se presentan como 'partida no monetaria' en operación y el prompt afirma que no hubo distribución | Corregido |
| niif-preproceso-06 | niif-preproceso | alta | R8 absorbe cualquier residual de A − P − K en la cuenta virtual 3710VC y el Bridge lo vuelve no bloqueante hasta max(1% del activo, $1M) | Corregido |
| niif-preproceso-13 | niif-preproceso | alta | Mapeo de capital contrario al PUC: 3105 (Capital suscrito y pagado) se publica como 'capitalAutorizado' y capitalSuscritoPagado queda vacío para SAS y SA | Corregido |
| niif-preproceso-15 | niif-preproceso | alta | EFE (R2): los 'dividendos estimados' restan la utilidad del año en vez de sumar el traslado de la utilidad previa, y R6 compensa en actividades de operación | Corregido |
| niif-preproceso-17 | niif-preproceso | alta | R4 'Pasivo fiscal oculto' compara todo el grupo 24 (IVA, ICA…) contra 35% de la utilidad NETA: falso crítico con impuesto correctamente causado y silencio co… | Corregido |
| niif-preproceso-26 | niif-preproceso | alta | R12 (libros no cerrados → V12 'nunca emitible') ignora periodoTipo y sólo mira 36+37: bloquea cortes parciales legítimos y no detecta años cerrados con 3705… | Corregido |
| pipeline-flujo-02 | pipeline-flujo | alta | Pre-vuelo de emitibilidad: V15 se evalúa sobre texto vacío y sella CON SALVEDADES todo balance de un solo periodo | Corregido |
| pipeline-flujo-03 | pipeline-flujo | alta | Sin preprocesado en /governance el acta no se reconcilia y el gate de exportación la acepta (flujo UI principal y reanudación tras recarga) | Corregido |
| pipeline-flujo-05 | pipeline-flujo | alta | Estrategia: dashboard, KPIs, DuPont, gate de liquidez, punto de equilibrio y proyecciones sin ninguna validación determinista post-LLM | Corregido |
| pipeline-flujo-07 | pipeline-flujo | alta | Exportación PDF/Excel mezcla fuentes: estados desde el JSON (balance ajustado) y KPI grid/cascada/diales/anexo/KPIs deterministas desde rawData re-preprocesa… | Corregido |
| prompts-normativa-01 | prompts-normativa | alta | Causal de disolución por pérdidas DEROGADA (Arts. 457 num. 2, 458 y 459 C.Co.) usada en notas al cliente y en la conclusión NIA 570 | Corregido |
| prompts-normativa-02 | prompts-normativa | alta | Umbral SAGRILAFT erróneo: 160.000 UVT ($8.379.840.000) en vez de 40.000 SMMLV / 4.929.017 UVB (CE 100-000020 de 2026) | Corregido |
| prompts-normativa-03 | prompts-normativa | alta | El auditor tributario (Dictamen 2) calcula la TTD como impuesto contable / UAI y emite 'cumple / no_cumple' | Corregido |
| prompts-normativa-07 | prompts-normativa | alta | El Auditor Legal (Dictamen 3) contradice a Governance y a Supersociedades: reserva legal obligatoria en SAS, Art. 5 Ley 1258 y Art. 36-3 E.T. para capitaliza… | Corregido |
| prompts-normativa-11 | prompts-normativa | alta | presentation-v3 clasifica cuentas de CAPITAL del PUC (3115 aportes sociales, 3120, 3130...) como componentes de ORI y usa saldos acumulados como ORI del periodo | Corregido |
| ratios-kpis-04 | ratios-kpis | alta | ct.ingresos (Σ clase 4 = bruto + devoluciones + no operacionales) se usa como 'Ingresos' y denominador en PDF, Excel, pilares y dashboard | Corregido |
| ratios-kpis-07 | ratios-kpis | alta | ROE y apalancamiento con patrimonio negativo: pérdida publicada como ROE +451% vinculante | Corregido |
| ratios-kpis-09 | ratios-kpis | alta | Índice de Consistencia (Verdad) cuenta cada pasivo normal y cada cuenta correctora como 'signo incorrecto' | Corregido |
| ratios-kpis-10 | ratios-kpis | alta | Métricas fiscales heurísticas en pilares y Sentinel: 35% sobre utilidad neta, PUC 24 con IVA y valores inventados con pérdida | Corregido |
| ratios-kpis-12 | ratios-kpis | alta | kpis/mocks.ts alcanzable en producción: /workspace/verdad muestra mockCompliance (95/100) o un proxy engañoso (25/100) | Corregido |
| ratios-kpis-13 | ratios-kpis | alta | Puente P&L de /workspace/comando doble-cuenta financieros e impuestos y usa el saldo del pasivo 24 | Corregido |
| recalculo-03 | recalculo | alta | P&G del periodo principal publicado ACUMULADO cuando el comparativo no se cerró: utilidad 2025 $2.228.496.789,73 frente a $655.775.316,77 del ejercicio | Corregido |
| recalculo-07 | recalculo | alta | Selección de hojas ignora filas Cuenta/Grupo sin descendientes: balance exportado a 4 dígitos queda en $0 y cuentas huérfanas se descartan | Corregido |
| recalculo-08 | recalculo | alta | R5 ancla el patrimonio a un desglose parcial (sin 32/34/35/38/3795) cuando no hay P&G: rompe una ecuación que cuadraba | Corregido |
| reportes-export-03 | reportes-export | alta | PDF de cierre mensual recalcula estados con filtros por signo, Math.abs y truncamiento: Activo ≠ Pasivo + Patrimonio y líneas que no suman el total | Corregido |
| reportes-export-04 | reportes-export | alta | PDF Élite, panel derecho de Balance y ERI: en informes comparativos la cifra titular es la del periodo ANTERIOR, sin etiqueta | Corregido |
| reportes-export-05 | reportes-export | alta | Diales del PDF imprimen el valor recortado y ceros sustitutos: razón corriente 10,00 aparece como '5.00', N/D como '0.00' | Corregido |
| tributario-calc-01 | tributario-calc | alta | Art. 36-3 E.T. (DEROGADO por el art. 96 de la Ley 2277 de 2022) usado como base de una capitalización de utilidades 'INCRGNO' con impuesto del socio = $0 | Corregido |
| tributario-calc-02 | tributario-calc | alta | Calculadora de sanciones: los contratos de entrada (tool LLM, API REST y voz) descartan saldoAFavor, netEquityPriorYear y correccionStage | Corregido |
| tributario-modulos-02 | tributario-modulos | alta | F04 = UAI contable × 35% − F03 se presenta como 'saldo a favor' (Art. 850) y dispara recomendación de devolución: se confunde UAI con renta líquida y se omit… | Corregido |
| tributario-modulos-11 | tributario-modulos | alta | Dictamen del revisor fiscal: si fallan los evaluadores el fallback declara 'Sin incorrecciones materiales' y nada impide opinión LIMPIA; materialInAggregate/… | Corregido |
| tributario-modulos-13 | tributario-modulos | alta | Reglas procedimentales incorrectas en el constructor de cartas DIAN y la cabecera del Agente Fiscal (pliego de cargos, requerimiento ordinario, reducción Art… | Corregido |
| valoracion-02 | valoracion | alta | Página Macroeconomía: indicadores fijos y desactualizados atribuidos a 'Banco de la República, DANE — Actualizado 9 jun 2026' | Corregido |
| valoracion-03 | valoracion | alta | Página /workspace/valor/valoracion: valoración demo fija ($4.820M, WACC 13,2%, g 3,0%, pasos 'done') sin rotular | Corregido |
| valoracion-11 | valoracion | alta | Strategy Director: el renderer pierde el signo del saldo final de caja del año +3, de los KPI en COP y del punto de equilibrio (PDF/Excel) | Corregido |
| NM-02 | re-auditoría normativa-metricas | media | 'ROE Dinámico' del pilar Valor no se anualiza ni respeta el N/D del preprocesador | Corregido |
| NM-03 | re-auditoría normativa-metricas | media | 'Margen Neto Real' resta de la utilidad el monto de las reclasificaciones R1 de balance; el PDF imprime dos márgenes netos | Corregido |
| NM-06 | re-auditoría normativa-metricas | media | Lista blanca de crédito de renta implementada 6 veces (trial-balance, credito-renta, bindings, R4, R10, R16) con resultados distintos | Corregido |
| NM-07 | re-auditoría normativa-metricas | media | Binding del LLM sin EBITDA, margen bruto, capital de trabajo ni ciclo, y N/D sin el motivo que el preprocesador sí calculó | Corregido |
| NM-08 | re-auditoría normativa-metricas | media | Prompt de reserva de contingencia: reserva legal 'OBLIGATORIA' para cualquier sociedad y capital suscrito = 3115 | Corregido |
| NM-09 | re-auditoría normativa-metricas | media | Chat contable calcula KPIs con fórmulas distintas a las vinculantes | Corregido |
| NM-10 | re-auditoría normativa-metricas | media | Corpus RAG con normas superadas: bases 27/4 UVT, exenta laboral pre-Ley 2277, ZOMAC/IMR/ZF erróneos y Art. 36-3 sin nota | Corregido |
| auditoria-calidad-02 | auditoria-calidad | media | Dictámenes 2, 3 y 4 pierden el signo de brecha, posición fiscal neta, utilidad neta/disponible e IVA neto | Corregido |
| auditoria-calidad-03 | auditoria-calidad | media | Opinión de auditoría y sello de calidad no están condicionados a la integridad aritmética determinista | Corregido |
| auditoria-calidad-10 | auditoria-calidad | media | overallScore/grade del LLM no se validan y la PDF muestra un veredicto distinto al sello v2.1 | Corregido |
| auditoria-calidad-11 | auditoria-calidad | media | La meta-auditoría nunca recibe el preprocesador; D14=100 por defecto infla Actualidad y Comparabilidad | Corregido |
| auditoria-calidad-12 | auditoria-calidad | media | Reglas de opinión no conformes a NIA 705: crítico ⇒ adversa mecánica; conteo ≥3 ⇒ adversa | Corregido |
| auditoria-calidad-18 | auditoria-calidad | media | Dos 'dictámenes del Revisor Fiscal' independientes (acta y auditoría) pueden contradecirse | Corregido |
| auditoria-calidad-20 | auditoria-calidad | media | Dictamen 4: anticipo de renta al 75% sin descontar retenciones y 'sanción por mora' bajo el Art. 641 | Corregido |
| auditoria-calidad-21 | auditoria-calidad | media | Score global de auditoría renormalizado: con 3 de 4 auditores fallidos se publica 100/100 y opinión favorable | Corregido |
| auditoria-calidad-22 | auditoria-calidad | media | Cuenta 1805 rotulada 'impuesto diferido activo' y sumada a la posición fiscal neta | Corregido |
| auditoria-calidad-23 | auditoria-calidad | media | Indicadores de riesgo DIAN del Dictamen 4 distintos a la spec y agregación contradictoria | Corregido |
| contab-nomina-03 | contab-nomina | media | Cierre mensual falla con el PUC sembrado: busca 360500 (el seed trae 360505/361005) y no envía centro de costo/tercero en cuentas que lo exigen | Corregido |
| contab-nomina-07 | contab-nomina | media | Provisiones automáticas cobran salud 8,5 % y SENA+ICBF (parafiscales 9 %) sin la exoneración del Art. 114-1 E.T. | Corregido |
| contab-nomina-08 | contab-nomina | media | Intereses sobre cesantías: base configurada sobre el pasivo 261020 y cálculo solo de saldo débito → siempre 0 | Corregido |
| contab-nomina-10 | contab-nomina | media | El matcher bancario puede asignar la misma línea contable a varios movimientos bancarios en una corrida | Corregido |
| contab-nomina-11 | contab-nomina | media | Tolerancia de conciliación de max($1.000; 0,1 % del saldo): diferencias grandes no bloquean y el estado queda "balanced" | Corregido |
| contab-nomina-12 | contab-nomina | media | Partida doble: el validador trunca la 3.ª decimal pero se persiste el string crudo en NUMERIC(20,2), que redondea → líneas descuadradas con cabecera cuadrada | Corregido |
| contab-nomina-14 | contab-nomina | media | Depreciación ignora fecha de adquisición y método: deprecia activos adquiridos después del período y calcula línea recta aunque el activo diga accelerated/units | Corregido |
| contab-nomina-15 | contab-nomina | media | Amortización de diferidos: el residuo de redondeo y los meses no corridos nunca se amortizan (el saldo queda en el activo) | Corregido |
| contab-nomina-16 | contab-nomina | media | Base de provisiones incluye asientos en borrador | Corregido |
| contab-nomina-17 | contab-nomina | media | Saldos iniciales: la cuenta balanceadora 3705 no es postable en el PUC sembrado y el diseño cuadra en patrimonio hasta un 30 % de cuentas desconocidas | Corregido |
| contab-nomina-19 | contab-nomina | media | Costo laboral en producción (/api/pyme/empleados): exoneración 114-1 incondicional, sin tope IBC de 25 SMMLV y sin salario integral | Corregido |
| contab-nomina-20 | contab-nomina | media | Aporte del dueño independiente: cita norma inexequible (Ley 1955 art. 244), 40 % sin costos presuntos, sin tope 25 SMMLV ni FSP | Corregido en parte (ver Pendientes) |
| contab-nomina-21 | contab-nomina | media | Documento RAG de retención laboral (Arts. 383-388) con topes obsoletos: renta exenta 25 % "240 UVT/mes" y límite "1.340 UVT mensuales" | Corregido |
| e2e-niif-09 | re-auditoría e2e-niif | media | Rótulos del LLM sin validar: fechas de otro periodo en el ECP, cuentas mal rotuladas y 'ganancia' en una pérdida | Corregido |
| e2e-niif-10 | re-auditoría e2e-niif | media | Notas de los estados y notas técnicas (Pass-3) con cifras falsas: se exportan sin validar y sin el aviso de narrativa IA | Corregido |
| e2e-niif-11 | re-auditoría e2e-niif | media | HTML emitible con cifras falsas en prosa o abreviadas: pérdida $4M (real $40M), EBITDA positivo, ROE 25 % y corte 2024 | Corregido |
| e2e-niif-12 | re-auditoría e2e-niif | media | Subtotales sin código del ESF con el signo invertido pasan (se compara el valor absoluto) | Corregido |
| e2e-niif-13 | re-auditoría e2e-niif | media | /html devuelve 400 siempre desde la UI: el company que envía PipelineWorkspace (effectiveCompany) no trae `signatories` y CompanyInfoSchema la exige | Corregido |
| e2e-niif-14 | re-auditoría e2e-niif | media | Parte II: rótulos o KPIs fuera de la regex y tendencias con comparativo se declaran 'no verificables' y se exportan con signo o cifra falsos | Corregido en parte (ver Pendientes) |
| e2e-niif-15 | re-auditoría e2e-niif | media | Centro de Alertas (enlazado desde el Insight Inbox del header) muestra 6 alertas fijas como 'detectadas por la IA' con cifras del cliente y sin rótulo de demo | Corregido |
| ingesta-07 | ingesta | media | 'Saldo Débito / Saldo Crédito' con tilde se interpretan como dos periodos: pasivo y patrimonio del periodo actual quedan en 0 | Corregido |
| ingesta-09 | ingesta | media | 'Saldo Anterior' (apertura del periodo) se etiqueta como año previo: el P&G comparativo sale 0 en vez de N/D | Corregido |
| ingesta-11 | ingesta | media | Balances 'por tercero': NIT/cédula en la columna código se suma como cuenta PUC | Corregido |
| ingesta-12 | ingesta | media | Códigos repetidos: el CSV los suma y el XLSX conserva el último | Corregido |
| ingesta-15 | ingesta | media | isAuxiliary = code.length >= 6 duplica saldos cuando el ERP entrega informes jerárquicos (subcuenta + auxiliares) | Corregido |
| ingesta-16 | ingesta | media | trialBalanceToCSV serializa importes float crudos: la suma de centavos se infla al re-parsear (ruta ERP → pipeline) | Corregido |
| ingesta-17 | ingesta | media | Los conectores sólo entienden 'YYYY-MM': los periodos anuales y trimestrales generan fechas NaN | Corregido |
| ingesta-18 | ingesta | media | La ingesta ERP no llega a los informes: la UI de sync siempre da 400, el cron y el webhook descartan el resultado y el pipeline nunca recibe conexiones | Corregido en parte (ver Pendientes) |
| ingesta-21 | ingesta | media | query_erp: el 'Resultado operacional' ignora la clase 7 y usa valores absolutos; los conectores intercambian la clase 5 (gastos) y la 6 (costos) | Corregido |
| ingesta-24 | ingesta | media | Extracto CSV en orden descendente: endingBalance toma la fila más antigua del último día y el control de continuidad da falsos avisos | Corregido |
| ingesta-25 | ingesta | media | Extracto CSV: se ignora la columna de naturaleza (D/C) y un débito exportado con signo negativo invierte el movimiento | Corregido |
| ingesta-27 | ingesta | media | Saldos de apertura: hasta 30% de las cuentas puede omitirse y el descuadre se absorbe en 3705 y se postea | Corregido |
| ingesta-28 | ingesta | media | Saldos de apertura XLSX: se concatenan todas las hojas y una copia del balance duplica el asiento sin error | Corregido |
| niif-contrato-05 | niif-contrato | media | EFE determinista no devuelve a operación la amortización acumulada (1597, 1698, 1798) ni el deterioro (1599); incluye un prefijo inexistente ('1595') | Corregido |
| niif-contrato-06 | niif-contrato | media | Subtotales del ESF (activo/pasivo corriente y no corriente) y encabezados con monto no se validan; el PDF los imprime como subtotales | Corregido |
| niif-contrato-07 | niif-contrato | media | El completado determinista del ESF elimina la clasificación corriente/no corriente | Corregido |
| niif-contrato-08 | niif-contrato | media | La columna comparativa de los renglones (ESF y P&G) no está cubierta por ninguna identidad | Corregido |
| niif-contrato-09 | niif-contrato | media | Los renglones individuales del ESF no se anclan: el renglón de efectivo (11) puede diferir del efectivo final del EFE | Corregido |
| niif-contrato-10 | niif-contrato | media | Tolerancias no exactas en el ECP: E7a acepta 0,5% de la utilidad neta + $100 y E7c $1.000 por columna | Corregido |
| niif-contrato-11 | niif-contrato | media | ECP sin anclar: saldo inicial vs patrimonio comparativo/3605 real, columnas vs renglones de patrimonio del ESF y movimientos en modo legacy | Corregido |
| niif-contrato-12 | niif-contrato | media | El ORI del P&G es una cifra libre: sólo genera warning E6; oriComparative sin regla | Corregido |
| niif-contrato-13 | niif-contrato | media | E16 usa /monto/ de cada renglón: un P&G correcto con un renglón contranatura firmado se bloquea | Corregido |
| niif-contrato-15 | niif-contrato | media | Pass-3 exige citar montos en centavos dentro de las notas y recibe anclas '$<centavos>' (contradice la corrección 8) | Corregido |
| niif-preproceso-11 | niif-preproceso | media | Detector de convención: excluir el grupo 36 rompe Σ=0 en archivos algebraicos consistentes cuando 3605 tiene saldo real, y el archivo se lee como natural | Corregido |
| niif-preproceso-12 | niif-preproceso | media | 3610 (Pérdida del ejercicio) ignorada por R8 y clasificada como 'Utilidades acumuladas': pérdida duplicada en patrimonio y +pérdida fantasma en 3710VC | Corregido |
| niif-preproceso-14 | niif-preproceso | media | R18 invoca la 'causal de disolución por pérdidas (Art. 459 C.Co.)', derogada por la Ley 2069 de 2020, y además con la fórmula invertida | Corregido |
| niif-preproceso-16 | niif-preproceso | media | EFE (R2) sólo modela los grupos 13/14/15/21-25/31-33/36-37: inversiones (12), intangibles (16), diferidos (17), otros activos (18) y pasivos 26-29 se cierran… | Corregido |
| niif-preproceso-19 | niif-preproceso | media | El detector de 'saldo a favor de renta' usa 1805 (Bienes de arte y cultura en el PUC), todo 1355 (incluye ICA, IVA retenido e impuestos descontables) y 5404… | Corregido |
| niif-preproceso-21 | niif-preproceso | media | Corriente/no corriente fijado sólo por grupo PUC, sin vencimientos: 21 siempre corriente, 28 siempre no corriente (anticipos de clientes), 12/13 siempre corr… | Corregido en parte (ver Pendientes) |
| niif-preproceso-22 | niif-preproceso | media | R1 lleva sobregiros y anticipos con saldo contrario a '2810ZZ' (grupo 28 → pasivo NO corriente) y no recalcula efectivoCuenta11 ni deudoresCuenta13 | Corregido |
| niif-preproceso-24 | niif-preproceso | media | EBIT, margen operativo y cobertura de intereses incluyen ingresos NO operacionales (grupo 42); el gasto financiero cae a todo el grupo 53 cuando falta 5305 | Corregido |
| niif-preproceso-25 | niif-preproceso | media | Días de cartera sobre todo el grupo 13 (incluye 1355 anticipos de impuestos, 1330 y 1365) y 365 días fijos incluso en cortes parciales | Corregido |
| pipeline-flujo-06 | pipeline-flujo | media | /export modo 1 (Excel full pipeline) re-parsea 'enhancedData' como CSV: el pipeline corre sin preprocesado, sin anclas y sin el gate 422 | Corregido |
| pipeline-flujo-08 | pipeline-flujo | media | El gate del HTML no detecta columnas de periodo intercambiadas ni rótulos/fecha de corte equivocados | Corregido |
| pipeline-flujo-09 | pipeline-flujo | media | Reconciliación HTML↔JSON insensible al signo; cifras de Estrategia/Gobierno y de la prosa sólo con aviso (warn) | Corregido |
| pipeline-flujo-10 | pipeline-flujo | media | /api/financial-report/html no aplica el gate aritmético servidor: un JSON NIIF que no cuadra produce HTML 'emittable' | Corregido |
| pipeline-flujo-11 | pipeline-flujo | media | Camino partido (UI): /strategy y /governance no reciben reportMode → prompts en 'COMPARATIVO_COMPLETO' para balances de un solo periodo | Corregido |
| pipeline-flujo-12 | pipeline-flujo | media | reconcileActaArithmetic no detecta una capitalización propuesta cuando el ancla dice que NO aplica | Corregido |
| pipeline-flujo-13 | pipeline-flujo | media | La exportación no cruza el JSON contra las anclas del rawData que recibe (procedencia) | Corregido |
| pipeline-flujo-14 | pipeline-flujo | media | Informe PARCIAL (Estrategia/Gobierno fallidos) exportable a PDF/Excel sin marca en el artefacto | Corregido |
| pipeline-flujo-15 | pipeline-flujo | media | Degradación silenciosa: secciones generadas con effort='low' tras fallo no se marcan en el informe | Corregido |
| pipeline-flujo-16 | pipeline-flujo | media | El camino partido omite la validación post-render del consolidado y los checks de texto V8/V9/V10 | Corregido |
| pipeline-flujo-17 | pipeline-flujo | media | Periodo: el año del intake no se contrasta con el del balance y el JSON NIIF declara su propio periodo sin validación | Corregido |
| pipeline-flujo-18 | pipeline-flujo | media | Acta: el título dice 'Capitalización 40% de utilidades retenidas acumuladas' pero la base determinista es la utilidad neta del ejercicio | Corregido |
| prompts-normativa-04 | prompts-normativa | media | La Nota 14 IFRS 18 que el prompt de Governance vuelve obligatoria para Grupo 2/3 activa el blocker V8 del gate de emitibilidad | Corregido |
| prompts-normativa-05 | prompts-normativa | media | IFRS 18 se presenta como obligatoria en Colombia desde 2027 para el Grupo 1: no está incorporada y la propuesta del CTCP es 2028 | Corregido |
| prompts-normativa-06 | prompts-normativa | media | Citas del C.Co. y de la Ley 1258 erróneas en el contexto compartido y en las 'referencias usables con seguridad' del guardarraíl | Corregido |
| prompts-normativa-08 | prompts-normativa | media | Auditor Legal: regla del Art. 155 C.Co. mal enunciada y detección frágil del tipo societario ('S.A.' se audita como SAS) | Corregido |
| prompts-normativa-09 | prompts-normativa | media | La 'Defensa Art. 647 E.T.' se usa como conclusión jurídica genérica ('no sancionable', 'anula sanción') sobre criterios contables, con doctrina no verificabl… | Corregido |
| prompts-normativa-10 | prompts-normativa | media | Impuesto de renta en el Pass-1: instrucciones contradictorias, provisión 35% × UAI calculada por el LLM y cuenta PUC 1805 con tres significados | Corregido |
| prompts-normativa-13 | prompts-normativa | media | Convocatoria del acta citada siempre por el Art. 424 C.Co., también en SAS (Art. 20 Ley 1258: 5 días hábiles salvo estatutos) | Corregido |
| prompts-normativa-14 | prompts-normativa | media | Pasivos laborales: el prompt manda repartir el saldo de la Clase 25 en 38,17 / 4,58 / 38,17 / 19,08 % cuando no hay auxiliares | Corregido |
| prompts-normativa-15 | prompts-normativa | media | Conocimiento NIIF: deterioro PYMES descrito como pérdida esperada, activos contingentes 'posibles' y tasa de NIIF 16 incompleta | Corregido |
| prompts-normativa-16 | prompts-normativa | media | Chat contable: criterios de Grupo 1 inexactos y criterios de Grupo 3 derogados | Corregido |
| prompts-normativa-17 | prompts-normativa | media | Chat tributario: beneficios derogados presentados como vigentes, plazo de devolución con garantía erróneo y tasa moratoria mal definida | Corregido en parte (ver Pendientes) |
| prompts-normativa-18 | prompts-normativa | media | El corpus RAG en producción conserva el régimen de dividendos derogado y la lectura anual del tope de 100 UVT del Art. 771-5 que anuló el Consejo de Estado | Corregido |
| prompts-normativa-20 | prompts-normativa | media | Dictamen del revisor fiscal: empresa en marcha y asuntos clave aplicados en contra de las NIA vigentes (570 revisada y 701) | Corregido |
| prompts-normativa-23 | prompts-normativa | media | Instrucción de citar la 'impracticabilidad' (§3.14, §10.21, §29.27, NIC 7 §50) cuando falta un dato, en contra del contrato N/D y de la REGLA 2 ('§' prohibido) | Corregido |
| ratios-kpis-08 | ratios-kpis | media | Correo de cierre mensual: los 4 KPIs de pilares se envían como 0 fijos | Corregido |
| ratios-kpis-15 | ratios-kpis | media | Liquidez con fórmulas y nombres distintos en la misma pantalla y en el PDF | Corregido |
| ratios-kpis-18 | ratios-kpis | media | Periodos parciales: días, ROA/ROE, rotación y runway no se anualizan | Corregido |
| ratios-kpis-19 | ratios-kpis | media | 'Capacidad de Inversión' con dos fórmulas y valores distintos en el mismo pilar | Corregido |
| ratios-kpis-20 | ratios-kpis | media | Series 'interpoladas' con un solo periodo: saldos de balance ÷ 12 y tendencias fabricadas | Corregido |
| ratios-kpis-21 | ratios-kpis | media | Monte Carlo: 'inversión PPE' siempre es el activo no corriente (busca clase 15, que no existe) | Corregido |
| ratios-kpis-23 | ratios-kpis | media | Entrada de montos: parseCOP y pesosToCentavos alteran cifras con formato colombiano | Corregido |
| ratios-kpis-24 | ratios-kpis | media | Prompts con fórmulas distintas a los KPIs vinculantes (EBITDA 'al centavo' sin ancla, días proveedores, ROE en chat) | Corregido |
| ratios-kpis-25 | ratios-kpis | media | Pilares: KPIs ausentes puntúan 50 y otras degradaciones silenciosas (EVA, integridad sin forense) | Corregido |
| recalculo-11 | recalculo | media | Dos EFE contradictorios en el mismo prompt: el bloque vinculante sigue declarando "AUTORIDAD" al EFE R2 (no concilia) y el gate V3 bloquea con él | Corregido |
| recalculo-final-01 | re-auditoría recalculo-final | media | El score de riesgo DIAN que publica /niif (fiscalSnapshot) usa controlTotals.cents.ingresos (Σ firmada de la clase 4): el mismo balance cambia de nivel según… | Corregido |
| recalculo-final-02 | re-auditoría recalculo-final | media | El comparativo que sale de una columna 'Saldo inicial' publica el P&G en $0 y ROE/ROA en 0,0 % como vinculantes; ninguna ruta pasa openingPeriods, así que sa… | Corregido |
| recalculo-final-03 | re-auditoría recalculo-final | media | Una unidad declarada 'en miles de pesos' en el encabezado o en el título se ignora: las cifras se publican ×1/1000 sin aviso | Corregido |
| reportes-export-06 | reportes-export | media | parseCOP interpreta miles colombianos sin decimales: '850.000' → 850 y '1.234.567' → 0 en los formularios de asientos | Corregido |
| reportes-export-07 | reportes-export | media | El gate de exportación no valida líneas comparativas, subtotales sin código PUC ni renglones del ERI fuera de las clases 4–7 | Corregido |
| reportes-export-10 | reportes-export | media | Empresa, NIT y periodo del encabezado/portada no se cruzan con los del JSON de los estados | Corregido |
| reportes-export-11 | reportes-export | media | Narrativa, notas, dictamen y sello de calidad se exportan sin validar cifras ni procedencia; las notas estructuradas del JSON no se exportan | Corregido |
| reportes-export-12 | reportes-export | media | ROE/margen N/D se sustituyen por un cálculo local distinto (Excel y PDF) y el Excel compara ROE de bases distintas sin marca | Corregido |
| reportes-export-13 | reportes-export | media | EFE y ECP se exportan sin periodo comparativo aunque el informe declare comparativePeriod | Corregido |
| reportes-export-14 | reportes-export | media | Los estados exportados no declaran fecha de corte, periodo cubierto ni moneda/unidad | Corregido |
| reportes-export-15 | reportes-export | media | 'Estado de Resultados Integral' sin ORI ni resultado integral total | Corregido |
| reportes-export-16 | reportes-export | media | Citas normativas erróneas o no aplicables en el PDF editorial y subtítulos que describen otra métrica | Corregido |
| reportes-export-17 | reportes-export | media | Cuentas correctoras se imprimen como positivas: la columna del activo no suma al total | Corregido |
| reportes-export-18 | reportes-export | media | Grilla de KPIs del PDF: categorías rotuladas por posición y KPIs 10–12 descartados | Corregido |
| tributario-calc-05 | tributario-calc | media | Motor Normativo toma el dígito de verificación como 'último dígito del NIT' para el calendario | Corregido |
| tributario-calc-06 | tributario-calc | media | get_tax_calendar presenta fechas calculadas por el scraper (verified:false) como 'OFICIAL_DIAN_VERIFICADO — puedes presentarlas como definitivas' | Corregido |
| tributario-calc-07 | tributario-calc | media | Calendario nacional 2026 incompleto: sin Régimen SIMPLE, precios de transferencia, INC ni ingresos y patrimonio | Corregido en parte (ver Pendientes) |
| tributario-calc-09 | tributario-calc | media | Reglas sembradas de retención incompletas o con criterio distinto al DUR: sin compras, sin 6 % a no declarantes, honorarios por 'declarante' y sin Art. 383 p… | Corregido |
| tributario-calc-11 | tributario-calc | media | Balanza 'Régimen Simple vs Ordinario' (/workspace/pyme/pagos) muestra un 'impuesto ordinario' subestimado | Corregido |
| tributario-calc-12 | tributario-calc | media | Calculadora de sanciones sin reducción Art. 640 num. 1-2, sin corrección previa al vencimiento y sin el incremento del par. 1 del Art. 644 | Corregido |
| tributario-calc-13 | tributario-calc | media | Prompts de auditoría y planeación con cuantías de sanción desactualizadas (Art. 651 '5 %', Art. 647 'reducible al 50 %', zona franca '20 %') | Corregido |
| tributario-calc-16 | tributario-calc | media | Neteo 'determinista' del descuento Art. 257 se rotula TOTAL VINCULANTE sobre un impuesto a cargo producido por el LLM y con tope 25 % sólo para donaciones | Corregido |
| tributario-calc-17 | tributario-calc | media | Prompts ordenan emitir '0' cuando un dato fiscal no es calculable (N/D ≠ 0) | Corregido |
| tributario-modulos-03 | tributario-modulos | media | Ningún validador determinista se ejecuta en producción (survival-validators, fiscal-agent/validators, fiscal-anchor-validators); los de Capa 4 ni siquiera ac… | Corregido en parte (ver Pendientes) |
| tributario-modulos-04 | tributario-modulos | media | Agente Fiscal: montos de Conciliación, Devoluciones y Supervivencia vienen del LLM sin sobrescritura ni recomputo (incluidos los marcados 'intocables') | Corregido |
| tributario-modulos-05 | tributario-modulos | media | Score de Riesgo DIAN mostrado es el del LLM; se pierde `publicable` y el schema no admite 2 de los 7 factores deterministas | Corregido |
| tributario-modulos-06 | tributario-modulos | media | /api/escudo-survival (TET calculator) sigue calculando la TTD con el LLM ('TTD ~ TET' sobre UAI) e impuesto adicional; TET tautológica y fallback 'verde' | Corregido |
| tributario-modulos-07 | tributario-modulos | media | Anti-DIAN (bancarización Art. 771-5 §1) aplica el 40% sobre la propia caja y usa el SALDO de 1105 como 'pagos en efectivo'; costosTotales duplica la clase 6… | Corregido |
| tributario-modulos-08 | tributario-modulos | media | Planeación tributaria: 'Cálculo dual TMT' del LLM con impuesto a cargo = MAX(35% renta, 15%×UAI) y tmtAplicable=true por defecto; el 'TOTAL VINCULANTE' del A… | Corregido |
| tributario-modulos-09 | tributario-modulos | media | Precios de transferencia: umbrales de obligatoriedad con UVT 2026 fija aunque el periodo sea 2025, y conclusión del LLM sin chequeo de coherencia | Corregido |
| tributario-modulos-10 | tributario-modulos | media | Precios de transferencia: rango intercuartil, 'dentro del rango' y 'CUMPLE' los calcula el LLM (incluso con comparables simulados) y no se recalculan desde s… | Corregido en parte (ver Pendientes) |
| tributario-modulos-12 | tributario-modulos | media | Modo 'devolucion' del Agente Fiscal (ofrecido en la UI) siempre falla | Corregido |
| tributario-modulos-14 | tributario-modulos | media | Tope individual Art. 771-5 §2 descrito 'por NIT' en el Agente Fiscal, contra la sentencia 26676/2023 (se mide por transacción) | Corregido |
| tributario-modulos-15 | tributario-modulos | media | F09 (razón contable) se sigue usando como proxy de la TTD: +20 puntos 'debajo del umbral 15% de TTD' y tarjeta CCV en rojo bajo 15% con norma Art. 240 par. 6 | Corregido |
| tributario-modulos-16 | tributario-modulos | media | Planeación (Agente Fiscal, módulo 4): ahorros medidos contra F02 = UAI×35% usando deducciones ya incluidas en la UAI y con el Art. 254 dentro del tope del Ar… | Corregido en parte (ver Pendientes) |
| tributario-modulos-17 | tributario-modulos | media | Sanciones de precios de transferencia (Art. 260-11) incorrectas en los prompts del estudio | Corregido |
| tributario-modulos-18 | tributario-modulos | media | Conciliación fiscal: se cita el Decreto 2235/2017 (concesiones/APP) como reglamento del Formato 2516 y el umbral 45.000 UVT se expresa con UVT 2026 para cual… | Corregido |
| tributario-modulos-19 | tributario-modulos | media | Impuesto diferido con tarifa fija 35% para toda diferencia, sin ganancia ocasional (15%) ni tarifas especiales; Art. 137 'maquinaria 15 años'; invariantes no… | Corregido |
| valoracion-06 | valoracion | media | DCF: ninguna validación determinista post-LLM (g ≥ WACC, WACC, FCF, TV, EV y puente a patrimonio no se recalculan) | Corregido |
| valoracion-07 | valoracion | media | CAPM: Rf = TES 10Y en COP más prima EMBI cuenta dos veces el riesgo país | Corregido |
| valoracion-08 | valoracion | media | Puente EV → patrimonio: 'Equity = EV − Deuda Neta + Caja' suma la caja dos veces | Corregido |
| valoracion-09 | valoracion | media | Factibilidad: el Modelador Financiero no recibe projectData ni las instrucciones; VPN/TIR/TIRM/payback/PE son prosa del LLM sin cálculo | Corregido |
| valoracion-10 | valoracion | media | Evaluador de Riesgos: se pide un 'Monte Carlo ≥10.000 iteraciones' y P(VPN<0) sin simulación; la matriz de riesgo no se valida | Corregido |
| valoracion-12 | valoracion | media | Proyecciones y punto de equilibrio: la puerta de liquidez (AC<PC), el PE y la aritmética de escenarios quedan al criterio del LLM | Corregido |
| valoracion-13 | valoracion | media | Múltiplos: EBITDA y utilidad negativos se muestran positivos; estadísticas y rango no se contrastan con los comparables | Corregido |
| valoracion-14 | valoracion | media | Valoración: si fallan el DCF y los Múltiplos, el Sintetizador igual emite una opinión de valor 'multi-metodología' con cifras obligatorias | Corregido |
| valoracion-17 | valoracion | media | Factibilidad ZOMAC: calendario 'años 1-5: 0%… 16+: 100%' inexistente; en 2026 aplica 50% de la tarifa (micro/pequeña) hasta 2027 | Corregido |
| valoracion-18 | valoracion | media | Parámetros macro fijos en los prompts desfasados frente a sep-2026 (TRM, IBR/DTF, IPC); el servicio macro no está conectado a ningún agente | Corregido |
| valoracion-20 | valoracion | media | Strategy Director: base del impuesto proyectado incoherente (Utilidad Operativa frente a UAI) y 'TMT 15% activa' como supuesto del escenario conservador | Corregido |
| valoracion-22 | valoracion | media | Monte Carlo del Pilar Futuro: supuestos ocultos, histograma teórico (no empírico) y rótulos no sustentados | Corregido |
| valoracion-23 | valoracion | media | Escenarios (UI): 'Simulaciones tipo Monte Carlo' deterministas con 'probabilidad de éxito' inventada | Corregido |
| NM-11 | re-auditoría normativa-metricas | baja | Sentinel días de inventario sólo con la clase 6 (el preprocesador usa 6 + 7) | Corregido |
| NM-12 | re-auditoría normativa-metricas | baja | Âncora NIIF con definiciones propias (grupo 42 dentro de ganancia bruta, cartera = grupo 13, crecimiento entre periodos no comparables) | Corregido |
| NM-13 | re-auditoría normativa-metricas | baja | Textos residuales de TMT/UAI y etiquetas F01/F09 | Corregido |
| NM-14 | re-auditoría normativa-metricas | baja | Spec northstar v2.1 en 3f61fa1: el cuerpo de la Parte IV contradice las decisiones (sólo existen las enmiendas 1-2); spec v2 sin aviso | Corregido |
| NM-15 | re-auditoría normativa-metricas | baja | SAGRILAFT evalúa ingresos brutos Σ clase 4 y SMMLV 2026 fijo | Corregido |
| NM-16 | re-auditoría normativa-metricas | baja | Rutas legacy / export modo pipeline: 'TOTALES VINCULANTES' con summary pre-curator y Σ bruta de la clase 4 | Corregido |
| auditoria-calidad-08 | auditoria-calidad | baja | Redondeo por dimensión antes del umbral: 75% se aprueba y un informe con media 7,5 recibe sello CERTIFICADA | Corregido |
| auditoria-calidad-09 | auditoria-calidad | baja | Dimensiones sin dato reciben 7/10 y un 0 real se trata como 'sin dato' | Corregido |
| auditoria-calidad-13 | auditoria-calidad | baja | Dictamen 1 NIIF sin salvaguarda: 'sin salvedades' con hallazgos críticos y resumen estadístico que no cuadra con la lista | Corregido |
| auditoria-calidad-17 | auditoria-calidad | baja | El describe() del contrato de Governance (enviado al LLM) cita 'Art. 187 Ley 222/1995', prohibido por el prompt | Corregido |
| auditoria-calidad-19 | auditoria-calidad | baja | Escaneo forense devuelve score 100 'limpio' cuando las reglas fallan | Corregido |
| contab-nomina-13 | contab-nomina | baja | Inmutabilidad de períodos bloqueados no garantizada en BD: se pueden modificar/borrar líneas y pasar asientos posted→draft | Corregido |
| e2e-niif-16 | re-auditoría e2e-niif | baja | El gate de /html no considera actaQualifications ni strategyQualifications: con el acta sellada, el HTML sale emitible | Corregido |
| e2e-niif-17 | re-auditoría e2e-niif | baja | Informe comparativo con trends=null: la Parte II imprime 'Sin periodo comparativo disponible' en PDF y Excel | Corregido |
| ingesta-19 | ingesta | baja | SAP B1 y Dynamics fijan currency='COP' en el balance: la validación de moneda del HANDOFF no aplica a estos ERP internacionales | Corregido |
| ingesta-20 | ingesta | baja | Alegra y Odoo usan el ID interno como código PUC cuando falta el código (cuentas sin code o deprecadas) | Corregido |
| ingesta-29 | ingesta | baja | Saldos de apertura: la clase 9 (cuentas de orden acreedoras) se enruta como naturaleza débito | Corregido |
| niif-contrato-16 | niif-contrato | baja | Validador legacy: extractHeadlineTotal lee la última columna (comparativo) y produce un error DURO falso ECP↔Balance; la regla EFE↔Caja no coincide con 'PERÍ… | Corregido |
| niif-preproceso-05 | niif-preproceso | baja | Notación científica y signo menos Unicode devuelven NaN y la cuenta se descarta sin advertencia | Corregido |
| niif-preproceso-18 | niif-preproceso | baja | R10/V11 bloquea como 'impuesto sin causación' el caso legítimo de renta causada y compensada (2404 = 0 por cruce con anticipos o retenciones) | Corregido |
| prompts-normativa-22 | prompts-normativa | baja | 'Ingresos operacionales' = toda la Clase 4 (41 + 42) y una identidad de P&G que resta dos veces el impuesto (grupo 54 dentro de la Clase 5) | Corregido |
| recalculo-final-04 | re-auditoría recalculo-final | baja | El API v1 (/trial-balances y webhook trial_balance.processed) publica status 'balanced' para balances que /niif bloquea (CUR-R12, importes fuera del rango de… | Corregido |
| recalculo-final-05 | re-auditoría recalculo-final | baja | R12 sugiere asientos de cierre que no cuadran cuando 4175 viene con el signo del ingreso (usa la Σ firmada de la clase 4) | Corregido |
| recalculo-final-06 | re-auditoría recalculo-final | baja | La Ganancia Bruta (X01/X02) y el margen operacional del Âncora incluyen el grupo 42, en contra del ancla UB y del KPI (decisión §7) | Corregido |
| recalculo-final-07 | re-auditoría recalculo-final | baja | 'Riesgo de liquidez' (AC < PC) bloquea con 422 un balance cuadrado sin P&G; el mismo caso con P&G pasa por el Bridge | Corregido |
| tributario-calc-04 | tributario-calc | baja | Motor Normativo (cabecera de todos los módulos del Agente Fiscal) inyecta constantes 'vinculantes' desactualizadas | Corregido |
| tributario-calc-08 | tributario-calc | baja | Smart-Tax Engine: la API acepta amountIncludesTax/uvtYear pero el motor los ignora, y no expone taxTreatments | Corregido |
| tributario-calc-10 | tributario-calc | baja | Promoción Pyme → libro mayor invoca el motor tributario con la fecha de hoy y reemplaza el asiento por sólo líneas de impuesto | Corregido |
| valoracion-04 | valoracion | baja | Servicio macro: mezcla valores por defecto (ene-2026) con datos reales bajo fuente 'banrep' y con fecha de hoy | Corregido |
| valoracion-05 | valoracion | baja | Cliente BanRep/DANE: heurística %/decimal y columnas genéricas aceptan valores de otra serie o de otra escala | Corregido |
| valoracion-15 | valoracion | baja | Sintetizador: la regla de rango ni la de pesos, divergencia ni bandera roja se validan (contrato afirma lo contrario) | Corregido |
| valoracion-16 | valoracion | baja | Citas normativas erróneas en valoración: Circular 115-000011/2008 (es de Revisoría Fiscal) y Art. 90 E.T. mal resumido | Corregido |
| valoracion-19 | valoracion | baja | Analista de Mercado: clasificación MIPYME por activos (500 SMMLV) derogada y cifra calculada con el SMMLV 2025 | Corregido |
