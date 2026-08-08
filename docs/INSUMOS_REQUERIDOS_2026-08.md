# Insumos requeridos para cerrar la ola de cálculos — 2026-08-08

Qué hace falta conseguir de fuera del repositorio para poder corregir lo que encontró la
[auditoría de cálculos](AUDITORIA_CALCULOS_2026-08.md), y por qué cada cosa.

---

## A. Balances de prueba reales — lo más importante

Hoy el repositorio tiene **un solo** balance de cliente real
(`src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx`), y es **atípico en tres
dimensiones a la vez**:

| Rasgo del archivo actual | Consecuencia |
|---|---|
| `costoVentas` (clase 6) = $0 | La Utilidad Bruta casi no se ejercita, y un defecto probado —`costosTotales` duplicando clases 6 y 7— **no se dispara** |
| Sin provisión de renta (clase 54 vacía) | El impuesto del periodo vale $0: la superficie de mayor riesgo sancionatorio nunca se ejercita |
| Libros sin cerrar | Todo lo medido pasa por el Cierre Virtual (R8), que inyecta cuentas ficticias. El camino normal nunca se ha visto |

Es decir: **el archivo con el que se midió todo es benigno**, y aun así salieron 10 P0. Hay defectos
que quedan latentes ahí y reventarían con un cliente corriente.

### Lo que se pide

Cuatro balances de prueba con estos perfiles. Sirve que sean de la misma empresa en años distintos si
eso facilita conseguirlos.

| # | Perfil | Qué desbloquea |
|---|---|---|
| 1 | **Con costo de ventas real** (clase 6 > 0) — manufactura o comercializadora que registre COGS | Ejercita la Utilidad Bruta y dispara el defecto de `costosTotales` que hoy duerme |
| 2 | **Con libros cerrados** — cuenta 3605 con el resultado del ejercicio ya trasladado | Primera medición del camino que NO pasa por R8 ni por cuentas virtuales |
| 3 | **Con provisión de renta** en cuentas 54xx y contrapartida en 24xx | Único modo de validar el impuesto del periodo, la TMT y el Score de Riesgo DIAN sobre datos reales |
| 4 | **De un ERP distinto** (World Office, Helisa, Siigo, SAP, el que use el cliente) | Valida el detector de convención de signos contra un tercer formato. Hoy está calibrado con dos archivos |

**Bonus si aparece:** una **SA o LTDA** (no SAS). La reserva legal del 10% (Art. 371 C.Co.) y el
mínimo de dividendos del Art. 155 C.Co. sólo se ejercitan ahí, y el acta es de las superficies peor
calificadas de toda la auditoría.

### Formato

- Tal como los exporta el ERP, **sin retocar**: XLSX o CSV con los encabezados originales.
- **Los dos periodos** (año corriente y comparativo).
- Que no los "limpien" ni los normalicen: el valor está justamente en el formato crudo, porque es
  ahí donde estaba el defecto más grave que se corrigió (la convención de signos).

### Privacidad

Se pueden anonimizar razón social y NIT. Dos condiciones:

- El NIT sustituto debe tener **dígito de verificación válido** — el sistema lo valida contra el
  algoritmo DIAN y un NIT inválido cambia el camino que recorre el archivo.
- Los **saldos deben ser reales**. Si se escalan, dejan de ejercitar los umbrales en UVT, que es
  buena parte de lo que hay que verificar.

---

## B. Decisiones de negocio

Tres cosas que el código no puede resolver solo porque son criterio del negocio, no aritmética.

### B1 · El 40% de capitalización del acta

El sistema propone por defecto capitalizar el 40% de la utilidad. **No se encontró su fundamento**
en el repositorio ni en la normativa. ¿Es una regla del despacho, una preferencia del cliente, o
alguien lo puso arbitrariamente? De la respuesta depende si se codifica como constante, como
parámetro por empresa, o si desaparece.

### B2 · La distribución por defecto 10 / 50 / 40

Tal como está, el dividendo propuesto queda **por debajo del mínimo legal del Art. 155 C.Co.**
Medido sobre el balance real: el mínimo es $1.114.227.034,86 (50% de la utilidad) y el acta propone
$891.398.715,89 — un **déficit de $222.828.318,97**. Repartir menos del mínimo exige el voto del
**78% de las acciones**, y el prompt actual prohíbe declararlo.

Dos salidas posibles, y hay que elegir una:

- Bajar el reparto propuesto para respetar el mínimo legal, o
- Mantenerlo y que el acta **advierta expresamente** que requiere mayoría calificada del 78%.

### B3 · `estatutosRequierenReservaLegal`

Es el interruptor que decide todo el régimen de reserva legal del acta —la Ley 1258/2008 **no**
obliga a las SAS a constituirla salvo que los estatutos lo prevean— y **ningún punto del repositorio
lo escribe**: siempre llega `undefined`. Hay que decidir si se pregunta en el intake, se guarda por
empresa, o se asume un valor por defecto.

---

## C. Infraestructura

### C1 · `COHERE_API_KEY`

Sin ella, el gate de reranking del RAG es código muerto: `maybeRerank()` sale antes del filtro
`score >= MIN_RERANK_SCORE`. O se consigue la clave, o se documenta explícitamente que el único
filtro es el bi-encoder y qué se pierde con eso.

### C2 · Purga de los 1.892 chunks huérfanos

Documentos de clientes con `workspace_id NULL` en el corpus global de producción. El código ya no
los puede leer cross-tenant (se cerró el 2026-08-08), pero los datos siguen ahí. Script listo, en
dry-run por defecto:

```bash
npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.scripts.json \
  scripts/rag-purge-orphan-uploads.ts            # inventario, no borra nada
  # --borrar --confirmar 1892                    # para actuar
```

Borrar datos de producción es decisión del dueño.

### C3 · Migración `0020_workspaces_user_id_uq.sql`

Escrita y **no aplicada**, con `_journal.json` intacto a propósito. Va a mano por dos razones
independientes: `CREATE INDEX CONCURRENTLY` no puede correr dentro de un bloque transaccional, y el
migrador de drizzle envuelve todo en uno.

---

## Lo que NO hace falta

Ni accesos nuevos, ni credenciales de producción, ni permisos adicionales.

## Lo que se puede empezar sin esperar nada

Los cuatro primeros de la lista priorizada no dependen de datos nuevos:

1. La doble resta de la 4175 (`trial-balance.ts:1461-1473`) — el defecto raíz que explica cinco P0
2. La columna comparativa del Balance (`reconcile-anchors.ts:503`)
3. El bloqueo del botón de PDF (`PipelineWorkspace.tsx:1430`) — una línea
4. Las dos anclas fiscales que se calculan y se tiran (`niif-json-validator.ts:170-173`)
