import crypto from 'node:crypto';
import { getDb } from './db.ts';
import { decryptSecret } from './crypto.ts';
import { assertSafeExternalUrl } from './ssrf.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  kind: 'builtin' | 'rest_connector';
  connectorId?: string;
  method?: string;
  requiresConfirmation: boolean;
  requiredFields: string[];
  inputSchema: Record<string, unknown>;
}

export interface ApiConnectorRow {
  id: string;
  workspace_id: string;
  chatbot_id: string | null;
  name: string;
  description: string;
  method: string;
  url: string;
  headers_json: string;
  query_params_json: string;
  body_template_json: string;
  auth_type: string;
  encrypted_auth_config: string | null;
  input_schema_json: string;
  requires_confirmation: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function listToolsForChatbot(workspaceId: string, chatbotId: string): ToolDefinition[] {
  const db = getDb();
  const tools: ToolDefinition[] = [
    {
      name: 'create_support_ticket',
      description:
        'Creates a tracked customer support or operations escalation ticket in KRESNA. Use when the user asks to create a ticket/escalate or troubleshooting fails. Requires explicit user confirmation before executing.',
      kind: 'builtin',
      requiresConfirmation: true,
      requiredFields: ['subject', 'description', 'customer_contact'],
      inputSchema: {
        type: 'object',
        required: ['subject', 'description', 'customer_contact'],
        properties: {
          subject: { type: 'string', description: 'Concise issue summary' },
          description: { type: 'string', description: 'Observed symptoms, context, and steps tried' },
          customer_name: { type: 'string', description: 'Customer name if provided' },
          customer_contact: { type: 'string', description: 'Email, phone, or driver/employee ID' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
      },
    },
  ];

  const rows = db
    .prepare(
      `SELECT * FROM api_connectors
       WHERE workspace_id = ? AND enabled = 1 AND (chatbot_id IS NULL OR chatbot_id = ?)
       ORDER BY created_at ASC`
    )
    .all(workspaceId, chatbotId) as unknown as ApiConnectorRow[];

  for (const row of rows) {
    let schema: Record<string, unknown> = {};
    try {
      schema = JSON.parse(row.input_schema_json || '{}');
    } catch {
      schema = {};
    }
    const requiredFields = Array.isArray((schema as { required?: unknown }).required)
      ? ((schema as { required: unknown[] }).required.filter((x) => typeof x === 'string') as string[])
      : [];
    const normalizedName =
      row.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || `connector_${row.id.slice(0, 6)}`;

    tools.push({
      name: normalizedName,
      description: `${row.description} (REST ${row.method} connector)`,
      kind: 'rest_connector',
      connectorId: row.id,
      method: row.method.toUpperCase(),
      requiresConfirmation:
        Boolean(row.requires_confirmation) ||
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(row.method.toUpperCase()),
      requiredFields,
      inputSchema: schema,
    });
  }

  return tools;
}

export function validateToolArguments(
  tool: ToolDefinition,
  args: Record<string, unknown>
): { valid: boolean; missingFields: string[]; error?: string } {
  const missingFields: string[] = [];
  for (const field of tool.requiredFields) {
    const val = args[field];
    if (val === undefined || val === null || String(val).trim() === '') {
      missingFields.push(field);
    }
  }
  if (missingFields.length > 0) {
    return {
      valid: false,
      missingFields,
      error: `Missing mandatory field(s): ${missingFields.join(', ')}`,
    };
  }
  return { valid: true, missingFields: [] };
}

function interpolateTemplate(
  template: unknown,
  args: Record<string, unknown>
): unknown {
  if (typeof template === 'string') {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
      const val = args[key];
      return val !== undefined && val !== null ? String(val) : '';
    });
  }
  if (Array.isArray(template)) {
    return template.map((v) => interpolateTemplate(v, args));
  }
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = interpolateTemplate(v, args);
    }
    return out;
  }
  return template;
}

