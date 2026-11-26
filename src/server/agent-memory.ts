import { getDb } from './db.ts';

export interface FactRecord {
  key: string;
  value: string;
  recordedAt: string;
  source?: string;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: 'proposed' | 'awaiting_confirmation' | 'executed' | 'failed';
  timestamp: string;
}

export interface ToolResultRecord {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
  executedAt: string;
}

export interface TaskRecord {
  id: string;
  objective: string;
  topic: string;
  missingFields?: string[];
  notes?: string;
  updatedAt: string;
}

export interface PendingConfirmation {
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  missingFields: string[];
  requestedAt: string;
}

export interface ConversationMemoryState {
  currentObjective: string;
  currentTopic: string;
  confirmedFacts: FactRecord[]; // Strictly verified via tool/system output
  userReportedFacts: FactRecord[]; // Claims reported by the user (unverified)
  inferredContext: string[];
  extractedEntities: Record<string, string>;
  pendingQuestions: string[];
  previousToolCalls: ToolCallRecord[];
  actualToolResults: ToolResultRecord[];
  unresolvedTasks: TaskRecord[];
  pausedTasks: TaskRecord[];
  pendingConfirmation: PendingConfirmation | null;
  frustrationLevel: 'none' | 'mild' | 'high';
}

export function createEmptyMemory(): ConversationMemoryState {
  return {
    currentObjective: '',
    currentTopic: '',
    confirmedFacts: [],
    userReportedFacts: [],
    inferredContext: [],
    extractedEntities: {},
    pendingQuestions: [],
    previousToolCalls: [],
    actualToolResults: [],
    unresolvedTasks: [],
    pausedTasks: [],
    pendingConfirmation: null,
    frustrationLevel: 'none',
  };
}

export function loadConversationMemory(conversationId: string): ConversationMemoryState {
  const db = getDb();
  const row = db
    .prepare(`SELECT memory_json FROM conversation_memory WHERE conversation_id = ?`)
    .get(conversationId) as { memory_json: string } | undefined;

  if (!row) return createEmptyMemory();
  try {
    const parsed = JSON.parse(row.memory_json) as Partial<ConversationMemoryState>;
    return {
      ...createEmptyMemory(),
      ...parsed,
      confirmedFacts: Array.isArray(parsed.confirmedFacts) ? parsed.confirmedFacts : [],
      userReportedFacts: Array.isArray(parsed.userReportedFacts) ? parsed.userReportedFacts : [],
      inferredContext: Array.isArray(parsed.inferredContext) ? parsed.inferredContext : [],
      extractedEntities:
        parsed.extractedEntities && typeof parsed.extractedEntities === 'object'
          ? parsed.extractedEntities
          : {},
      pendingQuestions: Array.isArray(parsed.pendingQuestions) ? parsed.pendingQuestions : [],
      previousToolCalls: Array.isArray(parsed.previousToolCalls) ? parsed.previousToolCalls : [],
      actualToolResults: Array.isArray(parsed.actualToolResults) ? parsed.actualToolResults : [],
      unresolvedTasks: Array.isArray(parsed.unresolvedTasks) ? parsed.unresolvedTasks : [],
      pausedTasks: Array.isArray(parsed.pausedTasks) ? parsed.pausedTasks : [],
      pendingConfirmation: parsed.pendingConfirmation ?? null,
    };
  } catch {
    return createEmptyMemory();
  }
}

