import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Cpu,
  Database,
  ExternalLink,
  MessageSquare,
  Plus,
} from 'lucide-react';
import {
  apiRequest,
  type AnalyticsOverviewResponse,
  type ChatbotRow,
  type ModelConnectionRow,
  type OllamaDiscoveryResult,
  type QdrantHealthStatus,
} from '../lib/api';
import type { ConsoleSection } from './ConsoleLayout';

interface DashboardViewProps {
  chatbots: ChatbotRow[];
  connections: ModelConnectionRow[];
  ollamaDiscovery: OllamaDiscoveryResult | null;
  qdrantHealth: QdrantHealthStatus | null;
  platformKeyConfigured: boolean;
  onNavigate: (section: ConsoleSection) => void;
  onSelectBot: (id: string) => void;
  onNewChatbot: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  chatbots,
  connections,
  ollamaDiscovery,
  qdrantHealth,
  platformKeyConfigured,
  onNavigate,
  onSelectBot,
  onNewChatbot,
}) => {
  const [analytics, setAnalytics] = useState<AnalyticsOverviewResponse | null>(null);

  useEffect(() => {
    apiRequest<AnalyticsOverviewResponse>('/api/analytics/overview')
      .then((res) => setAnalytics(res))
      .catch(() => {});
  }, [chatbots.length]);

  const ov = analytics?.overview;
  const activeGeminiConn = connections.find(
    (c) => c.provider === 'gemini' && (c.status === 'connected' || c.auth_mode === 'platform_managed')
  );
  const usingGeminiEngine = !ollamaDiscovery?.reachable && (Boolean(activeGeminiConn) || platformKeyConfigured);

  return (
    <div className="space-y-6">
      {/* Header & Quick Actions */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950">
            KRESNA Agentic Chatbot Studio
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Bring Your Knowledge. Choose Your AI. Build Your Chatbot. Publish Everywhere.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onNewChatbot}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Chatbot
          </button>
          <button
            type="button"
            onClick={() => onNavigate('knowledge')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Upload Knowledge
          </button>
          <button
            type="button"
            onClick={() => onNavigate('models')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Cpu className="h-3.5 w-3.5" />
            AI Models
          </button>
        </div>
      </div>

      {/* Infrastructure Health Strip */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Cpu className="h-4 w-4 text-slate-700" />
              {usingGeminiEngine ? 'Active AI Engine (Gemini)' : 'Ollama Local Inference'}
            </span>
            <span
              className={`text-xs font-semibold ${
                ollamaDiscovery?.reachable || usingGeminiEngine ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {ollamaDiscovery?.reachable
                ? 'Connected'
                : usingGeminiEngine
                  ? 'Ready'
                  : 'Not Connected'}
            </span>
          </div>
          <div className="mt-3 font-mono text-xs text-slate-700">
            {ollamaDiscovery?.reachable
              ? ollamaDiscovery.endpoint
              : usingGeminiEngine
                ? activeGeminiConn?.default_model || 'gemini-3.1-flash-lite'
                : ollamaDiscovery?.endpoint || 'http://ollama:11434'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {ollamaDiscovery?.reachable
              ? `${ollamaDiscovery.chatModels.length} chat · ${ollamaDiscovery.embeddingModels.length} embedding model(s)`
              : usingGeminiEngine
                ? 'Using existing Server Gemini API key. Self-hosted Ollama/Docker remains optional.'
                : 'Configure Ollama endpoint or run Docker Compose to discover local models.'}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('models')}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
          >
            Manage AI Models <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Database className="h-4 w-4 text-slate-700" />
              Qdrant Vector Index
            </span>
            <span
              className={`text-xs font-semibold ${
                qdrantHealth?.reachable ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {qdrantHealth?.reachable ? 'Connected' : 'Offline (FTS5 Active)'}
            </span>
          </div>
          <div className="mt-3 font-mono text-xs text-slate-700">
            {qdrantHealth?.url || 'http://qdrant:6333'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {qdrantHealth?.reachable
              ? `Collection "${qdrantHealth.collectionName}" · ${qdrantHealth.pointsCount} vectors`
              : 'Hybrid search automatically falls back to SQLite FTS5 when Qdrant is offline.'}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('knowledge')}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
          >
            Open Knowledge & Retrieval <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Bot className="h-4 w-4 text-slate-700" />
              Workspace Summary
            </span>
            <span className="text-xs font-semibold text-emerald-700">SQLite WAL</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Chatbots</div>
              <div className="font-mono text-lg font-bold text-slate-950 tabular-nums">
                {ov?.totalChatbots ?? chatbots.length}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Knowledge Chunks</div>
              <div className="font-mono text-lg font-bold text-slate-950 tabular-nums">
                {ov?.totalKnowledgeChunks ?? 0}
              </div>
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {ov?.totalConversations ?? 0} conversations · {ov?.totalMessages ?? 0} messages
          </div>
        </div>
      </div>

      {/* Chatbots Quick List & Recent Executions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-950">Your Chatbots</h2>
            <button
              type="button"
              onClick={() => onNavigate('chatbots')}
              className="text-xs font-semibold text-blue-700 hover:text-blue-800"
            >
              View All
            </button>
          </div>

          {chatbots.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-600">
                No chatbots created yet. Launch the 5-step builder to publish your first agent.
              </p>
              <button
                type="button"
                onClick={onNewChatbot}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" /> Start Builder
              </button>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {chatbots.slice(0, 5).map((bot) => (
                <li
                  key={bot.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {bot.name}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          bot.status === 'published' ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {bot.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">
                        {bot.model_id || 'No model selected'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{bot.knowledge_count ?? 0} knowledge</span>
                      <span aria-hidden="true">·</span>
                      <span>{bot.conversation_count ?? 0} chats</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {bot.status === 'published' && (
                      <a
                        href={`/widget-preview/${bot.public_bot_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Widget <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectBot(bot.id)}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-950">Recent Agent Executions</h2>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-semibold text-blue-700 hover:text-blue-800"
            >
              Full Analytics
            </button>
          </div>
          {!analytics || analytics.recentExecutions.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-center">
              <MessageSquare className="h-6 w-6 text-slate-400" />
              <p className="mt-2 text-xs text-slate-500">
                Test a conversation in any chatbot Playground or Widget Preview to see execution traces here.
              </p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {analytics.recentExecutions.slice(0, 5).map((ex) => (
                <li key={ex.id} className="py-3 text-xs">
                  <div className="flex items-center justify-between font-medium text-slate-900">
                    <span className="truncate">{ex.chatbot_name}</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {ex.total_response_ms}ms · {ex.iterations} iter
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-slate-600">{ex.user_message}</p>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-slate-500">
                    <span>{ex.model}</span>
                    <span>·</span>
                    <span>{ex.retrieval_count} evidence</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