export async function executeApiConnector(params: {
  connector: ApiConnectorRow;
  args: Record<string, unknown>;
  workspaceId: string;
  chatbotId?: string | null;
  conversationId?: string | null;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  data?: unknown;
  error?: string;
  latencyMs: number;
}> {
  const db = getDb();
  const started = Date.now();
  const method = params.connector.method.toUpperCase();

  let targetUrl = interpolateTemplate(params.connector.url, params.args) as string;
  let safeUrl: URL;
  try {
    safeUrl = await assertSafeExternalUrl(targetUrl);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Blocked URL';
    db.prepare(
      `INSERT INTO connector_execution_logs
        (id, workspace_id, chatbot_id, connector_id, conversation_id, method, url, request_summary_json, response_status, response_summary, latency_ms, success, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?)`
    ).run(
      crypto.randomUUID(),
      params.workspaceId,
      params.chatbotId ?? null,
      params.connector.id,
      params.conversationId ?? null,
      method,
      targetUrl,
      JSON.stringify({ args: params.args }),
      Date.now() - started,
      error,
      new Date().toISOString()
    );
    return { ok: false, error, latencyMs: Date.now() - started };
  }

  // Merge query params
  try {
    const qp = JSON.parse(params.connector.query_params_json || '{}') as Record<string, unknown>;
    for (const [k, v] of Object.entries(qp)) {
      const resolved = String(interpolateTemplate(v, params.args) ?? '');
      if (resolved) safeUrl.searchParams.set(k, resolved);
    }
  } catch {
    // ignore malformed optional query config
  }

  // Build headers + decrypt optional auth config
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  try {
    const rawHeaders = JSON.parse(params.connector.headers_json || '{}') as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawHeaders)) {
      headers[k] = String(interpolateTemplate(v, params.args) ?? '');
    }
  } catch {
    // ignore
  }

  if (params.connector.encrypted_auth_config && params.connector.auth_type !== 'none') {
    try {
      const authCfg = JSON.parse(decryptSecret(params.connector.encrypted_auth_config)) as {
        token?: string;
        headerName?: string;
        apiKey?: string;
        username?: string;
        password?: string;
      };
      if (params.connector.auth_type === 'bearer' && authCfg.token) {
        headers.Authorization = `Bearer ${authCfg.token}`;
      } else if (params.connector.auth_type === 'api_key' && authCfg.headerName && authCfg.apiKey) {
        headers[authCfg.headerName] = authCfg.apiKey;
      } else if (params.connector.auth_type === 'basic' && authCfg.username) {
        const encoded = Buffer.from(`${authCfg.username}:${authCfg.password || ''}`).toString('base64');
        headers.Authorization = `Basic ${encoded}`;
      }
    } catch {
      return {
        ok: false,
        error: 'Stored connector credentials could not be decrypted.',
        latencyMs: Date.now() - started,
      };
    }
  }

  let bodyStr: string | undefined;
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    let bodyPayload: unknown = {};
    try {
      const template = JSON.parse(params.connector.body_template_json || '{}');
      if (template && typeof template === 'object' && Object.keys(template).length > 0) {
        bodyPayload = interpolateTemplate(template, params.args);
      } else {
        bodyPayload = params.args;
      }
    } catch {
      bodyPayload = params.args;
    }
    bodyStr = JSON.stringify(bodyPayload);
  }

  try {
    const res = await fetch(safeUrl.toString(), {
      method,
      headers,
      ...(bodyStr !== undefined ? { body: bodyStr } : {}),
      signal: AbortSignal.timeout(12000),
    });
    const latencyMs = Date.now() - started;
    const rawBody = await res.text();
    let parsed: unknown = rawBody.slice(0, 4000);
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      // keep raw text snippet
    }

    const ok = res.ok;
    const summary = typeof parsed === 'string' ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500);

    db.prepare(
      `INSERT INTO connector_execution_logs
        (id, workspace_id, chatbot_id, connector_id, conversation_id, method, url, request_summary_json, response_status, response_summary, latency_ms, success, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      params.workspaceId,
      params.chatbotId ?? null,
      params.connector.id,
      params.conversationId ?? null,
      method,
      safeUrl.toString(),
      JSON.stringify({ args: params.args }),
      res.status,
      summary,
      latencyMs,
      ok ? 1 : 0,
      ok ? null : `HTTP ${res.status}`,
      new Date().toISOString()
    );

    if (!ok) {
      return {
        ok: false,
        statusCode: res.status,
        data: parsed,
        error: `External API returned HTTP ${res.status}`,
        latencyMs,
      };
    }

    return { ok: true, statusCode: res.status, data: parsed, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - started;
    const error = err instanceof Error ? err.message : String(err);
    db.prepare(
      `INSERT INTO connector_execution_logs
        (id, workspace_id, chatbot_id, connector_id, conversation_id, method, url, request_summary_json, response_status, response_summary, latency_ms, success, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?)`
    ).run(
      crypto.randomUUID(),
      params.workspaceId,
      params.chatbotId ?? null,
      params.connector.id,
      params.conversationId ?? null,
      method,
      safeUrl.toString(),
      JSON.stringify({ args: params.args }),
      latencyMs,
      error,
      new Date().toISOString()
    );
    return { ok: false, error, latencyMs };
  }
}

export async function executeRegisteredTool(params: {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  workspaceId: string;
  chatbotId: string;
  conversationId: string;
}): Promise<{ ok: boolean; data?: unknown; error?: string; latencyMs: number }> {
  const started = Date.now();
  const validation = validateToolArguments(params.tool, params.args);
  if (!validation.valid) {
    return { ok: false, error: validation.error, latencyMs: Date.now() - started };
  }

  const db = getDb();
  if (params.tool.kind === 'builtin' && params.tool.name === 'create_support_ticket') {
    const ticketId = `TKT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const subject = String(params.args.subject).trim();
    const description = String(params.args.description).trim();
    const customerName = params.args.customer_name ? String(params.args.customer_name).trim() : null;
    const customerContact = String(params.args.customer_contact).trim();
    const priority =
      typeof params.args.priority === 'string' &&
      ['low', 'normal', 'high', 'urgent'].includes(params.args.priority)
        ? params.args.priority
        : 'normal';

    db.prepare(
      `INSERT INTO support_tickets
        (id, workspace_id, chatbot_id, conversation_id, subject, description, customer_name, customer_contact, priority, status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).run(
      ticketId,
      params.workspaceId,
      params.chatbotId,
      params.conversationId,
      subject,
      description,
      customerName,
      customerContact,
      priority,
      JSON.stringify({ createdByAgent: true }),
      now
    );

    return {
      ok: true,
      data: {
        ticketId,
        status: 'open',
        subject,
        customerContact,
        priority,
        createdAt: now,
      },
      latencyMs: Date.now() - started,
    };
  }

  if (params.tool.kind === 'rest_connector' && params.tool.connectorId) {
    const connector = db
      .prepare(`SELECT * FROM api_connectors WHERE id = ? AND workspace_id = ?`)
      .get(params.tool.connectorId, params.workspaceId) as ApiConnectorRow | undefined;

    if (!connector) {
      return {
        ok: false,
        error: 'Configured API connector no longer exists.',
        latencyMs: Date.now() - started,
      };
    }

    return executeApiConnector({
      connector,
      args: params.args,
      workspaceId: params.workspaceId,
      chatbotId: params.chatbotId,
      conversationId: params.conversationId,
    });
  }

  return {
    ok: false,
    error: `Tool "${params.tool.name}" is not available.`,
    latencyMs: Date.now() - started,
  };
}
