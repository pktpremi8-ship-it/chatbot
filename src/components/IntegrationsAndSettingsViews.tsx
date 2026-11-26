import React, { useEffect, useState } from 'react';
import {
  Check,
  Database,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  apiRequest,
  type ApiConnectorRow,
  type ChatbotRow,
  type ConnectorLogRow,
  type EvaluationSuiteReport,
  type SupportTicketRow,
  type WorkspaceSummary,
} from '../lib/api';
import { KRESNA_ROADMAP, type BuilderMode } from '../shared/kresna-logic';

// ============================================================================
// 1. INTEGRATIONS VIEW (REST API Connectors + Built-in Ticket Queue)
// ============================================================================

export const IntegrationsView: React.FC<{
  chatbots: ChatbotRow[];
  builderMode: BuilderMode;
}> = ({ chatbots, builderMode }) => {
  const [connectors, setConnectors] = useState<ApiConnectorRow[]>([]);
  const [logs, setLogs] = useState<ConnectorLogRow[]>([]);
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // New connector form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [chatbotId, setChatbotId] = useState('');
  const [authType, setAuthType] = useState('none');
  const [authSecret, setAuthSecret] = useState('');
  const [authHeader, setAuthHeader] = useState('X-API-Key');
  const [schemaJson, setSchemaJson] = useState(
    '{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}'
  );
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testOutput, setTestOutput] = useState<string>('');

  const loadConnectors = async () => {
    try {
      const res = await apiRequest<{
        connectors: ApiConnectorRow[];
        logs: ConnectorLogRow[];
        tickets: SupportTicketRow[];
      }>('/api/connectors');
      setConnectors(res.connectors);
      setLogs(res.logs);
      setTickets(res.tickets);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadConnectors();
  }, []);

  const handleCreateConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      let parsedSchema = {};
      try {
        parsedSchema = JSON.parse(schemaJson || '{}');
      } catch {
        throw new Error('Input JSON Schema must be valid JSON.');
      }

      const authConfig =
        authType === 'bearer'
          ? { token: authSecret }
          : authType === 'api_key'
            ? { headerName: authHeader, apiKey: authSecret }
            : undefined;

      await apiRequest('/api/connectors', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          method,
          url,
          chatbotId: chatbotId || null,
          authType,
          authConfig,
          inputSchema: parsedSchema,
          requiresConfirmation,
        }),
      });
      setName('');
      setDescription('');
      setUrl('');
      setAuthSecret('');
      setNotice('REST API connector saved and registered as an agent tool.');
      await loadConnectors();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create connector.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnector = async (id: string) => {
    setError('');
    setTestOutput('');
    try {
      const res = await apiRequest<Record<string, unknown>>(`/api/connectors/${id}/test`, {
        method: 'POST',
        body: JSON.stringify({ args: { id: 'sample-1' } }),
      });
      setTestOutput(JSON.stringify(res, null, 2));
      await loadConnectors();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connector test failed.');
      await loadConnectors();
    }
  };

  const handleDeleteConnector = async (id: string) => {
    await apiRequest(`/api/connectors/${id}`, { method: 'DELETE' });
    await loadConnectors();
  };

  const handleTicketStatus = async (id: string, status: 'open' | 'in_progress' | 'resolved') => {
    await apiRequest(`/api/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          API Connectors & Agent Tools
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Register REST API connectors with SSRF safety guards, encrypted auth credentials, confirmation gates, and inspect agent-created support tickets.
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Built-in Tool Notice */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Built-in Agent Tool: <span className="font-mono">create_support_ticket</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              Automatically available to every chatbot with mandatory field validation (<code className="font-mono">subject, description, customer_contact</code>) and explicit confirmation gate.
            </p>
          </div>
          <span className="rounded bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            Active on All Chatbots
          </span>
        </div>
      </div>

      {/* Connector Form & Registered Connectors */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleCreateConnector}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5"
        >
          <h2 className="text-base font-semibold text-slate-900">Add REST API Connector</h2>
          <div>
            <label htmlFor="c-name" className="block text-xs font-medium text-slate-700">
              Tool Name
            </label>
            <input
              id="c-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="check_order_status"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="c-desc" className="block text-xs font-medium text-slate-700">
              Description (shown to LLM planner)
            </label>
            <input
              id="c-desc"
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Fetches live order status by order ID"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="c-method" className="block text-xs font-medium text-slate-700">
                Method
              </label>
              <select
                id="c-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="col-span-2">
              <label htmlFor="c-bot" className="block text-xs font-medium text-slate-700">
                Scope
              </label>
              <select
                id="c-bot"
                value={chatbotId}
                onChange={(e) => setChatbotId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900"
              >
                <option value="">All Workspace Chatbots</option>
                {chatbots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="c-url" className="block text-xs font-medium text-slate-700">
              Endpoint URL (supports <code className="font-mono">{'{{param}}'}</code>)
            </label>
            <input
              id="c-url"
              type="text"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/orders/{{id}}"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="c-auth" className="block text-xs font-medium text-slate-700">
                Auth Type
              </label>
              <select
                id="c-auth"
                value={authType}
                onChange={(e) => setAuthType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900"
              >
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="api_key">API Key Header</option>
              </select>
            </div>
            {authType !== 'none' && (
              <div>
                <label htmlFor="c-secret" className="block text-xs font-medium text-slate-700">
                  Secret / Token
                </label>
                <input
                  id="c-secret"
                  type="password"
                  value={authSecret}
                  onChange={(e) => setAuthSecret(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>
            )}
          </div>
          {authType === 'api_key' && (
            <input
              type="text"
              value={authHeader}
              onChange={(e) => setAuthHeader(e.target.value)}
              placeholder="Header Name (e.g., X-API-Key)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
            />
          )}
          {builderMode === 'developer' && (
            <div>
              <label htmlFor="c-schema" className="block text-xs font-medium text-slate-700">
                Input JSON Schema
              </label>
              <textarea
                id="c-schema"
                rows={3}
                value={schemaJson}
                onChange={(e) => setSchemaJson(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-[11px] text-slate-900"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={requiresConfirmation}
              onChange={(e) => setRequiresConfirmation(e.target.checked)}
            />
            Require user confirmation before execution
          </label>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save REST Connector'}
          </button>
        </form>

        <div className="space-y-4 lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">
              Registered Connectors ({connectors.length})
            </h2>
            {connectors.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No external REST connectors registered yet. Create one on the left to let your chatbots call live external APIs.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {connectors.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="font-mono">{c.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                          {c.method}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-slate-500">{c.url}</div>
                      <div className="mt-0.5 text-xs text-slate-600">{c.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTestConnector(c.id)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteConnector(c.id)}
                        aria-label={`Delete ${c.name}`}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {testOutput && (
              <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
                {testOutput}
              </pre>
            )}
          </div>

          {/* Support Ticket Queue */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">
              Agent Support Tickets ({tickets.length})
            </h2>
            {tickets.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No tickets created yet. When users escalate or ask to create a ticket, confirmed tickets appear here.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200 text-xs">
                {tickets.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono text-blue-700">{t.id}</span> · {t.subject}
                      </div>
                      <div className="mt-0.5 text-slate-600">
                        Contact: {t.customer_contact || '—'} · Priority: {t.priority}
                      </div>
                    </div>
                    <select
                      aria-label={`Status for ${t.id}`}
                      value={t.status}
                      onChange={(e) =>
                        handleTicketStatus(
                          t.id,
                          e.target.value as 'open' | 'in_progress' | 'resolved'
                        )
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {logs.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900">Connector Execution Logs</h2>
              <ul className="mt-3 divide-y divide-slate-200 text-xs">
                {logs.slice(0, 10).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="font-mono text-slate-800">
                      {l.method} {l.connector_name || l.url}
                    </span>
                    <span className={l.success ? 'font-mono text-emerald-700' : 'font-mono text-red-700'}>
                      {l.response_status ?? 'ERR'} · {l.latency_ms}ms
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. SETTINGS VIEW (SQLite Backup, Security Notice, Evaluation Suite A–J)
// ============================================================================

export const SettingsView: React.FC<{ workspace: WorkspaceSummary }> = ({ workspace }) => {
  const [sysInfo, setSysInfo] = useState<{
    localSingleUserMode: boolean;
    databasePath: string;
    databaseSizeBytes: number;
    backups: Array<{ name: string; sizeBytes: number }>;
  } | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [evalReport, setEvalReport] = useState<EvaluationSuiteReport | null>(null);
  const [runningEval, setRunningEval] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadSystemInfo = async () => {
    try {
      const [infoRes, evalRes] = await Promise.all([
        apiRequest<{
          localSingleUserMode: boolean;
          databasePath: string;
          databaseSizeBytes: number;
          backups: Array<{ name: string; sizeBytes: number }>;
        }>('/api/system/info'),
        apiRequest<{
          runs: Array<{
            id: string;
            provider: string;
            model: string;
            summary_json: string;
            results_json: string;
            created_at: string;
          }>;
        }>('/api/evaluations'),
      ]);
      setSysInfo(infoRes);
      if (evalRes.runs.length > 0 && !evalReport) {
        const r = evalRes.runs[0];
        setEvalReport({
          id: r.id,
          mode: r.model.includes('simulated') ? 'simulated' : 'live',
          provider: r.provider,
          model: r.model,
          createdAt: r.created_at,
          summary: JSON.parse(r.summary_json),
          scenarios: JSON.parse(r.results_json),
        });
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSystemInfo();
  }, [workspace.id]);

  const handleBackupNow = async () => {
    setBackingUp(true);
    setError('');
    setNotice('');
    try {
      const res = await apiRequest<{ backup: { backupPath: string; sizeBytes: number } }>(
        '/api/system/backup',
        { method: 'POST' }
      );
      setNotice(`SQLite snapshot saved (${Math.round(res.backup.sizeBytes / 1024)} KB).`);
      await loadSystemInfo();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBackingUp(false);
    }
  };

  const handleRunEvaluation = async (mode: 'simulated' | 'live') => {
    setRunningEval(true);
    setError('');
    setNotice('');
    try {
      const res = await apiRequest<{ report: EvaluationSuiteReport }>('/api/evaluations/run', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      setEvalReport(res.report);
      setNotice(
        `Evaluation complete (${res.report.mode}): ${res.report.summary.passedScenarios}/${res.report.summary.totalScenarios} scenarios passed.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setRunningEval(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          System Settings, Backup & Agent Evaluation
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Local workspace administration, SQLite WAL database snapshots, and the Scenarios A–J Conversational Regression Suite.
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Regression Evaluation Suite (Scenarios A–J) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Conversational Regression Evaluation Suite (Scenarios A–J)
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Verifies informal knowledge queries, brief follow-ups, write-tool confirmation gates, frustration handling, contextual retries, domain switching, and hallucination honesty.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleRunEvaluation('simulated')}
              disabled={runningEval}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              {runningEval ? 'Running...' : 'Run Contract Suite (Simulated)'}
            </button>
            <button
              type="button"
              onClick={() => handleRunEvaluation('live')}
              disabled={runningEval}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            >
              Run Live Ollama Suite
            </button>
          </div>
        </div>

        {evalReport && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-5">
              <div>
                <div className="text-slate-500">Passed</div>
                <div className="font-mono text-lg font-bold text-slate-950">
                  {evalReport.summary.passedScenarios}/{evalReport.summary.totalScenarios}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Context Retention</div>
                <div className="font-mono text-lg font-bold text-slate-950">
                  {evalReport.summary.contextRetentionRate}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">Grounding</div>
                <div className="font-mono text-lg font-bold text-slate-950">
                  {evalReport.summary.answerGroundingRate}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">Tool Accuracy</div>
                <div className="font-mono text-lg font-bold text-slate-950">
                  {evalReport.summary.toolSelectionAccuracyRate}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">Hallucinations</div>
                <div className="font-mono text-lg font-bold text-emerald-700">
                  {evalReport.summary.hallucinationRate}%
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">Scenario</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Observation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {evalReport.scenarios.map((s) => (
                    <tr key={s.scenarioId}>
                      <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">
                        {s.scenarioId}
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-slate-900">{s.title}</td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`font-semibold ${
                            s.passed ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {s.passed ? 'PASS' : 'FAIL'}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-600">{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* SQLite Database Backup & Security Info */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Database className="h-4 w-4 text-slate-700" />
              SQLite Persistence & Snapshots
            </h2>
            <button
              type="button"
              onClick={handleBackupNow}
              disabled={backingUp}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              {backingUp ? 'Creating Backup...' : 'Backup Database Now'}
            </button>
          </div>
          {sysInfo && (
            <div className="mt-4 space-y-2 text-xs text-slate-600">
              <div>
                File: <span className="font-mono text-slate-900">{sysInfo.databasePath}</span>
              </div>
              <div>
                Active DB Size:{' '}
                <span className="font-mono text-slate-900">
                  {Math.round(sysInfo.databaseSizeBytes / 1024)} KB
                </span>
              </div>
              {sysInfo.backups.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <div className="font-semibold text-slate-800">Recent Backups</div>
                  <ul className="mt-1.5 space-y-1 font-mono text-[11px]">
                    {sysInfo.backups.map((b) => (
                      <li key={b.name} className="flex justify-between">
                        <span>{b.name}</span>
                        <span>{Math.round(b.sizeBytes / 1024)} KB</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-slate-700" />
            Local Single-User Security Boundaries
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            <li>
              • Workspace initialized automatically as <strong>{workspace.name}</strong> with <strong>Local Admin</strong>.
            </li>
            <li>
              • Legacy multi-user auth remains disabled behind <code className="font-mono">ENABLE_MULTI_USER_AUTH=true</code>.
            </li>
            <li>
              • Docker Compose binds port <code className="font-mono">127.0.0.1:3000:3000</code> so the admin dashboard is not exposed publicly.
            </li>
            <li>
              • Public <code className="font-mono">/api/widget/:publicBotId/*</code> routes enforce published status and allowed-domain origin checks.
            </li>
          </ul>
        </div>
      </div>

      {/* Honest Implementation Status */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">
          KRESNA MVP Implementation Status
        </h2>
        <div className="mt-4 divide-y divide-slate-200">
          {KRESNA_ROADMAP.map((phase) => (
            <div key={phase.phase} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  <span className="mr-2 font-mono text-xs text-slate-500">{phase.phase}</span>
                  {phase.title}
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    phase.status === 'implemented' || phase.status === 'tested'
                      ? 'text-emerald-700'
                      : 'text-slate-500'
                  }`}
                >
                  {(phase.status === 'implemented' || phase.status === 'tested') && (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {phase.status === 'planned' ? 'Future Phase' : 'Implemented'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{phase.summary}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
