// ---------------------------------------------------------------------------
// Documento OpenAPI 3.1.2 del API v1 — generado desde los schemas Zod.
//
// Decisión de spec (§4): contrato base 3.1.2 (OpenAPI 3.2.0 existe desde
// 2025-09 pero es superset; 3.1.2 maximiza compatibilidad del tooling de los
// clientes). Los request bodies salen de `z.toJSONSchema` sobre los MISMOS
// schemas que validan en runtime (schemas.ts) — cero drift de entrada. El
// test openapi.test.ts exige además que cada route.ts tenga su path aquí.
// ---------------------------------------------------------------------------

import { z } from 'zod';

import {
  TrialBalanceCreateSchema,
  WebhookEndpointCreateSchema,
  WebhookEndpointUpdateSchema,
} from './schemas';
import { API_VERSION } from './handler';
import { WEBHOOK_EVENT_TYPES } from './webhooks';

export const OPENAPI_PATHS = [
  '/v1/me',
  '/v1/trial-balances',
  '/v1/trial-balances/{id}',
  '/v1/webhook-endpoints',
  '/v1/webhook-endpoints/{id}',
  '/v1/webhook-endpoints/{id}/ping',
] as const satisfies readonly string[];

// ---------------------------------------------------------------------------
// Schemas de componentes (los de respuesta se documentan a mano — allowlist)
// ---------------------------------------------------------------------------

const MONEY_SCHEMA = {
  type: 'object',
  description:
    'Monto en centavos de COP como string-integer (evita pérdida de precisión sobre 2^53 en JS).',
  properties: {
    amount: { type: 'string', pattern: '^-?[0-9]+$', examples: ['150000000'] },
    currency: { type: 'string', const: 'COP' },
  },
  required: ['amount', 'currency'],
} as const;

const PROBLEM_SCHEMA = {
  type: 'object',
  description:
    'Error RFC 9457 (application/problem+json). Matchee por `code` — es el identificador estable.',
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    request_id: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          detail: { type: 'string' },
          pointer: { type: 'string', description: 'JSON Pointer al campo inválido' },
        },
        required: ['detail', 'pointer'],
      },
    },
  },
  required: ['type', 'title', 'status', 'code', 'request_id'],
} as const;

// Contrato tb-2026-09-24 (niif-preproceso-07): los campos de abajo son los que
// `summarize` / `serializeTrialBalance` (trial-balances.ts) ya emiten. Los
// añadidos en esa versión no son `required`: los summaries persistidos antes
// de ella no los traen en el listado (el detalle los recalcula).
const TRIAL_BALANCE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', examples: ['tb_0698fq7yv7f7btkdjq8x2xz3ec'] },
    object: { type: 'string', const: 'trial_balance' },
    status: {
      type: 'string',
      enum: ['balanced', 'unbalanced'],
      description:
        'balanced sólo si equation_delta = 0 y ningún periodo del archivo trae un motivo ' +
        'persistente. unbalanced cubre el descuadre del archivo (equation_delta ≠ 0) y también, ' +
        'aunque la ecuación cuadre, los motivos persistentes: integridad de la lectura (importes ' +
        'ilegibles, columnas de saldo ambiguas, filas desplazadas, códigos que no son cuentas PUC), ' +
        'importes fuera del rango de precisión monetaria, unidad declarada ("en miles" / "en ' +
        'millones") sin confirmar (envíe `unit` para confirmarla) y bloqueos del curador ' +
        'posteriores al Cierre Virtual (R8), p. ej. CUR-R12. El detalle los lista en ' +
        'validation_reasons. El riesgo de liquidez (activo corriente < pasivo corriente) no cambia ' +
        'el status. Contrato tb-2026-09-24.3.',
    },
    period_label: { type: 'string' },
    row_count: { type: 'integer' },
    unit: {
      type: ['object', 'null'],
      description:
        'Unidad de los importes (tb-2026-09-24.3). declared: unidad distinta de pesos que declara ' +
        'el CSV ("en miles de pesos") con el texto donde se leyó; confirmed: la del parámetro ' +
        '`unit`. requires_confirmation = true ⇒ la remisión queda unbalanced hasta reenviarla con ' +
        '`unit`. null en remisiones anteriores a tb-2026-09-24.3.',
      properties: {
        declared: { type: ['string', 'null'], enum: ['miles', 'millones', null] },
        declared_text: { type: ['string', 'null'] },
        confirmed: { type: ['string', 'null'], enum: ['pesos', 'miles', 'millones', null] },
        requires_confirmation: { type: 'boolean' },
      },
      required: ['declared', 'declared_text', 'confirmed', 'requires_confirmation'],
    },
    sign_convention: {
      type: ['string', 'null'],
      enum: ['natural', 'algebraica', null],
      description:
        'Convención de signos detectada en la entrada (csv y rows se normalizan igual a la ' +
        'convención natural). null si no se conoce (remisiones anteriores a tb-2026-09-24).',
    },
    control_totals: {
      type: 'object',
      properties: {
        activo: MONEY_SCHEMA,
        pasivo: MONEY_SCHEMA,
        patrimonio: MONEY_SCHEMA,
        ingresos_netos: MONEY_SCHEMA,
        equation_delta: {
          ...MONEY_SCHEMA,
          description:
            'Descuadre del archivo de origen (Activo − Pasivo − Patrimonio) antes del Cierre ' +
            'Virtual: no incluye el traslado del resultado del ejercicio (3605VC) ni la ' +
            'reclasificación de un grupo 36 anterior (reclassified_from_3605). El curador no lo ' +
            'absorbe; ≠ 0 ⇒ status = unbalanced.',
        },
        virtual_close_adjustment: {
          ...MONEY_SCHEMA,
          description:
            'Histórico: monto que el Cierre Virtual (R8) absorbía en 3710VC. Desde tb-2026-09-24 ' +
            'vale 0 (el residual está en equation_delta); se conserva por compatibilidad.',
        },
        reclassified_from_3605: {
          ...MONEY_SCHEMA,
          description:
            'Resultado de un ejercicio anterior que seguía en el grupo 36 y se reclasificó a ' +
            'resultados acumulados (3710VC). No es descuadre.',
        },
        equity_anchor_adjustment: {
          ...MONEY_SCHEMA,
          description:
            'Histórico: brecha que R5 absorbía al anclar el patrimonio al ECP. Desde ' +
            'tb-2026-09-24 vale 0; se conserva por compatibilidad.',
        },
      },
      required: ['activo', 'pasivo', 'patrimonio', 'ingresos_netos', 'equation_delta'],
    },
    findings: {
      type: 'object',
      properties: {
        discrepancies: { type: 'integer' },
        curator: { type: 'integer' },
      },
      required: ['discrepancies', 'curator'],
    },
    preprocessor_version: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'object',
    'status',
    'period_label',
    'row_count',
    'control_totals',
    'findings',
    'preprocessor_version',
    'created_at',
  ],
} as const;

