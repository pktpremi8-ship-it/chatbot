import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  backupSqliteDatabase,
  createWorkspaceDefaults,
  getDb,
  getDbPath,
} from './src/server/db.ts';
import {
  clearSession,
  createSessionForUser,
  isAllowedLocalAdminRequest,
  isMultiUserAuthEnabled,
  requireAuth,
  requireRole,
  type AuthRequest,
} from './src/server/auth.ts';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  maskApiKey,
  verifyPassword,
} from './src/server/crypto.ts';
import { discoverOllamaModels } from './src/server/ollama-client.ts';
import {
  testProviderConnection,
  type ProviderConnectionRecord,
} from './src/server/llm-gateway.ts';
import { checkQdrantHealth } from './src/server/qdrant-client.ts';
import {
  ingestManualKnowledgeRecord,
  ingestUploadedKnowledgeFile,
  ingestWebsiteUrl,
  reindexKnowledgeItem,
  removeKnowledgeItem,
} from './src/server/knowledge-pipeline.ts';
import { retrieveHybridKnowledge } from './src/server/retrieval.ts';
import { runAgentTurn, type ChatbotRuntimeRecord } from './src/server/agent-runtime.ts';
import { loadConversationMemory } from './src/server/agent-memory.ts';
import { executeApiConnector, type ApiConnectorRow } from './src/server/connectors.ts';
import { runRegressionEvaluation } from './src/server/regression-eval.ts';
import { assertSafeExternalUrl } from './src/server/ssrf.ts';
import {
  evaluatePublishReadiness,
  GEMINI_MODEL_CATALOG,
  getPresetByKey,
  KRESNA_ROADMAP,
  SUGGESTED_OLLAMA_MODELS,
  type ChatbotPresetKey,
} from './src/shared/kresna-logic.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Initialize SQLite database & Local Workspace cleanly
getDb();

function recordAudit(
  workspaceId: string,
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (id, workspace_id, user_id, action, resource_type, resource_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    workspaceId,
    userId,
    action,
    resourceType,
    resourceId,
    JSON.stringify(metadata),
    new Date().toISOString()
  );
}

function getHostnameFromHeader(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.split(':')[0].toLowerCase();
  }
}

function isOriginAllowedForWidget(req: Request, widgetConfigJson: string): boolean {
  let allowedDomains: string[] = [];
  try {
    const parsed = JSON.parse(widgetConfigJson || '{}') as { allowedDomains?: string[] };
    if (Array.isArray(parsed.allowedDomains)) {
      allowedDomains = parsed.allowedDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
    }
  } catch {
    allowedDomains = [];
  }

  if (allowedDomains.length === 0 || allowedDomains.includes('*')) {
    return true;
  }

  const originHost =
    getHostnameFromHeader(req.headers.origin) ||
    getHostnameFromHeader(req.headers.referer) ||
    getHostnameFromHeader(req.headers.host);

  if (!originHost) return true;
  if (originHost === 'localhost' || originHost === '127.0.0.1') {
    if (allowedDomains.includes('localhost') || allowedDomains.includes('127.0.0.1')) {
      return true;
    }
  }
  const requestHost = getHostnameFromHeader(req.headers.host);
  if (requestHost && originHost === requestHost) {
    return true;
  }

  return allowedDomains.some(
    (domain) => originHost === domain || originHost.endsWith(`.${domain}`)
  );
}

async function resolveRuntimeExecutionTarget(params: {
  workspaceId: string;
  chatbot: ChatbotRuntimeRecord;
  connection: ProviderConnectionRecord;
}): Promise<{ chatbot: ChatbotRuntimeRecord; connection: ProviderConnectionRecord }> {
  const { workspaceId, chatbot, connection } = params;
  const serverGeminiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (connection.provider === 'gemini') {
    return {
      chatbot: {
        ...chatbot,
        model_id: chatbot.model_id || connection.default_model || 'gemini-3.1-flash-lite',
      },
      connection,
    };
  }

  if (
    connection.provider === 'ollama' &&
    process.env.OLLAMA_STRICT !== 'true' &&
    serverGeminiKey
  ) {
    let shouldFallbackToGemini = !chatbot.model_id;
    if (!shouldFallbackToGemini) {
      const probe = await discoverOllamaModels(
        connection.endpoint || process.env.OLLAMA_BASE_URL || 'http://ollama:11434'
      );
      shouldFallbackToGemini = !probe.reachable;
    }

    if (shouldFallbackToGemini) {
      const db = getDb();
      const gemConn = db
        .prepare(
          `SELECT id, provider, auth_mode, encrypted_api_key, endpoint, default_model, embedding_model
           FROM model_connections
           WHERE workspace_id = ? AND provider = 'gemini' AND auth_mode = 'platform_managed'
           LIMIT 1`
        )
        .get(workspaceId) as ProviderConnectionRecord | undefined;

      const resolvedConn: ProviderConnectionRecord = gemConn ?? {
        id: 'preview-gemini-fallback',
        provider: 'gemini',
        auth_mode: 'platform_managed',
        encrypted_api_key: null,
        endpoint: null,
        default_model: 'gemini-3.1-flash-lite',
      };
      const fallbackModel =
        resolvedConn.default_model && resolvedConn.default_model !== 'gemini-4-hydrogen'
          ? resolvedConn.default_model
          : 'gemini-3.1-flash-lite';

      return {
        chatbot: {
          ...chatbot,
          model_connection_id: resolvedConn.id,
          model_id: fallbackModel,
        },
        connection: resolvedConn,
      };
    }
  }

  return { chatbot, connection };
}

// ============================================================================
// PUBLIC HEALTH & PLATFORM METADATA
// ============================================================================

app.get('/api/health', async (_req: Request, res: Response) => {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
  const [ollama, qdrant] = await Promise.all([
    discoverOllamaModels(ollamaUrl),
    checkQdrantHealth(),
  ]);
  res.json({
    ok: true,
    localSingleUserMode: !isMultiUserAuthEnabled(),
    multiUserAuthEnabled: isMultiUserAuthEnabled(),
    platformKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    ollama: {
      reachable: ollama.reachable,
      endpoint: ollama.endpoint,
      installedModelsCount: ollama.models.length,
      error: ollama.error,
    },
    qdrant,
  });
});

