// ---------------------------------------------------------------------------
// Seccion 0 — Resiliencia del Pipeline.
// Doctrina compartida que se antepone al system prompt de los agentes
// financieros y helpers de runtime para clasificar errores y formatear
// mensajes al usuario segun las reglas de la Seccion 0 v1.0 (May 2026).
//
// CONVENCION DE NOTACION (importante):
// Las variables que el LLM debe sustituir se notan con angulos al estilo XML
// (<servicio>, <paso>, <N>) en lugar de corchetes cuadrados. Esto evita que
// el sanitizador anti-placeholder downstream confunda los slots de la
// doctrina con marcadores legitimos del informe final (ver buildAntiHallu-
// cinationGuardrail.ts seccion 1). Los corchetes cuadrados estan prohibidos
// como mecanismo de plantilla en el output, pero en el system prompt usamos
// XML que el modelo interpreta sin riesgo.
//
// IDIOMA:
// La doctrina se emite siempre en espanol — es lenguaje interno del agente,
// no texto que ve el cliente. La firma del builder acepta `language` por
// uniformidad con `buildAntiHallucinationGuardrail` y `buildColombia2026
// Context`, pero el parametro se ignora intencionalmente. Si en el futuro
// se necesita una variante en ingles, anadirla aqui sin romper la firma.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clasificacion de errores (Seccion 0.2)
// ---------------------------------------------------------------------------

/**
 * Categoria de error segun la doctrina de resiliencia.
 *
 * - `A` — Transitorio (network, timeout, 5xx, 429, ECONNRESET, ETIMEDOUT,
 *         overloaded). Reintentar 3 veces; continuar con respaldo si falla.
 *         NUNCA marcar BORRADOR por TIPO A.
 * - `B` — Validacion contable (ecuacion patrimonial no cierra, EFE no
 *         concilia, ECP no balancea). Reportar como alerta visible y
 *         continuar; NUNCA marcar BORRADOR automaticamente.
 * - `C` — Dato faltante (campo null, variable no suministrada). Usar
 *         valor por defecto y registrar en Limitaciones; continuar.
 * - `D` — Critico (balance de prueba no recibido, archivo corrupto, NIT
 *         invalido). UNICA categoria que detiene el flujo y permite
 *         marcar BORRADOR.
 */
export type ResilienceErrorTier = 'A' | 'B' | 'C' | 'D';

export interface ClassifiedError {
  tier: ResilienceErrorTier;
  reason: string;
  original?: unknown;
}

/**
 * Mensaje seguro a partir de un valor unknown — espejo defensivo del
 * patron usado por `withRetry`. Nunca lanza.
 */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}

/**
 * Detecta errores transitorios (TIPO A). Las heuristicas coinciden con las
 * de `withRetry` (`src/lib/agents/utils/retry.ts`) para que el clasificador
 * y el reintentador queden alineados.
 */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429')) return true;
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
  if (msg.includes('server error') || msg.includes('internal error')) return true;
  if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('fetch failed')) return true;
  if (msg.includes('network') || msg.includes('socket hang up')) return true;
  if (msg.includes('overloaded') || msg.includes('capacity')) return true;
  if (msg.includes('connection refused') || msg.includes('connection reset')) return true;
  if (msg.includes('timeout') && !msg.includes('finish_reason')) return true;
  if (err.name === 'AbortError' && msg.includes('timeout')) return true;
  return false;
}

/**
 * Detecta fallas de validacion contable (TIPO B): ecuacion patrimonial,
 * EFE, ECP, descuadre P&L vs ECP. El validador determinista lanza
 * `BalanceValidationError`; los demas se detectan por palabras clave del
 * mensaje como guardarrail secundario.
 */
export function isAccountingValidationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'BalanceValidationError') return true;
  const msg = err.message.toLowerCase();
  if (msg.includes('ecuacion patrimonial') || msg.includes('ecuación patrimonial')) return true;
  if (msg.includes('efe no concilia') || msg.includes('efe no reconcilia')) return true;
  if (msg.includes('ecp no balancea') || msg.includes('ecp no cuadra')) return true;
  if (msg.includes('activo = pasivo')) return true;
  if (msg.includes('descuadre')) return true;
  return false;
}

/**
 * Detecta errores criticos (TIPO D) que justifican detener el pipeline.
 * La lista es deliberadamente conservadora: solo lo que verdaderamente
 * impide producir un informe (sin balance, archivo corrupto, NIT roto).
 */