// Detalle (GET /v1/trial-balances/{id}): base + motivos, discrepancias y
// hallazgos del curador (allowlist de `serializeTrialBalanceDetail`).
const TRIAL_BALANCE_DETAIL_SCHEMA = {
  allOf: [
    { $ref: '#/components/schemas/TrialBalance' },
    {
      type: 'object',
      properties: {
        validation_reasons: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Motivos por los que la remisión no es certificable (descuadres, importes ' +
            'ilegibles, columnas ambiguas, códigos que no son cuentas PUC, precisión monetaria, ' +
            'unidad declarada sin confirmar, bloqueos del curador post-R8). Vacío si no hay.',
        },
        validation_notes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Notas informativas, no bloqueantes: cifras reexpresadas a pesos por la unidad ' +
            'confirmada (`unit`), excepciones de vencimiento aplicadas (`maturity_overrides`), ' +
            'fecha de corte declarada en el archivo, riesgo de liquidez.',
        },
        classification_note: {
          type: ['string', 'null'],
          description:
            'Supuesto de clasificación corriente / no corriente por grupo PUC y, si se enviaron ' +
            '`maturity_overrides`, las excepciones aplicadas con su monto.',
        },
        discrepancies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              location: { type: 'string' },
              reported: { type: 'number' },
              calculated: { type: 'number' },
              difference: { type: 'number' },
              description: { type: 'string' },
            },
          },
        },
        curator_findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              severity: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              norm_reference: { type: 'string' },
              recommendation: { type: 'string' },
            },
          },
        },
      },
      required: [
        'validation_reasons',
        'validation_notes',
        'classification_note',
        'discrepancies',
        'curator_findings',
      ],
    },
  ],
} as const;

const WEBHOOK_ENDPOINT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', examples: ['whe_0698fq7yv7f7btkdjq8x2xz3ec'] },
    object: { type: 'string', const: 'webhook_endpoint' },
    url: { type: 'string', format: 'uri' },
    description: { type: ['string', 'null'] },
    events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] } },
    status: { type: 'string', enum: ['enabled', 'disabled'] },
    secret: {
      type: 'string',
      description: 'Secreto whsec_… — SOLO presente en la respuesta de creación.',
    },
    secret_preview: { type: 'string', examples: ['whsec_…8kQz'] },
    created_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'object', 'url', 'events', 'status', 'created_at'],
} as const;