app.get('/api/platform/metadata', (_req: Request, res: Response) => {
  res.json({
    localSingleUserMode: !isMultiUserAuthEnabled(),
    multiUserAuthEnabled: isMultiUserAuthEnabled(),
    suggestedOllamaModels: SUGGESTED_OLLAMA_MODELS,
    legacyGeminiCatalog: GEMINI_MODEL_CATALOG,
    roadmap: KRESNA_ROADMAP,
    platformKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

// ============================================================================
// SESSION & LEGACY AUTH (Auth screens disabled in Local Single-User MVP Mode)
// ============================================================================

app.get('/api/auth/session', (req: AuthRequest, res: Response) => {
  if (!isMultiUserAuthEnabled()) {
    requireAuth(req, res, () => {
      const auth = req.auth!;
      res.json({
        authenticated: true,
        localSingleUserMode: true,
        user: auth.user,
        activeWorkspace: auth.workspace,
        workspaces: [auth.workspace],
        platformKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      });
    });
    return;
  }

  const authHeader = req.headers.authorization;
  const cookieHeader = req.headers.cookie;
  const hasCreds =
    (authHeader && authHeader.startsWith('Bearer ')) ||
    (cookieHeader && cookieHeader.includes('kresna_session='));
  if (!hasCreds) {
    res.json({ authenticated: false, localSingleUserMode: false });
    return;
  }
  requireAuth(req, res, () => {
    const db = getDb();
    const auth = req.auth!;
    const workspaces = db
      .prepare(
        `SELECT w.id, w.name, w.slug, w.plan, wm.role, w.created_at
         FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = ?
         ORDER BY w.created_at ASC`
      )
      .all(auth.user.id);

    res.json({
      authenticated: true,
      localSingleUserMode: false,
      user: auth.user,
      activeWorkspace: auth.workspace,
      workspaces,
      platformKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });
});

// Legacy auth endpoints remain gated behind ENABLE_MULTI_USER_AUTH=true
app.post('/api/auth/register', (req: Request, res: Response) => {
  if (!isMultiUserAuthEnabled()) {
    res.status(403).json({ error: 'Registration is disabled in Local Single-User Mode.' });
    return;
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const workspaceName =
    typeof req.body?.workspaceName === 'string' ? req.body.workspaceName.trim() : '';

  if (!email || !email.includes('@') || name.length < 2 || password.length < 8) {
    res.status(400).json({ error: 'Valid email, name, and 8+ character password are required.' });
    return;
  }

  const db = getDb();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, email, name, hashPassword(password), now);

  const { workspaceId } = createWorkspaceDefaults(db, {
    userId,
    workspaceName: workspaceName || `${name.split(' ')[0]}'s Workspace`,
    plan: 'starter',
  });
  const token = createSessionForUser(res, userId, workspaceId);
  res.status(201).json({ token, user: { id: userId, email, name }, workspaceId });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  if (!isMultiUserAuthEnabled()) {
    res.status(403).json({ error: 'Login is disabled in Local Single-User Mode.' });
    return;
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const db = getDb();
  const user = db
    .prepare(`SELECT id, email, name, password_hash FROM users WHERE email = ?`)
    .get(email) as { id: string; email: string; name: string; password_hash: string } | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  const membership = db
    .prepare(`SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`)
    .get(user.id) as { workspace_id: string } | undefined;
  if (!membership) {
    res.status(403).json({ error: 'No workspace membership found.' });
    return;
  }
  const token = createSessionForUser(res, user.id, membership.workspace_id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name }, workspaceId: membership.workspace_id });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  clearSession(req, res);
  res.json({ ok: true });
});

// ============================================================================
// AI MODELS & OLLAMA DISCOVERY
// ============================================================================

app.get('/api/models', requireAuth, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const connections = db
    .prepare(
      `SELECT id, workspace_id, name, provider, auth_mode, key_hint, endpoint, default_model, embedding_model, capabilities_json, status, last_tested_at, last_error, created_at
       FROM model_connections
       WHERE workspace_id = ?
       ORDER BY created_at ASC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const ollamaConn = connections.find((c) => c.provider === 'ollama');
  const ollamaEndpoint =
    typeof ollamaConn?.endpoint === 'string' && ollamaConn.endpoint
      ? ollamaConn.endpoint
      : process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

  const [ollamaDiscovery, qdrantHealth] = await Promise.all([
    discoverOllamaModels(ollamaEndpoint),
    checkQdrantHealth(),
  ]);

  res.json({
    connections,
    ollamaDiscovery,
    qdrantHealth,
    suggestedOllamaModels: SUGGESTED_OLLAMA_MODELS,
    legacyGeminiCatalog: GEMINI_MODEL_CATALOG,
    platformKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

app.post('/api/models/ollama/discover', requireAuth, async (req: AuthRequest, res: Response) => {
  const endpoint =
    typeof req.body?.endpoint === 'string' && req.body.endpoint.trim()
      ? req.body.endpoint.trim()
      : process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

  const discovery = await discoverOllamaModels(endpoint);

  if (typeof req.body?.connectionId === 'string' && req.body.connectionId) {
    const db = getDb();
    db.prepare(
      `UPDATE model_connections
       SET endpoint = ?, status = ?, last_tested_at = ?, last_error = ?, capabilities_json = ?
       WHERE id = ? AND workspace_id = ? AND provider = 'ollama'`
    ).run(
      discovery.endpoint,
      discovery.reachable ? 'connected' : 'error',
      new Date().toISOString(),
      discovery.error || null,
      JSON.stringify({
        discoveredModels: discovery.models.map((m) => m.name),
        chatCount: discovery.chatModels.length,
        embeddingCount: discovery.embeddingModels.length,
      }),
      req.body.connectionId,
      req.auth!.workspace.id
    );
  }

  res.json({ discovery });
});

app.post(
  '/api/models',
  requireAuth,
  requireRole(['owner', 'admin', 'developer']),
  async (req: AuthRequest, res: Response) => {
    const auth = req.auth!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const provider =
      req.body?.provider === 'ollama' ||
      req.body?.provider === 'gemini' ||
      req.body?.provider === 'openai_compatible'
        ? req.body.provider
        : 'ollama';
    const authMode =
      provider === 'ollama'
        ? 'local'
        : req.body?.authMode === 'platform_managed'
          ? 'platform_managed'
          : 'byok';
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : null;
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const defaultModel =
      typeof req.body?.defaultModel === 'string' ? req.body.defaultModel.trim() : '';
    const embeddingModel =
      typeof req.body?.embeddingModel === 'string' ? req.body.embeddingModel.trim() : '';
    const testImmediately = Boolean(req.body?.testConnection);

    if (name.length < 2) {
      res.status(400).json({ error: 'Connection name must be at least 2 characters.' });
      return;
    }
    if (provider === 'gemini' && authMode === 'byok' && apiKey.length < 10) {
      res.status(400).json({ error: 'Provide a valid API key for BYOK mode.' });
      return;
    }

    const encryptedKey = authMode === 'byok' && apiKey ? encryptSecret(apiKey) : null;
    const keyHint =
      provider === 'ollama'
        ? endpoint || process.env.OLLAMA_BASE_URL || 'http://ollama:11434'
        : authMode === 'byok'
          ? maskApiKey(apiKey)
          : 'Managed Server Key';

    let status = 'untested';
    let lastTestedAt: string | null = null;
    let lastError: string | null = null;

    const tempRecord: ProviderConnectionRecord = {
      id: 'temp',
      provider,
      auth_mode: authMode,
      encrypted_api_key: encryptedKey,
      endpoint: endpoint || (provider === 'ollama' ? process.env.OLLAMA_BASE_URL || 'http://ollama:11434' : null),
      default_model: defaultModel,
      embedding_model: embeddingModel,
    };

    if (testImmediately) {
      const check = await testProviderConnection({ connection: tempRecord, model: defaultModel });
      status = check.ok ? 'connected' : 'error';
      lastTestedAt = new Date().toISOString();
      lastError = check.ok ? null : check.message;
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO model_connections
        (id, workspace_id, name, provider, auth_mode, encrypted_api_key, key_hint, endpoint, default_model, embedding_model, status, last_tested_at, last_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      auth.workspace.id,
      name,
      provider,
      authMode,
      encryptedKey,
      keyHint,
      tempRecord.endpoint,
      defaultModel,
      embeddingModel,
      status,
      lastTestedAt,
      lastError,
      now
    );

    const created = db
      .prepare(
        `SELECT id, workspace_id, name, provider, auth_mode, key_hint, endpoint, default_model, embedding_model, status, last_tested_at, last_error, created_at
         FROM model_connections WHERE id = ?`
      )
      .get(id);

    res.status(201).json({ connection: created });
  }
);

app.patch('/api/models/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM model_connections WHERE id = ? AND workspace_id = ?`)
    .get(req.params.id, req.auth!.workspace.id) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Model connection not found.' });
    return;
  }

  const endpoint =
    typeof req.body?.endpoint === 'string' && req.body.endpoint.trim()
      ? req.body.endpoint.trim()
      : (existing.endpoint as string | null);
  const defaultModel =
    typeof req.body?.defaultModel === 'string'
      ? req.body.defaultModel.trim()
      : String(existing.default_model ?? '');
  const embeddingModel =
    typeof req.body?.embeddingModel === 'string'
      ? req.body.embeddingModel.trim()
      : String(existing.embedding_model ?? '');

  db.prepare(
    `UPDATE model_connections SET endpoint = ?, default_model = ?, embedding_model = ? WHERE id = ? AND workspace_id = ?`
  ).run(endpoint, defaultModel, embeddingModel, req.params.id, req.auth!.workspace.id);

  const updated = db
    .prepare(
      `SELECT id, workspace_id, name, provider, auth_mode, key_hint, endpoint, default_model, embedding_model, status, last_tested_at, last_error, created_at
       FROM model_connections WHERE id = ?`
    )
    .get(req.params.id);
  res.json({ connection: updated });
});

app.post('/api/models/:id/test', requireAuth, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const conn = db
    .prepare(`SELECT * FROM model_connections WHERE id = ? AND workspace_id = ?`)
    .get(req.params.id, req.auth!.workspace.id) as ProviderConnectionRecord | undefined;

  if (!conn) {
    res.status(404).json({ error: 'Model connection not found.' });
    return;
  }

  const modelToTest =
    typeof req.body?.model === 'string' ? req.body.model.trim() : conn.default_model;
  const result = await testProviderConnection({ connection: conn, model: modelToTest });
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE model_connections SET status = ?, last_tested_at = ?, last_error = ? WHERE id = ?`
  ).run(result.ok ? 'connected' : 'error', now, result.ok ? null : result.message, conn.id);

  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/models/:id/apply-all', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const conn = db
    .prepare(`SELECT id, provider, default_model, embedding_model FROM model_connections WHERE id = ? AND workspace_id = ?`)
    .get(req.params.id, req.auth!.workspace.id) as
    | { id: string; provider: string; default_model: string; embedding_model: string }
    | undefined;

  if (!conn) {
    res.status(404).json({ error: 'Model connection not found.' });
    return;
  }

  const chosenModel =
    (typeof req.body?.model === 'string' && req.body.model.trim()) ||
    conn.default_model ||
    (conn.provider === 'gemini' ? 'gemini-3.1-flash-lite' : '');

  if (!chosenModel) {
    res.status(400).json({ error: 'Configure or enter a default chat model on this connection first.' });
    return;
  }

  const now = new Date().toISOString();
  if (conn.provider === 'gemini') {
    db.prepare(
      `UPDATE model_connections SET default_model = ?, status = 'connected', last_error = NULL WHERE id = ? AND workspace_id = ?`
    ).run(chosenModel, conn.id, req.auth!.workspace.id);
  }
  const result = db
    .prepare(
      `UPDATE chatbots SET model_connection_id = ?, model_id = ?, updated_at = ? WHERE workspace_id = ?`
    )
    .run(conn.id, chosenModel, now, req.auth!.workspace.id);

  res.json({ ok: true, updatedChatbots: Number(result.changes || 0), model: chosenModel });
});

app.delete('/api/models/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const deleted = db
    .prepare(`DELETE FROM model_connections WHERE id = ? AND workspace_id = ?`)
    .run(req.params.id, req.auth!.workspace.id);
  if (deleted.changes === 0) {
    res.status(404).json({ error: 'Model connection not found.' });
    return;
  }
  res.json({ ok: true });
});

// ============================================================================
// CHATBOTS CRUD & PUBLISH
// ============================================================================

app.get('/api/chatbots', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const rows = db
    .prepare(
      `SELECT
        c.*,
        mc.name AS model_connection_name,
        mc.provider AS model_provider,
        mc.status AS model_connection_status,
        mc.auth_mode AS model_auth_mode,
        (SELECT COUNT(*) FROM knowledge_items ki WHERE ki.chatbot_id = c.id) AS knowledge_count,
        (SELECT COUNT(*) FROM conversations cv WHERE cv.chatbot_id = c.id) AS conversation_count
      FROM chatbots c
      LEFT JOIN model_connections mc ON mc.id = c.model_connection_id
      WHERE c.workspace_id = ?
      ORDER BY c.updated_at DESC`
    )
    .all(workspaceId);

  res.json({ chatbots: rows });
});

app.get('/api/chatbots/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const chatbot = db
    .prepare(
      `SELECT c.*, mc.name AS model_connection_name, mc.provider AS model_provider, mc.status AS model_connection_status, mc.auth_mode AS model_auth_mode
       FROM chatbots c
       LEFT JOIN model_connections mc ON mc.id = c.model_connection_id
       WHERE c.id = ? AND c.workspace_id = ?`
    )
    .get(req.params.id, workspaceId) as Record<string, unknown> | undefined;

  if (!chatbot) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }

  const knowledgeItems = db
    .prepare(`SELECT * FROM knowledge_items WHERE chatbot_id = ? AND workspace_id = ? ORDER BY created_at DESC`)
    .all(req.params.id, workspaceId);

  const channels = db
    .prepare(`SELECT * FROM channel_configs WHERE chatbot_id = ? AND workspace_id = ?`)
    .all(req.params.id, workspaceId);

  const connectors = db
    .prepare(
      `SELECT id, name, description, method, url, requires_confirmation, enabled
       FROM api_connectors WHERE workspace_id = ? AND (chatbot_id IS NULL OR chatbot_id = ?)`
    )
    .all(workspaceId, req.params.id);

  const testedCountRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       WHERE cv.chatbot_id = ? AND cv.workspace_id = ? AND m.role = 'assistant'`
    )
    .get(req.params.id, workspaceId) as { count: number };

  const readiness = evaluatePublishReadiness({
    name: String(chatbot.name ?? ''),
    purpose: String(chatbot.purpose ?? ''),
    modelConnectionStatus: String(chatbot.model_connection_status ?? ''),
    modelId: String(chatbot.model_id ?? ''),
    hasTestedConversation: testedCountRow.count > 0,
  });

  res.json({ chatbot, knowledgeItems, channels, connectors, readiness });
});

app.post('/api/chatbots', requireAuth, async (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const db = getDb();
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim() : '';
  const presetKey = (typeof req.body?.preset === 'string'
    ? req.body.preset
    : 'customer_support') as ChatbotPresetKey;
  const preset = getPresetByKey(presetKey);
  const language =
    typeof req.body?.language === 'string' && req.body.language.trim()
      ? req.body.language.trim()
      : 'English';
  const style =
    typeof req.body?.style === 'string' && req.body.style.trim()
      ? req.body.style.trim()
      : preset.defaultStyle;
  const escalationMode =
    typeof req.body?.escalationMode === 'string' && req.body.escalationMode.trim()
      ? req.body.escalationMode.trim()
      : preset.defaultEscalation;
  const welcomeMessage =
    typeof req.body?.welcomeMessage === 'string' && req.body.welcomeMessage.trim()
      ? req.body.welcomeMessage.trim()
      : preset.defaultWelcome;
  const systemInstructions =
    typeof req.body?.systemInstructions === 'string' ? req.body.systemInstructions.trim() : '';
  const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
  const embeddingModelId =
    typeof req.body?.embeddingModelId === 'string' ? req.body.embeddingModelId.trim() : '';
  const mode = req.body?.mode === 'developer' ? 'developer' : 'simple';

  if (name.length < 2) {
    res.status(400).json({ error: 'Chatbot name must be at least 2 characters.' });
    return;
  }
  if (purpose.length < 8) {
    res.status(400).json({ error: 'Purpose must be at least 8 characters.' });
    return;
  }

  let modelConnectionId =
    typeof req.body?.modelConnectionId === 'string' ? req.body.modelConnectionId : '';
  if (!modelConnectionId) {
    const fallbackConn = db
      .prepare(`SELECT id FROM model_connections WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(auth.workspace.id) as { id: string } | undefined;
    modelConnectionId = fallbackConn?.id ?? '';
  }

  const id = crypto.randomUUID();
  const publicBotId = `bot_${id.slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO chatbots
      (id, workspace_id, public_bot_id, name, purpose, preset, language, style, system_instructions, welcome_message, model_connection_id, model_id, embedding_connection_id, embedding_model_id, escalation_mode, max_output_tokens, mode, status, widget_config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    auth.workspace.id,
    publicBotId,
    name,
    purpose,
    preset.key,
    language,
    style,
    systemInstructions,
    welcomeMessage,
    modelConnectionId || null,
    modelId,
    modelConnectionId || null,
    embeddingModelId,
    escalationMode,
    1024,
    mode,
    JSON.stringify({
      accentColor: '#1D4ED8',
      position: 'bottom-right',
      title: name,
      subtitle: 'KRESNA AI Support',
      allowedDomains: ['localhost', '127.0.0.1'],
    }),
    now,
    now
  );

  // Optional starter knowledge items from Step 2
  const starterItems = Array.isArray(req.body?.starterKnowledge)
    ? req.body.starterKnowledge
    : [];
  for (const item of starterItems) {
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    const sourceType = item?.sourceType === 'note' ? 'note' : 'faq';
    if (title && content) {
      await ingestManualKnowledgeRecord({
        workspaceId: auth.workspace.id,
        chatbotId: id,
        title,
        sourceType,
        content,
      });
    }
  }

  // Optional cloning/attaching existing workspace knowledge IDs
  const attachIds = Array.isArray(req.body?.existingKnowledgeIds)
    ? req.body.existingKnowledgeIds
    : [];
  for (const srcId of attachIds) {
    if (typeof srcId !== 'string') continue;
    const src = db
      .prepare(`SELECT title, source_type, content FROM knowledge_items WHERE id = ? AND workspace_id = ?`)
      .get(srcId, auth.workspace.id) as { title: string; source_type: string; content: string } | undefined;
    if (src && src.content) {
      await ingestManualKnowledgeRecord({
        workspaceId: auth.workspace.id,
        chatbotId: id,
        title: src.title,
        sourceType: src.source_type === 'note' ? 'note' : 'faq',
        content: src.content,
      });
    }
  }

  db.prepare(
    `INSERT INTO channel_configs (id, workspace_id, chatbot_id, channel_type, status, config_json, updated_at)
     VALUES (?, ?, ?, 'website', 'configured', ?, ?)`
  ).run(
    crypto.randomUUID(),
    auth.workspace.id,
    id,
    JSON.stringify({ accentColor: '#1D4ED8', position: 'bottom-right', allowedDomains: ['localhost', '127.0.0.1'] }),
    now
  );

  recordAudit(auth.workspace.id, auth.user.id, 'chatbot.created', 'chatbot', id, { name });
  const created = db.prepare(`SELECT * FROM chatbots WHERE id = ?`).get(id);
  res.status(201).json({ chatbot: created });
});

app.patch('/api/chatbots/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM chatbots WHERE id = ? AND workspace_id = ?`)
    .get(req.params.id, auth.workspace.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }

  const name =
    typeof req.body?.name === 'string' && req.body.name.trim().length >= 2
      ? req.body.name.trim()
      : String(existing.name);
  const purpose =
    typeof req.body?.purpose === 'string' && req.body.purpose.trim().length >= 8
      ? req.body.purpose.trim()
      : String(existing.purpose);
  const language =
    typeof req.body?.language === 'string' && req.body.language.trim()
      ? req.body.language.trim()
      : String(existing.language);
  const style =
    typeof req.body?.style === 'string' && req.body.style.trim()
      ? req.body.style.trim()
      : String(existing.style);
  const escalationMode =
    typeof req.body?.escalationMode === 'string'
      ? req.body.escalationMode.trim()
      : String(existing.escalation_mode ?? '');
  const systemInstructions =
    typeof req.body?.systemInstructions === 'string'
      ? req.body.systemInstructions.trim()
      : String(existing.system_instructions ?? '');
  const welcomeMessage =
    typeof req.body?.welcomeMessage === 'string' && req.body.welcomeMessage.trim()
      ? req.body.welcomeMessage.trim()
      : String(existing.welcome_message);
  const modelId =
    typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : String(existing.model_id);
  const embeddingModelId =
    typeof req.body?.embeddingModelId === 'string'
      ? req.body.embeddingModelId.trim()
      : String(existing.embedding_model_id ?? '');
  const modelConnectionId =
    typeof req.body?.modelConnectionId === 'string'
      ? req.body.modelConnectionId
      : (existing.model_connection_id as string | null);
  const mode =
    req.body?.mode === 'developer' || req.body?.mode === 'simple'
      ? req.body.mode
      : String(existing.mode);

  let widgetConfigJson = String(existing.widget_config_json || '{}');
  if (req.body?.widgetConfig && typeof req.body.widgetConfig === 'object') {
    let prev: Record<string, unknown> = {};
    try {
      prev = JSON.parse(widgetConfigJson);
    } catch {
      prev = {};
    }
    widgetConfigJson = JSON.stringify({ ...prev, ...req.body.widgetConfig });
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE chatbots
     SET name = ?, purpose = ?, language = ?, style = ?, escalation_mode = ?, system_instructions = ?, welcome_message = ?, model_connection_id = ?, model_id = ?, embedding_model_id = ?, mode = ?, widget_config_json = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`
  ).run(
    name,
    purpose,
    language,
    style,
    escalationMode,
    systemInstructions,
    welcomeMessage,
    modelConnectionId || null,
    modelId,
    embeddingModelId,
    mode,
    widgetConfigJson,
    now,
    req.params.id,
    auth.workspace.id
  );

  const updated = db.prepare(`SELECT * FROM chatbots WHERE id = ?`).get(req.params.id);
  res.json({ chatbot: updated });
});

app.post('/api/chatbots/:id/publish', requireAuth, (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM chatbots WHERE id = ? AND workspace_id = ?`)
    .get(req.params.id, auth.workspace.id);
  if (!existing) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }

  const nextStatus = req.body?.status === 'draft' ? 'draft' : 'published';
  const now = new Date().toISOString();
  db.prepare(`UPDATE chatbots SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`).run(
    nextStatus,
    now,
    req.params.id,
    auth.workspace.id
  );
  recordAudit(auth.workspace.id, auth.user.id, `chatbot.${nextStatus}`, 'chatbot', req.params.id);
  res.json({ ok: true, status: nextStatus });
});

app.delete('/api/chatbots/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const db = getDb();
  db.prepare(`DELETE FROM knowledge_chunks_fts WHERE chatbot_id = ? AND workspace_id = ?`).run(
    req.params.id,
    auth.workspace.id
  );
  const deleted = db
    .prepare(`DELETE FROM chatbots WHERE id = ? AND workspace_id = ?`)
    .run(req.params.id, auth.workspace.id);
  if (deleted.changes === 0) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }
  recordAudit(auth.workspace.id, auth.user.id, 'chatbot.deleted', 'chatbot', req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// KNOWLEDGE INGESTION, PREVIEW, REINDEX & HYBRID RETRIEVAL TESTING
// ============================================================================

app.get('/api/knowledge', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const chatbotId = typeof req.query.chatbotId === 'string' ? req.query.chatbotId : '';

  const rows = chatbotId
    ? db
        .prepare(
          `SELECT ki.*, c.name AS chatbot_name
           FROM knowledge_items ki
           JOIN chatbots c ON c.id = ki.chatbot_id
           WHERE ki.workspace_id = ? AND ki.chatbot_id = ?
           ORDER BY ki.created_at DESC`
        )
        .all(workspaceId, chatbotId)
    : db
        .prepare(
          `SELECT ki.*, c.name AS chatbot_name
           FROM knowledge_items ki
           JOIN chatbots c ON c.id = ki.chatbot_id
           WHERE ki.workspace_id = ?
           ORDER BY ki.created_at DESC`
        )
        .all(workspaceId);

  res.json({ items: rows });
});

app.post(
  '/api/knowledge/upload',
  requireAuth,
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    const auth = req.auth!;
    const db = getDb();
    const chatbotId = typeof req.body?.chatbotId === 'string' ? req.body.chatbotId : '';
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const file = req.file;

    if (!chatbotId) {
      res.status(400).json({ error: 'Select a target chatbot for this knowledge file.' });
      return;
    }
    const bot = db
      .prepare(`SELECT id FROM chatbots WHERE id = ? AND workspace_id = ?`)
      .get(chatbotId, auth.workspace.id);
    if (!bot) {
      res.status(404).json({ error: 'Target chatbot not found.' });
      return;
    }
    if (!file) {
      res.status(400).json({ error: 'Select a file to upload (XLSX, CSV, PDF, DOCX, TXT, HTML).' });
      return;
    }

    try {
      const result = await ingestUploadedKnowledgeFile({
        workspaceId: auth.workspace.id,
        chatbotId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
        title,
      });
      res.status(201).json(result);
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'File ingestion failed.',
      });
    }
  }
);