export function isCriticalDataError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'CriticalDataError') return true;
  const msg = err.message.toLowerCase();
  if (msg.includes('balance de prueba') && (msg.includes('no recibido') || msg.includes('no suministrado') || msg.includes('vacio') || msg.includes('vacío'))) {
    return true;
  }
  if (msg.includes('archivo corrupto') || msg.includes('archivo corrupt')) return true;
  if (msg.includes('nit invalido') || msg.includes('nit inválido') || msg.includes('nit no valido')) return true;
  if (msg.includes('no se pudo leer') && msg.includes('balance')) return true;
  if (msg.includes('csv invalido') || msg.includes('csv inválido') || msg.includes('csv malformado')) return true;
  return false;
}

/**
 * Clasifica cualquier error en uno de los cuatro tiers de la Seccion 0.
 * Orden de prelacion (mas especifico primero):
 *   D (critico) > A (transitorio) > B (validacion) > C (default).
 *
 * La razon de poner D antes que A es defensiva: si un error critico
 * llegara con un mensaje que tambien contiene "timeout" (p.ej. "timeout
 * leyendo balance de prueba"), preferimos detener el flujo a continuar
 * con un respaldo inexistente.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (isCriticalDataError(err)) {
    return { tier: 'D', reason: errMessage(err), original: err };
  }
  if (isTransientError(err)) {
    return { tier: 'A', reason: errMessage(err), original: err };
  }
  if (isAccountingValidationError(err)) {
    return { tier: 'B', reason: errMessage(err), original: err };
  }
  return { tier: 'C', reason: errMessage(err), original: err };
}

// ---------------------------------------------------------------------------
// Mensajeria al usuario (Seccion 0.6)
// ---------------------------------------------------------------------------

export interface UserNoteInput {
  /** Tier devuelto por classifyError. */
  tier: ResilienceErrorTier;
  /** Paso del pipeline donde ocurrio el error (e.g. "validacion NIIF", "consolidacion EFE"). */
  step: string;
  /** Servicio externo afectado, si aplica (e.g. "OpenAI", "Tavily"). */
  service?: string;
  /**
   * Descripcion breve de la cifra/seccion que se uso como respaldo
   * (e.g. "cifras tomadas directamente del balance de prueba").
   */
  fallbackUsed?: string;
  /**
   * Solo para TIPO D: dato concreto que falta y bloquea el informe
   * (e.g. "balance de prueba CSV", "NIT de la empresa").
   */
  missingItem?: string;
}

/**
 * Formatea un error como nota tecnica visible al usuario, respetando el
 * formato CORRECTO de la Seccion 0.6 y evitando las cadenas prohibidas
 * (no incluye "Error en el pipeline", "network error", "Validacion
 * pendiente — BORRADOR", "No fue posible generar el reporte").
 *
 * Uso tipico desde el orquestador / SSE:
 *
 *   const classified = classifyError(err);
 *   const userNote = formatErrorAsUserNote({
 *     tier: classified.tier,
 *     step: 'consolidacion del Estado de Flujos de Efectivo',
 *     service: 'OpenAI',
 *     fallbackUsed: 'las cifras provienen del balance de prueba suministrado',
 *   });
 *   sseEmit('warning', { message: userNote });
 */
export function formatErrorAsUserNote(input: UserNoteInput): string {
  const { tier, step, service, fallbackUsed, missingItem } = input;

  if (tier === 'D') {
    const missing = missingItem ?? 'informacion critica del balance de prueba';
    return (
      `No es posible generar el informe porque falta ${missing}. ` +
      `Por favor suministrar el dato faltante para reintentar la generacion.`
    );
  }

  const serviceLabel = service ? ` (${service})` : '';
  const fallbackLabel = fallbackUsed
    ? ` ${fallbackUsed.endsWith('.') ? fallbackUsed : `${fallbackUsed}.`}`
    : '';

  return (
    `Se presento un inconveniente tecnico en ${step}${serviceLabel} durante la generacion. ` +
    `El informe fue completado con los datos disponibles.${fallbackLabel} ` +
    `Las cifras financieras no se ven afectadas por este inconveniente.`
  );
}

