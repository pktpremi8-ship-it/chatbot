import React, { useEffect, useState } from 'react';
import {
  apiRequest,
  type AnalyticsOverviewResponse,
  type ChatbotRow,
  type ConversationMemoryState,
  type ConversationRow,
  type MessageRow,
} from '../lib/api';

interface ConversationsViewProps {
  chatbots: ChatbotRow[];
}

export const ConversationsView: React.FC<ConversationsViewProps> = ({ chatbots }) => {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [filterBot, setFilterBot] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'resolved' | 'escalated'>('all');
  const [selectedId, setSelectedId] = useState<string>('');
  const [replayMessages, setReplayMessages] = useState<MessageRow[]>([]);
  const [memory, setMemory] = useState<ConversationMemoryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadConversations = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = filterBot ? `?chatbotId=${encodeURIComponent(filterBot)}` : '';
      const data = await apiRequest<{ conversations: ConversationRow[] }>(
        `/api/conversations${qs}`
      );
      setConversations(data.conversations);
      if (data.conversations.length > 0 && !selectedId) {
        setSelectedId(data.conversations[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [filterBot]);

  useEffect(() => {
    if (!selectedId) {
      setReplayMessages([]);
      setMemory(null);
      return;
    }
    apiRequest<{ messages: MessageRow[]; memory: ConversationMemoryState }>(
      `/api/conversations/${selectedId}`
    )
      .then((res) => {
        setReplayMessages(res.messages);
        setMemory(res.memory);
      })
      .catch(() => {
        setReplayMessages([]);
        setMemory(null);
      });
  }, [selectedId]);

  const handleStatusChange = async (
    convId: string,
    status: 'active' | 'resolved' | 'escalated'
  ) => {
    await apiRequest(`/api/conversations/${convId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, status } : c))
    );
  };

  const filtered = conversations.filter((c) =>
    filterStatus === 'all' ? true : c.status === filterStatus
  );

  const selectedConv = conversations.find((c) => c.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Conversations & Agent Memory
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Inspect persisted conversations, message traces, and structured conversation memory state.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Filter by chatbot"
            value={filterBot}
            onChange={(e) => setFilterBot(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="">All Chatbots</option>
            {chatbots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
            {(['all', 'active', 'resolved', 'escalated'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilterStatus(st)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  filterStatus === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-white" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            No conversations recorded yet
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Send a message in any chatbot Playground or Website Widget Preview to record conversations here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-4">
            <ul className="divide-y divide-slate-200">
              {filtered.map((conv) => {
                const isSelected = conv.id === selectedId;
                return (
                  <li key={conv.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(conv.id)}
                      className={`w-full p-4 text-left transition-colors ${
                        isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-slate-900">
                          {conv.chatbot_name}
                        </span>
                        <span
                          className={`font-medium capitalize ${
                            conv.status === 'resolved'
                              ? 'text-emerald-700'
                              : conv.status === 'escalated'
                                ? 'text-red-700'
                                : 'text-blue-700'
                          }`}
                        >
                          {conv.status}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                        {conv.last_message || 'No messages yet'}
                      </p>
                      <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-slate-500 tabular-nums">
                        <span>{conv.channel_type}</span>
                        <span>·</span>
                        <span>{conv.message_count ?? 0} msgs</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white lg:col-span-5">
            {selectedConv ? (
              <div className="flex h-[540px] flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {selectedConv.chatbot_name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {selectedConv.channel_type} · {new Date(selectedConv.started_at).toLocaleString()}
                    </div>
                  </div>

                  <select
                    aria-label="Conversation resolution status"
                    value={selectedConv.status}
                    onChange={(e) =>
                      handleStatusChange(
                        selectedConv.id,
                        e.target.value as 'active' | 'resolved' | 'escalated'
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                  >
                    <option value="active">Active</option>
                    <option value="resolved">Resolved</option>
                    <option value="escalated">Escalated</option>
                  </select>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/40 p-5">
                  {replayMessages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex flex-col ${
                        m.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                          m.role === 'user'
                            ? 'bg-slate-900 text-white'
                            : 'border border-slate-200 bg-white text-slate-900'
                        }`}
                      >
                        {m.content}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                        {m.role === 'assistant'
                          ? `${m.model_used || 'ollama'} · ${m.latency_ms}ms`
                          : new Date(m.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-8 text-sm text-slate-500">
                Select a conversation to inspect its full replay.
              </div>
            )}
          </div>

          {/* Structured Conversation Memory Inspector */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-3">
            <h2 className="text-sm font-semibold text-slate-900">Structured Memory State</h2>
            {memory ? (
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <div className="text-slate-500">Current Objective</div>
                  <div className="font-medium text-slate-900">{memory.currentObjective || '—'}</div>
                </div>
                <div>
                  <div className="text-slate-500">Current Topic / Frustration</div>
                  <div className="font-mono text-slate-900">
                    {memory.currentTopic || '—'} ({memory.frustrationLevel})
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Verified Facts ({memory.confirmedFacts.length})</div>
                  {memory.confirmedFacts.length > 0 ? (
                    <ul className="mt-1 space-y-1 font-mono text-[10px] text-emerald-800">
                      {memory.confirmedFacts.map((f, i) => (
                        <li key={i} className="rounded bg-emerald-50 p-1.5">
                          {f.key}: {f.value}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-slate-400">None yet</div>
                  )}
                </div>
                <div>
                  <div className="text-slate-500">
                    User-Reported Facts ({memory.userReportedFacts.length})
                  </div>
                  {memory.userReportedFacts.length > 0 ? (
                    <ul className="mt-1 space-y-1 font-mono text-[10px] text-slate-700">
                      {memory.userReportedFacts.map((f, i) => (
                        <li key={i} className="rounded bg-slate-50 p-1.5">
                          {f.key}: {f.value}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-slate-400">None</div>
                  )}
                </div>
                {memory.pausedTasks.length > 0 && (
                  <div>
                    <div className="text-slate-500">Paused Tasks ({memory.pausedTasks.length})</div>
                    <ul className="mt-1 space-y-1 text-[11px] text-amber-800">
                      {memory.pausedTasks.map((t) => (
                        <li key={t.id}>• {t.objective}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No memory state recorded yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const AnalyticsView: React.FC = () => {
  const [data, setData] = useState<AnalyticsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    apiRequest<AnalyticsOverviewResponse>('/api/analytics/overview')
      .then((res) => setData(res))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load analytics.')
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-44 animate-pulse rounded bg-slate-200" />
        <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error || 'Analytics unavailable.'}
      </div>
    );
  }

  const o = data.overview;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          Monitoring & Analytics
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Metrics derived directly from SQLite conversations, execution logs, feedback ratings, and local/provider usage events.
        </p>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Conversations & Messages</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {o.totalConversations} / {o.totalMessages}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {o.activeConversations} active · {o.resolvedConversations} resolved
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Avg Response Latency</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {o.avgLatencyMs} ms
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {o.successfulRequests} ok · {o.failedExecutions} failed
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Retrieval & Tool Turns</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {o.retrievalFrequency} / {o.toolExecutionFrequency}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {o.totalKnowledgeSources} sources · {o.totalKnowledgeChunks} chunks
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Feedback & Unanswered</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-950 tabular-nums">
            {o.satisfactionRate !== null ? `${o.satisfactionRate}%` : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            +{o.positiveFeedback} / -{o.negativeFeedback} · {o.unansweredCount} unanswered
          </div>
        </div>
      </div>

      {/* Model Breakdown & Unanswered Questions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <h2 className="text-base font-semibold text-slate-900">
            Model Usage Breakdown (Local Inference = $0.00)
          </h2>
          {data.modelBreakdown.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No model invocations recorded yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 font-semibold text-slate-500">
                    <th className="py-2 pr-3">Model</th>
                    <th className="py-2 pr-3">Provider</th>
                    <th className="py-2 pr-3 text-right">Requests</th>
                    <th className="py-2 pr-3 text-right">Failed</th>
                    <th className="py-2 pr-3 text-right">Avg Latency</th>
                    <th className="py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.modelBreakdown.map((row) => (
                    <tr key={`${row.provider}-${row.model}`} className="h-10">
                      <td className="pr-3 font-mono font-medium text-slate-900">{row.model}</td>
                      <td className="pr-3 capitalize text-slate-600">{row.provider}</td>
                      <td className="pr-3 text-right font-mono tabular-nums">{row.requests}</td>
                      <td className="pr-3 text-right font-mono tabular-nums">{row.failed_requests}</td>
                      <td className="pr-3 text-right font-mono tabular-nums">
                        {Math.round(row.avg_latency_ms || 0)} ms
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        {row.provider === 'ollama' ? '$0.00 (Local)' : 'External'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <h2 className="text-base font-semibold text-slate-900">
            Unanswered Questions ({data.unansweredQuestions.length})
          </h2>
          {data.unansweredQuestions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No unanswered questions logged yet. Knowledge gaps appear here so you can upload missing docs.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 text-xs">
              {data.unansweredQuestions.map((uq) => (
                <li key={uq.id} className="py-2.5">
                  <div className="font-semibold text-slate-900">{uq.user_message}</div>
                  <div className="mt-0.5 text-slate-500">
                    {uq.chatbot_name} · {new Date(uq.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent Execution Logs */}
      {data.recentExecutions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Recent Agent Execution Logs</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3">Chatbot</th>
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3">User Message</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3 text-right">Iter</th>
                  <th className="py-2 pr-3 text-right">Evidence</th>
                  <th className="py-2 text-right">Total ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentExecutions.map((ex) => (
                  <tr key={ex.id} className="h-9">
                    <td className="pr-3 font-medium text-slate-900">{ex.chatbot_name}</td>
                    <td className="pr-3 font-mono text-slate-500">{ex.channel_type}</td>
                    <td className="max-w-[280px] truncate pr-3 text-slate-700">{ex.user_message}</td>
                    <td className="pr-3 font-mono text-slate-600">{ex.model}</td>
                    <td className="pr-3 text-right font-mono tabular-nums">{ex.iterations}</td>
                    <td className="pr-3 text-right font-mono tabular-nums">{ex.retrieval_count}</td>
                    <td className="text-right font-mono tabular-nums">{ex.total_response_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
