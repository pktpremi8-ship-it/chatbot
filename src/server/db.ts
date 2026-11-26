import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './crypto.ts';
import { CHATBOT_PRESETS, estimateTokenCostUsd } from '../shared/kresna-logic.ts';

let dbInstance: DatabaseSync | null = null;
let activeDbPath = path.resolve(process.cwd(), 'data', 'kresna.db');

export function getDbPath(): string {
  return activeDbPath;
}

export function getDb(dbPath?: string): DatabaseSync {
  if (!dbPath && dbInstance) return dbInstance;
  const resolvedPath =
    dbPath ||
    (process.env.KRESNA_DB_PATH
      ? path.resolve(process.env.KRESNA_DB_PATH)
      : path.resolve(process.cwd(), 'data', 'kresna.db'));

  if (dbInstance && activeDbPath === resolvedPath) return dbInstance;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  activeDbPath = resolvedPath;
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  if (process.env.ENABLE_MULTI_USER_AUTH === 'true') {
    seedDemoWorkspaceIfEmpty(db);
  } else {
    ensureLocalWorkspace(db);
  }
  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function backupSqliteDatabase(targetDir = path.resolve(process.cwd(), 'data', 'backups')): {
  backupPath: string;
  sizeBytes: number;
  createdAt: string;
} {
  const db = getDb();
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetDir, `kresna-backup-${stamp}.db`);
  // Flush WAL cleanly and create a consistent SQLite VACUUM INTO snapshot
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const escaped = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}';`);
  const stat = fs.statSync(backupPath);
  return {
    backupPath,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'local',
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      active_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      auth_mode TEXT NOT NULL,
      encrypted_api_key TEXT,
      key_hint TEXT,
      endpoint TEXT,
      deployment_name TEXT,
      api_version TEXT,
      default_model TEXT NOT NULL DEFAULT '',
      embedding_model TEXT NOT NULL DEFAULT '',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'untested',
      last_tested_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chatbots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      public_bot_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL,
      preset TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'English',
      style TEXT NOT NULL,
      system_instructions TEXT NOT NULL DEFAULT '',
      welcome_message TEXT NOT NULL,
      model_connection_id TEXT REFERENCES model_connections(id) ON DELETE SET NULL,
      model_id TEXT NOT NULL DEFAULT '',
      embedding_connection_id TEXT REFERENCES model_connections(id) ON DELETE SET NULL,
      embedding_model_id TEXT NOT NULL DEFAULT '',
      escalation_mode TEXT NOT NULL DEFAULT '',
      max_output_tokens INTEGER NOT NULL DEFAULT 1024,
      mode TEXT NOT NULL DEFAULT 'simple',
      status TEXT NOT NULL DEFAULT 'draft',
      widget_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'faq',
      content TEXT NOT NULL,
      file_name TEXT,
      mime_type TEXT,
      source_url TEXT,
      status TEXT NOT NULL DEFAULT 'indexed',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      vector_indexed INTEGER NOT NULL DEFAULT 0,
      fts_indexed INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      file_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
      knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      token_estimate INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      workspace_id UNINDEXED,
      chatbot_id UNINDEXED,
      knowledge_item_id UNINDEXED,
      title,
      content,
      metadata_text
    );

    CREATE TABLE IF NOT EXISTS channel_configs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'configured',
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(chatbot_id, channel_type)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL DEFAULT 'playground',
      external_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_memory (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
      memory_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model_used TEXT,
      provider_used TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      feedback TEXT,
      trace_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_connectors (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT REFERENCES chatbots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      url TEXT NOT NULL,
      headers_json TEXT NOT NULL DEFAULT '{}',
      query_params_json TEXT NOT NULL DEFAULT '{}',
      body_template_json TEXT NOT NULL DEFAULT '{}',
      auth_type TEXT NOT NULL DEFAULT 'none',
      encrypted_auth_config TEXT,
      input_schema_json TEXT NOT NULL DEFAULT '{}',
      requires_confirmation INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connector_execution_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT REFERENCES chatbots(id) ON DELETE SET NULL,
      connector_id TEXT REFERENCES api_connectors(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      request_summary_json TEXT NOT NULL DEFAULT '{}',
      response_status INTEGER,
      response_summary TEXT,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT REFERENCES chatbots(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      customer_name TEXT,
      customer_contact TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      channel_type TEXT NOT NULL DEFAULT 'playground',
      user_message TEXT NOT NULL,
      assistant_response TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      model_latency_ms INTEGER NOT NULL DEFAULT 0,
      total_response_ms INTEGER NOT NULL DEFAULT 0,
      iterations INTEGER NOT NULL DEFAULT 1,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      retrieval_sources_json TEXT NOT NULL DEFAULT '[]',
      retrieved_evidence_json TEXT NOT NULL DEFAULT '[]',
      tool_calls_json TEXT NOT NULL DEFAULT '[]',
      tool_results_json TEXT NOT NULL DEFAULT '[]',
      memory_snapshot_json TEXT NOT NULL DEFAULT '{}',
      unanswered INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      token_metrics_measured INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT REFERENCES chatbots(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chatbot_id TEXT REFERENCES chatbots(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chatbots_workspace ON chatbots(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_bot ON knowledge_chunks(chatbot_id, knowledge_item_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_usage_workspace ON usage_events(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_exec_logs_workspace ON execution_logs(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_connectors_workspace ON api_connectors(workspace_id);
  `);

  // Non-destructive column migrations for existing Phase 1 SQLite tables
  ensureColumn(db, 'model_connections', 'embedding_model', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'model_connections', 'capabilities_json', "TEXT NOT NULL DEFAULT '{}'");

  ensureColumn(
    db,
    'chatbots',
    'embedding_connection_id',
    'TEXT REFERENCES model_connections(id) ON DELETE SET NULL'
  );
  ensureColumn(db, 'chatbots', 'embedding_model_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'chatbots', 'escalation_mode', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'chatbots', 'widget_config_json', "TEXT NOT NULL DEFAULT '{}'");

  ensureColumn(db, 'knowledge_items', 'file_name', 'TEXT');
  ensureColumn(db, 'knowledge_items', 'mime_type', 'TEXT');
  ensureColumn(db, 'knowledge_items', 'source_url', 'TEXT');
  ensureColumn(db, 'knowledge_items', 'status', "TEXT NOT NULL DEFAULT 'indexed'");
  ensureColumn(db, 'knowledge_items', 'chunk_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'knowledge_items', 'vector_indexed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'knowledge_items', 'fts_indexed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'knowledge_items', 'error_message', 'TEXT');
  ensureColumn(db, 'knowledge_items', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'knowledge_items', 'file_path', 'TEXT');
  ensureColumn(db, 'knowledge_items', 'updated_at', 'TEXT');

  // Backfill any Phase 1 knowledge_items that don't yet have chunks/FTS entries
  const unchunked = db
    .prepare(
      `SELECT id, workspace_id, chatbot_id, title, source_type, content, created_at
       FROM knowledge_items
       WHERE id NOT IN (SELECT DISTINCT knowledge_item_id FROM knowledge_chunks)`
    )
    .all() as Array<{
    id: string;
    workspace_id: string;
    chatbot_id: string;
    title: string;
    source_type: string;
    content: string;
    created_at: string;
  }>;

  for (const item of unchunked) {
    const chunkId = crypto.randomUUID();
    const metadataJson = JSON.stringify({ title: item.title, sourceType: item.source_type });
    db.prepare(
      `INSERT INTO knowledge_chunks (id, workspace_id, chatbot_id, knowledge_item_id, chunk_index, content, metadata_json, token_estimate, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(
      chunkId,
      item.workspace_id,
      item.chatbot_id,
      item.id,
      item.content,
      metadataJson,
      Math.ceil(item.content.length / 4),
      item.created_at
    );
    db.prepare(
      `INSERT INTO knowledge_chunks_fts (chunk_id, workspace_id, chatbot_id, knowledge_item_id, title, content, metadata_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      chunkId,
      item.workspace_id,
      item.chatbot_id,
      item.id,
      item.title,
      item.content,
      `${item.title} ${item.source_type}`
    );
    db.prepare(
      `UPDATE knowledge_items SET status = 'indexed', chunk_count = 1, fts_indexed = 1 WHERE id = ?`
    ).run(item.id);
  }
}

export interface LocalWorkspaceContext {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; slug: string; plan: string };
  ollamaConnectionId: string;
}

export function ensureLocalWorkspace(db: DatabaseSync): LocalWorkspaceContext {
  const now = new Date().toISOString();
  const defaultOllamaUrl = (process.env.OLLAMA_BASE_URL || 'http://ollama:11434').trim();

  // 1. Ensure Local Admin user without removing any existing users
  let localUser = db
    .prepare(`SELECT id, email, name FROM users WHERE email = ?`)
    .get('local@kresna.local') as { id: string; email: string; name: string } | undefined;

  if (!localUser) {
    const userId = crypto.randomUUID();
    // Placeholder non-interactive random hash (login UI disabled in local single-user mode)
    const lockHash = hashPassword(crypto.randomBytes(24).toString('hex'));
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, 'local@kresna.local', 'Local Admin', lockHash, now);
    localUser = { id: userId, email: 'local@kresna.local', name: 'Local Admin' };
  }

  // 2. Ensure default workspace "My Workspace"
  let workspace = db
    .prepare(`SELECT id, name, slug, plan FROM workspaces WHERE slug = ? OR name = ? ORDER BY created_at ASC LIMIT 1`)
    .get('my-workspace', 'My Workspace') as
    | { id: string; name: string; slug: string; plan: string }
    | undefined;

  if (!workspace) {
    const workspaceId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO workspaces (id, name, slug, plan, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(workspaceId, 'My Workspace', 'my-workspace', 'local', localUser.id, now);
    workspace = { id: workspaceId, name: 'My Workspace', slug: 'my-workspace', plan: 'local' };
  }

  // 3. Ensure Local Admin membership as owner
  const member = db
    .prepare(`SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?`)
    .get(workspace.id, localUser.id);
  if (!member) {
    db.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`
    ).run(crypto.randomUUID(), workspace.id, localUser.id, now);
  }

  // 4. Ensure default Local Ollama model connection exists (never hardcoded with fake installed models)
  let ollamaConn = db
    .prepare(
      `SELECT id FROM model_connections WHERE workspace_id = ? AND provider = 'ollama' ORDER BY created_at ASC LIMIT 1`
    )
    .get(workspace.id) as { id: string } | undefined;

  if (!ollamaConn) {
    const connId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO model_connections
        (id, workspace_id, name, provider, auth_mode, encrypted_api_key, key_hint, endpoint, default_model, embedding_model, status, created_at)
       VALUES (?, ?, ?, 'ollama', 'local', NULL, 'Local Ollama', ?, ?, ?, 'untested', ?)`
    ).run(
      connId,
      workspace.id,
      'Local Ollama',
      defaultOllamaUrl,
      (process.env.OLLAMA_CHAT_MODEL || '').trim(),
      (process.env.OLLAMA_EMBED_MODEL || '').trim(),
      now
    );
    ollamaConn = { id: connId };
  }

  // 4b. When running inside an environment with server-managed GEMINI_API_KEY (e.g. AI Studio preview)
  // and no Ollama chat model configured, expose an optional ready preview connection so users can test end-to-end immediately.
  const serverGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
  let previewGeminiConnId: string | null = null;
  if (serverGeminiKey) {
    const existingGemini = db
      .prepare(
        `SELECT id, default_model FROM model_connections WHERE workspace_id = ? AND provider = 'gemini' AND auth_mode = 'platform_managed' LIMIT 1`
      )
      .get(workspace.id) as { id: string; default_model: string } | undefined;

    if (existingGemini) {
      previewGeminiConnId = existingGemini.id;
      if (existingGemini.default_model === 'gemini-4-hydrogen') {
        db.prepare(
          `UPDATE model_connections SET default_model = 'gemini-3.1-flash-lite', status = 'connected', last_error = NULL WHERE id = ?`
        ).run(previewGeminiConnId);
      } else {
        db.prepare(
          `UPDATE model_connections SET status = 'connected', last_error = NULL WHERE id = ? AND status != 'connected'`
        ).run(previewGeminiConnId);
      }
    } else {
      previewGeminiConnId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO model_connections
          (id, workspace_id, name, provider, auth_mode, encrypted_api_key, key_hint, endpoint, default_model, embedding_model, status, created_at)
         VALUES (?, ?, ?, 'gemini', 'platform_managed', NULL, 'Managed Server Key', NULL, 'gemini-3.1-flash-lite', '', 'connected', ?)`
      ).run(previewGeminiConnId, workspace.id, 'Preview Cloud Gemini (Server Key)', now);
    }
  }

  // 5. Preserve existing chatbots; only create a clean starter assistant if My Workspace has 0 chatbots
  const botCountRow = db
    .prepare(`SELECT COUNT(*) AS count FROM chatbots WHERE workspace_id = ?`)
    .get(workspace.id) as { count: number };

  const ollamaDefaultModel = (process.env.OLLAMA_CHAT_MODEL || '').trim();
  const initialConnId =
    !ollamaDefaultModel && previewGeminiConnId ? previewGeminiConnId : ollamaConn.id;
  const initialModelId =
    !ollamaDefaultModel && previewGeminiConnId ? 'gemini-3.1-flash-lite' : ollamaDefaultModel;

  if (botCountRow.count === 0) {
    const preset = CHATBOT_PRESETS[0];
    const botId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO chatbots
        (id, workspace_id, public_bot_id, name, purpose, preset, language, style, system_instructions, welcome_message, model_connection_id, model_id, embedding_connection_id, embedding_model_id, escalation_mode, max_output_tokens, mode, status, widget_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      botId,
      workspace.id,
      `bot_${botId.slice(0, 12)}`,
      'KRESNA Support Representative',
      'Assist customers naturally using grounded knowledge, multi-turn memory, and live operational tools.',
      preset.key,
      'English',
      preset.defaultStyle,
      '',
      preset.defaultWelcome,
      initialConnId,
      initialModelId,
      ollamaConn.id,
      (process.env.OLLAMA_EMBED_MODEL || '').trim(),
      preset.defaultEscalation,
      1024,
      'simple',
      'published',
      JSON.stringify({
        accentColor: '#1D4ED8',
        position: 'bottom-right',
        title: 'Support Assistant',
        subtitle: 'Ask a question or request help',
        allowedDomains: ['localhost', '127.0.0.1'],
      }),
      now,
      now
    );

    db.prepare(
      `INSERT INTO channel_configs (id, workspace_id, chatbot_id, channel_type, status, config_json, updated_at)
       VALUES (?, ?, ?, 'website', 'configured', ?, ?)`
    ).run(
      crypto.randomUUID(),
      workspace.id,
      botId,
      JSON.stringify({
        accentColor: '#1D4ED8',
        position: 'bottom-right',
        allowedDomains: ['localhost', '127.0.0.1'],
      }),
      now
    );
  } else if (!ollamaDefaultModel && previewGeminiConnId) {
    db.prepare(
      `UPDATE chatbots
       SET model_connection_id = ?, model_id = 'gemini-3.1-flash-lite', updated_at = ?
       WHERE workspace_id = ? AND (COALESCE(TRIM(model_id), '') = '' OR (model_connection_id = ? AND model_id = 'gemini-4-hydrogen'))`
    ).run(previewGeminiConnId, now, workspace.id, previewGeminiConnId);
  }

  return {
    user: localUser,
    workspace,
    ollamaConnectionId: ollamaConn.id,
  };
}

export function createWorkspaceDefaults(
  db: DatabaseSync,
  params: { userId: string; workspaceName: string; plan?: string }
): { workspaceId: string; modelConnectionId: string } {
  const now = new Date().toISOString();
  const workspaceId = crypto.randomUUID();
  const slug =
    params.workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace';

  db.prepare(
    `INSERT INTO workspaces (id, name, slug, plan, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(workspaceId, params.workspaceName.trim(), slug, params.plan ?? 'local', params.userId, now);

  db.prepare(
    `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), workspaceId, params.userId, 'owner', now);

  const modelConnectionId = crypto.randomUUID();
  const defaultOllamaUrl = (process.env.OLLAMA_BASE_URL || 'http://ollama:11434').trim();
  db.prepare(
    `INSERT INTO model_connections
      (id, workspace_id, name, provider, auth_mode, encrypted_api_key, key_hint, endpoint, default_model, embedding_model, status, created_at)
     VALUES (?, ?, ?, 'ollama', 'local', NULL, 'Local Ollama', ?, '', '', 'untested', ?)`
  ).run(modelConnectionId, workspaceId, 'Local Ollama', defaultOllamaUrl, now);

  return { workspaceId, modelConnectionId };
}

// Legacy Phase 1 seed helper retained only when ENABLE_MULTI_USER_AUTH=true or called in legacy tests
export function seedDemoWorkspaceIfEmpty(db: DatabaseSync): void {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM users`).get() as { count: number };
  if (row.count > 0) return;

  const now = new Date().toISOString();
  const demoUserId = crypto.randomUUID();
  const demoPasswordHash = hashPassword('KresnaDemo2026!');

  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(demoUserId, 'demo@kresna.ai', 'Elena Vance', demoPasswordHash, now);

  const { workspaceId, modelConnectionId } = createWorkspaceDefaults(db, {
    userId: demoUserId,
    workspaceName: 'Northwind Operations',
    plan: 'starter',
  });

  const supportPreset = CHATBOT_PRESETS[0];
  const bot1Id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO chatbots
      (id, workspace_id, public_bot_id, name, purpose, preset, language, style, system_instructions, welcome_message, model_connection_id, model_id, max_output_tokens, mode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bot1Id,
    workspaceId,
    `bot_${bot1Id.slice(0, 12)}`,
    'Aria Support',
    'Resolve order tracking, refund eligibility, and account access questions naturally.',
    supportPreset.key,
    'English',
    supportPreset.defaultStyle,
    '',
    supportPreset.defaultWelcome,
    modelConnectionId,
    'llama3.1:8b',
    1024,
    'simple',
    'published',
    now,
    now
  );

  const item1Id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO knowledge_items (id, workspace_id, chatbot_id, title, source_type, content, status, chunk_count, fts_indexed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'indexed', 1, 1, ?)`
  ).run(
    item1Id,
    workspaceId,
    bot1Id,
    'Returns & Refund Policy',
    'faq',
    'Customers can return unused items within 30 days of delivery with an order ID. Refunds process in 3-5 business days.',
    now
  );

  const chunkId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO knowledge_chunks (id, workspace_id, chatbot_id, knowledge_item_id, chunk_index, content, metadata_json, token_estimate, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, 24, ?)`
  ).run(
    chunkId,
    workspaceId,
    bot1Id,
    item1Id,
    'Customers can return unused items within 30 days of delivery with an order ID. Refunds process in 3-5 business days.',
    JSON.stringify({ title: 'Returns & Refund Policy', sourceType: 'faq' }),
    now
  );

  db.prepare(
    `INSERT INTO knowledge_chunks_fts (chunk_id, workspace_id, chatbot_id, knowledge_item_id, title, content, metadata_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    chunkId,
    workspaceId,
    bot1Id,
    item1Id,
    'Returns & Refund Policy',
    'Customers can return unused items within 30 days of delivery with an order ID. Refunds process in 3-5 business days.',
    'Returns & Refund Policy faq'
  );

  const conv1Id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO conversations (id, workspace_id, chatbot_id, channel_type, external_user_id, status, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(conv1Id, workspaceId, bot1Id, 'playground', 'tester-01', 'resolved', now, now);

  db.prepare(
    `INSERT INTO usage_events (id, workspace_id, chatbot_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, latency_ms, success, created_at)
     VALUES (?, ?, ?, 'ollama', 'llama3.1:8b', 180, 60, ?, 410, 1, ?)`
  ).run(crypto.randomUUID(), workspaceId, bot1Id, estimateTokenCostUsd('llama3.1:8b', 180, 60, 'ollama'), now);
}
