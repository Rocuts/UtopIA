# D5.3 — Auditoría Forense Continua

**Feature flag**: `UTOPIA_ENABLE_ANOMALY_DETECTION=true`
**Cron**: `0 4 * * *` UTC (≡ 23:00 Colombia UTC-5)
**Owner**: Johan / Basilea Systems
**Estado**: Implementado (Ola 1+1 Élite)

---

## ¿Qué hace este módulo?

Un cron nocturno que escanea los `journal_lines` posteados del período activo y detecta patrones sospechosos mediante 6 reglas deterministas (sin LLM — rápidas, idempotentes, costo $0). Cuando hay anomalías con `score < 70` o al menos una `severity='high'`, dispara un email vía el canal de notificaciones (WS6).

---

## Reglas implementadas

### 1. `benford_violation` — Ley de Benford

**Algoritmo**: extrae el primer dígito significativo (1-9) de cada monto positivo (debit y credit). Construye la distribución observada de los 9 dígitos. Calcula chi-cuadrado contra la distribución esperada de Benford: `P(d) = log10(1 + 1/d)`.

| Condición | Severidad |
|-----------|-----------|
| chi² entre 11 y 15.51 | `low` |
| chi² > 15.51 (p<0.05, 8 gl) | `medium` |
| N < 50 montos | skip + warning |

**¿Qué detecta?** Creación artificial de montos (todos los meses con el mismo dígito inicial, montos "inventados" vs registros reales).

---

### 2. `numeration_gap` — Gaps en numeración

**Algoritmo**: obtiene `entry_number` de entries posteadas ordenados ASC. Detecta saltos en la secuencia.

| Condición | Severidad |
|-----------|-----------|
| gap de 1 número | `low` |
| gap de 3+ números | `medium` |

**¿Qué detecta?** Eliminación de asientos ya posteados (violación de la regla de inmutabilidad del libro mayor).

---

### 3. `weekend_posting` — Asientos en no-hábiles

**Algoritmo**: verifica si `entry_date` cae en sábado, domingo o en los 18 festivos colombianos 2026 hardcodeados (actualizados anualmente).

| Condición | Severidad |
|-----------|-----------|
| Algunos asientos en fin de semana | `low` |
| > 30% del período en no-hábiles | `high` |

**¿Qué detecta?** Posteos fraudulentos fuera de horario, ajustes no autorizados.

---

### 4. `repeated_amount` — Montos repetidos

**Algoritmo**: agrupa montos > $100.000 COP (excluyendo montos redondos comunes como $500.000, $1M, $5M). Alerta si el mismo monto exacto aparece ≥5 veces en 7 días o ≥8 veces en el período.

| Condición | Severidad |
|-----------|-----------|
| Repetición excesiva | `medium` |

**¿Qué detecta?** Fraccionamiento de pagos (smurf), errores de proceso batch, pagos ficticios repetidos.

---

### 5. `new_third_party_unverified` — Terceros nuevos

**Algoritmo**: identifica terceros que aparecen por primera vez en el libro (ninguna línea en períodos anteriores). Solo los que superan $5M COP.

| Condición | Severidad |
|-----------|-----------|
| Primera vez + monto > 5M + tiene `verified_at` | `medium` |
| Primera vez + monto > 5M + sin `verified_at` | `high` |

**¿Qué detecta?** Proveedores fantasma, desvío de fondos a nuevos beneficiarios no verificados.

---

### 6. `round_number_bias` — Sesgo de números redondos

**Algoritmo**: calcula qué porcentaje de montos termina en múltiplos exactos de $1.000. En contabilidad natural se espera ~10%.

| Condición | Severidad |
|-----------|-----------|
| > 30% redondos | `medium` |
| > 50% redondos | `high` |

**¿Qué detecta?** Estimaciones sin soporte documental, ajustes de conveniencia, registros "a ojo" en lugar de valores reales.

---

## Score de riesgo (0-100)

```
base = 100
deducción por anomalía:
  low    → -2
  medium → -6
  high   → -15
score = max(0, 100 - suma_deducciones)
```

| Score | Significado |
|-------|-------------|
| ≥ 85 | Limpio |
| 70-84 | Advertencia |
| 50-69 | Requiere revisión |
| < 50 | Alto riesgo |

