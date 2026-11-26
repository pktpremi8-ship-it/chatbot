import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  createWorkspaceDefaults,
  ensureLocalWorkspace,
  runMigrations,
  seedDemoWorkspaceIfEmpty,
} from './db.ts';
import { hashPassword } from './crypto.ts';

test('database migrations, demo seeding, and strict tenant isolation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kresna-db-test-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seedDemoWorkspaceIfEmpty(db);

  const demoUser = db
    .prepare(`SELECT id, email FROM users WHERE email = ?`)
    .get('demo@kresna.ai') as { id: string; email: string } | undefined;
  assert.ok(demoUser);

  const user2Id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(user2Id, 'tenant2@example.com', 'Tenant Two', hashPassword('Password123!'), now);

  const { workspaceId: ws2Id, modelConnectionId: mc2Id } = createWorkspaceDefaults(db, {
    userId: user2Id,
    workspaceName: 'Tenant Two Org',
  });

  const bot2Id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO chatbots (id, workspace_id, public_bot_id, name, purpose, preset, language, style, welcome_message, model_connection_id, model_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bot2Id,
    ws2Id,
    `bot_${bot2Id.slice(0, 12)}`,
    'Tenant 2 Bot',
    'Private internal support bot for Tenant 2.',
    'internal_assistant',
    'English',
    'Direct',
    'Hello!',
    mc2Id,
    'llama3.1:8b',
    now,
    now
  );

  const ws1 = db
    .prepare(`SELECT workspace_id FROM workspace_members WHERE user_id = ?`)
    .get(demoUser!.id) as { workspace_id: string };
  const ws1Bots = db
    .prepare(`SELECT name FROM chatbots WHERE workspace_id = ?`)
    .all(ws1.workspace_id) as Array<{ name: string }>;

  assert.equal(ws1Bots.some((b) => b.name === 'Tenant 2 Bot'), false);
  assert.equal(ws1Bots.some((b) => b.name === 'Aria Support'), true);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ensureLocalWorkspace initializes My Workspace and Local Admin idempotently without deleting existing data', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kresna-local-ws-'));
  const dbFile = path.join(tmpDir, 'local.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);

  // Pre-seed a legacy user record to confirm non-destructive preservation
  const legacyUserId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(legacyUserId, 'legacy@example.com', 'Legacy Owner', hashPassword('Secret123!'), now);

  const first = ensureLocalWorkspace(db);
  const second = ensureLocalWorkspace(db);

  assert.equal(first.workspace.name, 'My Workspace');
  assert.equal(first.user.name, 'Local Admin');
  assert.equal(first.workspace.id, second.workspace.id);
  assert.equal(first.user.id, second.user.id);

  const legacyPreserved = db
    .prepare(`SELECT email FROM users WHERE id = ?`)
    .get(legacyUserId) as { email: string } | undefined;
  assert.equal(legacyPreserved?.email, 'legacy@example.com');

  const ollamaConn = db
    .prepare(`SELECT provider, auth_mode, default_model FROM model_connections WHERE id = ?`)
    .get(first.ollamaConnectionId) as { provider: string; auth_mode: string; default_model: string };
  assert.equal(ollamaConn.provider, 'ollama');
  assert.equal(ollamaConn.auth_mode, 'local');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runMigrations non-destructively backfills Phase 1 knowledge_items into knowledge_chunks and FTS5', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kresna-migrate-backfill-'));
  const dbFile = path.join(tmpDir, 'legacy.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  const ctx = ensureLocalWorkspace(db);

  const bot = db
    .prepare(`SELECT id FROM chatbots WHERE workspace_id = ? LIMIT 1`)
    .get(ctx.workspace.id) as { id: string };

  const itemId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO knowledge_items (id, workspace_id, chatbot_id, title, source_type, content, created_at)
     VALUES (?, ?, ?, ?, 'faq', ?, ?)`
  ).run(itemId, ctx.workspace.id, bot.id, 'Legacy FAQ', 'Garansi unit berlaku 12 bulan.', now);

  // Re-run migrations to simulate upgrade from Phase 1 database
  runMigrations(db);

  const chunks = db
    .prepare(`SELECT content FROM knowledge_chunks WHERE knowledge_item_id = ?`)
    .all(itemId) as Array<{ content: string }>;
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].content, /Garansi unit berlaku 12 bulan/);

  const ftsHits = db
    .prepare(`SELECT title FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH '"garansi"'`)
    .all() as Array<{ title: string }>;
  assert.equal(ftsHits.length, 1);
  assert.equal(ftsHits[0].title, 'Legacy FAQ');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