const WEBHOOK_ENVELOPE_SCHEMA = {
  type: 'object',
  description:
    'Envelope Standard Webhooks v1.0.0. Headers de cada entrega: webhook-id, webhook-timestamp (unix s), webhook-signature ("v1,<base64 HMAC-SHA256>"). Verifique con la librería `standardwebhooks` y tolerancia de 5 minutos.',
  properties: {
    type: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] },
    timestamp: { type: 'string', format: 'date-time' },
    data: { type: 'object' },
  },
  required: ['type', 'timestamp', 'data'],
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
}

const PROBLEM_RESPONSE = {
  description: 'Error (RFC 9457)',
  content: {
    'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
  },
} as const;

function jsonResponse(description: string, schemaRef: unknown) {
  return {
    description,
    content: { 'application/json': { schema: schemaRef } },
  };
}

const ID_PARAM = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const PAGE_PARAMS = [
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  {
    name: 'cursor',
    in: 'query',
    schema: { type: 'string' },
    description: 'Cursor opaco de la página anterior (next_cursor).',
  },
] as const;

function listSchema(itemRef: unknown) {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: itemRef },
      has_more: { type: 'boolean' },
      next_cursor: { type: ['string', 'null'] },
    },
    required: ['data', 'has_more', 'next_cursor'],
  };
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

