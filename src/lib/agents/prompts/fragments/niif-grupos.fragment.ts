// src/lib/agents/prompts/fragments/niif-grupos.fragment.ts
//
// Criterios vigentes de los grupos de preparadores de información financiera
// (DUR 2420 de 2015) para los prompts del chat. Espejo del bloque del
// pipeline financiero (src/lib/agents/financial/prompts/colombia-2026-context.ts):
// ambas superficies deben decir lo mismo.
//
// Fuentes:
//  - Grupo 1: Art. 1.1.1.1 DUR 2420/2015 — emisores de valores, entidades de
//    interés público y entidades con planta de personal > 200 trabajadores o
//    activos totales > 30.000 SMMLV que ADEMÁS cumplan uno de los parámetros de
//    vínculo con NIIF plenas o comercio exterior (> 50 %). Los ingresos NO son
//    criterio del Grupo 1.
//  - Grupo 3: Art. 1.1.3.1 DUR 2420/2015 modificado por el Decreto 1670 de
//    2021 (vigente desde el 01-ene-2023), que reemplazó los criterios de tamaño
//    del Decreto 2706/2012 (10 trabajadores, 500 SMMLV de activos, 6.000 SMMLV
//    de ingresos). Topes de microempresa: Decreto 1074/2015 adicionado por el
//    Decreto 957 de 2019.

export function niifGruposBlock(): string {
  return `| Grupo | Criterio vigente (DUR 2420/2015) | Marco Normativo |
|-------|-----------------|-----------------|
| **Grupo 1** | Emisores de valores; entidades de interes publico; y entidades con planta de personal > 200 trabajadores o activos totales > 30.000 SMMLV que ADEMAS cumplan uno de estos parametros: subordinada o sucursal de compania extranjera que aplique NIIF plenas; subordinada o matriz de compania nacional que aplique NIIF plenas; matriz, asociada o negocio conjunto de entidades extranjeras que apliquen NIIF plenas; importaciones o exportaciones > 50% de las compras o ventas del ano anterior (Art. 1.1.1.1). Los ingresos NO son criterio del Grupo 1. | NIIF Plenas (NIC/NIIF completas) |
| **Grupo 2** | No cumplen criterios de Grupo 1 ni Grupo 3 (o Grupo 3 que opta voluntariamente) | NIIF para PYMES (35 secciones) |
| **Grupo 3** | Art. 1.1.3.1 mod. Decreto 1670 de 2021 (vigente desde 01-ene-2023). Deben cumplirse TODOS: ingresos ordinarios del ano anterior dentro de los topes de microempresa del Decreto 957 de 2019 (manufacturero <= 23.563 UVT; servicios <= 32.988 UVT; comercio <= 44.769 UVT); sin inversiones en subsidiarias, negocios conjuntos ni asociadas; sin obligacion de presentar estados consolidados, combinados o separados; sin pagos basados en acciones; sin planes de beneficios post-empleo de beneficios definidos; no ser cooperativa de ahorro y credito. | Contabilidad Simplificada (Anexo 3 del DUR 2420/2015) |

Los criterios de tamano del Decreto 2706 de 2012 (10 trabajadores, 500 SMMLV de activos, 6.000 SMMLV de ingresos) fueron reemplazados por el Decreto 1670 de 2021: no los uses para clasificar. If faltan datos para clasificar (planta, activos, vinculos, comercio exterior, ingresos por macrosector) then pidelos otherwise clasifica citando el articulo del DUR 2420/2015.`;
}