app.post('/api/knowledge/url', requireAuth, async (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const db = getDb();
  const chatbotId = typeof req.body?.chatbotId === 'string' ? req.body.chatbotId : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';

  if (!chatbotId || !url) {
    res.status(400).json({ error: 'Provide both a chatbotId and website URL.' });
    return;
  }
  const bot = db
    .prepare(`SELECT id FROM chatbots WHERE id = ? AND workspace_id = ?`)
    .get(chatbotId, auth.workspace.id);
  if (!bot) {
    res.status(404).json({ error: 'Target chatbot not found.' });
    return;
  }

  try {
    const result = await ingestWebsiteUrl({
      workspaceId: auth.workspace.id,
      chatbotId,
      url,
      title,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Website ingestion failed.',
    });
  }
});

app.post('/api/chatbots/:id/knowledge', requireAuth, async (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const db = getDb();
  const bot = db
    .prepare(`SELECT id FROM chatbots WHERE id = ? AND workspace_id = ?`)
    .get(req.params.id, auth.workspace.id);
  if (!bot) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const sourceType = req.body?.sourceType === 'note' ? 'note' : 'faq';

  if (title.length < 2 || content.length < 5) {
    res.status(400).json({ error: 'Provide both a title and knowledge content.' });
    return;
  }

  const result = await ingestManualKnowledgeRecord({
    workspaceId: auth.workspace.id,
    chatbotId: req.params.id,
    title,
    sourceType,
    content,
  });
  res.status(201).json(result);
});

