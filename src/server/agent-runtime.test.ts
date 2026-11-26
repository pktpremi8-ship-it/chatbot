import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, getDb } from './db.ts';
import { runRegressionEvaluation } from './regression-eval.ts';

test('Agentic runtime Regression Evaluation Suite passes all Scenarios A-J with zero hallucinations', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kresna-agent-eval-'));
  const dbPath = path.join(tmpDir, 'eval.db');
  closeDb();
  const db = getDb(dbPath);

  try {
    const ws = db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as { id: string };
    const report = await runRegressionEvaluation({
      workspaceId: ws.id,
      mode: 'simulated',
    });

    assert.equal(report.summary.totalScenarios, 10);
    assert.equal(
      report.summary.passedScenarios,
      10,
      `Failed scenarios: ${report.scenarios
        .filter((s) => !s.passed)
        .map((s) => `${s.scenarioId}: ${s.notes}`)
        .join('; ')}`
    );
    assert.equal(report.summary.hallucinationRate, 0);
    assert.equal(report.summary.repeatedQuestionRate, 0);
    assert.equal(report.summary.contextRetentionRate, 100);
    assert.equal(report.summary.conversationContinuityRate, 100);
    assert.equal(report.summary.toolSelectionAccuracyRate, 100);

    // Verify Scenario D persisted a real support ticket in SQLite
    const tickets = db
      .prepare(`SELECT subject, customer_contact, status FROM support_tickets WHERE workspace_id = ?`)
      .all(ws.id) as Array<{ subject: string; customer_contact: string; status: string }>;
    assert.ok(tickets.length >= 1);
    assert.equal(tickets[0].customer_contact, 'driver-0812345678');
    assert.equal(tickets[0].status, 'open');

    // Verify evaluation run was persisted
    const savedRuns = db
      .prepare(`SELECT id, model FROM evaluation_runs WHERE id = ?`)
      .get(report.id) as { id: string; model: string } | undefined;
    assert.ok(savedRuns);
  } finally {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
