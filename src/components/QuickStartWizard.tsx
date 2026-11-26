import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  FileUp,
  Globe,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import {
  apiRequest,
  apiUploadFile,
  type ChatbotRow,
  type KnowledgeItemRow,
  type ModelConnectionRow,
  type OllamaDiscoveryResult,
} from '../lib/api';
import {
  CHATBOT_PRESETS,
  GEMINI_MODEL_CATALOG,
  SUGGESTED_OLLAMA_MODELS,
  getPresetByKey,
  validateWizardStep,
  type BuilderMode,
  type ChatbotPresetKey,
} from '../shared/kresna-logic';

interface QuickStartWizardProps {
  connections: ModelConnectionRow[];
  ollamaDiscovery: OllamaDiscoveryResult | null;
  platformKeyConfigured?: boolean;
  builderMode: BuilderMode;
  onCancel: () => void;
  onConnectionsUpdated: () => Promise<void>;
  onComplete: (chatbotId: string) => Promise<void>;
}

interface StarterKnowledgeDraft {
  id: string;
  title: string;
  sourceType: 'faq' | 'note';
  content: string;
}

const STEPS = [
  { num: 1, label: 'Create Chatbot' },
  { num: 2, label: 'Add Knowledge' },
  { num: 3, label: 'Choose AI' },
  { num: 4, label: 'Behavior & Widget' },
  { num: 5, label: 'Test & Publish' },
];

