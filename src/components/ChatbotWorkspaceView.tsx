import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  FileUp,
  Globe,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import {
  apiRequest,
  apiUploadFile,
  type AgentExecutionTrace,
  type ChatbotRow,
  type KnowledgeChunkRow,
  type KnowledgeItemRow,
  type ModelConnectionRow,
  type OllamaDiscoveryResult,
  type WidgetConfig,
} from '../lib/api';
import { GEMINI_MODEL_CATALOG, type BuilderMode } from '../shared/kresna-logic';

interface ChatbotWorkspaceViewProps {
  chatbotId: string;
  connections: ModelConnectionRow[];
  ollamaDiscovery: OllamaDiscoveryResult | null;
  builderMode: BuilderMode;
  onBack: () => void;
  onDeleted: () => Promise<void>;
  onUpdated: () => Promise<void>;
}

interface PlaygroundMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  model_used?: string | null;
  provider_used?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
  feedback?: 'up' | 'down' | null;
  trace?: AgentExecutionTrace;
  suggested_followups?: string[];
}

export const ChatbotWorkspaceView: React.FC<ChatbotWorkspaceViewProps> = ({
  chatbotId,
  connections,
  ollamaDiscovery,
  builderMode,
  onBack,
  onDeleted,
  onUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [chatbot, setChatbot] = useState<ChatbotRow | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItemRow[]>([]);
  const [readiness, setReadiness] = useState<{
    ready: boolean;
    checks: Array<{ label: string; passed: boolean; detail: string }>;
  } | null>(null);
  const [tab, setTab] = useState<'playground' | 'knowledge' | 'settings'>('playground');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Playground state
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<AgentExecutionTrace | null>(null);

  // Knowledge tab state
  const [kTitle, setKTitle] = useState('');
  const [kType, setKType] = useState<'faq' | 'note'>('faq');
  const [kContent, setKContent] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [ingestingUrl, setIngestingUrl] = useState(false);
  const [previewItem, setPreviewItem] = useState<{
    item: KnowledgeItemRow;
    chunks: KnowledgeChunkRow[];
  } | null>(null);

  // Settings & Widget form
  const [editName, setEditName] = useState('');
  const [editPurpose, setEditPurpose] = useState('');
  const [editLanguage, setEditLanguage] = useState('');
  const [editStyle, setEditStyle] = useState('');
  const [editEscalation, setEditEscalation] = useState('');
  const [editWelcome, setEditWelcome] = useState('');
  const [editSys, setEditSys] = useState('');
  const [editConnId, setEditConnId] = useState('');
  const [editModelId, setEditModelId] = useState('');
  const [editEmbedModelId, setEditEmbedModelId] = useState('');
  const [widgetTitle, setWidgetTitle] = useState('');
  const [widgetSubtitle, setWidgetSubtitle] = useState('');
  const [widgetColor, setWidgetColor] = useState('#1D4ED8');
  const [widgetPosition, setWidgetPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right');
  const [widgetDomains, setWidgetDomains] = useState('localhost, 127.0.0.1');
  const [savingSettings, setSavingSettings] = useState(false);

  const loadChatbot = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<{
        chatbot: ChatbotRow;
        knowledgeItems: KnowledgeItemRow[];
        readiness: {
          ready: boolean;
          checks: Array<{ label: string; passed: boolean; detail: string }>;
        };
      }>(`/api/chatbots/${chatbotId}`);
      setChatbot(data.chatbot);
      setKnowledgeItems(data.knowledgeItems);
      setReadiness(data.readiness);

      setEditName(data.chatbot.name);
      setEditPurpose(data.chatbot.purpose);
      setEditLanguage(data.chatbot.language);
      setEditStyle(data.chatbot.style);
      setEditEscalation(data.chatbot.escalation_mode || '');
      setEditWelcome(data.chatbot.welcome_message);
      setEditSys(data.chatbot.system_instructions || '');
      setEditConnId(data.chatbot.model_connection_id || '');
      setEditModelId(data.chatbot.model_id || '');
      setEditEmbedModelId(data.chatbot.embedding_model_id || '');

      let wCfg: WidgetConfig = {};
      try {
        wCfg = JSON.parse(data.chatbot.widget_config_json || '{}');
      } catch {
        wCfg = {};
      }
      setWidgetTitle(wCfg.title || data.chatbot.name);
      setWidgetSubtitle(wCfg.subtitle || 'Ask a question or request help');
      setWidgetColor(wCfg.accentColor || '#1D4ED8');
      setWidgetPosition(wCfg.position === 'bottom-left' ? 'bottom-left' : 'bottom-right');
      setWidgetDomains(
        Array.isArray(wCfg.allowedDomains) && wCfg.allowedDomains.length > 0
          ? wCfg.allowedDomains.join(', ')
          : 'localhost, 127.0.0.1'
      );

      setMessages((prev) =>
        prev.length === 0
          ? [{ role: 'assistant', content: data.chatbot.welcome_message }]
          : prev
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load chatbot.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChatbot();
  }, [chatbotId]);

  const sendMessageWithPrompt = async (promptText: string) => {
    if (!promptText.trim() || !chatbot || sending) return;
    const prompt = promptText.trim();
    setChatInput('');
    setError('');
    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    setSending(true);
    try {
      const res = await apiRequest<{
        conversationId: string;
        assistantMessage: {
          id: string;
          content: string;
          model_used: string;
          provider_used: string;
          input_tokens: number;
          output_tokens: number;
          latency_ms: number;
          trace_json: string;
          suggested_followups?: string[];
        };
        trace: AgentExecutionTrace;
      }>(`/api/chatbots/${chatbot.id}/playground`, {
        method: 'POST',
        body: JSON.stringify({ message: prompt, conversationId }),
      });
      setConversationId(res.conversationId);
      const parsedTrace: AgentExecutionTrace | undefined =
        res.trace ||
        (res.assistantMessage && typeof res.assistantMessage.trace_json === 'string' && res.assistantMessage.trace_json
          ? JSON.parse(res.assistantMessage.trace_json)
          : undefined);
      if (parsedTrace) setSelectedTrace(parsedTrace);
      const followups =
        res.assistantMessage?.suggested_followups ||
        parsedTrace?.suggestedFollowups ||
        [];
      setMessages((prev) => [
        ...prev,
        {
          id: res.assistantMessage.id,
          role: 'assistant',
          content: res.assistantMessage.content,
          model_used: res.assistantMessage.model_used,
          provider_used: res.assistantMessage.provider_used,
          input_tokens: res.assistantMessage.input_tokens,
          output_tokens: res.assistantMessage.output_tokens,
          latency_ms: res.assistantMessage.latency_ms,
          feedback: null,
          trace: parsedTrace,
          suggested_followups: followups,
        },
      ]);
      const refreshed = await apiRequest<{
        readiness: {
          ready: boolean;
          checks: Array<{ label: string; passed: boolean; detail: string }>;
        };
      }>(`/api/chatbots/${chatbot.id}`);
      setReadiness(refreshed.readiness);
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to get response.');
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessageWithPrompt(chatInput);
  };

  const handleFeedback = async (msgId: string | undefined, value: 'up' | 'down') => {
    if (!msgId) return;
    try {
      await apiRequest(`/api/messages/${msgId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ feedback: value }),
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, feedback: value } : m))
      );
    } catch {
      // ignore non-critical error
    }
  };

  const handleResetChat = () => {
    setConversationId('');
    setSelectedTrace(null);
    setMessages(chatbot ? [{ role: 'assistant', content: chatbot.welcome_message }] : []);
  };

  const handleUploadKnowledgeFile = async (file: File) => {
    if (!chatbot) return;
    setError('');
    setNotice('');
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append('chatbotId', chatbot.id);
      fd.append('title', file.name);
      fd.append('file', file);
      await apiUploadFile('/api/knowledge/upload', fd);
      setNotice(`Indexed "${file.name}" into knowledge base.`);
      await loadChatbot();
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'File upload failed.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleIngestUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatbot || !urlInput.trim()) return;
    setError('');
    setNotice('');
    setIngestingUrl(true);
    try {
      await apiRequest('/api/knowledge/url', {
        method: 'POST',
        body: JSON.stringify({ chatbotId: chatbot.id, url: urlInput.trim() }),
      });
      setUrlInput('');
      setNotice('Website URL ingested and indexed.');
      await loadChatbot();
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Website URL ingestion failed.');
    } finally {
      setIngestingUrl(false);
    }
  };

  const handleAddKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatbot) return;
    setError('');
    try {
      await apiRequest(`/api/chatbots/${chatbot.id}/knowledge`, {
        method: 'POST',
        body: JSON.stringify({ title: kTitle, sourceType: kType, content: kContent }),
      });
      setKTitle('');
      setKContent('');
      await loadChatbot();
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save knowledge item.');
    }
  };

  const handlePreviewChunks = async (itemId: string) => {
    try {
      const res = await apiRequest<{ item: KnowledgeItemRow; chunks: KnowledgeChunkRow[] }>(
        `/api/knowledge/${itemId}/chunks`
      );
      setPreviewItem(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load chunks.');
    }
  };

  const handleReindex = async (itemId: string) => {
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/knowledge/${itemId}/reindex`, { method: 'POST' });
      setNotice('Knowledge item reindexed.');
      await loadChatbot();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reindex failed.');
    }
  };

  const handleDeleteKnowledge = async (itemId: string) => {
    if (!chatbot) return;
    await apiRequest(`/api/chatbots/${chatbot.id}/knowledge/${itemId}`, {
      method: 'DELETE',
    });
    setKnowledgeItems((prev) => prev.filter((k) => k.id !== itemId));
    await onUpdated();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatbot) return;
    setError('');
    setNotice('');
    setSavingSettings(true);
    try {
      const allowedDomains = widgetDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      const res = await apiRequest<{ chatbot: ChatbotRow }>(
        `/api/chatbots/${chatbot.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: editName,
            purpose: editPurpose,
            language: editLanguage,
            style: editStyle,
            escalationMode: editEscalation,
            welcomeMessage: editWelcome,
            systemInstructions: editSys,
            modelConnectionId: editConnId,
            modelId: editModelId,
            embeddingModelId: editEmbedModelId,
            mode: builderMode,
            widgetConfig: {
              title: widgetTitle,
              subtitle: widgetSubtitle,
              accentColor: widgetColor,
              position: widgetPosition,
              allowedDomains,
            },
          }),
        }
      );
      setChatbot(res.chatbot);
      setNotice('Chatbot and widget configuration saved.');
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!chatbot) return;
    setError('');
    setNotice('');
    const nextStatus = chatbot.status === 'published' ? 'draft' : 'published';
    try {
      await apiRequest(`/api/chatbots/${chatbot.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadChatbot();
      await onUpdated();
      setNotice(
        nextStatus === 'published'
          ? 'Chatbot published and active on website widget.'
          : 'Chatbot reverted to draft.'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update publish status.');
    }
  };

  const handleDeleteBot = async () => {
    if (!chatbot) return;
    await apiRequest(`/api/chatbots/${chatbot.id}`, { method: 'DELETE' });
    await onDeleted();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

  if (!chatbot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8">
        <p className="text-sm text-red-700">{error || 'Chatbot not found.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
        >
          Back to My Chatbots
        </button>
      </div>
    );
  }

  const selectedConnObj = connections.find((c) => c.id === editConnId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Chatbots
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              {chatbot.name}
            </h1>
            <span
              className={`text-xs font-semibold ${
                chatbot.status === 'published' ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {chatbot.status === 'published' ? 'Published' : 'Draft'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">
              {chatbot.model_id && chatbot.model_provider !== 'ollama'
                ? chatbot.model_id
                : ollamaDiscovery?.reachable && chatbot.model_id
                  ? chatbot.model_id
                  : connections.some((c) => c.provider === 'gemini' && c.status === 'connected')
                    ? 'gemini-3.1-flash-lite (Server Key Active)'
                    : chatbot.model_id || 'No model selected'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{chatbot.language}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{chatbot.public_bot_id}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {chatbot.status === 'published' && (
            <a
              href={`/widget-preview/${chatbot.public_bot_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              Open Live Widget Preview <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={handleTogglePublish}
            className={`rounded-lg px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              chatbot.status === 'published'
                ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                : 'bg-blue-700 text-white hover:bg-blue-800'
            }`}
          >
            {chatbot.status === 'published' ? 'Unpublish' : 'Publish Chatbot'}
          </button>
        </div>
      </div>

      {/* Segmented Tabs */}
      <div className="inline-flex rounded-lg bg-slate-200/70 p-1">
        {(
          [
            { id: 'playground', label: 'Playground & Execution Inspector' },
            { id: 'knowledge', label: `Knowledge (${knowledgeItems.length})` },
            { id: 'settings', label: 'Behavior & Widget Embed' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      {/* TAB 1: PLAYGROUND & EXECUTION INSPECTOR */}
      {tab === 'playground' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex h-[560px] flex-col rounded-xl border border-slate-200 bg-white lg:col-span-7">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">
                Live Agent Playground
              </div>
              <button
                type="button"
                onClick={handleResetChat}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                New Conversation
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-4">
              {messages.map((msg, idx) => (
                <div
                  key={msg.id || idx}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    {msg.content}
                    {msg.trace && msg.trace.retrievalSources?.length > 0 && (
                      <div className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
                        Sources: {msg.trace.retrievalSources.map((s) => s.citation).join(' | ')}
                      </div>
                    )}
                  </div>
                  {msg.role === 'assistant' &&
                    ((msg.suggested_followups && msg.suggested_followups.length > 0) ||
                      (msg.trace?.suggestedFollowups &&
                        msg.trace.suggestedFollowups.length > 0)) && (
                      <div className="mt-2 flex max-w-[85%] flex-wrap gap-1.5">
                        {(
                          msg.suggested_followups ||
                          msg.trace?.suggestedFollowups ||
                          []
                        ).map((chip, chipIdx) => (
                          <button
                            key={chipIdx}
                            type="button"
                            disabled={sending}
                            onClick={() => sendMessageWithPrompt(chip)}
                            className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 shadow-2xs transition-all hover:border-blue-400 hover:bg-blue-100 active:scale-95 disabled:opacity-50"
                          >
                            <span>💬</span>
                            <span>{chip}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  {msg.role === 'assistant' && msg.id && (
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
                      <span className="font-mono tabular-nums">
                        {msg.model_used} · {msg.latency_ms}ms ·{' '}
                        {msg.trace?.iterations || 1} iter
                      </span>
                      {msg.trace && (
                        <button
                          type="button"
                          onClick={() => setSelectedTrace(msg.trace!)}
                          className="font-semibold text-blue-700 hover:underline"
                        >
                          Inspect
                        </button>
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleFeedback(msg.id, 'up')}
                          aria-label="Helpful response"
                          className={`rounded p-1 hover:bg-slate-200 ${
                            msg.feedback === 'up' ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(msg.id, 'down')}
                          aria-label="Unhelpful response"
                          className={`rounded p-1 hover:bg-slate-200 ${
                            msg.feedback === 'down' ? 'text-red-700' : 'text-slate-400'
                          }`}
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="text-xs text-slate-500">
                  Agent thinking via {chatbot.model_id || 'configured model'}...
                </div>
              )}
            </div>

            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 border-t border-slate-200 bg-white p-3"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Send a message, follow-up, confirmation ('ya'), or topic switch..."
                aria-label="Chat message input"
                className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !chatInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </button>
            </form>
          </div>

          {/* Agent Execution Inspector */}
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Agent Execution Inspector
              </h2>
              {selectedTrace ? (
                <div className="mt-4 space-y-4 text-xs">
                  <dl className="space-y-1.5">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Provider / Model</dt>
                      <dd className="font-mono font-medium text-slate-900">
                        {selectedTrace.provider} · {selectedTrace.model}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Agent Loop Iterations</dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {selectedTrace.iterations}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Latency (Model / Total)</dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {selectedTrace.modelLatencyMs}ms / {selectedTrace.totalResponseMs}ms
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Tokens ({selectedTrace.tokensMeasured ? 'Measured' : 'Estimated'})</dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {selectedTrace.inputTokens} in / {selectedTrace.outputTokens} out
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Inference Cost</dt>
                      <dd className="font-mono font-medium text-slate-900 tabular-nums">
                        {selectedTrace.provider === 'ollama'
                          ? '$0.00 (Local)'
                          : `$${selectedTrace.estimatedCostUsd.toFixed(6)}`}
                      </dd>
                    </div>
                  </dl>

                  {selectedTrace.executionSummary?.length > 0 && (
                    <div className="border-t border-slate-100 pt-3">
                      <div className="font-semibold text-slate-800">Loop Decisions</div>
                      <ul className="mt-1 space-y-1 font-mono text-[11px] text-slate-600">
                        {selectedTrace.executionSummary.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="border-t border-slate-100 pt-3">
                    <div className="font-semibold text-slate-800">
                      Retrieved Evidence ({selectedTrace.retrievalSources?.length || 0})
                    </div>
                    {selectedTrace.retrievalSources?.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {selectedTrace.retrievalSources.map((src, idx) => (
                          <li key={idx} className="rounded bg-slate-50 p-2 text-[11px]">
                            <div className="font-semibold text-slate-800">{src.citation}</div>
                            <div className="font-mono text-slate-500">
                              {src.method} · RRF {src.rrfScore}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-1 text-slate-500">No knowledge chunks retrieved.</div>
                    )}
                  </div>

                  {selectedTrace.toolCalls?.length > 0 && (
                    <div className="border-t border-slate-100 pt-3">
                      <div className="font-semibold text-slate-800">Tool Executions</div>
                      <ul className="mt-1.5 space-y-1">
                        {selectedTrace.toolCalls.map((tc, idx) => (
                          <li key={idx} className="rounded bg-slate-50 p-2 font-mono text-[11px]">
                            {tc.name} — <strong>{tc.status}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedTrace.memorySnapshot && (
                    <div className="border-t border-slate-100 pt-3">
                      <div className="font-semibold text-slate-800">Conversation Memory</div>
                      <div className="mt-1 space-y-1 text-[11px] text-slate-600">
                        <div>
                          <strong>Objective:</strong> {selectedTrace.memorySnapshot.currentObjective || 'None'}
                        </div>
                        <div>
                          <strong>Topic:</strong> {selectedTrace.memorySnapshot.currentTopic || 'None'} ·{' '}
                          <strong>Frustration:</strong> {selectedTrace.memorySnapshot.frustrationLevel}
                        </div>
                        <div>
                          <strong>Confirmed Facts:</strong> {selectedTrace.memorySnapshot.confirmedFacts.length} ·{' '}
                          <strong>User-Reported:</strong> {selectedTrace.memorySnapshot.userReportedFacts.length}
                        </div>
                        {Object.keys(selectedTrace.memorySnapshot.extractedEntities || {}).length > 0 && (
                          <div className="font-mono text-[10px] text-slate-500">
                            Entities: {JSON.stringify(selectedTrace.memorySnapshot.extractedEntities)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  Send a message in the Playground to inspect agent iterations, RRF evidence citations, tool execution status, and structured memory separation.
                </p>
              )}
            </div>

            {readiness && (
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">Publish Checklist</h2>
                <ul className="mt-3 space-y-2.5">
                  {readiness.checks.map((c) => (
                    <li key={c.label} className="text-xs">
                      <div className="flex items-center justify-between font-medium">
                        <span className="text-slate-800">{c.label}</span>
                        <span className={c.passed ? 'text-emerald-700' : 'text-amber-700'}>
                          {c.passed ? (
                            <span className="inline-flex items-center gap-1">
                              <Check className="h-3.5 w-3.5" /> Ready
                            </span>
                          ) : (
                            'Pending'
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 text-slate-500">{c.detail}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MULTI-FORMAT KNOWLEDGE */}
      {tab === 'knowledge' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            {/* Upload File */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileUp className="h-4 w-4 text-blue-700" />
                Upload File (XLSX, CSV, PDF, DOCX, TXT, HTML)
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.pdf,.docx,.txt,.md,.html,.htm"
                disabled={uploadingFile}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadKnowledgeFile(file);
                  e.target.value = '';
                }}
                className="mt-3 block w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 py-2 file:text-xs file:font-semibold file:text-white"
              />
              {uploadingFile && (
                <div className="mt-2 text-xs text-blue-700">Parsing & indexing file...</div>
              )}
            </div>

            {/* Website URL */}
            <form
              onSubmit={handleIngestUrl}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Globe className="h-4 w-4 text-blue-700" />
                Ingest Website URL
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  required
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/help"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
                <button
                  type="submit"
                  disabled={ingestingUrl}
                  className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {ingestingUrl ? 'Fetching...' : 'Ingest'}
                </button>
              </div>
            </form>

            {/* Manual FAQ / Note */}
            <form
              onSubmit={handleAddKnowledge}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
            >
              <h2 className="text-sm font-semibold text-slate-900">Add Manual FAQ / Note</h2>
              <input
                type="text"
                required
                value={kTitle}
                onChange={(e) => setKTitle(e.target.value)}
                placeholder="Title / Question"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
              />
              <select
                value={kType}
                onChange={(e) => setKType(e.target.value as 'faq' | 'note')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
              >
                <option value="faq">FAQ Entry</option>
                <option value="note">Reference Note</option>
              </select>
              <textarea
                rows={3}
                required
                value={kContent}
                onChange={(e) => setKContent(e.target.value)}
                placeholder="Verified factual policy or answer..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Save Record
              </button>
            </form>
          </div>

          <div className="space-y-4 lg:col-span-7">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900">
                Indexed Knowledge Sources ({knowledgeItems.length})
              </h2>
              {knowledgeItems.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No knowledge sources attached yet. Upload a document, ingest a website URL, or add a FAQ record.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-200">
                  {knowledgeItems.map((item) => (
                    <li key={item.id} className="py-3.5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                            <span>{item.title}</span>
                            <span className="font-mono text-[11px] font-normal text-slate-500 uppercase">
                              {item.source_type}
                            </span>
                            <span className="font-mono text-[11px] text-emerald-700">
                              {item.chunk_count} chunks
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
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.content}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handlePreviewChunks(item.id)}
                            title="Preview chunks"
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReindex(item.id)}
                            title="Reindex"
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteKnowledge(item.id)}
                            aria-label={`Delete ${item.title}`}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {previewItem && (
              <div className="rounded-xl border border-blue-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Chunk Preview: {previewItem.item.title} ({previewItem.chunks.length} chunks)
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPreviewItem(null)}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                  {previewItem.chunks.map((c) => (
                    <div key={c.id} className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs">
                      <div className="font-mono text-[10px] text-slate-500">
                        Chunk #{c.chunk_index + 1} · ~{c.token_estimate} tokens · {c.metadata_json}
                      </div>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-800">
                        {c.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: BEHAVIOR & WIDGET EMBED */}
      {tab === 'settings' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleSaveSettings}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7"
          >
            <h2 className="text-base font-semibold text-slate-900">
              Chatbot & Model Configuration
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cfg-name" className="block text-xs font-medium text-slate-700">
                  Name
                </label>
                <input
                  id="cfg-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="cfg-lang" className="block text-xs font-medium text-slate-700">
                  Language
                </label>
                <input
                  id="cfg-lang"
                  type="text"
                  required
                  value={editLanguage}
                  onChange={(e) => setEditLanguage(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cfg-purpose" className="block text-xs font-medium text-slate-700">
                Purpose
              </label>
              <textarea
                id="cfg-purpose"
                rows={2}
                required
                value={editPurpose}
                onChange={(e) => setEditPurpose(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cfg-style" className="block text-xs font-medium text-slate-700">
                  Tone / Style
                </label>
                <input
                  id="cfg-style"
                  type="text"
                  value={editStyle}
                  onChange={(e) => setEditStyle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="cfg-welcome" className="block text-xs font-medium text-slate-700">
                  Welcome Message
                </label>
                <input
                  id="cfg-welcome"
                  type="text"
                  value={editWelcome}
                  onChange={(e) => setEditWelcome(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cfg-esc" className="block text-xs font-medium text-slate-700">
                Escalation Policy
              </label>
              <input
                id="cfg-esc"
                type="text"
                value={editEscalation}
                onChange={(e) => setEditEscalation(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="cfg-conn" className="block text-xs font-medium text-slate-700">
                  Provider Connection
                </label>
                <select
                  id="cfg-conn"
                  value={editConnId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setEditConnId(nextId);
                    const nextConn = connections.find((c) => c.id === nextId);
                    if (nextConn) {
                      setEditModelId(
                        nextConn.default_model ||
                          (nextConn.provider === 'gemini' ? GEMINI_MODEL_CATALOG[0].id : '')
                      );
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cfg-model" className="block text-xs font-medium text-slate-700">
                  Chat Model
                </label>
                {selectedConnObj?.provider === 'gemini' ? (
                  <select
                    id="cfg-model"
                    value={editModelId}
                    onChange={(e) => setEditModelId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                  >
                    {GEMINI_MODEL_CATALOG.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="cfg-model"
                    list="ollama-chat-models-list"
                    value={editModelId}
                    onChange={(e) => setEditModelId(e.target.value)}
                    placeholder="e.g., llama3.1:8b"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                  />
                )}
                <datalist id="ollama-chat-models-list">
                  {ollamaDiscovery?.chatModels.map((m) => (
                    <option key={m.name} value={m.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="cfg-embed" className="block text-xs font-medium text-slate-700">
                  Embedding Model
                </label>
                <input
                  id="cfg-embed"
                  list="ollama-embed-models-list"
                  value={editEmbedModelId}
                  onChange={(e) => setEditEmbedModelId(e.target.value)}
                  placeholder="e.g., nomic-embed-text"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                />
                <datalist id="ollama-embed-models-list">
                  {ollamaDiscovery?.embeddingModels.map((m) => (
                    <option key={m.name} value={m.name} />
                  ))}
                </datalist>
              </div>
            </div>

            {builderMode === 'developer' && (
              <div>
                <label htmlFor="cfg-sys" className="block text-xs font-medium text-slate-700">
                  Developer System Instructions
                </label>
                <textarea
                  id="cfg-sys"
                  rows={3}
                  value={editSys}
                  onChange={(e) => setEditSys(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                />
              </div>
            )}

            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs font-semibold text-slate-900">
                Website Widget Appearance & Domain Allowlist
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="w-title" className="block text-xs font-medium text-slate-700">
                    Widget Header Title
                  </label>
                  <input
                    id="w-title"
                    type="text"
                    value={widgetTitle}
                    onChange={(e) => setWidgetTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="w-sub" className="block text-xs font-medium text-slate-700">
                    Widget Subtitle
                  </label>
                  <input
                    id="w-sub"
                    type="text"
                    value={widgetSubtitle}
                    onChange={(e) => setWidgetSubtitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="w-color" className="block text-xs font-medium text-slate-700">
                    Accent Color
                  </label>
                  <input
                    id="w-color"
                    type="color"
                    value={widgetColor}
                    onChange={(e) => setWidgetColor(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-300 p-1"
                  />
                </div>
                <div>
                  <label htmlFor="w-pos" className="block text-xs font-medium text-slate-700">
                    Position
                  </label>
                  <select
                    id="w-pos"
                    value={widgetPosition}
                    onChange={(e) =>
                      setWidgetPosition(
                        e.target.value === 'bottom-left' ? 'bottom-left' : 'bottom-right'
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                  >
                    <option value="bottom-right">Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <label htmlFor="w-domains" className="block text-xs font-medium text-slate-700">
                  Allowed Website Domains (comma-separated, e.g. localhost, 127.0.0.1, example.com)
                </label>
                <input
                  id="w-domains"
                  type="text"
                  value={widgetDomains}
                  onChange={(e) => setWidgetDomains(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="submit"
                disabled={savingSettings}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingSettings ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={handleDeleteBot}
                className="text-xs font-medium text-red-700 hover:text-red-800"
              >
                Delete Chatbot
              </button>
            </div>
          </form>

          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900">
                Website Widget Embed Code
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Embed this isolated Shadow DOM widget on any allowed website. Supports SSE token streaming, source citations, conversation continuity, and message feedback.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
{`<script
  src="${window.location.origin}/widget.js"
  data-bot-id="${chatbot.public_bot_id}">
</script>`}
              </pre>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={`/widget-preview/${chatbot.public_bot_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  Open Live Widget Preview <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
