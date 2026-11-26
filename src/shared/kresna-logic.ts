export type ChatbotPresetKey =
  | 'customer_support'
  | 'sales_assistant'
  | 'product_advisor'
  | 'internal_assistant'
  | 'technical_support'
  | 'booking_assistant'
  | 'custom';

export type WorkspaceRole =
  | 'owner'
  | 'admin'
  | 'developer'
  | 'knowledge_manager'
  | 'analyst'
  | 'viewer';

export type ModelProviderType = 'ollama' | 'gemini' | 'openai_compatible';
export type ModelAuthMode = 'local' | 'platform_managed' | 'byok';
export type BuilderMode = 'simple' | 'developer';
export type ChatbotStatus = 'draft' | 'published';

export interface ChatbotPreset {
  key: ChatbotPresetKey;
  label: string;
  summary: string;
  defaultPurpose: string;
  defaultStyle: string;
  defaultWelcome: string;
  defaultEscalation: string;
  systemTemplate: string;
}

export const CHATBOT_PRESETS: ChatbotPreset[] = [
  {
    key: 'customer_support',
    label: 'Customer Support',
    summary: 'Resolves inquiries, tracks orders, and handles troubleshooting naturally.',
    defaultPurpose: 'Help customers solve account, order, operational, and service issues.',
    defaultStyle: 'Warm, concise, solution-oriented',
    defaultWelcome: 'Hello! How can I help you today?',
    defaultEscalation: 'Offer a support ticket or human handoff if troubleshooting is blocked or requested.',
    systemTemplate:
      'You are a capable customer service representative. Understand the user situation from full context, never ask the same diagnostic question twice, ask at most one clarifying question at a time, and respect explicit action requests immediately.',
  },
  {
    key: 'sales_assistant',
    label: 'Sales Assistant',
    summary: 'Qualifies inbound leads, compares plans, and schedules product demos.',
    defaultPurpose: 'Answer product pricing questions, qualify needs, and guide buyers.',
    defaultStyle: 'Consultative, clear, helpful',
    defaultWelcome: 'Hi there! Looking for the right plan or have a question about our product?',
    defaultEscalation: 'Offer to connect with a sales specialist when custom pricing or contracts are requested.',
    systemTemplate:
      'You are a consultative sales advisor. Listen closely to the buyer requirements, answer clearly using verified product details, and offer relevant next steps without pushy scripts.',
  },
  {
    key: 'product_advisor',
    label: 'Product Advisor',
    summary: 'Recommends tailored products and explains specifications accurately.',
    defaultPurpose: 'Help visitors compare options and select the best fit for their use case.',
    defaultStyle: 'Knowledgeable, structured, approachable',
    defaultWelcome: 'Welcome! Tell me what you are looking for and I will help you compare options.',
    defaultEscalation: 'Escalate technical compatibility requests if documentation is unavailable.',
    systemTemplate:
      'You are an expert product advisor. Match customer requirements to verified product specifications, explain trade-offs transparently, and ask focused follow-ups only when needed.',
  },
  {
    key: 'internal_assistant',
    label: 'Internal Company Assistant',
    summary: 'Answers HR, IT, and operational policy questions for employees.',
    defaultPurpose: 'Help team members find internal policies, IT procedures, and operational SOPs.',
    defaultStyle: 'Direct, accurate, professional',
    defaultWelcome: 'Hi! Ask me about company policies, IT access, or internal workflows.',
    defaultEscalation: 'Offer IT/Operations ticket creation when an access change or manual intervention is needed.',
    systemTemplate:
      'You are an internal operations assistant. Provide concise, policy-accurate answers based on verified company knowledge, and clearly note when a request needs IT or HR approval.',
  },
  {
    key: 'technical_support',
    label: 'Technical Support',
    summary: 'Diagnoses product issues adaptively without rigid decision trees.',
    defaultPurpose: 'Troubleshoot technical errors, fleet/operations issues, and configuration problems.',
    defaultStyle: 'Calm, diagnostic, precise',
    defaultWelcome: 'Hi! Describe the issue you are seeing and I will help troubleshoot.',
    defaultEscalation: 'Create an engineering or operations ticket immediately if user requests escalation or diagnostics fail.',
    systemTemplate:
      'You are a senior technical support engineer. Adapt diagnostics to what the user has already shared, skip redundant steps, separate verified facts from hypotheses, and escalate cleanly if blocked.',
  },
  {
    key: 'booking_assistant',
    label: 'Booking Assistant',
    summary: 'Guides reservations, rescheduling, and status checks smoothly.',
    defaultPurpose: 'Assist customers with creating, modifying, and checking bookings.',
    defaultStyle: 'Courteous, efficient, clear',
    defaultWelcome: 'Hello! I can help you schedule, update, or check a booking.',
    defaultEscalation: 'Escalate to a coordinator when manual overrides or group bookings are required.',
    systemTemplate:
      'You are a booking coordinator. Gather only mandatory details needed to confirm or inspect a reservation, keep track of identifiers shared earlier, and confirm changes explicitly.',
  },
  {
    key: 'custom',
    label: 'Custom',
    summary: 'Start from a clean slate tailored to your exact domain.',
    defaultPurpose: 'Assist users with domain-specific questions and tasks.',
    defaultStyle: 'Helpful, clear, natural',
    defaultWelcome: 'Hello! How can I assist you today?',
    defaultEscalation: 'Offer to create a ticket or escalate if verified evidence is unavailable.',
    systemTemplate:
      'You are a helpful AI assistant. Follow the workspace purpose and communication style, ground answers in verified knowledge, and be transparent when information is unavailable.',
  },
];