app.get('/api/knowledge/:itemId/chunks', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const item = db
    .prepare(`SELECT * FROM knowledge_items WHERE id = ? AND workspace_id = ?`)
    .get(req.params.itemId, workspaceId);
  if (!item) {
    res.status(404).json({ error: 'Knowledge item not found.' });
    return;
  }
  const chunks = db
    .prepare(
      `SELECT id, chunk_index, content, metadata_json, token_estimate, created_at
       FROM knowledge_chunks WHERE knowledge_item_id = ? AND workspace_id = ? ORDER BY chunk_index ASC LIMIT 100`
    )
    .all(req.params.itemId, workspaceId);
  res.json({ item, chunks });
});

app.post('/api/knowledge/:itemId/reindex', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await reindexKnowledgeItem({
      workspaceId: req.auth!.workspace.id,
      itemId: req.params.itemId,
    });
    res.json({ ok: true, indexing: result });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Reindexing failed.' });
  }
});

app.post('/api/knowledge/test-retrieval', requireAuth, async (req: AuthRequest, res: Response) => {
  const chatbotId = typeof req.body?.chatbotId === 'string' ? req.body.chatbotId : '';
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!chatbotId || !query) {
    res.status(400).json({ error: 'Select a chatbot and enter a retrieval query.' });
    return;
  }
  const result = await retrieveHybridKnowledge({
    workspaceId: req.auth!.workspace.id,
    chatbotId,
    query,
    topK: 6,
  });
  res.json(result);
});

