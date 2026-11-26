import React, { useEffect, useState } from 'react';
import {
  Check,
  Database,
  Eye,
  FileUp,
  Globe,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  apiRequest,
  apiUploadFile,
  type ChatbotRow,
  type HybridRetrievalResponse,
  type KnowledgeChunkRow,
  type KnowledgeItemRow,
  type ModelConnectionRow,
  type OllamaDiscoveryResult,
  type QdrantHealthStatus,
} from '../lib/api';
import {
  GEMINI_MODEL_CATALOG,
  SUGGESTED_OLLAMA_MODELS,
} from '../shared/kresna-logic';

// ============================================================================
// 1. KNOWLEDGE INGESTION, CHUNK PREVIEW & HYBRID RETRIEVAL TESTER
// ============================================================================

export const KnowledgeView: React.FC<{
  chatbots: ChatbotRow[];
  onOpenBot: (id: string) => void;
}> = ({ chatbots, onOpenBot }) => {
  const [items, setItems] = useState<KnowledgeItemRow[]>([]);
  const [selectedBotId, setSelectedBotId] = useState(chatbots[0]?.id ?? '');
  const [urlInput, setUrlInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [ingestingUrl, setIngestingUrl] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Chunk preview
  const [preview, setPreview] = useState<{
    item: KnowledgeItemRow;
    chunks: KnowledgeChunkRow[];
  } | null>(null);

  // Hybrid retrieval tester
  const [testQuery, setTestQuery] = useState('');
  const [testingRetrieval, setTestingRetrieval] = useState(false);
  const [retrievalResult, setRetrievalResult] = useState<HybridRetrievalResponse | null>(null);

  const loadKnowledge = async () => {
    try {
      const res = await apiRequest<{ items: KnowledgeItemRow[] }>('/api/knowledge');
      setItems(res.items);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  useEffect(() => {
    if (!selectedBotId && chatbots[0]?.id) {
      setSelectedBotId(chatbots[0].id);
    }
  }, [chatbots, selectedBotId]);

  const handleFileUpload = async (file: File) => {
    if (!selectedBotId) {
      setError('Select a target chatbot first.');
      return;
    }
    setError('');
    setNotice('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('chatbotId', selectedBotId);
      fd.append('title', file.name);
      fd.append('file', file);
      await apiUploadFile('/api/knowledge/upload', fd);
      setNotice(`Parsed and indexed "${file.name}".`);
      await loadKnowledge();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'File upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleUrlIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBotId || !urlInput.trim()) return;
    setError('');
    setNotice('');
    setIngestingUrl(true);
    try {
      await apiRequest('/api/knowledge/url', {
        method: 'POST',
        body: JSON.stringify({ chatbotId: selectedBotId, url: urlInput.trim() }),
      });
      setUrlInput('');
      setNotice('Website URL ingested and indexed.');
      await loadKnowledge();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Website ingestion failed.');
    } finally {
      setIngestingUrl(false);
    }
  };

  const handlePreviewChunks = async (itemId: string) => {
    const res = await apiRequest<{ item: KnowledgeItemRow; chunks: KnowledgeChunkRow[] }>(
      `/api/knowledge/${itemId}/chunks`
    );
    setPreview(res);
  };

  const handleReindex = async (itemId: string) => {
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/knowledge/${itemId}/reindex`, { method: 'POST' });
      setNotice('Source reindexed.');
      await loadKnowledge();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reindex failed.');
    }
  };

  const handleDelete = async (itemId: string) => {
    await apiRequest(`/api/knowledge/${itemId}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  const handleTestRetrieval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBotId || !testQuery.trim()) return;
    setError('');
    setTestingRetrieval(true);
    try {
      const res = await apiRequest<HybridRetrievalResponse>('/api/knowledge/test-retrieval', {
        method: 'POST',
        body: JSON.stringify({ chatbotId: selectedBotId, query: testQuery.trim() }),
      });
      setRetrievalResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Retrieval test failed.');
    } finally {
      setTestingRetrieval(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Knowledge Pipeline & Hybrid RAG
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload XLSX, CSV, PDF, DOCX, TXT, HTML files or ingest website URLs. Chunks are indexed into SQLite FTS5 + Qdrant vectors with Reciprocal Rank Fusion.
          </p>
        </div>

        <div className="min-w-[220px]">
          <label htmlFor="kb-target-bot" className="block text-xs font-medium text-slate-600">
            Active Chatbot Target
          </label>
          <select
            id="kb-target-bot"
            value={selectedBotId}
            onChange={(e) => setSelectedBotId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
          >
            {chatbots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
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

      {/* Upload & URL Ingestion Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileUp className="h-4 w-4 text-blue-700" />
            Upload Document or Spreadsheet
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Supports <span className="font-mono">.xlsx, .csv, .pdf, .docx, .txt, .html</span>. Excel preserves sheet names, column headers, and row numbers.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,.docx,.txt,.md,.html,.htm"
            disabled={uploading || !selectedBotId}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = '';
            }}
            aria-label="Upload knowledge document"
            className="mt-3 block w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3.5 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
          />
          {uploading && <div className="mt-2 text-xs text-blue-700">Parsing & indexing...</div>}
        </div>

        <form onSubmit={handleUrlIngest} className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Globe className="h-4 w-4 text-blue-700" />
            Ingest Public Website URL
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Extracts main readable text from public web pages (SSRF-guarded against private networks).
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="url"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://docs.example.com/returns"
              aria-label="Website URL"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
            />
            <button
              type="submit"
              disabled={ingestingUrl || !selectedBotId}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {ingestingUrl ? 'Ingesting...' : 'Fetch & Index'}
            </button>
          </div>
        </form>
      </div>

      {/* Hybrid Retrieval Tester */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">
          Hybrid Retrieval Tester (SQLite FTS5 + Qdrant RRF)
        </h2>
        <form onSubmit={handleTestRetrieval} className="mt-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              placeholder="Test natural or informal query (e.g., 'saya gabisa pool out' or 'refund window')..."
              aria-label="Retrieval test query"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={testingRetrieval || !selectedBotId || !testQuery.trim()}
            className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {testingRetrieval ? 'Searching...' : 'Test Retrieval'}
          </button>
        </form>

        {retrievalResult && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>
                FTS5 hits: <strong>{retrievalResult.diagnostics.ftsHits}</strong>
              </span>
              <span>
                Qdrant vector hits: <strong>{retrievalResult.diagnostics.vectorHits}</strong>
              </span>
              {retrievalResult.diagnostics.vectorNote && (
                <span className="text-amber-700">({retrievalResult.diagnostics.vectorNote})</span>
              )}
            </div>
            {retrievalResult.evidence.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                No matching chunks found for "{retrievalResult.query}" on the selected chatbot. Try searching an actual topic, error code, or phrase from your uploaded document (greetings like "halo" won&apos;t match knowledge chunks, though the chatbot still greets naturally in Playground/Widget).
              </div>
            ) : (
              <ul className="space-y-2">
                {retrievalResult.evidence.map((ev) => (
                  <li key={ev.chunkId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{ev.citation}</span>
                      <span className="font-mono text-[11px] text-blue-700">
                        {ev.retrievalMethod} · RRF {ev.rrfScore}
                        {ev.lexicalRank ? ` · FTS #${ev.lexicalRank}` : ''}
                        {ev.semanticRank ? ` · Vec #${ev.semanticRank}` : ''}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-slate-700">{ev.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Knowledge Sources Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">
          All Workspace Knowledge Sources ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No knowledge sources uploaded yet. Upload a spreadsheet, document, or website URL above.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <span>{item.title}</span>
                    <span className="font-mono text-[11px] font-normal text-slate-500 uppercase">
                      {item.source_type}
                    </span>
                    <span
                      className={`text-[11px] font-medium ${
                        item.status === 'indexed' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {item.status} ({item.chunk_count} chunks)
                    </span>
                    {item.fts_indexed ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                        FTS5
                      </span>
                    ) : null}
                    {item.vector_indexed ? (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700">
                        Qdrant
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Chatbot:{' '}
                    <button
                      type="button"
                      onClick={() => onOpenBot(item.chatbot_id)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {item.chatbot_name || item.chatbot_id}
                    </button>
                    {item.source_url && <span className="ml-2 font-mono">{item.source_url}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePreviewChunks(item.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReindex(item.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Reindex
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    aria-label={`Delete ${item.title}`}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview && (
        <div className="rounded-xl border border-blue-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              Source Chunks — {preview.item.title}
            </h3>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Close Preview
            </button>
          </div>
          <div className="mt-4 max-h-80 space-y-2.5 overflow-y-auto">
            {preview.chunks.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="font-mono text-[11px] text-slate-500">
                  Chunk #{c.chunk_index + 1} · ~{c.token_estimate} tokens · {c.metadata_json}
                </div>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-800">{c.content}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. AI MODELS VIEW (Ollama First + Dynamic Discovery + Optional Legacy)
// ============================================================================

export const AIModelsView: React.FC<{
  connections: ModelConnectionRow[];
  ollamaDiscovery: OllamaDiscoveryResult | null;
  qdrantHealth: QdrantHealthStatus | null;
  platformKeyConfigured: boolean;
  onRefresh: () => Promise<void>;
}> = ({
  connections,
  ollamaDiscovery: initialDiscovery,
  qdrantHealth,
  platformKeyConfigured,
  onRefresh,
}) => {
  const ollamaConn = connections.find((c) => c.provider === 'ollama');
  const [discovery, setDiscovery] = useState<OllamaDiscoveryResult | null>(initialDiscovery);
  const [endpoint, setEndpoint] = useState(
    ollamaConn?.endpoint || initialDiscovery?.endpoint || 'http://ollama:11434'
  );
  const [defaultChatModel, setDefaultChatModel] = useState(ollamaConn?.default_model || '');
  const [defaultEmbedModel, setDefaultEmbedModel] = useState(ollamaConn?.embedding_model || '');
  const [discovering, setDiscovering] = useState(false);
  const [savingOllama, setSavingOllama] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Optional legacy BYOK
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyName, setLegacyName] = useState('');
  const [legacyKey, setLegacyKey] = useState('');
  const [legacyModel, setLegacyModel] = useState('gemini-3.1-flash-lite');
  const [selectedPreviewModel, setSelectedPreviewModel] = useState('gemini-3.1-flash-lite');

  useEffect(() => {
    setDiscovery(initialDiscovery);
  }, [initialDiscovery]);

  const handleDiscover = async () => {
    setDiscovering(true);
    setError('');
    setNotice('');
    try {
      const res = await apiRequest<{ discovery: OllamaDiscoveryResult }>(
        '/api/models/ollama/discover',
        {
          method: 'POST',
          body: JSON.stringify({ endpoint, connectionId: ollamaConn?.id }),
        }
      );
      setDiscovery(res.discovery);
      await onRefresh();
      setNotice(
        res.discovery.reachable
          ? `Discovered ${res.discovery.models.length} installed model(s) from ${res.discovery.endpoint}.`
          : res.discovery.error || 'Could not reach Ollama.'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Discovery failed.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleSaveOllamaDefaults = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ollamaConn) return;
    setSavingOllama(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/models/${ollamaConn.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          endpoint,
          defaultModel: defaultChatModel,
          embeddingModel: defaultEmbedModel,
        }),
      });
      await onRefresh();
      setNotice('Default Ollama endpoint, chat model, and embedding model saved.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSavingOllama(false);
    }
  };

  const handleTest = async (id: string, model?: string) => {
    setTestingId(id);
    setError('');
    setNotice('');
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/models/${id}/test`, {
        method: 'POST',
        body: JSON.stringify({ model }),
      });
      await onRefresh();
      setNotice(res.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Model test failed.');
    } finally {
      setTestingId(null);
    }
  };

  const handleAddLegacyGemini = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/models', {
        method: 'POST',
        body: JSON.stringify({
          name: legacyName,
          provider: 'gemini',
          authMode: 'byok',
          apiKey: legacyKey,
          defaultModel: legacyModel,
          testConnection: true,
        }),
      });
      setLegacyName('');
      setLegacyKey('');
      setNotice('Optional legacy Gemini connection saved.');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save legacy connection.');
    }
  };

  const handleEnablePreviewGemini = async () => {
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/models', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Preview Cloud Gemini (Server Key)',
          provider: 'gemini',
          authMode: 'platform_managed',
          defaultModel: 'gemini-3.1-flash-lite',
          testConnection: true,
        }),
      });
      setNotice('Preview Cloud Gemini enabled and ready to assign to chatbots.');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to enable Preview Cloud Gemini.');
    }
  };

  const handleApplyToAllBots = async (connId: string, modelOverride?: string) => {
    setError('');
    setNotice('');
    try {
      const res = await apiRequest<{ ok: boolean; updatedChatbots: number; model: string }>(
        `/api/models/${connId}/apply-all`,
        {
          method: 'POST',
          body: JSON.stringify({ model: modelOverride }),
        }
      );
      await onRefresh();
      setNotice(`Applied model "${res.model}" to ${res.updatedChatbots} chatbot(s) in My Workspace.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to apply connection to chatbots.');
    }
  };

  const platformGeminiConn = connections.find(
    (c) => c.provider === 'gemini' && c.auth_mode === 'platform_managed'
  );
  const hasPlatformGemini = Boolean(platformGeminiConn);

  useEffect(() => {
    if (platformGeminiConn?.default_model) {
      setSelectedPreviewModel(
        platformGeminiConn.default_model === 'gemini-4-hydrogen'
          ? 'gemini-3.1-flash-lite'
          : platformGeminiConn.default_model
      );
    }
  }, [platformGeminiConn?.default_model]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          AI Models & Embeddings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {platformKeyConfigured && !discovery?.reachable
            ? 'Existing Server Gemini API key is active and ready for instant MVP testing. Local Ollama + Qdrant remain optional for self-hosted Docker Compose.'
            : 'KRESNA defaults to self-hosted Ollama for chat inference and local embeddings. Models are discovered dynamically from your Ollama instance.'}
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

      {platformKeyConfigured && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                <h2 className="text-base font-semibold text-slate-950">
                  Gemini AI Ready (Existing Server API Key)
                </h2>
                <span className="rounded bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                  Connected
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-700">
                Ready for Playground, Knowledge Q&A, and Website Widget without waiting for Docker Ollama.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Preview Gemini Model"
                value={selectedPreviewModel}
                onChange={(e) => setSelectedPreviewModel(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
              >
                {GEMINI_MODEL_CATALOG.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              {platformGeminiConn ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleTest(platformGeminiConn.id, selectedPreviewModel)}
                    disabled={testingId === platformGeminiConn.id}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                  >
                    {testingId === platformGeminiConn.id ? 'Testing...' : 'Test Gemini'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyToAllBots(platformGeminiConn.id, selectedPreviewModel)}
                    className="rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                  >
                    Use Gemini on All Chatbots
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleEnablePreviewGemini}
                  className="rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  Enable Server Gemini
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Configured AI Connections */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-950">
          Configured AI Connections ({connections.length})
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Switch all chatbots between Gemini (Server API Key / BYOK) and Local Ollama in one click.
        </p>
        <ul className="mt-4 divide-y divide-slate-200">
          {connections.map((conn) => (
            <li key={conn.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
              <div>
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <span>{conn.name}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-700">
                    {conn.provider}
                  </span>
                  <span
                    className={`font-mono text-[10px] ${
                      conn.status === 'connected' ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {conn.status}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                  Model: {conn.default_model || '(not selected yet)'}{' '}
                  {conn.endpoint ? `· ${conn.endpoint}` : conn.key_hint ? `· ${conn.key_hint}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleTest(conn.id, conn.default_model)}
                  disabled={testingId === conn.id}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50"
                >
                  {testingId === conn.id ? 'Testing...' : 'Test'}
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyToAllBots(conn.id, conn.default_model)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                >
                  Use on All Chatbots
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Ollama Endpoint & Default Models */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSaveOllamaDefaults}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Local Ollama Connection</h2>
              <p className="text-xs text-slate-500">
                Status:{' '}
                <strong className={discovery?.reachable ? 'text-emerald-700' : 'text-amber-700'}>
                  {discovery?.reachable ? `Reachable (${discovery.latencyMs}ms)` : 'Not Connected'}
                </strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDiscover}
                disabled={discovering}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${discovering ? 'animate-spin' : ''}`} />
                {discovering ? 'Inspecting...' : 'Refresh Installed Models'}
              </button>
              {ollamaConn && (
                <button
                  type="button"
                  onClick={() => handleTest(ollamaConn.id, defaultChatModel)}
                  disabled={testingId === ollamaConn.id}
                  className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {testingId === ollamaConn.id ? 'Testing...' : 'Test Chat Model'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="m-ollama-url" className="block text-xs font-medium text-slate-700">
                Ollama Base URL
              </label>
              <input
                id="m-ollama-url"
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="m-chat-default" className="block text-xs font-medium text-slate-700">
                Default Chat Model
              </label>
              <input
                id="m-chat-default"
                list="discovered-chat-list"
                value={defaultChatModel}
                onChange={(e) => setDefaultChatModel(e.target.value)}
                placeholder="e.g., llama3.1:8b"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
              />
              <datalist id="discovered-chat-list">
                {discovery?.chatModels.map((m) => (
                  <option key={m.name} value={m.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="m-embed-default" className="block text-xs font-medium text-slate-700">
                Default Embedding Model
              </label>
              <input
                id="m-embed-default"
                list="discovered-embed-list"
                value={defaultEmbedModel}
                onChange={(e) => setDefaultEmbedModel(e.target.value)}
                placeholder="e.g., nomic-embed-text"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
              />
              <datalist id="discovered-embed-list">
                {discovery?.embeddingModels.map((m) => (
                  <option key={m.name} value={m.name} />
                ))}
              </datalist>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingOllama}
            className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
          >
            {savingOllama ? 'Saving...' : 'Save Ollama Defaults'}
          </button>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Database className="h-4 w-4 text-slate-700" />
              Qdrant Vector Engine
            </h2>
            <span
              className={`text-xs font-semibold ${
                qdrantHealth?.reachable ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {qdrantHealth?.reachable ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="mt-3 space-y-1.5 text-xs text-slate-600">
            <div className="font-mono">{qdrantHealth?.url || 'http://qdrant:6333'}</div>
            <div>Collection: {qdrantHealth?.collectionName || 'kresna_knowledge'}</div>
            <div>Indexed vectors: {qdrantHealth?.pointsCount ?? 0}</div>
            {qdrantHealth?.error && <div className="text-amber-800">{qdrantHealth.error}</div>}
          </div>
        </div>
      </div>

      {/* Discovered Models Grid OR Honest Pull Instructions */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-950">
          Installed Ollama Models ({discovery?.models.length ?? 0})
        </h2>

        {discovery && discovery.models.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {discovery.models.map((m) => (
              <div key={m.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-950">{m.name}</span>
                  <span className="rounded bg-white px-2 py-0.5 font-mono text-[10px] uppercase text-slate-700 border border-slate-200">
                    {m.capabilities.role}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-slate-600">
                  {m.parameterSize && <span>{m.parameterSize}</span>}
                  {m.capabilities.contextLength && <span>· {m.capabilities.contextLength} ctx</span>}
                  {m.capabilities.supportsTools && (
                    <span className="text-emerald-700 inline-flex items-center gap-0.5">
                      <Check className="h-3 w-3" /> Tools
                    </span>
                  )}
                  {m.capabilities.supportsStreaming && <span>· Streaming</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-5 text-xs">
            <p className="font-semibold text-slate-900">
              {discovery?.reachable
                ? 'Ollama is running, but 0 models are installed yet.'
                : 'No live Ollama models discovered yet.'}
            </p>
            <p className="mt-1 text-slate-600">
              Pull recommended open-source chat and embedding models using PowerShell or terminal:
            </p>
            <div className="mt-3 space-y-2">
              {SUGGESTED_OLLAMA_MODELS.map((m) => (
                <div
                  key={m.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2"
                >
                  <code className="font-mono text-[11px] text-slate-900">{m.pullCommand}</code>
                  <span className="text-slate-500">
                    {m.role.toUpperCase()} — {m.note}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Legacy / Optional Cloud Providers */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Optional External / Legacy Providers
            </h2>
            <p className="text-xs text-slate-500">
              Not required for self-hosted Docker Compose operation. Server Gemini key:{' '}
              {platformKeyConfigured ? 'Present (Ready for preview testing)' : 'Not configured'}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {platformKeyConfigured && !hasPlatformGemini && (
              <button
                type="button"
                onClick={handleEnablePreviewGemini}
                className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Enable Server Gemini (Preview)
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowLegacy((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {showLegacy ? 'Hide BYOK Form' : 'Configure Optional Gemini BYOK'}
            </button>
          </div>
        </div>

        {showLegacy && (
          <form
            onSubmit={handleAddLegacyGemini}
            className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-4"
          >
            <input
              type="text"
              required
              value={legacyName}
              onChange={(e) => setLegacyName(e.target.value)}
              placeholder="Connection Name"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
            />
            <input
              type="password"
              required
              value={legacyKey}
              onChange={(e) => setLegacyKey(e.target.value)}
              placeholder="Gemini API Key (AIza...)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
            />
            <select
              value={legacyModel}
              onChange={(e) => setLegacyModel(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
            >
              {GEMINI_MODEL_CATALOG.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Save Legacy Key
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