export interface ModelCatalogItem {
  id: string;
  provider: ModelProviderType;
  label: string;
  description: string;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  inputCostPer1M: number;
  outputCostPer1M: number;
  recommended?: boolean;
}

// Legacy optional Gemini catalog (only used when user explicitly selects legacy Gemini)
export const GEMINI_MODEL_CATALOG: ModelCatalogItem[] = [
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash Lite (Recommended)',
    description: 'Fast, reliable cloud model compatible with free and standard Gemini API keys.',
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.30,
    recommended: true,
  },
  {
    id: 'gemini-4-hydrogen',
    provider: 'gemini',
    label: 'Gemini 4 Hydrogen',
    description: 'General cloud model when a Gemini API key is configured.',
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
  },
  {
    id: 'gemini-4-neon',
    provider: 'gemini',
    label: 'Gemini 4 Neon (Paid Key)',
    description: 'Optional cloud high-reasoning model.',
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.0,
  },
];

export const SUGGESTED_OLLAMA_MODELS = [
  {
    name: 'llama3.1:8b',
    role: 'chat',
    note: 'Balanced 8B instruction & tool-calling chat model',
    pullCommand: 'docker compose exec ollama ollama pull llama3.1:8b',
  },
  {
    name: 'qwen2.5:7b',
    role: 'chat',
    note: 'Strong multilingual (English + Indonesian) reasoning & JSON output',
    pullCommand: 'docker compose exec ollama ollama pull qwen2.5:7b',
  },
  {
    name: 'nomic-embed-text',
    role: 'embedding',
    note: 'Fast 768-dim local text embeddings for Qdrant hybrid RAG',
    pullCommand: 'docker compose exec ollama ollama pull nomic-embed-text',
  },
];

export function getPresetByKey(key: ChatbotPresetKey): ChatbotPreset {
  return CHATBOT_PRESETS.find((p) => p.key === key) ?? CHATBOT_PRESETS[0];
}

export function getModelInfo(modelId: string): ModelCatalogItem | undefined {
  return GEMINI_MODEL_CATALOG.find((m) => m.id === modelId);
}

export function estimateTokenCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  provider: string = 'ollama'
): number {
  if (provider === 'ollama') return 0; // Local inference has no per-token API fee
  const model = getModelInfo(modelId);
  if (!model) return 0;
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * model.inputCostPer1M;
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * model.outputCostPer1M;
  return Number((inputCost + outputCost).toFixed(6));
}

export interface WizardDraftInput {
  name: string;
  purpose: string;
  preset: ChatbotPresetKey;
  language: string;
  style: string;
  modelConnectionId: string;
  modelId: string;
}