export function buildOpenApiDocument(): Record<string, unknown> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return {
    openapi: '3.1.2',
    info: {
      title: 'UtopIA API de Clientes',
      version: API_VERSION,
      description:
        'API B2B server-to-server para remitir balances de prueba PUC y recibir la validación NIIF determinista de UtopIA (anclas en centavos, ecuación contable, curator R1–R4), con webhooks firmados (Standard Webhooks v1). Errores: RFC 9457. Idempotencia: header Idempotency-Key en POST. Spec interna: docs/spec/api-clientes-v1.md.',
      contact: { name: 'UtopIA' },
    },
    servers: [{ url: `${baseUrl}/api` }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'llave', description: 'Introspección de la credencial' },
      { name: 'trial-balances', description: 'Remisiones de balance de prueba PUC' },
      { name: 'webhook-endpoints', description: 'Receptores de eventos firmados' },
    ],
    paths: {
      '/v1/me': {
        get: {
          tags: ['llave'],
          operationId: 'getMe',
          summary: 'Introspección de la llave (workspace, scopes, límites)',
          responses: {
            '200': jsonResponse('Llave autenticada', {
              type: 'object',
              properties: {
                object: { type: 'string', const: 'api_key' },
                name: { type: 'string' },
                mode: { type: 'string', enum: ['live', 'test'] },
                scopes: { type: 'array', items: { type: 'string' } },
                rate_limits: {
                  type: 'object',
                  properties: {
                    read_rpm: { type: 'integer' },
                    write_rpm: { type: 'integer' },
                  },
                },
                workspace: {
                  type: 'object',
                  properties: {
                    name: { type: ['string', 'null'] },
                    nit: { type: ['string', 'null'] },
                  },
                },
              },
            }),
            default: PROBLEM_RESPONSE,
          },
        },
      },
      '/v1/trial-balances': {
        post: {
          tags: ['trial-balances'],
          operationId: 'createTrialBalance',
          summary: 'Remitir un balance de prueba (CSV o filas) y validarlo',
          description:
            'Idempotente vía header Idempotency-Key (TTL 24 h; replay devuelve la misma respuesta con Idempotent-Replayed: true). Un balance descuadrado NO es error: la remisión se crea con status=unbalanced y el descuadre del archivo de origen (antes del Cierre Virtual) viaja en control_totals.equation_delta; status=unbalanced también cubre los motivos persistentes aunque la ecuación cuadre — integridad, precisión monetaria, unidad declarada sin confirmar, bloqueos del curador post-R8 (ver validation_reasons en el detalle); el riesgo de liquidez no cambia el status. csv y rows pasan por la misma normalización (convención de signos, hojas estructurales).',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              schema: { type: 'string', maxLength: 255 },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TrialBalanceCreate' } },
            },
          },
          responses: {
            '201': jsonResponse('Remisión creada y validada', {
              $ref: '#/components/schemas/TrialBalance',
            }),
            default: PROBLEM_RESPONSE,
          },
        },
        get: {
          tags: ['trial-balances'],
          operationId: 'listTrialBalances',
          summary: 'Listar remisiones (cursor-based)',
          parameters: [...PAGE_PARAMS],
          responses: {
            '200': jsonResponse(
              'Página de remisiones',
              listSchema({ $ref: '#/components/schemas/TrialBalance' }),
            ),
            default: PROBLEM_RESPONSE,
          },
        },
      },
      '/v1/trial-balances/{id}': {
        get: {
          tags: ['trial-balances'],
          operationId: 'getTrialBalance',
          summary: 'Detalle recomputado (discrepancias + findings del curator)',
          parameters: [ID_PARAM],
          responses: {
            '200': jsonResponse('Detalle', { $ref: '#/components/schemas/TrialBalanceDetail' }),
            default: PROBLEM_RESPONSE,
          },
        },
        delete: {
          tags: ['trial-balances'],
          operationId: 'deleteTrialBalance',
          summary: 'Borrado físico de la remisión (Ley 1581)',
          parameters: [ID_PARAM],
          responses: {
            '204': { description: 'Borrada' },
            default: PROBLEM_RESPONSE,
          },
        },
      },
      '/v1/webhook-endpoints': {
        post: {
          tags: ['webhook-endpoints'],
          operationId: 'createWebhookEndpoint',
          summary: 'Registrar un endpoint (el secreto whsec_ se muestra UNA vez)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WebhookEndpointCreate' },
              },
            },
          },
          responses: {
            '201': jsonResponse('Endpoint creado (incluye secret)', {
              $ref: '#/components/schemas/WebhookEndpoint',
            }),
            default: PROBLEM_RESPONSE,
          },
        },
        get: {
          tags: ['webhook-endpoints'],
          operationId: 'listWebhookEndpoints',
          summary: 'Listar endpoints del workspace',
          parameters: [...PAGE_PARAMS],
          responses: {
            '200': jsonResponse(
              'Página de endpoints',
              listSchema({ $ref: '#/components/schemas/WebhookEndpoint' }),
            ),
            default: PROBLEM_RESPONSE,
          },
        },
      },
      '/v1/webhook-endpoints/{id}': {
        get: {
          tags: ['webhook-endpoints'],
          operationId: 'getWebhookEndpoint',
          summary: 'Detalle del endpoint (con ETag para concurrencia optimista)',
          parameters: [ID_PARAM],
          responses: {
            '200': jsonResponse('Endpoint', { $ref: '#/components/schemas/WebhookEndpoint' }),
            default: PROBLEM_RESPONSE,
          },
        },
        patch: {
          tags: ['webhook-endpoints'],
          operationId: 'updateWebhookEndpoint',
          summary: 'Actualizar (exige If-Match; 428 sin él, 412 si no coincide)',
          parameters: [
            ID_PARAM,
            { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WebhookEndpointUpdate' },
              },
            },
          },
          responses: {
            '200': jsonResponse('Endpoint actualizado', {
              $ref: '#/components/schemas/WebhookEndpoint',
            }),
            default: PROBLEM_RESPONSE,
          },
        },
        delete: {
          tags: ['webhook-endpoints'],
          operationId: 'deleteWebhookEndpoint',
          summary: 'Eliminar el endpoint',
          parameters: [ID_PARAM],
          responses: {
            '204': { description: 'Eliminado' },
            default: PROBLEM_RESPONSE,
          },
        },
      },
      '/v1/webhook-endpoints/{id}/ping': {
        post: {
          tags: ['webhook-endpoints'],
          operationId: 'pingWebhookEndpoint',
          summary: 'Enviar un evento ping firmado (prueba de integración)',
          parameters: [ID_PARAM],
          responses: {
            '202': jsonResponse('Ping encolado', {
              type: 'object',
              properties: { message_id: { type: 'string' } },
              required: ['message_id'],
            }),
            default: PROBLEM_RESPONSE,
          },
        },
      },
    },
    webhooks: {
      ping: {
        post: {
          summary: 'Evento de prueba',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/WebhookEnvelope' } },
            },
          },
          responses: { '2xx': { description: 'Reciba con 2xx antes de procesar.' } },
        },
      },
      'trial_balance.processed': {
        post: {
          summary: 'Una remisión de balance fue procesada y validada',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/WebhookEnvelope' } },
            },
          },
          responses: { '2xx': { description: 'Reciba con 2xx antes de procesar.' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Llave de API: Authorization: Bearer utop_sk_live_… (o utop_sk_test_…). Se emite por workspace con scopes granulares.',
        },
      },
      schemas: {
        Problem: PROBLEM_SCHEMA,
        Money: MONEY_SCHEMA,
        TrialBalance: TRIAL_BALANCE_SCHEMA,
        TrialBalanceDetail: TRIAL_BALANCE_DETAIL_SCHEMA,
        WebhookEndpoint: WEBHOOK_ENDPOINT_SCHEMA,
        WebhookEnvelope: WEBHOOK_ENVELOPE_SCHEMA,
        TrialBalanceCreate: jsonSchema(TrialBalanceCreateSchema),
        WebhookEndpointCreate: jsonSchema(WebhookEndpointCreateSchema),
        WebhookEndpointUpdate: jsonSchema(WebhookEndpointUpdateSchema),
      },
    },
  };
}