---

## Cómo leer la salida (`ForensicScanResult`)

```json
{
  "workspaceId": "uuid-del-workspace",
  "periodId": "uuid-del-periodo",
  "scanStartedAt": "2026-05-05T04:00:00Z",
  "scanDurationMs": 842,
  "totalAnomalies": 3,
  "bySeverity": { "low": 1, "medium": 1, "high": 1 },
  "score": 77,
  "anomalies": [
    {
      "kind": "benford_violation",
      "severity": "medium",
      "description": "Distribución del primer dígito significativo se desvía ...",
      "affectedEntryIds": ["entry-id-1", "entry-id-2"],
      "affectedAmountCop": "12500000.00",
      "reviewUrl": "/workspace/contabilidad/asientos?period=...",
      "evidence": {
        "chiSquare": 18.4,
        "n": 312,
        "digitCounts": [45, 38, 40, 41, 40, 37, 36, 36, 39],
        "digitFrequencies": [0.144, 0.122, 0.128, 0.132, 0.128, 0.119, 0.115, 0.115, 0.125],
        "benfordExpected": [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046]
      }
    }
  ],
  "warnings": []
}
```

Los resultados se persisten en `reports` con `kind = 'forensic_scan'`. Un `idempotencyKey` garantiza que el mismo período no se escanea dos veces el mismo día.

---

## Idempotencia

Clave: `forensic:{workspaceId}:{periodId}:{YYYYMMDD}`.

Si el cron corre dos veces el mismo día (redeploy, reintentos de Vercel), el segundo pase detecta el report existente y retorna `action: 'skipped_idempotent'` sin insertar duplicados ni enviar notificaciones dobles.

---

## Encender el flag

```bash
# Local
echo 'UTOPIA_ENABLE_ANOMALY_DETECTION=true' >> .env.local

# Vercel preview/prod
vercel env add UTOPIA_ENABLE_ANOMALY_DETECTION preview
vercel env add UTOPIA_ENABLE_ANOMALY_DETECTION production
```

Requiere también `CRON_SECRET` (para autenticar el cron de Vercel) y `UTOPIA_ENABLE_NOTIFICATIONS=true` para que los emails salgan.

---

## Cómo agregar una nueva regla

1. Crear `src/lib/agents/financial/audit/forensic/rules/mi-regla.ts`.
2. Implementar `ForensicRule` (interface con `kind: AnomalyKind` y `run(input): Promise<RuleResult>`).
3. Agregar el nuevo `AnomalyKind` en `types.ts`.
4. Registrar la regla en `rules/index.ts` dentro de `ALL_RULES`.
5. Agregar tests en `__tests__/mi-regla.test.ts`.
6. Actualizar este documento.

**Principios de diseño para nuevas reglas:**
- Deterministas: mismo input → mismo output. Sin randomness, sin fecha-dependencia implícita.
- Idempotentes: correr 2 veces sobre los mismos datos produce el mismo resultado.
- Sin LLM: las reglas forenses son deliberadamente libres de LLM para garantizar velocidad, determinismo y costo cero por invocación.
- Capturadas individualmente: si una regla falla, el orchestrator la captura con `try/catch` y continúa con las demás. El fallo se registra en `warnings`.

---

## Festivos colombianos 2026 (hardcoded en `weekend-postings.ts`)

Actualizar la constante `HOLIDAYS_2026` al inicio de cada año con la resolución del Ministerio del Trabajo:

```
Año nuevo (1 ene), Reyes Magos (12 ene puente), San José (23 mar puente),
Jueves Santo (2 abr), Viernes Santo (3 abr), Día del Trabajo (1 may),
Ascensión (18 may puente), Corpus Christi (8 jun puente),
Sagrado Corazón (15 jun puente), San Pedro y Pablo (29 jun puente),
Independencia Colombia (20 jul), Boyacá (7 ago),
Asunción Virgen (17 ago puente), Día de la Raza (12 oct puente),
Todos los Santos (2 nov puente), Independencia Cartagena (16 nov puente),
Inmaculada Concepción (8 dic), Navidad (25 dic).
```