export function validateWizardStep(
  step: number,
  draft: WizardDraftInput
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (step === 1) {
    if (!draft.name.trim() || draft.name.trim().length < 2) {
      errors.push('Chatbot name must be at least 2 characters.');
    }
    if (!draft.purpose.trim() || draft.purpose.trim().length < 8) {
      errors.push('Describe what this chatbot helps users with (at least 8 characters).');
    }
    if (!draft.language.trim()) {
      errors.push('Select a preferred language.');
    }
  }
  if (step === 3) {
    if (!draft.modelConnectionId.trim()) {
      errors.push('Select or configure an AI provider connection.');
    }
    if (!draft.modelId.trim()) {
      errors.push('Select an installed chat model (or configure one in AI Models).');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function evaluatePublishReadiness(params: {
  name: string;
  purpose: string;
  modelConnectionStatus?: string;
  modelId: string;
  hasTestedConversation: boolean;
}): { ready: boolean; checks: Array<{ label: string; passed: boolean; detail: string }> } {
  const modelReady = params.modelId.trim().length > 0;
  const connConnected = params.modelConnectionStatus === 'connected';
  const checks = [
    {
      label: 'Identity & purpose configured',
      passed: params.name.trim().length >= 2 && params.purpose.trim().length >= 8,
      detail: params.name.trim() ? `${params.name.trim()}` : 'Missing name or purpose',
    },
    {
      label: 'AI model selected',
      passed: modelReady,
      detail: modelReady
        ? connConnected
          ? `Connected (${params.modelId})`
          : `Model configured (${params.modelId})`
        : 'Select an installed model in Choose AI',
    },
    {
      label: 'Playground conversation tested',
      passed: params.hasTestedConversation,
      detail: params.hasTestedConversation
        ? 'At least 1 response verified'
        : 'Send a test message in the Playground (or publish anyway for local testing)',
    },
  ];
  return {
    ready: checks[0].passed && checks[1].passed && checks[2].passed,
    checks,
  };
}

export interface KnowledgeSnippet {
  title: string;
  sourceType: string;
  content: string;
  citation?: string;
}

export function buildChatbotSystemInstruction(params: {
  name: string;
  purpose: string;
  preset: ChatbotPresetKey;
  language: string;
  style: string;
  escalationMode?: string;
  customSystemInstructions?: string;
  knowledgeItems?: KnowledgeSnippet[];
}): string {
  const preset = getPresetByKey(params.preset);
  const sections: string[] = [
    `You are "${params.name}", an intelligent customer-service AI representative powered by KRESNA.`,
    `Primary Purpose: ${params.purpose}`,
    `Preferred Language: ${params.language} (adapt smoothly if the user speaks another language such as Indonesian or English).`,
    `Communication Style: ${params.style}`,
    `Role Guidance: ${preset.systemTemplate}`,
    `Escalation Policy: ${params.escalationMode || preset.defaultEscalation}`,
    `Conversational Intelligence & Customer Service Professional Constitution:
- Progressive Disclosure & Interactive Pacing:
  * Do NOT overwhelm the customer with an encyclopedia dump or long bulleted SOP in a single message. Speak like an empathetic, seasoned Tier-2 customer service specialist.
  * For simple factual / lookup questions (e.g., "Kapan SO terbentuk?", "Cara cari nomor polisi"): Give a direct, crisp, concise answer in 1-2 sentences. Do not force multi-turn questions when the answer is simple.
  * For multi-cause troubleshooting or error diagnoses (e.g., UJP/Termin failed/pending, JMP configuration errors, OBD data not updating, Planning status stuck):
    1. Acknowledge empathetically and summarize the top 1-2 most common root causes in 1-2 clear, human sentences.
    2. Ask a focused, interactive follow-up question to narrow down their specific case (e.g. which exact status code or symptom appears).
    3. Suggest 2-3 short, actionable quick replies in suggested_followups.
- Empathy & Conversational Continuity:
  * Maintain complete situational awareness across turns. Never re-introduce yourself mid-conversation.
  * If the user says a step did not work ("masih belum bisa", "tetap gagal", "tidak bisa"): Empathize warmly, skip repeating previously tried steps, and offer the next escalation step (such as creating a support ticket).
  * Distinguish user-reported claims from verified tool/system results. Never claim a tool executed unless you observed its actual result.
  * Never ask for details the user already gave in conversation history or memory.
  * Cite only actual retrieved knowledge sources. When evidence is missing, state clearly what is unknown and propose a helpful next action.`,
  ];

  if (params.customSystemInstructions && params.customSystemInstructions.trim()) {
    sections.push(`Custom Instructions:\n${params.customSystemInstructions.trim()}`);
  }

  if (params.knowledgeItems && params.knowledgeItems.length > 0) {
    const formatted = params.knowledgeItems
      .map(
        (item, idx) =>
          `[Source ${idx + 1}: ${item.title} (${item.sourceType})${item.citation ? ` · ${item.citation}` : ''}]\n${item.content}`
      )
      .join('\n\n');
    sections.push(`Retrieved Grounded Knowledge:\n${formatted}`);
  }

  return sections.join('\n\n');
}

export interface RrfInputItem<T> {
  id: string;
  item: T;
}

/**
 * Combines ranked lexical and semantic hit lists using Reciprocal Rank Fusion:
 * score(d) = sum( 1 / (k + rank_i(d)) ), with default k = 60.
 */
export function calculateRrfScores<T>(params: {
  lexical: RrfInputItem<T>[];
  semantic: RrfInputItem<T>[];
  k?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
}): Array<{
  id: string;
  item: T;
  rrfScore: number;
  lexicalRank: number | null;
  semanticRank: number | null;
}> {
  const k = params.k ?? 60;
  const lexWeight = params.lexicalWeight ?? 1.0;
  const semWeight = params.semanticWeight ?? 1.0;

  const map = new Map<
    string,
    {
      id: string;
      item: T;
      rrfScore: number;
      lexicalRank: number | null;
      semanticRank: number | null;
    }
  >();

  params.lexical.forEach((entry, idx) => {
    const rank = idx + 1;
    const contrib = lexWeight * (1 / (k + rank));
    const existing = map.get(entry.id);
    if (existing) {
      existing.rrfScore += contrib;
      existing.lexicalRank = rank;
    } else {
      map.set(entry.id, {
        id: entry.id,
        item: entry.item,
        rrfScore: contrib,
        lexicalRank: rank,
        semanticRank: null,
      });
    }
  });

  params.semantic.forEach((entry, idx) => {
    const rank = idx + 1;
    const contrib = semWeight * (1 / (k + rank));
    const existing = map.get(entry.id);
    if (existing) {
      existing.rrfScore += contrib;
      existing.semanticRank = rank;
    } else {
      map.set(entry.id, {
        id: entry.id,
        item: entry.item,
        rrfScore: contrib,
        lexicalRank: null,
        semanticRank: rank,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Derives clean, actionable 2-4 quick-reply suggestion chips for customer service.
 */
export function extractSuggestedFollowups(params: {
  text: string;
  explicitSuggestions?: string[];
  decision?: string;
}): string[] {
  const explicit = Array.isArray(params.explicitSuggestions)
    ? params.explicitSuggestions
        .map((s) => String(s).trim())
        .filter((s) => s.length >= 2 && s.length <= 45)
    : [];
  if (explicit.length > 0) {
    return Array.from(new Set(explicit)).slice(0, 4);
  }

  const raw = params.text || '';
  const lower = raw.toLowerCase();

  // If text discusses UJP / Termin troubleshooting
  if (lower.includes('ujp') || lower.includes('termin')) {
    if (lower.includes('failed') || lower.includes('pending') || lower.includes('sap')) {
      return [
        'Statusnya Failed',
        'Statusnya Pending / Waiting SAP',
        'Panduan Transfer Manual',
        'Buatkan Tiket Support',
      ];
    }
  }

  // If text offers or asks about ticket creation
  if (lower.includes('tiket') && (lower.includes('buatkan') || lower.includes('bantu'))) {
    return ['Boleh, bantu buatkan tiket', 'Saya coba cek manual dulu'];
  }

  // If text asks about confirmation for an action
  if (
    lower.includes('ketik "ya"') ||
    lower.includes('konfirmasi') ||
    lower.includes('apakah anda setuju') ||
    lower.includes('lanjutkan')
  ) {
    return ['Ya, buatkan sekarang', 'Batal / ubah rincian'];
  }

  // If text is diagnosing shipment planning or pairing
  if (lower.includes('planning') && lower.includes('journey')) {
    return ['Cek Pairing Driver & Unit', 'Sinkronisasi Ulang Journey', 'Buatkan Tiket'];
  }

  // If text asks "apakah ... atau ..."
  const orMatch = raw.match(/apakah\s+([^?]+)\?/i);
  if (orMatch?.[1]) {
    const parts = orMatch[1]
      .split(/\batau\b|,/i)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3 && p.length <= 35);
    if (parts.length >= 2) {
      return parts.slice(0, 3).map((p) => p.replace(/^\W+/, '').replace(/\W+$/, ''));
    }
  }

  return [];
}

export interface RoadmapPhase {
  phase: string;
  title: string;
  status: 'implemented' | 'tested' | 'partial' | 'planned';
  summary: string;
  items: Array<{ name: string; status: 'implemented' | 'tested' | 'partial' | 'planned' }>;
}

export const KRESNA_ROADMAP: RoadmapPhase[] = [
  {
    phase: 'Priority 0',
    title: 'Local Single-User MVP & Open-Source First',
    status: 'implemented',
    summary: 'Zero-login local workspace ("My Workspace" / "Local Admin"), SQLite WAL persistence, Ollama default gateway, optional legacy Gemini.',
    items: [
      { name: 'Local single-user dashboard (auth behind disabled flag)', status: 'implemented' },
      { name: 'Ollama dynamic model discovery & embedding configuration', status: 'implemented' },
    ],
  },
  {
    phase: 'Priority 1',
    title: 'Agentic Conversational Intelligence & Memory',
    status: 'implemented',
    summary: 'LLM-led 8-step agent loop, persistent structured memory (user-reported vs verified facts), confirmation gates, and Scenarios A–J evaluation.',
    items: [
      { name: 'Bounded ReAct loop (max 4 iterations) & Execution Inspector', status: 'implemented' },
      { name: 'Regression Evaluation Suite (Scenarios A–J)', status: 'implemented' },
    ],
  },
  {
    phase: 'Priority 2',
    title: 'Multi-Format Knowledge Ingestion & Hybrid RAG',
    status: 'implemented',
    summary: 'XLSX, CSV, PDF, DOCX, TXT, HTML, and Website URL ingestion into SQLite FTS5 + Qdrant vectors with Reciprocal Rank Fusion.',
    items: [
      { name: 'Structure-preserving XLSX/CSV/PDF/DOCX/HTML/URL parsers', status: 'implemented' },
      { name: 'Hybrid FTS5 + Qdrant RRF retrieval & source preview tester', status: 'implemented' },
    ],
  },
  {
    phase: 'Priority 3–4',
    title: 'Simplified Builder & Website Chatbot Widget',
    status: 'implemented',
    summary: '5-step wizard, live Playground, public /widget.js script, allowed-domain enforcement, SSE streaming, citations, and feedback.',
    items: [
      { name: '5-step simplified wizard & live Playground', status: 'implemented' },
      { name: 'Responsive /widget.js Shadow DOM embed & public endpoint', status: 'implemented' },
    ],
  },
  {
    phase: 'Priority 5',
    title: 'REST API Connectors, Monitoring & Docker Compose',
    status: 'implemented',
    summary: 'SSRF-guarded REST connector registry, persisted tickets & execution logs, SQL analytics, Docker Compose (App + Ollama + Qdrant).',
    items: [
      { name: 'REST API connector tool registry & confirmation controls', status: 'implemented' },
      { name: 'Docker Compose + PowerShell guide + SQLite backup/restore', status: 'implemented' },
    ],
  },
  {
    phase: 'Future Phases',
    title: 'Omnichannel Webhooks, OpenAPI Auto-Import & Commercial SaaS',
    status: 'planned',
    summary: 'Telegram/WhatsApp webhooks, OpenAPI spec importer, human live-chat inbox, and re-enabling multi-tenant auth.',
    items: [
      { name: 'WhatsApp Cloud API & Telegram Bot webhooks', status: 'planned' },
      { name: 'Multi-tenant RBAC re-activation & billing quotas', status: 'planned' },
    ],
  },
];