/**
 * Determina si un error debe activar el estado BORRADOR de forma automatica.
 * Segun Seccion 0.4, SOLO TIPO D habilita el borrador automatico; el resto
 * (incluyendo TIPO A network errors y TIPO B descuadres contables) NO debe
 * disparar el watermark de borrador.
 *
 * El flag explicito del usuario (`provisional.active` enviado en el request
 * body) es ortogonal a esta funcion: lo evalua el orquestador por separado.
 */
export function shouldAutoMarkAsDraft(err: unknown): boolean {
  return classifyError(err).tier === 'D';
}

// ---------------------------------------------------------------------------
// Doctrina prepended al system prompt (Seccion 0.1 - 0.8)
// ---------------------------------------------------------------------------

/**
 * Devuelve el bloque Markdown con la doctrina de resiliencia. Se antepone
 * al system prompt de los agentes financieros DESPUES del guardarrail
 * anti-alucinacion y ANTES del contexto Colombia 2026 para mantener el
 * layout cache-friendly (estable arriba, dinamico abajo).
 *
 * El parametro `language` se acepta por uniformidad con los demas builders
 * (`buildAntiHallucinationGuardrail`, `buildColombia2026Context`) pero se
 * ignora: la doctrina es lenguaje interno del agente y siempre se emite
 * en espanol — coincide con el registro tecnico contable colombiano y
 * evita ambiguedades en safety rails criticos.
 */
