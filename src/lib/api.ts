import type { ChatbotPresetKey, WorkspaceRole } from '../shared/kresna-logic';

let memorySessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  memorySessionToken = token;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'KresnaClient');
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (memorySessionToken) {
    headers.set('Authorization', `Bearer ${memorySessionToken}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data?.error === 'string'
        ? data.error
        : typeof data?.message === 'string'
          ? data.message
          : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function apiUploadFile<T>(
  path: string,
  formData: FormData
): Promise<T> {
  const headers = new Headers();
  headers.set('X-Requested-With', 'KresnaClient');
  if (memorySessionToken) {
    headers.set('Authorization', `Bearer ${memorySessionToken}`);
  }

  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data?.error === 'string'
        ? data.error
        : `Upload failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: WorkspaceRole;
  created_at?: string;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  localSingleUserMode: boolean;
  user: AuthUser;
  activeWorkspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  platformKeyConfigured: boolean;
}

export interface DiscoveredOllamaModel {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  digest: string;
  parameterSize?: string;
  family?: string;
  quantizationLevel?: string;
  capabilities: {
    role: 'chat' | 'embedding';
    supportsTools: boolean;
    supportsStructuredOutput: boolean;
    supportsStreaming: boolean;
    contextLength?: number;
    parameterSize?: string;
    family?: string;
  };
}

export interface OllamaDiscoveryResult {
  reachable: boolean;
  endpoint: string;
  latencyMs: number;
  models: DiscoveredOllamaModel[];
  chatModels: DiscoveredOllamaModel[];
  embeddingModels: DiscoveredOllamaModel[];
  error?: string;
}

export interface QdrantHealthStatus {
  reachable: boolean;
  url: string;
  collectionExists: boolean;
  collectionName: string;
  pointsCount: number;
  error?: string;
}

export interface ModelConnectionRow {
  id: string;
  workspace_id: string;
  name: string;
  provider: 'ollama' | 'gemini' | 'openai_compatible' | string;
  auth_mode: 'local' | 'platform_managed' | 'byok';
  key_hint: string | null;
  endpoint: string | null;
  default_model: string;
  embedding_model: string;
  capabilities_json: string;
  status: 'connected' | 'untested' | 'error';
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface WidgetConfig {
  accentColor?: string;
  position?: 'bottom-right' | 'bottom-left';
  title?: string;
  subtitle?: string;
  allowedDomains?: string[];
}

export interface ChatbotRow {
  id: string;
  workspace_id: string;
  public_bot_id: string;
  name: string;
  purpose: string;
  preset: ChatbotPresetKey;
  language: string;
  style: string;
  escalation_mode: string;
  system_instructions: string;
  welcome_message: string;
  model_connection_id: string | null;
  model_id: string;
  embedding_connection_id: string | null;
  embedding_model_id: string;
  max_output_tokens: number;
  mode: 'simple' | 'developer';
  status: 'draft' | 'published';
  widget_config_json: string;
  created_at: string;
  updated_at: string;
  model_connection_name?: string;
  model_provider?: string;
  model_connection_status?: string;
  model_auth_mode?: string;
  knowledge_count?: number;
  conversation_count?: number;
}

export interface KnowledgeItemRow {
  id: string;
  workspace_id: string;
  chatbot_id: string;
  chatbot_name?: string;
  title: string;
  source_type: string;
  content: string;
  file_name: string | null;
  mime_type: string | null;
  source_url: string | null;
  status: 'processing' | 'indexed' | 'error' | string;
  chunk_count: number;
  vector_indexed: number;
  fts_indexed: number;
  error_message: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string | null;
}

export interface KnowledgeChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  metadata_json: string;
  token_estimate: number;
  created_at: string;
}

export interface RetrievedEvidenceChunk {
  chunkId: string;
  knowledgeItemId: string;
  title: string;
  sourceType: string;
  content: string;
  citation: string;
  metadata: Record<string, unknown>;
  rrfScore: number;
  lexicalRank: number | null;
  semanticRank: number | null;
  vectorScore: number | null;
  retrievalMethod: 'hybrid' | 'lexical_fts5' | 'vector_qdrant';
}

export interface HybridRetrievalResponse {
  query: string;
  evidence: RetrievedEvidenceChunk[];
  diagnostics: {
    ftsHits: number;
    vectorHits: number;
    vectorSearchUsed: boolean;
    vectorNote?: string;
  };
}

export interface ConversationMemoryState {
  currentObjective: string;
  currentTopic: string;
  confirmedFacts: Array<{ key: string; value: string; recordedAt: string; source?: string }>;
  userReportedFacts: Array<{ key: string; value: string; recordedAt: string; source?: string }>;
  inferredContext: string[];
  extractedEntities: Record<string, string>;
  pendingQuestions: string[];
  previousToolCalls: Array<{
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    status: string;
    timestamp: string;
  }>;
  actualToolResults: Array<{
    toolCallId: string;
    toolName: string;
    ok: boolean;
    summary: string;
    error?: string;
    executedAt: string;
  }>;
  unresolvedTasks: Array<{ id: string; objective: string; topic: string; missingFields?: string[] }>;
  pausedTasks: Array<{ id: string; objective: string; topic: string; notes?: string }>;
  pendingConfirmation: {
    toolName: string;
    arguments: Record<string, unknown>;
    summary: string;
    requestedAt: string;
  } | null;
  frustrationLevel: 'none' | 'mild' | 'high';
}

export interface AgentExecutionTrace {
  provider: string;
  model: string;
  iterations: number;
  modelLatencyMs: number;
  totalResponseMs: number;
  inputTokens: number;
  outputTokens: number;
  tokensMeasured: boolean;
  estimatedCostUsd: number;
  unanswered: boolean;
  retrievalSources: Array<{
    knowledgeItemId: string;
    title: string;
    sourceType: string;
    citation: string;
    method: string;
    rrfScore: number;
  }>;
  retrievedEvidence: RetrievedEvidenceChunk[];
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    status: string;
  }>;
  toolResults: Array<{
    name: string;
    ok: boolean;
    summary: string;
    error?: string;
  }>;
  memorySnapshot: ConversationMemoryState;
  executionSummary: string[];
  suggestedFollowups?: string[];
}

