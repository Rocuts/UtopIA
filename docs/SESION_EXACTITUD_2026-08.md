# Sesión de exactitud estructural — 2026-08-07/08

Objetivo: que "los números salgan bien" deje de ser una aspiración y pase a ser una propiedad
verificable del sistema. Punto de partida: `main` en `bafcbc69`, 1928 tests verdes,
[auditoría integral](AUDITORIA_INTEGRAL_2026-08.md) y [normativa](AUDITORIA_NORMATIVA_2026-08.md)
recién cerradas.

La sesión empezó midiendo, no construyendo. Ver [FASE0_MEDICION_2026-08.md](FASE0_MEDICION_2026-08.md).

---

## Lo que la medición cambió

La hipótesis de partida era que la exactitud es probabilística porque **el LLM autora cada cifra**.
La medición con LLM real sobre el balance del único cliente del repo, tres corridas, tolerancia $0:

| | Resultado |
|---|---|
| Anclas cruzadas contra `buildReportAnchors` | **9/9 exactas en las tres corridas** |
| Desviación del modelo en cifras ancla | **cero** |
| Renglones del Activo que faltaron | **0,10% · 41,2% · 99,9%** según la corrida |

El modelo **sí copia** los tokens `[MoneyCop: N]`. Lo que varía salvajemente entre corridas —sobre
el mismo balance— es **qué renglones imprime**. En la tercera corrida el Estado de Situación
Financiera lista dos renglones por $3.905.924,28 bajo un total de $4.185.978.841,16: la sección de
activo corriente entera desaparece.

Y por debajo apareció algo anterior al LLM: el preprocesador leía **Pasivo e Ingresos en negativo**
en el único export de ERP real del repo, y el informe declaraba una **pérdida de $2.630M para una
empresa que ganó $2.228M**.

---

## Lo que entró

### 1. Convención de signos (`sign-convention.ts`)

Los ERP colombianos exportan en convención NATURAL (magnitudes por naturaleza) o ALGEBRAICA
(débitos +, créditos −). `parseTrialBalanceCSV` sólo normalizaba en la rama débito/crédito, que es
inalcanzable en cuanto el archivo trae cualquier columna que `isBalanceHeader` reconozca — es decir,
casi siempre, incluido el CSV de los conectores Siigo y Odoo.

Detector: en convención algebraica la suma de los saldos hoja es ~0 por partida doble, **excluyendo
el grupo PUC 36** (el balance típico publica el resultado en 3605 *y* los movimientos que lo
producen; contar ambos rompe la identidad por el monto exacto de la utilidad). Medido: 0,12%–0,24%
del activo frente a 156%–191% en natural.

La conversión es una **negación** de las clases 2/3/4, nunca `Math.abs` por cuenta: 11 de las 26
cuentas de clase 2 del balance real llevan saldo débito legítimo (IVA descontable, retenciones a
favor).

Verificado adversarialmente por tres escépticos independientes con lentes distintas (parser,
contable, reproducción): **3/3 CONFIRMADO**, y los tres ampliaron el alcance respecto de lo que yo
había medido.

### 2. Reconciliador determinista (`agents/reconcile-anchors.ts`)

Corre tras la respuesta del LLM y antes de validar.

- **Sobrescribe** el tríptico patrimonial (activo/pasivo/patrimonio) de forma atómica. Es seguro
  porque el preprocesador cumple `A = P + K` por construcción.
- **No sobrescribe** utilidad neta ni efectivo de cierre: cuelgan de la cascada del P&L (E4) y de
  `cashOpening + netChange` (E2). Cambiarlas aisladas sería cambiar una mentira por otra. Se
  reportan y las ataca la reparación.
- **Detecta** que el desglose impreso no suma el total — el fallo que realmente ve el cliente.
- **Registra** cada desviación: primera medición de la obediencia real del modelo.

### 3. Bucle de reparación acotado

Un reintento, dentro de `runNiifAnalyst` y justo después de Pass-1 —que es donde nace el desglose—
con la brecha exacta en pesos inyectada en el prompt. Se conserva el intento con menos descuadre.
Repararlo tras el reensamblaje obligaría a repetir los tres pases.

### 4. El artefacto cambia

- Sello **"REPORTE CON SALVEDADES"** en el cuerpo del Markdown, no como evento SSE: así viaja al
  informe consolidado, al HTML y al PDF sin que ninguna superficie tenga que acordarse de mirar un
  flag. La auditoría integral ya había verificado que los `warning` SSE mueren en el navegador.
- **Descarga bloqueada** cuando `reconciliation.clean === false`, con el motivo en `title` y
  `aria-label`.
- `auditReportEmittable` cableado en `prepareFinancialContext` en modo pre-vuelo (nueva opción
  `skipReportTextChecks`, porque en Stage 0 aún no hay informe y V10 dispararía siempre). Es la
  única función que atraviesan tanto el camino legacy como el partido.

### 5. Una sola definición de "renglón de detalle" (`contracts/statement-lines.ts`)

Compartida por E15 y el reconciliador. **Ya no se filtra por `level`**: medido, el mismo encabezado
salió con level 3, 1 y 0 en tres corridas. El código PUC sí es estable.

### 6. Golden test + corpus patológico