app.delete('/api/knowledge/:itemId', requireAuth, async (req: AuthRequest, res: Response) => {
  const ok = await removeKnowledgeItem({
    workspaceId: req.auth!.workspace.id,
    itemId: req.params.itemId,
  });
  if (!ok) {
    res.status(404).json({ error: 'Knowledge item not found.' });
    return;
  }
  res.json({ ok: true });
});

app.delete(
  '/api/chatbots/:id/knowledge/:itemId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const ok = await removeKnowledgeItem({
      workspaceId: req.auth!.workspace.id,
      itemId: req.params.itemId,
    });
    if (!ok) {
      res.status(404).json({ error: 'Knowledge item not found.' });
      return;
    }
    res.json({ ok: true });
  }
);

// ============================================================================
// AGENTIC PLAYGROUND (Supports JSON and SSE Streaming)
// ============================================================================

app.post('/api/chatbots/:id/playground', requireAuth, async (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const db = getDb();
  const userMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const requestedConversationId =
    typeof req.body?.conversationId === 'string' ? req.body.conversationId : '';

  if (!userMessage) {
    res.status(400).json({ error: 'Message cannot be empty.' });
    return;
  }

  const row = db
    .prepare(
      `SELECT
        c.*,
        mc.id AS mc_id,
        mc.provider AS mc_provider,
        mc.auth_mode AS mc_auth_mode,
        mc.encrypted_api_key AS mc_encrypted_api_key,
        mc.endpoint AS mc_endpoint,
        mc.default_model AS mc_default_model
       FROM chatbots c
       LEFT JOIN model_connections mc ON mc.id = c.model_connection_id
       WHERE c.id = ? AND c.workspace_id = ?`
    )
    .get(req.params.id, auth.workspace.id) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }

  const connection: ProviderConnectionRecord = row.mc_id
    ? {
        id: String(row.mc_id),
        provider: String(row.mc_provider || 'ollama'),
        auth_mode: String(row.mc_auth_mode || 'local'),
        encrypted_api_key: (row.mc_encrypted_api_key as string | null) ?? null,
        endpoint: (row.mc_endpoint as string | null) ?? (process.env.OLLAMA_BASE_URL || 'http://ollama:11434'),
        default_model: String(row.mc_default_model || ''),
      }
    : {
        id: 'default-ollama',
        provider: 'ollama',
        auth_mode: 'local',
        encrypted_api_key: null,
        endpoint: process.env.OLLAMA_BASE_URL || 'http://ollama:11434',
        default_model: String(row.model_id || ''),
      };

  const chatbot: ChatbotRuntimeRecord = {
    id: String(row.id),
    workspace_id: auth.workspace.id,
    public_bot_id: String(row.public_bot_id),
    name: String(row.name),
    purpose: String(row.purpose),
    preset: String(row.preset) as ChatbotPresetKey,
    language: String(row.language || 'English'),
    style: String(row.style || ''),
    escalation_mode: String(row.escalation_mode || ''),
    system_instructions: String(row.system_instructions || ''),
    welcome_message: String(row.welcome_message || ''),
    model_connection_id: (row.model_connection_id as string | null) ?? null,
    model_id: String(row.model_id || connection.default_model || ''),
    max_output_tokens: Number(row.max_output_tokens || 1024),
  };

  const resolvedTarget = await resolveRuntimeExecutionTarget({
    workspaceId: auth.workspace.id,
    chatbot,
    connection,
  });
  const activeChatbot = resolvedTarget.chatbot;
  const activeConnection = resolvedTarget.connection;

  if (!activeChatbot.model_id) {
    res.status(400).json({
      error:
        'No AI model is selected for this chatbot. Go to AI Models to select Gemini or configure Ollama.',
    });
    return;
  }

  const wantsStream = (req.headers.accept || '').includes('text/event-stream');
  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  try {
    const result = await runAgentTurn({
      workspaceId: auth.workspace.id,
      chatbot: activeChatbot,
      connection: activeConnection,
      userMessage,
      channelType: 'playground',
      externalUserId: auth.user.email,
      conversationId: requestedConversationId || undefined,
      onToken: wantsStream
        ? (token) => {
            res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
          }
        : undefined,
    });

    if (wantsStream) {
      res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
      return;
    }
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `INSERT INTO usage_events (id, workspace_id, chatbot_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, latency_ms, success, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`
    ).run(
      crypto.randomUUID(),
      auth.workspace.id,
      chatbot.id,
      connection.provider,
      chatbot.model_id,
      message,
      new Date().toISOString()
    );

    if (wantsStream) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
      return;
    }
    res.status(502).json({ error: message });
  }
});

app.post('/api/messages/:id/feedback', requireAuth, (req: AuthRequest, res: Response) => {
  const feedback = req.body?.feedback === 'up' || req.body?.feedback === 'down' ? req.body.feedback : null;
  const db = getDb();
  const updated = db
    .prepare(`UPDATE messages SET feedback = ? WHERE id = ? AND workspace_id = ? AND role = 'assistant'`)
    .run(feedback, req.params.id, req.auth!.workspace.id);
  if (updated.changes === 0) {
    res.status(404).json({ error: 'Message not found.' });
    return;
  }
  res.json({ ok: true, feedback });
});

