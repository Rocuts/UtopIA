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

const TRIAL_BALANCE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', examples: ['tb_0698fq7yv7f7btkdjq8x2xz3ec'] },
    object: { type: 'string', const: 'trial_balance' },
    status: { type: 'string', enum: ['balanced', 'unbalanced'] },
    period_label: { type: 'string' },
    row_count: { type: 'integer' },
    control_totals: {
      type: 'object',
      properties: {
        activo: MONEY_SCHEMA,
        pasivo: MONEY_SCHEMA,
        patrimonio: MONEY_SCHEMA,
        ingresos_netos: MONEY_SCHEMA,
        equation_delta: MONEY_SCHEMA,
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
            'Idempotente vía header Idempotency-Key (TTL 24 h; replay devuelve la misma respuesta con Idempotent-Replayed: true). Un balance descuadrado NO es error: la remisión se crea con status=unbalanced y el descuadre viaja en control_totals.equation_delta.',
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
            '200': jsonResponse('Detalle', { $ref: '#/components/schemas/TrialBalance' }),
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
        WebhookEndpoint: WEBHOOK_ENDPOINT_SCHEMA,
        WebhookEnvelope: WEBHOOK_ENVELOPE_SCHEMA,
        TrialBalanceCreate: jsonSchema(TrialBalanceCreateSchema),
        WebhookEndpointCreate: jsonSchema(WebhookEndpointCreateSchema),
        WebhookEndpointUpdate: jsonSchema(WebhookEndpointUpdateSchema),
      },
    },
  };
}
