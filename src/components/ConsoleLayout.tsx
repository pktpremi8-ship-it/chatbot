import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  Cpu,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Plug,
  Plus,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { AuthUser, WorkspaceSummary } from '../lib/api';
import type { BuilderMode } from '../shared/kresna-logic';

export type ConsoleSection =
  | 'dashboard'
  | 'chatbots'
  | 'knowledge'
  | 'models'
  | 'integrations'
  | 'conversations'
  | 'analytics'
  | 'settings';

interface ConsoleLayoutProps {
  user: AuthUser;
  activeWorkspace: WorkspaceSummary;
  activeSection: ConsoleSection;
  breadcrumbDetail?: string;
  builderMode: BuilderMode;
  onChangeMode: (mode: BuilderMode) => void;
  onNavigate: (section: ConsoleSection) => void;
  onNewChatbot: () => void;
  children: React.ReactNode;
}

const AVATAR_IMAGE = '/src/assets/images/avatar_workspace_owner_1795684573437.jpg';

const NAV_ITEMS: Array<{
  id: ConsoleSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chatbots', label: 'My Chatbots', icon: Bot },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'models', label: 'AI Models', icon: Cpu },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const ConsoleLayout: React.FC<ConsoleLayoutProps> = ({
  user,
  activeWorkspace,
  activeSection,
  breadcrumbDetail,
  builderMode,
  onChangeMode,
  onNavigate,
  onNewChatbot,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const currentNavLabel =
    NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? 'Dashboard';

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-white">
      <div className="overflow-y-auto">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <div>
            <span className="font-display text-lg font-bold tracking-tight text-slate-950">
              KRESNA
            </span>
            <span className="ml-2 font-mono text-[11px] font-medium text-blue-700">
              Self-Hosted MVP
            </span>
          </div>
        </div>

        {/* Local Single-User Workspace Badge (No Workspace Switching / No Auth UI) */}
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Local Workspace
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900">
            {activeWorkspace.name}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Local Single-User Mode · SQLite + Ollama + Qdrant
          </div>
        </div>

        {/* 8-item Navigation Links */}
        <nav aria-label="Workspace navigation" className="space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Simple / Developer Mode Progressive Disclosure */}
        <div className="mx-3 mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-medium text-slate-600">Experience Mode</div>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-slate-200/70 p-0.5">
            <button
              type="button"
              onClick={() => onChangeMode('simple')}
              className={`rounded py-1 text-xs font-medium transition-colors ${
                builderMode === 'simple'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('developer')}
              className={`rounded py-1 text-xs font-medium transition-colors ${
                builderMode === 'developer'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Developer
            </button>
          </div>
        </div>
      </div>

      {/* Local Admin Footer */}
      <div className="border-t border-slate-200 p-4">
        <div className="flex items-center gap-3">
          {!avatarError ? (
            <img
              src={AVATAR_IMAGE}
              alt={user.name}
              referrerPolicy="no-referrer"
              onError={() => setAvatarError(true)}
              className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
              LA
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
            <div className="truncate font-mono text-[11px] text-slate-500">
              127.0.0.1 Local Owner
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/30"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-72 border-r border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg border border-slate-200 p-2 text-slate-700 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="truncate font-medium text-slate-500">
                {activeWorkspace.name}
              </span>
              <span className="text-slate-400" aria-hidden="true">/</span>
              <span className="truncate font-semibold text-slate-900">
                {currentNavLabel}
              </span>
              {breadcrumbDetail && (
                <>
                  <span className="text-slate-400" aria-hidden="true">/</span>
                  <span className="truncate text-slate-600">{breadcrumbDetail}</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onNewChatbot}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>New Chatbot</span>
          </button>
        </header>

        {/* Local Development Mode Security Notice */}
        <div className="border-b border-amber-200 bg-amber-50/70 px-6 py-2 text-xs text-amber-950">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-700" />
              <span>
                <strong>Local Development Mode:</strong> Single-user admin dashboard bound for local loopback (<code className="font-mono">127.0.0.1</code>) without login. Do not expose this admin UI directly to the public internet.
              </span>
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-[1200px] flex-1 p-6">{children}</main>
      </div>
    </div>
  );
};