// ============================================================================
// PUBLIC WEBSITE WIDGET ENDPOINTS (Separated from Admin Dashboard)
// ============================================================================

app.get('/widget.js', (_req: Request, res: Response) => {
  const filePath = path.resolve(process.cwd(), 'public', 'widget.js');
  if (!fs.existsSync(filePath)) {
    res.status(404).send('// widget.js not found');
    return;
  }
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(filePath);
});

app.get('/widget-preview/:publicBotId', (req: Request, res: Response) => {
  const safeId = String(req.params.publicBotId).replace(/[^a-zA-Z0-9_-]/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KRESNA Website Widget Live Preview</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 48px 24px; }
    .card { max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Website Widget Live Host Preview</h1>
    <p>This isolated test page loads <code>/widget.js</code> for bot ID <code>${safeId}</code> just like an external customer website.</p>
    <p>Use the chat launcher in the bottom corner to test multi-turn memory, knowledge citations, streaming, and feedback.</p>
  </div>
  <script src="/widget.js" data-bot-id="${safeId}" data-open="true"></script>
</body>
</html>`);
});

app.options('/api/widget/:publicBotId/*', (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.status(204).end();
});

app.get('/api/widget/:publicBotId/config', (req: Request, res: Response) => {
  const db = getDb();
  const bot = db
    .prepare(
      `SELECT id, name, welcome_message, status, widget_config_json
       FROM chatbots WHERE public_bot_id = ?`
    )
    .get(req.params.publicBotId) as
    | {
        id: string;
        name: string;
        welcome_message: string;
        status: string;
        widget_config_json: string;
      }
    | undefined;

  if (!bot) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }
  if (bot.status !== 'published') {
    res.status(403).json({ error: 'This chatbot is currently in draft mode and not published.' });
    return;
  }
  if (!isOriginAllowedForWidget(req, bot.widget_config_json)) {
    res.status(403).json({ error: 'This website domain is not in the chatbot allowed domains list.' });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  let widgetConfig: Record<string, unknown> = {};
  try {
    widgetConfig = JSON.parse(bot.widget_config_json || '{}');
  } catch {
    widgetConfig = {};
  }

  res.json({
    name: bot.name,
    title: widgetConfig.title || bot.name,
    subtitle: widgetConfig.subtitle || 'Online · KRESNA Agent',
    accentColor: widgetConfig.accentColor || '#1D4ED8',
    position: widgetConfig.position || 'bottom-right',
    welcomeMessage: bot.welcome_message,
  });
});

app.post('/api/widget/:publicBotId/chat', async (req: Request, res: Response) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        c.*,
        mc.id AS mc_id,
        mc.provider AS mc_provider,
        mc.auth_mode AS mc_auth_mode,
        mc.encrypted_api_key AS mc_encrypted_api_key,
        mc.endpoint AS mc_endpoint,
        mc.default_model AS mc_default_model
       FROM chatbots c
       LEFT JOIN model_connections mc ON mc.id = c.model_connection_id
       WHERE c.public_bot_id = ?`
    )
    .get(req.params.publicBotId) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Chatbot not found.' });
    return;
  }
  if (row.status !== 'published') {
    res.status(403).json({ error: 'This chatbot is not published.' });
    return;
  }
  if (!isOriginAllowedForWidget(req, String(row.widget_config_json || '{}'))) {
    res.status(403).json({ error: 'Domain is not allowlisted for this widget.' });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const userMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const requestedConvId =
    typeof req.body?.conversationId === 'string' ? req.body.conversationId : '';

  if (!userMessage || userMessage.length > 4000) {
    res.status(400).json({ error: 'Provide a message between 1 and 4000 characters.' });
    return;
  }

  const connection: ProviderConnectionRecord = row.mc_id
    ? {
        id: String(row.mc_id),
        provider: String(row.mc_provider || 'ollama'),
        auth_mode: String(row.mc_auth_mode || 'local'),
        encrypted_api_key: (row.mc_encrypted_api_key as string | null) ?? null,
        endpoint: (row.mc_endpoint as string | null) ?? (process.env.OLLAMA_BASE_URL || 'http://ollama:11434'),
        default_model: String(row.mc_default_model || ''),
      }
    : {
        id: 'default-ollama',
        provider: 'ollama',
        auth_mode: 'local',
        encrypted_api_key: null,
        endpoint: process.env.OLLAMA_BASE_URL || 'http://ollama:11434',
        default_model: String(row.model_id || ''),
      };

  const chatbot: ChatbotRuntimeRecord = {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    public_bot_id: String(row.public_bot_id),
    name: String(row.name),
    purpose: String(row.purpose),
    preset: String(row.preset) as ChatbotPresetKey,
    language: String(row.language || 'English'),
    style: String(row.style || ''),
    escalation_mode: String(row.escalation_mode || ''),
    system_instructions: String(row.system_instructions || ''),
    welcome_message: String(row.welcome_message || ''),
    model_connection_id: (row.model_connection_id as string | null) ?? null,
    model_id: String(row.model_id || connection.default_model || ''),
    max_output_tokens: Number(row.max_output_tokens || 1024),
  };

  const resolvedTarget = await resolveRuntimeExecutionTarget({
    workspaceId: chatbot.workspace_id,
    chatbot,
    connection,
  });
  const activeChatbot = resolvedTarget.chatbot;
  const activeConnection = resolvedTarget.connection;

  if (!activeChatbot.model_id) {
    res.status(503).json({ error: 'Chatbot AI model is not configured yet.' });
    return;
  }

  const wantsStream = (req.headers.accept || '').includes('text/event-stream');
  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  try {
    const result = await runAgentTurn({
      workspaceId: activeChatbot.workspace_id,
      chatbot: activeChatbot,
      connection: activeConnection,
      userMessage,
      channelType: 'widget',
      externalUserId: `web:${getHostnameFromHeader(req.headers.origin) || 'visitor'}`,
      conversationId: requestedConvId || undefined,
      onToken: wantsStream
        ? (token) => {
            res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
          }
        : undefined,
    });

    const citations = result.trace.retrievalSources.map((s) => s.citation);
    const suggestedFollowups = result.trace.suggestedFollowups || [];
    if (wantsStream) {
      res.write(
        `event: done\ndata: ${JSON.stringify({
          conversationId: result.conversationId,
          messageId: result.assistantMessage.id,
          content: result.assistantMessage.content,
          citations,
          suggestedFollowups,
        })}\n\n`
      );
      res.end();
      return;
    }

    res.json({
      conversationId: result.conversationId,
      assistantMessage: {
        id: result.assistantMessage.id,
        content: result.assistantMessage.content,
      },
      citations,
      suggestedFollowups,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Assistant error';
    if (wantsStream) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
      return;
    }
    res.status(502).json({ error: message });
  }
});

app.post('/api/widget/:publicBotId/feedback', (req: Request, res: Response) => {
  const db = getDb();
  const bot = db
    .prepare(`SELECT id, workspace_id, widget_config_json FROM chatbots WHERE public_bot_id = ?`)
    .get(req.params.publicBotId) as
    | { id: string; workspace_id: string; widget_config_json: string }
    | undefined;
  if (!bot || !isOriginAllowedForWidget(req, bot.widget_config_json)) {
    res.status(403).json({ error: 'Widget access denied.' });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId : '';
  const feedback = req.body?.feedback === 'up' || req.body?.feedback === 'down' ? req.body.feedback : null;
  if (!messageId) {
    res.status(400).json({ error: 'messageId required.' });
    return;
  }

  db.prepare(
    `UPDATE messages SET feedback = ?
     WHERE id = ? AND workspace_id = ? AND role = 'assistant'
       AND conversation_id IN (SELECT id FROM conversations WHERE chatbot_id = ? AND channel_type = 'widget')`
  ).run(feedback, messageId, bot.workspace_id, bot.id);

  res.json({ ok: true });
});

// ============================================================================
// REST API CONNECTORS, TICKETS & EXECUTION LOGS
// ============================================================================

app.get('/api/connectors', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const connectors = db
    .prepare(
      `SELECT ac.id, ac.workspace_id, ac.chatbot_id, c.name AS chatbot_name, ac.name, ac.description, ac.method, ac.url, ac.headers_json, ac.query_params_json, ac.body_template_json, ac.auth_type, ac.input_schema_json, ac.requires_confirmation, ac.enabled, ac.created_at, ac.updated_at
       FROM api_connectors ac
       LEFT JOIN chatbots c ON c.id = ac.chatbot_id
       WHERE ac.workspace_id = ?
       ORDER BY ac.created_at DESC`
    )
    .all(workspaceId);

  const logs = db
    .prepare(
      `SELECT l.*, ac.name AS connector_name
       FROM connector_execution_logs l
       LEFT JOIN api_connectors ac ON ac.id = l.connector_id
       WHERE l.workspace_id = ?
       ORDER BY l.created_at DESC LIMIT 30`
    )
    .all(workspaceId);

  const tickets = db
    .prepare(
      `SELECT t.*, c.name AS chatbot_name
       FROM support_tickets t
       LEFT JOIN chatbots c ON c.id = t.chatbot_id
       WHERE t.workspace_id = ?
       ORDER BY t.created_at DESC LIMIT 30`
    )
    .all(workspaceId);

  res.json({ connectors, logs, tickets });
});

app.post('/api/connectors', requireAuth, async (req: AuthRequest, res: Response) => {
  const auth = req.auth!;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(
    String(req.body?.method || 'GET').toUpperCase()
  )
    ? String(req.body.method).toUpperCase()
    : 'GET';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const chatbotId = typeof req.body?.chatbotId === 'string' && req.body.chatbotId ? req.body.chatbotId : null;
  const authType = ['none', 'bearer', 'api_key', 'basic'].includes(String(req.body?.authType))
    ? String(req.body.authType)
    : 'none';
  const requiresConfirmation =
    typeof req.body?.requiresConfirmation === 'boolean'
      ? req.body.requiresConfirmation
      : ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (name.length < 2 || description.length < 4 || !url) {
    res.status(400).json({ error: 'Name, description, and endpoint URL are required.' });
    return;
  }

  try {
    // Strip template placeholders temporarily to validate base host against SSRF
    const urlForCheck = url.replace(/\{\{[^}]+\}\}/g, 'sample');
    await assertSafeExternalUrl(urlForCheck);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid URL.' });
    return;
  }

  const encryptedAuth =
    authType !== 'none' && req.body?.authConfig
      ? encryptSecret(JSON.stringify(req.body.authConfig))
      : null;

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO api_connectors
      (id, workspace_id, chatbot_id, name, description, method, url, headers_json, query_params_json, body_template_json, auth_type, encrypted_auth_config, input_schema_json, requires_confirmation, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    auth.workspace.id,
    chatbotId,
    name,
    description,
    method,
    url,
    JSON.stringify(req.body?.headers || {}),
    JSON.stringify(req.body?.queryParams || {}),
    JSON.stringify(req.body?.bodyTemplate || {}),
    authType,
    encryptedAuth,
    JSON.stringify(req.body?.inputSchema || {}),
    requiresConfirmation ? 1 : 0,
    now,
    now
  );

  const created = db
    .prepare(
      `SELECT id, workspace_id, chatbot_id, name, description, method, url, headers_json, query_params_json, body_template_json, auth_type, input_schema_json, requires_confirmation, enabled, created_at, updated_at
       FROM api_connectors WHERE id = ?`
    )
    .get(id);
  res.status(201).json({ connector: created });
});