export function saveConversationMemory(params: {
  conversationId: string;
  workspaceId: string;
  chatbotId: string;
  memory: ConversationMemoryState;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversation_memory (conversation_id, workspace_id, chatbot_id, memory_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       memory_json = excluded.memory_json,
       updated_at = excluded.updated_at`
  ).run(
    params.conversationId,
    params.workspaceId,
    params.chatbotId,
    JSON.stringify(params.memory),
    now
  );
}

export interface MemoryPatchInput {
  currentObjective?: string;
  currentTopic?: string;
  userReportedFacts?: Array<{ key: string; value: string }>;
  inferredContext?: string[];
  extractedEntities?: Record<string, string>;
  pendingQuestions?: string[];
  pauseCurrentTask?: boolean;
  frustrationLevel?: 'none' | 'mild' | 'high';
}

export function applyMemoryPatch(
  current: ConversationMemoryState,
  patch: MemoryPatchInput | undefined
): ConversationMemoryState {
  if (!patch) return current;
  const now = new Date().toISOString();
  const next: ConversationMemoryState = {
    ...current,
    confirmedFacts: [...current.confirmedFacts],
    userReportedFacts: [...current.userReportedFacts],
    inferredContext: [...current.inferredContext],
    extractedEntities: { ...current.extractedEntities },
    pendingQuestions: [...current.pendingQuestions],
    previousToolCalls: [...current.previousToolCalls],
    actualToolResults: [...current.actualToolResults],
    unresolvedTasks: [...current.unresolvedTasks],
    pausedTasks: [...current.pausedTasks],
  };

  // If LLM explicitly signals a topic switch and asks to pause the prior active task
  if (
    patch.pauseCurrentTask &&
    current.currentObjective &&
    patch.currentObjective &&
    patch.currentObjective !== current.currentObjective
  ) {
    const alreadyPaused = next.pausedTasks.some(
      (t) => t.objective === current.currentObjective
    );
    if (!alreadyPaused) {
      next.pausedTasks.push({
        id: `task_${Date.now()}`,
        objective: current.currentObjective,
        topic: current.currentTopic || 'previous_issue',
        notes: 'Paused automatically when user switched to a new topic.',
        updatedAt: now,
      });
    }
  }

  if (typeof patch.currentObjective === 'string' && patch.currentObjective.trim()) {
    next.currentObjective = patch.currentObjective.trim();
  }
  if (typeof patch.currentTopic === 'string' && patch.currentTopic.trim()) {
    next.currentTopic = patch.currentTopic.trim();
  }

  if (Array.isArray(patch.userReportedFacts)) {
    for (const fact of patch.userReportedFacts) {
      if (!fact?.key || !fact?.value) continue;
      const idx = next.userReportedFacts.findIndex((f) => f.key === fact.key);
      const record: FactRecord = {
        key: String(fact.key).trim(),
        value: String(fact.value).trim(),
        recordedAt: now,
        source: 'user_reported',
      };
      if (idx >= 0) next.userReportedFacts[idx] = record;
      else next.userReportedFacts.push(record);
    }
  }

  if (Array.isArray(patch.inferredContext)) {
    for (const note of patch.inferredContext) {
      const clean = String(note || '').trim();
      if (clean && !next.inferredContext.includes(clean)) {
        next.inferredContext.push(clean);
      }
    }
    if (next.inferredContext.length > 10) {
      next.inferredContext = next.inferredContext.slice(-10);
    }
  }

  if (patch.extractedEntities && typeof patch.extractedEntities === 'object') {
    for (const [k, v] of Object.entries(patch.extractedEntities)) {
      const val = String(v ?? '').trim();
      if (k && val) {
        next.extractedEntities[k] = val;
      }
    }
  }

  if (Array.isArray(patch.pendingQuestions)) {
    next.pendingQuestions = patch.pendingQuestions
      .map((q) => String(q || '').trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  if (
    patch.frustrationLevel === 'none' ||
    patch.frustrationLevel === 'mild' ||
    patch.frustrationLevel === 'high'
  ) {
    next.frustrationLevel = patch.frustrationLevel;
  }

  return next;
}

export function recordVerifiedFact(
  memory: ConversationMemoryState,
  key: string,
  value: string,
  source: string
): ConversationMemoryState {
  const now = new Date().toISOString();
  const next = {
    ...memory,
    confirmedFacts: [...memory.confirmedFacts],
  };
  const idx = next.confirmedFacts.findIndex((f) => f.key === key);
  const record: FactRecord = { key, value, source, recordedAt: now };
  if (idx >= 0) next.confirmedFacts[idx] = record;
  else next.confirmedFacts.push(record);
  return next;
}
