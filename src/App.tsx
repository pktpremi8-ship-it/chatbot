import { useCallback, useEffect, useState } from 'react';
import {
  apiRequest,
  type AuthSessionResponse,
  type ChatbotRow,
  type ModelConnectionRow,
  type OllamaDiscoveryResult,
  type QdrantHealthStatus,
} from './lib/api';
import { AuthScreen } from './components/AuthScreen';
import { ConsoleLayout, type ConsoleSection } from './components/ConsoleLayout';
import { DashboardView } from './components/DashboardView';
import { QuickStartWizard } from './components/QuickStartWizard';
import { ChatbotWorkspaceView } from './components/ChatbotWorkspaceView';
import {
  AnalyticsView,
  ConversationsView,
} from './components/ConversationsAndAnalytics';
import { ChatbotsListView } from './components/SectionViews';
import { AIModelsView, KnowledgeView } from './components/KnowledgeAndModelsViews';
import {
  IntegrationsView,
  SettingsView,
} from './components/IntegrationsAndSettingsViews';
import type { BuilderMode } from './shared/kresna-logic';

type AppView = 'loading' | 'auth' | 'console';

export default function App() {
  const [view, setView] = useState<AppView>('loading');
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [activeSection, setActiveSection] = useState<ConsoleSection>('dashboard');
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<BuilderMode>('simple');

  const [chatbots, setChatbots] = useState<ChatbotRow[]>([]);
  const [connections, setConnections] = useState<ModelConnectionRow[]>([]);
  const [ollamaDiscovery, setOllamaDiscovery] = useState<OllamaDiscoveryResult | null>(null);
  const [qdrantHealth, setQdrantHealth] = useState<QdrantHealthStatus | null>(null);
  const [loadingWorkspaceData, setLoadingWorkspaceData] = useState(false);
  const [bootError, setBootError] = useState('');

  const loadWorkspaceData = useCallback(async () => {
    setLoadingWorkspaceData(true);
    try {
      const [botsRes, modelsRes] = await Promise.all([
        apiRequest<{ chatbots: ChatbotRow[] }>('/api/chatbots'),
        apiRequest<{
          connections: ModelConnectionRow[];
          ollamaDiscovery: OllamaDiscoveryResult;
          qdrantHealth: QdrantHealthStatus;
        }>('/api/models'),
      ]);
      setChatbots(botsRes.chatbots);
      setConnections(modelsRes.connections);
      setOllamaDiscovery(modelsRes.ollamaDiscovery);
      setQdrantHealth(modelsRes.qdrantHealth);
    } finally {
      setLoadingWorkspaceData(false);
    }
  }, []);

  const hydrateSession = useCallback(async () => {
    setBootError('');
    try {
      const res = await apiRequest<
        { authenticated: false; localSingleUserMode?: boolean } | AuthSessionResponse
      >('/api/auth/session');

      if (!res.authenticated) {
        setSession(null);
        setView('auth');
        return;
      }

      setSession(res);
      setView('console');
      await loadWorkspaceData();
    } catch (err: unknown) {
      setBootError(
        err instanceof Error
          ? err.message
          : 'Unable to initialize KRESNA local workspace.'
      );
      setView('console');
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  if (view === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Initializing KRESNA Local Workspace...
      </div>
    );
  }

  // Only shown if legacy ENABLE_MULTI_USER_AUTH=true is explicitly enabled
  if (view === 'auth' || (!session && !bootError)) {
    return (
      <AuthScreen
        initialMode="login"
        onBack={() => hydrateSession()}
        onAuthenticated={async () => {
          await hydrateSession();
        }}
      />
    );
  }

  if (bootError || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-sm text-red-800">
          <div className="font-semibold">Workspace Initialization Error</div>
          <p className="mt-1">{bootError || 'Could not load local workspace.'}</p>
          <button
            type="button"
            onClick={() => hydrateSession()}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const selectedBot = chatbots.find((b) => b.id === selectedBotId);
  const breadcrumbDetail = wizardOpen
    ? 'Chatbot Builder'
    : selectedBot
      ? selectedBot.name
      : undefined;

  return (
    <ConsoleLayout
      user={session.user}
      activeWorkspace={session.activeWorkspace}
      activeSection={activeSection}
      breadcrumbDetail={breadcrumbDetail}
      builderMode={builderMode}
      onChangeMode={setBuilderMode}
      onNavigate={(section) => {
        setActiveSection(section);
        setSelectedBotId(null);
        setWizardOpen(false);
      }}
      onNewChatbot={() => {
        setActiveSection('chatbots');
        setSelectedBotId(null);
        setWizardOpen(true);
      }}
    >
      {wizardOpen ? (
        <QuickStartWizard
          connections={connections}
          ollamaDiscovery={ollamaDiscovery}
          platformKeyConfigured={session.platformKeyConfigured}
          builderMode={builderMode}
          onCancel={() => setWizardOpen(false)}
          onConnectionsUpdated={loadWorkspaceData}
          onComplete={async (chatbotId) => {
            await loadWorkspaceData();
            setWizardOpen(false);
            setActiveSection('chatbots');
            setSelectedBotId(chatbotId);
          }}
        />
      ) : selectedBotId ? (
        <ChatbotWorkspaceView
          chatbotId={selectedBotId}
          connections={connections}
          ollamaDiscovery={ollamaDiscovery}
          builderMode={builderMode}
          onBack={() => setSelectedBotId(null)}
          onDeleted={async () => {
            setSelectedBotId(null);
            await loadWorkspaceData();
          }}
          onUpdated={loadWorkspaceData}
        />
      ) : activeSection === 'dashboard' ? (
        <DashboardView
          chatbots={chatbots}
          connections={connections}
          ollamaDiscovery={ollamaDiscovery}
          qdrantHealth={qdrantHealth}
          platformKeyConfigured={session.platformKeyConfigured}
          onNavigate={(section) => setActiveSection(section)}
          onSelectBot={(id) => {
            setActiveSection('chatbots');
            setSelectedBotId(id);
          }}
          onNewChatbot={() => {
            setActiveSection('chatbots');
            setWizardOpen(true);
          }}
        />
      ) : activeSection === 'chatbots' ? (
        <ChatbotsListView
          chatbots={chatbots}
          loading={loadingWorkspaceData}
          onSelectBot={(id) => setSelectedBotId(id)}
          onCreateNew={() => setWizardOpen(true)}
        />
      ) : activeSection === 'knowledge' ? (
        <KnowledgeView
          chatbots={chatbots}
          onOpenBot={(id) => {
            setActiveSection('chatbots');
            setSelectedBotId(id);
          }}
        />
      ) : activeSection === 'models' ? (
        <AIModelsView
          connections={connections}
          ollamaDiscovery={ollamaDiscovery}
          qdrantHealth={qdrantHealth}
          platformKeyConfigured={session.platformKeyConfigured}
          onRefresh={loadWorkspaceData}
        />
      ) : activeSection === 'integrations' ? (
        <IntegrationsView chatbots={chatbots} builderMode={builderMode} />
      ) : activeSection === 'conversations' ? (
        <ConversationsView chatbots={chatbots} />
      ) : activeSection === 'analytics' ? (
        <AnalyticsView />
      ) : (
        <SettingsView workspace={session.activeWorkspace} />
      )}
    </ConsoleLayout>
  );
}