app.post('/api/connectors/:id/test', requireAuth, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const connector = db
    .prepare(`SELECT * FROM api_connectors WHERE id = ? AND workspace_id = ?`)
    .get(req.params.id, req.auth!.workspace.id) as ApiConnectorRow | undefined;
  if (!connector) {
    res.status(404).json({ error: 'Connector not found.' });
    return;
  }
  const args =
    req.body?.args && typeof req.body.args === 'object' ? (req.body.args as Record<string, unknown>) : {};
  const result = await executeApiConnector({
    connector,
    args,
    workspaceId: req.auth!.workspace.id,
  });
  res.status(result.ok ? 200 : 400).json(result);
});

app.delete('/api/connectors/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const deleted = db
    .prepare(`DELETE FROM api_connectors WHERE id = ? AND workspace_id = ?`)
    .run(req.params.id, req.auth!.workspace.id);
  if (deleted.changes === 0) {
    res.status(404).json({ error: 'Connector not found.' });
    return;
  }
  res.json({ ok: true });
});

app.patch('/api/tickets/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const status = ['open', 'in_progress', 'resolved'].includes(String(req.body?.status))
    ? String(req.body.status)
    : null;
  if (!status) {
    res.status(400).json({ error: 'Invalid ticket status.' });
    return;
  }
  const db = getDb();
  db.prepare(`UPDATE support_tickets SET status = ? WHERE id = ? AND workspace_id = ?`).run(
    status,
    req.params.id,
    req.auth!.workspace.id
  );
  res.json({ ok: true, status });
});

// ============================================================================
// CONVERSATIONS, MEMORY, ANALYTICS, EVALUATIONS & BACKUP
// ============================================================================

app.get('/api/conversations', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const chatbotId = typeof req.query.chatbotId === 'string' ? req.query.chatbotId : '';

  const rows = chatbotId
    ? db
        .prepare(
          `SELECT cv.*, c.name AS chatbot_name,
            (SELECT content FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cv.id) AS message_count,
            (SELECT AVG(latency_ms) FROM messages m WHERE m.conversation_id = cv.id AND m.role = 'assistant') AS avg_latency_ms
           FROM conversations cv
           JOIN chatbots c ON c.id = cv.chatbot_id
           WHERE cv.workspace_id = ? AND cv.chatbot_id = ?
           ORDER BY cv.updated_at DESC`
        )
        .all(workspaceId, chatbotId)
    : db
        .prepare(
          `SELECT cv.*, c.name AS chatbot_name,
            (SELECT content FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cv.id) AS message_count,
            (SELECT AVG(latency_ms) FROM messages m WHERE m.conversation_id = cv.id AND m.role = 'assistant') AS avg_latency_ms
           FROM conversations cv
           JOIN chatbots c ON c.id = cv.chatbot_id
           WHERE cv.workspace_id = ?
           ORDER BY cv.updated_at DESC`
        )
        .all(workspaceId);

  res.json({ conversations: rows });
});

app.get('/api/conversations/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;
  const conv = db
    .prepare(
      `SELECT cv.*, c.name AS chatbot_name
       FROM conversations cv
       JOIN chatbots c ON c.id = cv.chatbot_id
       WHERE cv.id = ? AND cv.workspace_id = ?`
    )
    .get(req.params.id, workspaceId);
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  const messages = db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? AND workspace_id = ? ORDER BY created_at ASC`)
    .all(req.params.id, workspaceId);
  const memory = loadConversationMemory(req.params.id);
  res.json({ conversation: conv, messages, memory });
});

app.patch('/api/conversations/:id/status', requireAuth, (req: AuthRequest, res: Response) => {
  const status =
    req.body?.status === 'resolved' || req.body?.status === 'escalated' || req.body?.status === 'active'
      ? req.body.status
      : null;
  if (!status) {
    res.status(400).json({ error: 'Invalid status.' });
    return;
  }
  const db = getDb();
  const result = db
    .prepare(`UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(status, new Date().toISOString(), req.params.id, req.auth!.workspace.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  res.json({ ok: true, status });
});

