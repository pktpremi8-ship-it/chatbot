import React, { useState } from 'react';
import {
  ArrowRight,
  ExternalLink,
  Plus,
  Search,
} from 'lucide-react';
import type { ChatbotRow } from '../lib/api';

interface ChatbotsListViewProps {
  chatbots: ChatbotRow[];
  loading: boolean;
  onSelectBot: (id: string) => void;
  onCreateNew: () => void;
}

export const ChatbotsListView: React.FC<ChatbotsListViewProps> = ({
  chatbots,
  loading,
  onSelectBot,
  onCreateNew,
}) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');

  const filtered = chatbots.filter((bot) => {
    const matchesQuery =
      !query.trim() ||
      bot.name.toLowerCase().includes(query.toLowerCase()) ||
      bot.purpose.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === 'all' || bot.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            My Chatbots
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Configure knowledge, local Ollama models, website widgets, and test conversations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chatbots..."
              aria-label="Search chatbots"
              className="rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
            {(['all', 'published', 'draft'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            {chatbots.length === 0 ? 'Create your first chatbot' : 'No matching chatbots'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {chatbots.length === 0
              ? 'Use the 5-step Chatbot Builder to upload knowledge, pick an Ollama model, and publish your website widget.'
              : 'Adjust your search term or status filter.'}
          </p>
          {chatbots.length === 0 && (
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <Plus className="h-4 w-4" />
              Create Chatbot
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 transition-colors hover:border-slate-300"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-950">{bot.name}</h2>
                  <span
                    className={`text-xs font-semibold ${
                      bot.status === 'published' ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {bot.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{bot.purpose}</p>

                <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                  <span className="font-mono">{bot.model_id || 'Select Ollama model'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{bot.language}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{bot.knowledge_count ?? 0} knowledge</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{bot.conversation_count ?? 0} chats</span>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-slate-400">
                    {bot.public_bot_id}
                  </span>
                  {bot.status === 'published' && (
                    <a
                      href={`/widget-preview/${bot.public_bot_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Live Widget <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onSelectBot(bot.id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                >
                  Open Workspace
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