`src/__tests__/golden-anclas-todas-las-superficies.test.ts` parte del balance real, lo preprocesa, y
verifica que cada ancla aparece byte-idéntica en Markdown, PDF Élite y Excel. **No mockea agentes**
— el e2e anterior mockeaba los tres con cifras sin relación con el CSV y luego afirmaba igualdad
contra sus propios mocks.

Corpus de seis balances patológicos con aserciones incondicionales: pérdida con patrimonio negativo,
sin comparativo, algebraico frente a su gemelo natural, cifras sobre 2^53 centavos, descuadrado en
origen, cuentas de orden. El corpus encontró de inmediato un hueco en el detector que los dos
fixtures anteriores no exponían.

---

## Re-medición con el reconciliador activo (2026-08-08)

Honestidad sobre lo que el bucle de reparación consigue y lo que no.

El bucle **dispara**: en la corrida 1 detectó 1 discrepancia y reinvocó Pass-1 con la brecha exacta
inyectada; en la corrida 2, dos. El coste está dentro del presupuesto (458s frente a 323–348s sin
reparación, contra un techo de 800s en el route).

Pero **la reparación no reparó**. El informe final de la corrida 1 seguía con el desglose del Activo
en dos renglones por $46.073.407,76 bajo un total de $4.185.978.841,16. Dicho de otro modo: darle al
modelo la brecha en pesos y pedirle que añada los renglones que faltan **no basta**.

Lo que sí cambió es el artefacto: la reconciliación queda `clean: false`, el informe sale sellado
como **REPORTE CON SALVEDADES** y la descarga está bloqueada. El cliente ya no recibe un informe
incorrecto — recibe uno que declara que no es firmable. Es una mejora real en confiabilidad, y **no**
una mejora en capacidad.

Y la re-medición encontró un defecto en lo que se acababa de construir: el Pasivo salió con los dos
encabezados de sección y **ningún renglón**, y ni E15 ni el reconciliador dijeron nada, porque ambos
hacían `if (count === 0) continue`. Esa exención venía de que todos los fixtures del validador traían
`liabilities: []` — el fixture convertía la peor forma del defecto en la forma neutra por defecto.
Corregido: un total material sin un solo renglón se reporta ahora como brecha del 100%.

### La conclusión estructural, y lo que se hizo con ella

Los renglones de los estados financieros **no deberían autorarlos el modelo**. El preprocesador ya
tiene el corte por clase y grupo en centavos exactos; el desglose del Balance no es un juicio
contable, es una proyección determinista del balance. Mientras el modelo autore las filas, el techo
del sistema es "detecta el descuadre y se niega a entregar", no "entrega bien".

Así que se movió la frontera. `contracts/deterministic-breakdown.ts` agrupa las cuentas auxiliares
por grupo PUC de dos dígitos con etiquetas NIIF, y **la suma de sus renglones es el total de la clase
por construcción**. Las correctoras reducen su grupo en vez de aparecer como renglón negativo suelto,
que es el importe en libros neto que exigen NIC 16.73 y NIIF PYMES 17.31.

El orden de remedios en `runNiifAnalyst` queda:

1. **Completar el desglose desde el preprocesador.** Determinista, gratis, cierto.
2. **Gastar el reintento del modelo sólo en lo que el código no puede corregir** sin autorar
   contabilidad: la utilidad neta y el efectivo de cierre, que cuelgan de la cascada del P&L y del
   EFE.
3. **Sellar y bloquear** lo que sobreviva a los dos.

Se conserva la etiqueta que escribió el modelo cuando su código coincide con el grupo —la redacción
NIIF es suya, la aritmética no— y un desglose que ya cuadra no se toca, porque su granularidad suele
ser mejor que la agregación por grupo.

Qué le queda al modelo: la clasificación corriente / no corriente donde el plazo no se deduce del
código PUC, la etiqueta de cada rubro y toda la narrativa. No se le quitó criterio; se le quitó la
aritmética, que es donde falla.

---

## Auth: por qué NO se activó BetterAuth

Investigación con verificación contra la base de producción (consultas de solo lectura):

- El cursor de drizzle está en `0006_banking` con 7 filas en `__drizzle_migrations`; la tabla
  `subscription` no existe. `npm run db:migrate` contra producción HOY corre 12 migraciones en UNA
  transacción sobre una DB construida con `db:push`: **falla garantizado**.
- Activar el secret **no cierra por sí solo la frontera de tenant**: 13 Server Actions de
  contabilidad sin gate de sesión, `getAuthSession()` degrada a anónimo ante cualquier excepción, y
  `requireWorkspace()` no filtra por `user_id IS NULL` en el camino cookie.
- En producción hay 52 workspaces y sólo 1 tiene `user_id`.

Alcance real: **3-5 días con al menos una ventana de riesgo alto sobre la DB de producción**.
Corrección de la premisa: `utopia_workspace_id` es un UUIDv4 (122 bits), httpOnly, sameSite=lax,
secure — no es adivinable por fuerza bruta. El problema es que es un bearer **sin binding a
identidad**, con vigencia de cinco años, y cuyo valor viaja al cliente en el body de
`GET /api/workspace`.

Lo que sí entró es el paquete de endurecimiento que cabe sin tocar la DB de producción ni el env de
auth, y que además es prerequisito del flip.