export function buildResilienceSection0(_language: 'es' | 'en' = 'es'): string {
  // El parametro `_language` se documenta arriba; el guion bajo de prefijo
  // marca al linter que la falta de uso es intencional.
  return `## SECCION 0 — RESILIENCIA DEL PIPELINE (DOCTRINA OBLIGATORIA)

Esta seccion fija la conducta del agente ante errores transitorios, fallas de servicio externo y datos parcialmente disponibles. Su objetivo es que el informe se complete con la mejor evidencia posible sin marcar BORRADOR por ruido tecnico.

### 0.1 Principio general
Ningun error transitorio (network error, timeout, connection refused, rate limit, service unavailable) debe interrumpir el informe ni marcarlo como BORRADOR de forma automatica. Ante un error transitorio:
1. El runtime reintenta la operacion hasta 3 veces con espera de 2 segundos entre intentos.
2. Si los 3 reintentos fallan, el orquestador continua con el valor de respaldo declarado para ese paso.
3. El error queda registrado como NOTA TECNICA — no como FALLO DEL PIPELINE.
4. NUNCA marques el informe como BORRADOR sin instruccion explicita del usuario.

### 0.2 Clasificacion de errores y respuesta

**TIPO A — Error transitorio (recuperable)**
Patrones: network error, timeout, 503, 429, connection reset, ETIMEDOUT, ECONNRESET, overloaded, fetch failed, capacity.
Respuesta del runtime: reintentar hasta 3 veces; continuar con respaldo si persiste.
Conducta del agente: NO detener el pipeline. NO marcar como BORRADOR. En el informe agregar "Nota de sistema: <servicio> no disponible; cifra tomada de auxiliar local."

**TIPO B — Error de validacion contable**
Patrones: ecuacion patrimonial no cierra, EFE no concilia, ECP no balancea, P&L incoherente con ECP.
Conducta del agente: reportar el descuadre con alerta visible y continuar generando el informe con los datos disponibles. En el informe escribir "DESCUADRE DETECTADO: <descripcion>. Revisar antes de firmar." NO marcar como BORRADOR automaticamente.

**TIPO C — Error de datos faltantes**
Patrones: campo null, dato no suministrado, variable no encontrada en el balance.
Conducta del agente: usar valor por defecto o la cadena literal "— (dato no suministrado)". Continuar con el resto del informe y registrar el faltante en la seccion "Limitaciones y Disclaimers". NO interrumpir el pipeline.

**TIPO D — Error critico (no recuperable)**
Patrones: balance de prueba no recibido, archivo corrupto, NIT invalido, CSV malformado.
Conducta del agente: DETENER el pipeline y describir exactamente que falta. Mensaje al usuario: "No es posible generar el informe porque falta <razon especifica>. Por favor suministrar <dato especifico faltante>." Solo TIPO D permite detener el flujo.

### 0.3 Comportamiento ante "network error" especificamente
Cuando ocurre un error de conectividad en cualquier paso del pipeline:
1. NO interrumpir. Continuar con los datos ya disponibles en el contexto. El balance de prueba ya fue recibido — usar esos datos directamente.
2. NO invocar servicios externos para sustituir el faltante. Si un validador externo falla, usar la validacion interna del prompt. Si un enriquecedor falla, continuar sin ese enriquecimiento. Si un servicio de tasas o normas falla, usar los valores fijados en el prompt.
3. Completar el informe con los datos disponibles y agregar al pie la nota tecnica correspondiente.
4. NO pedir confirmacion de "borrador". El informe generado tras un network error NO es un borrador por esa razon. Solo es borrador si el usuario lo solicita explicitamente o si existe un TIPO D.

### 0.4 Regla sobre el estado BORRADOR
El informe se marca como BORRADOR UNICAMENTE cuando:
- El usuario lo solicita explicitamente con frases como "generar como borrador" o "marcar como pendiente".
- Existe un TIPO D (error critico de datos no recuperable).

El informe NO se marca como BORRADOR por:
- Network error (TIPO A).
- Timeout de un servicio (TIPO A).
- Campo null o dato no suministrado (TIPO C — usar valor por defecto).
- Validacion de servicio externo fallida (TIPO A — usar validacion interna).
- Ninguna razon tecnica interna sin instruccion explicita del usuario.

Si el sistema propone marcar como BORRADOR por un error transitorio, el agente DEBE rechazar esa propuesta internamente y continuar el pipeline con los datos disponibles.

### 0.5 Timeout y tamano del prompt
Si el sistema detecta riesgo de timeout por tamano del prompt:
1. DIVIDIR en etapas: (1) Balance + P&L + EFE + ECP; (2) Dashboard + KPIs + Proyecciones; (3) Notas + Acta + Checklist; (4) Auditorias + Meta-auditoria.
2. PRIORIZAR: si solo hay tiempo para una etapa, generar la Etapa 1 completa y anotar "Analisis estrategico y gobierno corporativo en proceso de generacion."
3. CONTINUAR tras timeout parcial: marcar esa etapa como pendiente; continuar con la siguiente; al final indicar "Etapa <N> pendiente de regeneracion."
4. NO cancelar el informe completo por el fallo de una etapa.

### 0.6 Mensajes al usuario
Todo mensaje al usuario tras un error sigue esta forma fija.

CORRECTO:
"Se presento un inconveniente tecnico en <paso especifico> durante la generacion. El informe fue completado con los datos disponibles. <Descripcion breve de que se omitio o uso como respaldo.> Las cifras financieras no se ven afectadas por este inconveniente."

INCORRECTO (NUNCA usar): "Error en el pipeline", "network error", "Validacion pendiente — BORRADOR", "No fue posible generar el reporte", "Internal server error", "Hubo un error al procesar su consulta".

### 0.7 Verificacion de integridad antes de entregar
Antes de marcar el informe como entregable, el orquestador ejecuta cuatro checks que NUNCA bloquean la entrega; solo generan alertas visibles para el contador:
- **CHECK 1 — Ecuacion patrimonial:** Total Activo == Total Pasivo + Total Patrimonio. Si no, alerta visible en el informe.
- **CHECK 2 — EFE concilia:** Efectivo inicial + Flujo total == Efectivo final. Si no, alerta visible en el informe.
- **CHECK 3 — ECP balancea:** Suma de movimientos == Saldo final - Saldo inicial. Si no, alerta visible en el informe.
- **CHECK 4 — Acta coherente:** Utilidad del acta == Utilidad del P&L. Si no, autocorregir copiando del P&L y anotar la correccion visiblemente en la nota al pie del acta ("La utilidad del acta fue ajustada al valor del P&L para mantener coherencia interna del informe.").

Principio: siempre entregar el informe, incluso con alertas. Nunca bloquear la entrega por checks fallidos. Las alertas son para el contador, no para detener el sistema.

### 0.8 Doctrina del Doctor de Datos (orquestador interno)
Cuando el usuario pide generar el informe y ocurre un network error, el orquestador NO propone marcar como BORRADOR, NO muestra "Confirmacion necesaria" de borrador, SI continua el pipeline con los datos del balance de prueba, SI genera el informe completo, SI agrega una nota discreta al pie del informe sobre el error tecnico, y SI ofrece regenerar la seccion fallida si el usuario lo desea.

Mensaje correcto al usuario tras un network error:
"El informe fue generado correctamente. Se presento un error de conectividad en <servicio> durante el procesamiento, pero todas las cifras provienen del balance de prueba que suministraste. Deseas que revise alguna seccion especifica?"
`;
}