export interface ConversationRow {
  id: string;
  workspace_id: string;
  chatbot_id: string;
  chatbot_name: string;
  channel_type: string;
  external_user_id: string;
  status: 'active' | 'resolved' | 'escalated';
  started_at: string;
  updated_at: string;
  last_message?: string;
  message_count?: number;
  avg_latency_ms?: number | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  model_used: string | null;
  provider_used: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  feedback: 'up' | 'down' | null;
  trace_json: string | null;
  created_at: string;
}

export interface ApiConnectorRow {
  id: string;
  workspace_id: string;
  chatbot_id: string | null;
  chatbot_name?: string | null;
  name: string;
  description: string;
  method: string;
  url: string;
  headers_json: string;
  query_params_json: string;
  body_template_json: string;
  auth_type: string;
  input_schema_json: string;
  requires_confirmation: number;
  enabled: number;
  created_at: string;
}

export interface ConnectorLogRow {
  id: string;
  connector_id: string | null;
  connector_name?: string | null;
  method: string;
  url: string;
  response_status: number | null;
  response_summary: string | null;
  latency_ms: number;
  success: number;
  error_message: string | null;
  created_at: string;
}

export interface SupportTicketRow {
  id: string;
  chatbot_id: string | null;
  chatbot_name?: string | null;
  conversation_id: string | null;
  subject: string;
  description: string;
  customer_name: string | null;
  customer_contact: string | null;
  priority: string;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
}

export interface AnalyticsOverviewResponse {
  overview: {
    totalChatbots: number;
    publishedChatbots: number;
    totalKnowledgeSources: number;
    totalKnowledgeChunks: number;
    totalConversations: number;
    activeConversations: number;
    resolvedConversations: number;
    escalatedConversations: number;
    totalMessages: number;
    satisfactionRate: number | null;
    positiveFeedback: number;
    negativeFeedback: number;
    avgLatencyMs: number;
    totalRequests: number;
    successfulRequests: number;
    failedExecutions: number;
    retrievalFrequency: number;
    toolExecutionFrequency: number;
    unansweredCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  modelBreakdown: Array<{
    model: string;
    provider: string;
    requests: number;
    failed_requests: number;
    input_tokens: number;
    output_tokens: number;
    avg_latency_ms: number;
  }>;
  unansweredQuestions: Array<{
    id: string;
    user_message: string;
    assistant_response: string;
    chatbot_name: string;
    created_at: string;
  }>;
  recentExecutions: Array<{
    id: string;
    conversation_id: string;
    chatbot_id: string;
    chatbot_name: string;
    channel_type: string;
    user_message: string;
    model: string;
    provider: string;
    model_latency_ms: number;
    total_response_ms: number;
    iterations: number;
    retrieval_count: number;
    tool_calls_json: string;
    unanswered: number;
    created_at: string;
  }>;
}

export interface ScenarioEvalResult {
  scenarioId: string;
  title: string;
  passed: boolean;
  metrics: {
    contextRetained: boolean;
    retrievalRelevant: boolean;
    answerGrounded: boolean;
    unnecessaryClarification: boolean;
    repeatedQuestion: boolean;
    toolSelectionAccurate: boolean;
    taskCompleted: boolean;
    hallucinationDetected: boolean;
    conversationContinuity: boolean;
  };
  turns: Array<{
    userMessage: string;
    assistantResponse: string;
    decisionSummary: string[];
    retrievedTitles: string[];
    toolCalls: Array<{ name: string; status: string }>;
  }>;
  notes: string;
}

export interface EvaluationSuiteReport {
  id: string;
  mode: 'live' | 'simulated';
  provider: string;
  model: string;
  createdAt: string;
  summary: {
    totalScenarios: number;
    passedScenarios: number;
    contextRetentionRate: number;
    retrievalRelevanceRate: number;
    answerGroundingRate: number;
    unnecessaryClarificationRate: number;
    repeatedQuestionRate: number;
    toolSelectionAccuracyRate: number;
    taskCompletionRate: number;
    hallucinationRate: number;
    conversationContinuityRate: number;
  };
  scenarios: ScenarioEvalResult[];
}