export const QuickStartWizard: React.FC<QuickStartWizardProps> = ({
  connections,
  ollamaDiscovery: initialDiscovery,
  platformKeyConfigured = false,
  builderMode,
  onCancel,
  onConnectionsUpdated,
  onComplete,
}) => {
  const defaultPreset = getPresetByKey('customer_support');
  const ollamaConn = connections.find((c) => c.provider === 'ollama');
  const readyFallbackConn = connections.find(
    (c) =>
      c.provider !== 'ollama' &&
      (c.status === 'connected' ||
        (c.provider === 'gemini' && c.auth_mode === 'platform_managed' && platformKeyConfigured)) &&
      Boolean(c.default_model)
  );
  const ollamaHasModel =
    Boolean(ollamaConn?.default_model) || Boolean(initialDiscovery?.chatModels[0]?.name);
  const defaultConn =
    ollamaHasModel || !readyFallbackConn
      ? (ollamaConn ?? connections[0])
      : readyFallbackConn;

  const [step, setStep] = useState(1);
  const [error, setError] = useState('');

  // Step 1: Identity
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<ChatbotPresetKey>('customer_support');
  const [purpose, setPurpose] = useState(defaultPreset.defaultPurpose);
  const [language, setLanguage] = useState('English');

  // Step 2: Knowledge (files, URLs, existing items, or starter FAQs)
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [queuedUrls, setQueuedUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [existingKnowledge, setExistingKnowledge] = useState<KnowledgeItemRow[]>([]);
  const [selectedExistingIds, setSelectedExistingIds] = useState<string[]>([]);
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<StarterKnowledgeDraft[]>([]);
  const [kTitle, setKTitle] = useState('');
  const [kContent, setKContent] = useState('');
  const [kType, setKType] = useState<'faq' | 'note'>('faq');

  // Step 3: Choose AI (Local Ollama first + optional legacy)
  const [discovery, setDiscovery] = useState<OllamaDiscoveryResult | null>(initialDiscovery);
  const [discovering, setDiscovering] = useState(false);
  const [modelConnectionId, setModelConnectionId] = useState(defaultConn?.id ?? '');
  const [ollamaEndpoint, setOllamaEndpoint] = useState(
    ollamaConn?.endpoint || initialDiscovery?.endpoint || 'http://ollama:11434'
  );
  const [modelId, setModelId] = useState(
    defaultConn?.provider === 'ollama'
      ? ollamaConn?.default_model || initialDiscovery?.chatModels[0]?.name || ''
      : defaultConn?.default_model || GEMINI_MODEL_CATALOG[0].id
  );
  const [embeddingModelId, setEmbeddingModelId] = useState(
    ollamaConn?.embedding_model || initialDiscovery?.embeddingModels[0]?.name || ''
  );
  const [testingConn, setTestingConn] = useState(false);
  const [connTestMessage, setConnTestMessage] = useState('');

  // Step 4: Personality & Behavior
  const [style, setStyle] = useState(defaultPreset.defaultStyle);
  const [welcomeMessage, setWelcomeMessage] = useState(defaultPreset.defaultWelcome);
  const [escalationMode, setEscalationMode] = useState(defaultPreset.defaultEscalation);
  const [systemInstructions, setSystemInstructions] = useState('');

  // Step 5: Persisted draft bot + live test + widget publish
  const [createdBot, setCreatedBot] = useState<ChatbotRow | null>(null);
  const [savingBot, setSavingBot] = useState(false);
  const [ingestingNotice, setIngestingNotice] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testMessages, setTestMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string; meta?: string }>
  >([]);
  const [conversationId, setConversationId] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    apiRequest<{ items: KnowledgeItemRow[] }>('/api/knowledge')
      .then((res) => setExistingKnowledge(res.items))
      .catch(() => {});
  }, []);

  const selectedConnection = connections.find((c) => c.id === modelConnectionId);

  const handleSelectPreset = (key: ChatbotPresetKey) => {
    const p = getPresetByKey(key);
    setPreset(key);
    setPurpose(p.defaultPurpose);
    setStyle(p.defaultStyle);
    setWelcomeMessage(p.defaultWelcome);
    setEscalationMode(p.defaultEscalation);
  };

  const handleAddStarterKnowledge = () => {
    if (!kTitle.trim() || !kContent.trim()) return;
    setKnowledgeDrafts((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: kTitle.trim(),
        sourceType: kType,
        content: kContent.trim(),
      },
    ]);
    setKTitle('');
    setKContent('');
  };

  const handleAddUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setQueuedUrls((prev) => [...prev, trimmed]);
    setUrlInput('');
  };

  const handleDiscoverOllama = async () => {
    setDiscovering(true);
    setError('');
    try {
      const res = await apiRequest<{ discovery: OllamaDiscoveryResult }>(
        '/api/models/ollama/discover',
        {
          method: 'POST',
          body: JSON.stringify({
            endpoint: ollamaEndpoint,
            connectionId: selectedConnection?.provider === 'ollama' ? selectedConnection.id : undefined,
          }),
        }
      );
      setDiscovery(res.discovery);
      if (!modelId && res.discovery.chatModels[0]) {
        setModelId(res.discovery.chatModels[0].name);
      }
      if (!embeddingModelId && res.discovery.embeddingModels[0]) {
        setEmbeddingModelId(res.discovery.embeddingModels[0].name);
      }
      await onConnectionsUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to inspect Ollama.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleTestSelectedConnection = async () => {
    if (!modelConnectionId) return;
    setError('');
    setConnTestMessage('');
    setTestingConn(true);
    try {
      if (selectedConnection?.provider === 'ollama') {
        await apiRequest(`/api/models/${modelConnectionId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            endpoint: ollamaEndpoint,
            defaultModel: modelId,
            embeddingModel: embeddingModelId,
          }),
        });
      }
      const res = await apiRequest<{ ok: boolean; message: string }>(
        `/api/models/${modelConnectionId}/test`,
        {
          method: 'POST',
          body: JSON.stringify({ model: modelId }),
        }
      );
      await onConnectionsUpdated();
      setConnTestMessage(res.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection test failed.');
    } finally {
      setTestingConn(false);
    }
  };

  const handleNext = async () => {
    setError('');
    if (step === 1) {
      const check = validateWizardStep(1, {
        name,
        purpose,
        preset,
        language,
        style,
        modelConnectionId,
        modelId,
      });
      if (!check.valid) {
        setError(check.errors.join(' '));
        return;
      }
    }

    if (step === 3 && !modelConnectionId) {
      setError('Select an AI model connection.');
      return;
    }

    if (step === 4) {
      if (!createdBot) {
        setSavingBot(true);
        try {
          // Persist model selection on Ollama connection if changed
          if (selectedConnection?.provider === 'ollama' && (modelId || embeddingModelId)) {
            await apiRequest(`/api/models/${selectedConnection.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                endpoint: ollamaEndpoint,
                defaultModel: modelId,
                embeddingModel: embeddingModelId,
              }),
            });
          }

          const res = await apiRequest<{ chatbot: ChatbotRow }>('/api/chatbots', {
            method: 'POST',
            body: JSON.stringify({
              name,
              purpose,
              preset,
              language,
              style,
              escalationMode,
              welcomeMessage,
              systemInstructions,
              modelConnectionId,
              modelId,
              embeddingModelId,
              mode: builderMode,
              starterKnowledge: knowledgeDrafts.map(({ title, sourceType, content }) => ({
                title,
                sourceType,
                content,
              })),
              existingKnowledgeIds: selectedExistingIds,
            }),
          });

          const bot = res.chatbot;
          // Ingest queued uploaded files & website URLs onto the new chatbot
          let ingestedCount = knowledgeDrafts.length + selectedExistingIds.length;
          for (const file of queuedFiles) {
            const fd = new FormData();
            fd.append('chatbotId', bot.id);
            fd.append('title', file.name);
            fd.append('file', file);
            await apiUploadFile('/api/knowledge/upload', fd);
            ingestedCount++;
          }
          for (const url of queuedUrls) {
            await apiRequest('/api/knowledge/url', {
              method: 'POST',
              body: JSON.stringify({ chatbotId: bot.id, url }),
            });
            ingestedCount++;
          }

          if (ingestedCount > 0) {
            setIngestingNotice(`${ingestedCount} knowledge source(s) indexed into FTS5 + vector pipeline.`);
          }
          setCreatedBot(bot);
          setTestMessages([
            {
              role: 'assistant',
              content: bot.welcome_message,
              meta: 'Welcome message',
            },
          ]);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : 'Failed to create chatbot.');
          setSavingBot(false);
          return;
        }
        setSavingBot(false);
      }
    }

    setStep((s) => Math.min(5, s + 1));
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createdBot || !testInput.trim()) return;
    const prompt = testInput.trim();
    setTestInput('');
    setError('');
    setTestMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    setSendingTest(true);

    try {
      const res = await apiRequest<{
        conversationId: string;
        assistantMessage: {
          content: string;
          model_used: string;
          latency_ms: number;
          input_tokens: number;
          output_tokens: number;
        };
        trace: {
          iterations: number;
          retrievalSources: Array<{ citation: string }>;
        };
      }>(`/api/chatbots/${createdBot.id}/playground`, {
        method: 'POST',
        body: JSON.stringify({ message: prompt, conversationId }),
      });
      setConversationId(res.conversationId);
      const m = res.assistantMessage;
      const citeText =
        res.trace?.retrievalSources?.length > 0
          ? ` · ${res.trace.retrievalSources.length} source(s)`
          : '';
      setTestMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: m.content,
          meta: `${m.model_used} · ${m.latency_ms}ms · ${res.trace?.iterations || 1} iter${citeText}`,
        },
      ]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Playground reply failed.');
    } finally {
      setSendingTest(false);
    }
  };

  const handlePublish = async () => {
    if (!createdBot) return;
    setError('');
    setPublishing(true);
    try {
      await apiRequest(`/api/chatbots/${createdBot.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ status: 'published' }),
      });
      await onComplete(createdBot.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  };

  const hasLiveReply = testMessages.some(
    (m) => m.role === 'assistant' && m.meta !== 'Welcome message'
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to My Chatbots
          </button>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950">
            Guided Chatbot Builder
          </h1>
        </div>
        <div className="text-xs font-medium text-slate-500">Step {step} of 5</div>
      </div>

      {/* Stepper */}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STEPS.map((s) => {
          const active = step === s.num;
          const done = step > s.num;
          return (
            <li key={s.num}>
              <button
                type="button"
                disabled={s.num > step && !createdBot}
                onClick={() => {
                  if (s.num <= step || createdBot) setStep(s.num);
                }}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-medium ${
                  active
                    ? 'border-blue-700 bg-blue-50 font-semibold text-blue-900'
                    : done
                      ? 'border-slate-200 bg-white text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                <span className="font-mono text-[11px] font-semibold">
                  {done ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : `0${s.num}`}
                </span>
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        {/* STEP 1: CREATE CHATBOT */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Step 1 — Create Your Chatbot
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Choose a role preset to populate smart defaults, then name and describe your assistant.
              </p>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700">Role Preset</div>
              <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {CHATBOT_PRESETS.map((p) => {
                  const selected = preset === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => handleSelectPreset(p.key)}
                      className={`rounded-lg border p-3.5 text-left transition-colors ${
                        selected
                          ? 'border-blue-700 bg-blue-50/40'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900">{p.label}</div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{p.summary}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="bot-name" className="block text-xs font-medium text-slate-700">
                  Chatbot Name
                </label>
                <input
                  id="bot-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Fleet Operations Assistant"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="bot-language" className="block text-xs font-medium text-slate-700">
                  Primary Language
                </label>
                <select
                  id="bot-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="English">English</option>
                  <option value="Indonesian">Indonesian</option>
                  <option value="Multilingual (Indonesian & English)">
                    Multilingual (Indonesian & English)
                  </option>
                  <option value="Spanish">Spanish</option>
                  <option value="Japanese">Japanese</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="bot-purpose" className="block text-xs font-medium text-slate-700">
                What should this chatbot help users accomplish?
              </label>
              <textarea
                id="bot-purpose"
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* STEP 2: ADD KNOWLEDGE (Files, URLs, Existing, Starter FAQs) */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Step 2 — Add Knowledge Sources
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Upload Excel/CSV spreadsheets, PDFs, Word docs, text/HTML files, fetch website URLs, or write starter FAQs. All sources are indexed automatically into SQLite FTS5 + Qdrant.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* File Upload Queue */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <FileUp className="h-4 w-4 text-blue-700" />
                  Upload Documents & Spreadsheets
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Supports <span className="font-mono">.xlsx, .csv, .pdf, .docx, .txt, .html</span>. Excel sheets preserve sheet names, headers, and row numbers.
                </p>
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.csv,.pdf,.docx,.txt,.md,.html,.htm"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) setQueuedFiles((prev) => [...prev, ...files]);
                    e.target.value = '';
                  }}
                  aria-label="Upload knowledge files"
                  className="mt-3 block w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
                />
                {queuedFiles.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {queuedFiles.map((f, idx) => (
                      <li
                        key={`${f.name}-${idx}`}
                        className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 text-xs border border-slate-200"
                      >
                        <span className="truncate font-mono">{f.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-slate-400 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Website URL Queue */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Globe className="h-4 w-4 text-blue-700" />
                  Add Website URL
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Fetches public web page content with SSRF safety validation.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://docs.example.com/faq"
                    aria-label="Website URL to ingest"
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddUrl}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Queue URL
                  </button>
                </div>
                {queuedUrls.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {queuedUrls.map((u, idx) => (
                      <li
                        key={`${u}-${idx}`}
                        className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 text-xs border border-slate-200"
                      >
                        <span className="truncate font-mono">{u}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setQueuedUrls((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-slate-400 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Existing Workspace Knowledge */}
            {existingKnowledge.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-xs font-semibold text-slate-900">
                  Or Clone Existing Workspace Knowledge ({existingKnowledge.length} available)
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {existingKnowledge.slice(0, 6).map((item) => {
                    const checked = selectedExistingIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedExistingIds((prev) =>
                              checked ? prev.filter((x) => x !== item.id) : [...prev, item.id]
                            )
                          }
                        />
                        <span className="truncate font-medium text-slate-800">{item.title}</span>
                        <span className="ml-auto font-mono text-[10px] text-slate-500">
                          {item.source_type}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick FAQ / Policy Note */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-900">
                Or Write Quick FAQ / Policy Note
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  value={kTitle}
                  onChange={(e) => setKTitle(e.target.value)}
                  placeholder="Title (e.g., Operating Hours & SLA)"
                  aria-label="Knowledge title"
                  className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                />
                <select
                  value={kType}
                  onChange={(e) => setKType(e.target.value as 'faq' | 'note')}
                  aria-label="Knowledge record type"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="faq">Structured FAQ</option>
                  <option value="note">Policy Note</option>
                </select>
              </div>
              <textarea
                rows={2}
                value={kContent}
                onChange={(e) => setKContent(e.target.value)}
                placeholder="Verified factual policy or troubleshooting steps..."
                aria-label="Knowledge content"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
              />
              <div>
                <button
                  type="button"
                  onClick={handleAddStarterKnowledge}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add FAQ / Note
                </button>
              </div>
              {knowledgeDrafts.length > 0 && (
                <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                  {knowledgeDrafts.map((item) => (
                    <li key={item.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="font-medium text-slate-900">{item.title}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setKnowledgeDrafts((prev) => prev.filter((x) => x.id !== item.id))
                        }
                        className="text-slate-400 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: CHOOSE AI */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Step 3 — Choose Your AI Model
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {selectedConnection?.provider === 'gemini'
                  ? 'Using Gemini with your existing API key. Ready for immediate MVP testing.'
                  : 'Select an installed Ollama chat model or switch to your configured Gemini connection.'}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wiz-conn" className="block text-xs font-medium text-slate-700">
                  AI Provider Connection
                </label>
                <select
                  id="wiz-conn"
                  value={modelConnectionId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setModelConnectionId(nextId);
                    setConnTestMessage('');
                    const nextConn = connections.find((c) => c.id === nextId);
                    if (nextConn) {
                      setModelId(
                        nextConn.default_model ||
                          (nextConn.provider === 'gemini'
                            ? GEMINI_MODEL_CATALOG[0].id
                            : discovery?.chatModels[0]?.name || '')
                      );
                    }
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider === 'gemini' ? 'Gemini API Key' : c.provider})
                    </option>
                  ))}
                </select>
              </div>

              {selectedConnection?.provider === 'gemini' ? (
                <div>
                  <label htmlFor="wiz-gem" className="block text-xs font-medium text-slate-700">
                    Gemini Model
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <select
                      id="wiz-gem"
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                    >
                      {GEMINI_MODEL_CATALOG.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleTestSelectedConnection}
                      disabled={!modelConnectionId || testingConn}
                      className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {testingConn ? 'Testing...' : 'Test'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label htmlFor="wiz-ollama-url" className="block text-xs font-medium text-slate-700">
                      Ollama Endpoint
                    </label>
                    <input
                      id="wiz-ollama-url"
                      type="text"
                      value={ollamaEndpoint}
                      onChange={(e) => setOllamaEndpoint(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleDiscoverOllama}
                    disabled={discovering}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${discovering ? 'animate-spin' : ''}`} />
                    {discovering ? 'Checking...' : 'Discover'}
                  </button>
                </div>
              )}
            </div>

            {connTestMessage && (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                {connTestMessage}
              </div>
            )}

            {selectedConnection?.provider !== 'gemini' && (
              <>
                {discovery && (
                  <div className="text-xs">
                    {discovery.reachable ? (
                      <span className="font-medium text-emerald-700">
                        Ollama reachable ({discovery.latencyMs}ms) · {discovery.chatModels.length} chat model(s), {discovery.embeddingModels.length} embedding model(s) installed
                      </span>
                    ) : (
                      <span className="font-medium text-amber-800">
                        {discovery.error || 'Ollama not reachable yet.'}{' '}
                        {platformKeyConfigured
                          ? 'Tip: Select "Preview Cloud Gemini (Server Key)" above to run immediately.'
                          : ''}
                      </span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="wiz-chat-model" className="block text-xs font-medium text-slate-700">
                      Chat Model
                    </label>
                    {discovery && discovery.chatModels.length > 0 ? (
                      <select
                        id="wiz-chat-model"
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="">-- Select discovered chat model --</option>
                        {discovery.chatModels.map((m) => (
                          <option key={m.name} value={m.name}>
                            {m.name} ({m.parameterSize || 'local'})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="wiz-chat-model"
                        type="text"
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        placeholder="e.g., llama3.1:8b or qwen2.5:7b"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                      />
                    )}
                  </div>

                  <div>
                    <label htmlFor="wiz-embed-model" className="block text-xs font-medium text-slate-700">
                      Embedding Model (Optional for Qdrant Vectors)
                    </label>
                    {discovery && discovery.embeddingModels.length > 0 ? (
                      <select
                        id="wiz-embed-model"
                        value={embeddingModelId}
                        onChange={(e) => setEmbeddingModelId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="">-- None (use SQLite FTS5 only) --</option>
                        {discovery.embeddingModels.map((m) => (
                          <option key={m.name} value={m.name}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="wiz-embed-model"
                        type="text"
                        value={embeddingModelId}
                        onChange={(e) => setEmbeddingModelId(e.target.value)}
                        placeholder="e.g., nomic-embed-text"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                      />
                    )}
                  </div>
                </div>

                {(!discovery?.reachable || discovery.models.length === 0) && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-900">
                      Need to pull a local model in Docker Compose?
                    </div>
                    <div className="mt-2 space-y-1.5 font-mono text-[11px] text-slate-700">
                      {SUGGESTED_OLLAMA_MODELS.map((m) => (
                        <div key={m.name} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{m.pullCommand}</span>
                          <span className="font-sans text-slate-500">{m.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* STEP 4: CONFIGURE BEHAVIOR & WIDGET */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Step 4 — Configure Behavior & Website Widget
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Fine-tune tone, welcome greeting, and escalation rules. You can customize widget colors and allowed domains immediately after creation.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="bot-style" className="block text-xs font-medium text-slate-700">
                  Communication Style / Tone
                </label>
                <input
                  id="bot-style"
                  type="text"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="bot-welcome" className="block text-xs font-medium text-slate-700">
                  Welcome Message
                </label>
                <input
                  id="bot-welcome"
                  type="text"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="bot-escalation" className="block text-xs font-medium text-slate-700">
                Escalation & Fallback Behavior
              </label>
              <input
                id="bot-escalation"
                type="text"
                value={escalationMode}
                onChange={(e) => setEscalationMode(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900"
              />
            </div>

            {builderMode === 'developer' && (
              <div>
                <label htmlFor="bot-sys" className="block text-xs font-medium text-slate-700">
                  Custom System Instructions (Developer Mode)
                </label>
                <textarea
                  id="bot-sys"
                  rows={3}
                  value={systemInstructions}
                  onChange={(e) => setSystemInstructions(e.target.value)}
                  placeholder="Optional domain rules, formatting constraints, or tool instructions..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-xs text-slate-900"
                />
              </div>
            )}

            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 text-xs text-slate-700">
              <strong className="text-slate-900">Website Widget Included:</strong> Once you continue, KRESNA generates a public bot ID, Shadow DOM <code className="font-mono">/widget.js</code> script tag, and live preview page.
            </div>
          </div>
        )}

        {/* STEP 5: TEST & PUBLISH */}
        {step === 5 && createdBot && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  Step 5 — Test Conversation & Publish
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {ingestingNotice || `Send a message to test ${createdBot.name} with multi-turn memory and hybrid knowledge retrieval.`}
                </p>
              </div>

              <div className="flex h-80 flex-col rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {testMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${
                        msg.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${
                          msg.role === 'user'
                            ? 'bg-slate-900 text-white'
                            : 'border border-slate-200 bg-white text-slate-900'
                        }`}
                      >
                        {msg.content}
                      </div>
                      {msg.meta && (
                        <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                          {msg.meta}
                        </div>
                      )}
                    </div>
                  ))}
                  {sendingTest && (
                    <div className="text-xs text-slate-500">
                      Running agent loop via {createdBot.model_id || 'configured AI'}...
                    </div>
                  )}
                </div>

                <form
                  onSubmit={handleSendTestMessage}
                  className="flex items-center gap-2 border-t border-slate-200 bg-white p-3"
                >
                  <input
                    type="text"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    placeholder="Ask a question to test your chatbot..."
                    aria-label="Playground test message"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sendingTest || !testInput.trim()}
                    aria-label="Send test message"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send
                  </button>
                </form>
              </div>
            </div>

            <div className="space-y-4 lg:col-span-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Publish Readiness</h3>
                <ul className="mt-3 space-y-2.5 text-xs">
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">Identity & Purpose</span>
                    <span className="font-medium text-emerald-700">Verified</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">AI Chat Model</span>
                    <span
                      className={`font-medium ${
                        createdBot.model_id ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {createdBot.model_id || 'Not set'}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-700">Playground Test</span>
                    <span
                      className={`font-medium ${
                        hasLiveReply ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {hasLiveReply ? 'Tested' : 'Optional before publish'}
                    </span>
                  </li>
                </ul>

                <div className="mt-4 border-t border-slate-200 pt-3">
                  <div className="text-xs font-medium text-slate-700">Website Embed Snippet</div>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-slate-900 p-2.5 font-mono text-[11px] text-slate-100">
{`<script
  src="${window.location.origin}/widget.js"
  data-bot-id="${createdBot.public_bot_id}">
</script>`}
                  </pre>
                  <a
                    href={`/widget-preview/${createdBot.public_bot_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                  >
                    Open Live Widget Preview <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={publishing}
                    className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                  >
                    {publishing ? 'Publishing...' : 'Publish Chatbot'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onComplete(createdBot.id)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Open Chatbot Workspace
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Wizard Footer Navigation */}
        {step < 5 && (
          <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={() => (step === 1 ? onCancel() : setStep((s) => s - 1))}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {step === 1 ? 'Cancel' : 'Previous'}
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={savingBot}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <span>
                {savingBot ? 'Creating & Indexing...' : step === 4 ? 'Create Draft & Continue' : 'Continue'}
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