app.get('/api/analytics/overview', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const workspaceId = req.auth!.workspace.id;

  const convStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total_conversations,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_conversations,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_conversations,
        SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) AS escalated_conversations
       FROM conversations WHERE workspace_id = ?`
    )
    .get(workspaceId) as {
    total_conversations: number;
    active_conversations: number | null;
    resolved_conversations: number | null;
    escalated_conversations: number | null;
  };

  const messageStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total_messages,
        SUM(CASE WHEN feedback = 'up' THEN 1 ELSE 0 END) AS positive_feedback,
        SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END) AS negative_feedback,
        AVG(CASE WHEN role = 'assistant' AND latency_ms > 0 THEN latency_ms ELSE NULL END) AS avg_latency_ms
       FROM messages WHERE workspace_id = ?`
    )
    .get(workspaceId) as {
    total_messages: number;
    positive_feedback: number | null;
    negative_feedback: number | null;
    avg_latency_ms: number | null;
  };

  const execStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total_executions,
        SUM(CASE WHEN retrieval_count > 0 THEN 1 ELSE 0 END) AS retrieval_turns,
        SUM(CASE WHEN tool_calls_json != '[]' THEN 1 ELSE 0 END) AS tool_turns,
        SUM(CASE WHEN unanswered = 1 THEN 1 ELSE 0 END) AS unanswered_count
       FROM execution_logs WHERE workspace_id = ?`
    )
    .get(workspaceId) as {
    total_executions: number;
    retrieval_turns: number | null;
    tool_turns: number | null;
    unanswered_count: number | null;
  };

  const usageStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successful_requests,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed_requests,
        SUM(input_tokens) AS total_input_tokens,
        SUM(output_tokens) AS total_output_tokens
       FROM usage_events WHERE workspace_id = ?`
    )
    .get(workspaceId) as {
    total_requests: number;
    successful_requests: number | null;
    failed_requests: number | null;
    total_input_tokens: number | null;
    total_output_tokens: number | null;
  };

  const modelBreakdown = db
    .prepare(
      `SELECT
        model,
        provider,
        COUNT(*) AS requests,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed_requests,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        AVG(CASE WHEN latency_ms > 0 THEN latency_ms ELSE NULL END) AS avg_latency_ms
       FROM usage_events
       WHERE workspace_id = ?
       GROUP BY model, provider
       ORDER BY requests DESC`
    )
    .all(workspaceId);

  const unansweredQuestions = db
    .prepare(
      `SELECT el.id, el.user_message, el.assistant_response, el.created_at, c.name AS chatbot_name
       FROM execution_logs el
       JOIN chatbots c ON c.id = el.chatbot_id
       WHERE el.workspace_id = ? AND el.unanswered = 1
       ORDER BY el.created_at DESC LIMIT 15`
    )
    .all(workspaceId);

  const recentExecutions = db
    .prepare(
      `SELECT el.id, el.conversation_id, el.chatbot_id, c.name AS chatbot_name, el.channel_type, el.user_message, el.model, el.provider, el.model_latency_ms, el.total_response_ms, el.iterations, el.retrieval_count, el.tool_calls_json, el.unanswered, el.created_at
       FROM execution_logs el
       JOIN chatbots c ON c.id = el.chatbot_id
       WHERE el.workspace_id = ?
       ORDER BY el.created_at DESC LIMIT 25`
    )
    .all(workspaceId);

  const botCounts = db
    .prepare(
      `SELECT
        COUNT(*) AS total_chatbots,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published_chatbots
       FROM chatbots WHERE workspace_id = ?`
    )
    .get(workspaceId) as { total_chatbots: number; published_chatbots: number | null };

  const knowledgeCounts = db
    .prepare(
      `SELECT COUNT(*) AS total_sources, COALESCE(SUM(chunk_count), 0) AS total_chunks
       FROM knowledge_items WHERE workspace_id = ?`
    )
    .get(workspaceId) as { total_sources: number; total_chunks: number };

  const posFeedback = messageStats.positive_feedback || 0;
  const negFeedback = messageStats.negative_feedback || 0;
  const totalFeedback = posFeedback + negFeedback;

  res.json({
    overview: {
      totalChatbots: botCounts.total_chatbots || 0,
      publishedChatbots: botCounts.published_chatbots || 0,
      totalKnowledgeSources: knowledgeCounts.total_sources || 0,
      totalKnowledgeChunks: knowledgeCounts.total_chunks || 0,
      totalConversations: convStats.total_conversations || 0,
      activeConversations: convStats.active_conversations || 0,
      resolvedConversations: convStats.resolved_conversations || 0,
      escalatedConversations: convStats.escalated_conversations || 0,
      totalMessages: messageStats.total_messages || 0,
      satisfactionRate: totalFeedback > 0 ? Math.round((posFeedback / totalFeedback) * 100) : null,
      positiveFeedback: posFeedback,
      negativeFeedback: negFeedback,
      avgLatencyMs: messageStats.avg_latency_ms ? Math.round(messageStats.avg_latency_ms) : 0,
      totalRequests: usageStats.total_requests || 0,
      successfulRequests: usageStats.successful_requests || 0,
      failedExecutions: usageStats.failed_requests || 0,
      retrievalFrequency: execStats.retrieval_turns || 0,
      toolExecutionFrequency: execStats.tool_turns || 0,
      unansweredCount: execStats.unanswered_count || 0,
      totalInputTokens: usageStats.total_input_tokens || 0,
      totalOutputTokens: usageStats.total_output_tokens || 0,
    },
    modelBreakdown,
    unansweredQuestions,
    recentExecutions,
  });
});

app.get('/api/evaluations', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT id, provider, model, summary_json, results_json, created_at
       FROM evaluation_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10`
    )
    .all(req.auth!.workspace.id);
  res.json({ runs });
});

app.post('/api/evaluations/run', requireAuth, async (req: AuthRequest, res: Response) => {
  const mode = req.body?.mode === 'live' ? 'live' : 'simulated';
  const db = getDb();
  let connection: ProviderConnectionRecord | undefined;
  let model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';

  if (mode === 'live') {
    const connId = typeof req.body?.connectionId === 'string' ? req.body.connectionId : '';
    connection = connId
      ? (db
          .prepare(`SELECT * FROM model_connections WHERE id = ? AND workspace_id = ?`)
          .get(connId, req.auth!.workspace.id) as ProviderConnectionRecord | undefined)
      : (db
          .prepare(
            `SELECT * FROM model_connections WHERE workspace_id = ? AND provider = 'ollama' ORDER BY created_at ASC LIMIT 1`
          )
          .get(req.auth!.workspace.id) as ProviderConnectionRecord | undefined);
    if (!connection) {
      res.status(400).json({ error: 'No AI model connection found for live evaluation.' });
      return;
    }
    model = model || connection.default_model;
    if (!model) {
      res.status(400).json({
        error: 'Select an installed chat model in AI Models before running live evaluation.',
      });
      return;
    }
  }

  try {
    const report = await runRegressionEvaluation({
      workspaceId: req.auth!.workspace.id,
      mode,
      connection,
      model,
    });
    res.json({ report });
  } catch (err: unknown) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Evaluation run failed.',
    });
  }
});

app.get('/api/system/info', requireAuth, (req: AuthRequest, res: Response) => {
  const dbPath = getDbPath();
  const exists = fs.existsSync(dbPath);
  const sizeBytes = exists ? fs.statSync(dbPath).size : 0;
  const backupsDir = path.resolve(process.cwd(), 'data', 'backups');
  const backups = fs.existsSync(backupsDir)
    ? fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith('.db'))
        .sort()
        .reverse()
        .slice(0, 10)
        .map((name) => ({
          name,
          sizeBytes: fs.statSync(path.join(backupsDir, name)).size,
        }))
    : [];

  res.json({
    localSingleUserMode: !isMultiUserAuthEnabled(),
    localhostAdminVerified: isAllowedLocalAdminRequest(req),
    databasePath: dbPath,
    databaseSizeBytes: sizeBytes,
    backups,
  });
});

app.post('/api/system/backup', requireAuth, (_req: AuthRequest, res: Response) => {
  try {
    const backup = backupSqliteDatabase();
    res.json({ ok: true, backup });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Backup failed.' });
  }
});

// ============================================================================
// VITE DEV / PRODUCTION STATIC HOSTING
// ============================================================================

async function start() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build artifacts not found. Run npm run build.');
      }
    });
  }

  const bindHost = process.env.BIND_HOST || '0.0.0.0';
  app.listen(PORT, bindHost, () => {
    console.log(`KRESNA server running at http://localhost:${PORT} (Local Single-User Mode: ${!isMultiUserAuthEnabled()})`);
  });
}

start().catch((err) => {
  console.error('Failed to start KRESNA server:', err);
  process.exit(1);
});
