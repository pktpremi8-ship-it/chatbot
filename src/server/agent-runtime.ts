import crypto from 'node:crypto';
import { getDb } from './db.ts';
import {
  buildChatbotSystemInstruction,
  estimateTokenCostUsd,
  extractSuggestedFollowups,
  type ChatbotPresetKey,
} from '../shared/kresna-logic.ts';
import {
  defaultLlmDriver,
  type LlmDriver,
  type ProviderConnectionRecord,
} from './llm-gateway.ts';
import {
  applyMemoryPatch,
  loadConversationMemory,
  recordVerifiedFact,
  saveConversationMemory,
  type ConversationMemoryState,
  type MemoryPatchInput,
} from './agent-memory.ts';
import {
  executeRegisteredTool,
  listToolsForChatbot,
  validateToolArguments,
  type ToolDefinition,
} from './connectors.ts';
import { retrieveHybridKnowledge, type RetrievedEvidenceChunk } from './retrieval.ts';

export interface AgentPlan {
  thought_summary?: string;
  memory_patch?: MemoryPatchInput;
  decision:
    | 'retrieve_knowledge'
    | 'call_tool'
    | 'confirm_pending_tool'
    | 'ask_clarification'
    | 'escalate'
    | 'respond';
  knowledge_queries?: Array<{ query: string; sourceIds?: string[] }>;
  tool_call?: { name: string; arguments: Record<string, unknown> };
  direct_response?: string;
  suggested_followups?: string[];
}

export interface ChatbotRuntimeRecord {
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
  max_output_tokens: number;
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

export interface RunAgentTurnResult {
  conversationId: string;
  userMessage: { id: string; role: 'user'; content: string; created_at: string };
  assistantMessage: {
    id: string;
    role: 'assistant';
    content: string;
    model_used: string;
    provider_used: string;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    trace_json: string;
    created_at: string;
    suggested_followups?: string[];
  };
  trace: AgentExecutionTrace;
}

export type ToolExecutorFn = (params: {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  workspaceId: string;
  chatbotId: string;
  conversationId: string;
}) => Promise<{ ok: boolean; data?: unknown; error?: string; latencyMs: number }>;

export function parseJsonObjectRobust(raw: string): AgentPlan | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tryParse = (candidate: string): AgentPlan | null => {
    try {
      const parsed = JSON.parse(candidate) as Partial<AgentPlan>;
      if (parsed && typeof parsed === 'object' && typeof parsed.decision === 'string') {
        return parsed as AgentPlan;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  // Strip ```json fences if emitted
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced) return fenced;
  }

  // Fallback: locate outer JSON braces
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return tryParse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return null;
}

function buildPlannerPrompt(params: {
  chatbot: ChatbotRuntimeRecord;
  memory: ConversationMemoryState;
  knowledgeCatalog: Array<{ id: string; title: string; source_type: string }>;
  tools: ToolDefinition[];
  observations: Array<{ type: string; detail: unknown }>;
  iteration: number;
  maxIterations: number;
}): string {
  const baseInstruction = buildChatbotSystemInstruction({
    name: params.chatbot.name,
    purpose: params.chatbot.purpose,
    preset: params.chatbot.preset,
    language: params.chatbot.language,
    style: params.chatbot.style,
    escalationMode: params.chatbot.escalation_mode,
    customSystemInstructions: params.chatbot.system_instructions,
  });

  const catalogBlock =
    params.knowledgeCatalog.length > 0
      ? params.knowledgeCatalog
          .map((k) => `- id="${k.id}" | title="${k.title}" | type=${k.source_type}`)
          .join('\n')
      : 'None attached.';

  const toolsBlock =
    params.tools.length > 0
      ? params.tools
          .map(
            (t) =>
              `- name="${t.name}" | requiresConfirmation=${t.requiresConfirmation} | required=[${t.requiredFields.join(
                ', '
              )}] | description="${t.description}" | schema=${JSON.stringify(t.inputSchema)}`
          )
          .join('\n')
      : 'No external tools registered.';

  const obsBlock =
    params.observations.length > 0
      ? JSON.stringify(params.observations, null, 2)
      : 'None yet in this turn.';

  return `${baseInstruction}

--- AGENT ORCHESTRATION CONTRACT (Iteration ${params.iteration}/${params.maxIterations}) ---
You are the reasoning engine for an intelligent customer-service agent.
You must respond ONLY with a valid JSON object matching this schema:
{
  "thought_summary": "Brief private internal reasoning (never shown to end user)",
  "memory_patch": {
    "currentObjective": "string",
    "currentTopic": "string",
    "userReportedFacts": [{"key": "string", "value": "string"}],
    "inferredContext": ["string"],
    "extractedEntities": {"key": "value"},
    "pendingQuestions": ["string"],
    "pauseCurrentTask": false,
    "frustrationLevel": "none | mild | high"
  },
  "decision": "retrieve_knowledge | call_tool | confirm_pending_tool | ask_clarification | escalate | respond",
  "knowledge_queries": [{"query": "search query", "sourceIds": ["optional-id"]}],
  "tool_call": {"name": "tool_name", "arguments": {}},
  "direct_response": "Empathetic, crisp natural customer-service reply when decision is ask_clarification, escalate, or respond",
  "suggested_followups": ["Short option 1", "Short option 2"]
}

RULES FOR INTELLIGENT BEHAVIOR:
1. Context & Memory Continuity:
   - Read CURRENT MEMORY carefully. Preserve active objectives when user replies briefly ("ya", "tidak ada gabisa aja", "kalo ini AB1254GN").
   - If the user switches topics, set "pauseCurrentTask": true and update "currentObjective"/"currentTopic" while preserving extractedEntities.
   - Never ask for any entity or fact already present in extractedEntities, userReportedFacts, or confirmedFacts.
2. Knowledge Retrieval:
   - Before answering domain or troubleshooting questions, choose "retrieve_knowledge" if you haven't searched relevant knowledge yet in this turn.
   - Never assume a user issue belongs to a specific system unless retrieved evidence supports it. Search relevant or multiple sources when unsure.
   - Never cite knowledge that was not retrieved in observations. If retrieval returns no relevant evidence, choose "respond" and state honestly what information is unavailable.
3. Tool Execution & Confirmation:
   - Choose "call_tool" ONLY when a relevant tool exists in AVAILABLE TOOLS. If the user asks for an operation with no matching tool, respond honestly explaining no live connector is configured.
   - For write/escalation tools (requiresConfirmation=true): if required fields are missing, ask ONLY for the missing fields. Once all mandatory fields are known, first summarize and ask confirmation (or propose the call) — when pendingConfirmation exists and the user confirms ("ya", "yes", "ok", "buatkan"), choose "confirm_pending_tool".
   - If a previous tool failed (see actualToolResults / observations) and the user expresses frustration ("lah kok gabisa"), acknowledge the exact failure transparently without pretending success or restarting with a greeting.
4. Professional Customer Service Pacing & Progressive Disclosure:
   - Factual / Short queries (e.g. "Kapan SO terbentuk?"): Give a direct, concise 1-2 sentence answer. Omit unnecessary follow-ups.
   - Multi-cause troubleshooting (e.g. UJP/Termin failed/pending, OBD tracking stuck, route errors, pairing):
     * NEVER dump an encyclopedia or 10-line bulleted manual in a single message.
     * State the top 1-2 most common root causes concisely and warmly.
     * Conclude with an interactive diagnostic follow-up question (e.g. asking which specific status appears).
     * Provide 2-3 short, clickable follow-up options in "suggested_followups" (e.g. ["Status Failed", "Status Pending", "Panduan Transfer Manual"]).
   - Unresolved Issue / Frustration: If the customer says a previous step didn't work ("masih belum bisa", "tetap error"), acknowledge with empathy, skip repeating steps, and offer the next escalation step (e.g. creating a support ticket).
   - Write a natural, concise, helpful "direct_response" in the user's language. Never include raw JSON or chain-of-thought in "direct_response".

CURRENT CONVERSATION MEMORY:
${JSON.stringify(params.memory, null, 2)}

AVAILABLE KNOWLEDGE SOURCES:
${catalogBlock}

AVAILABLE TOOLS:
${toolsBlock}

OBSERVATIONS IN THIS TURN:
${obsBlock}`;
}

export async function runAgentTurn(params: {
  workspaceId: string;
  chatbot: ChatbotRuntimeRecord;
  connection: ProviderConnectionRecord;
  userMessage: string;
  channelType: 'playground' | 'widget' | 'eval';
  externalUserId: string;
  conversationId?: string;
  maxIterations?: number;
  maxOutputTokens?: number;
  driver?: LlmDriver;
  toolExecutor?: ToolExecutorFn;
  additionalTools?: ToolDefinition[];
  onToken?: (token: string) => void;
}): Promise<RunAgentTurnResult> {
  const db = getDb();
  const startedAll = Date.now();
  const maxIterations = Math.min(Math.max(params.maxIterations ?? 4, 1), 6);
  const driver = params.driver ?? defaultLlmDriver;
  const executeTool = params.toolExecutor ?? executeRegisteredTool;

  // 1. Create or load conversation
  const now = new Date().toISOString();
  let conversationId = params.conversationId || '';
  if (conversationId) {
    const existing = db
      .prepare(`SELECT id FROM conversations WHERE id = ? AND chatbot_id = ? AND workspace_id = ?`)
      .get(conversationId, params.chatbot.id, params.workspaceId);
    if (!existing) conversationId = '';
  }
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO conversations (id, workspace_id, chatbot_id, channel_type, external_user_id, status, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(
      conversationId,
      params.workspaceId,
      params.chatbot.id,
      params.channelType,
      params.externalUserId,
      now,
      now
    );
  }

  // 2. Context Assembly: Load history + structured memory + knowledge catalog + tools
  const historyRows = db
    .prepare(
      `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 24`
    )
    .all(conversationId) as Array<{ role: 'user' | 'assistant'; content: string }>;

  let memory = loadConversationMemory(conversationId);

  const knowledgeCatalog = db
    .prepare(
      `SELECT id, title, source_type FROM knowledge_items WHERE chatbot_id = ? AND workspace_id = ? ORDER BY created_at DESC`
    )
    .all(params.chatbot.id, params.workspaceId) as Array<{
    id: string;
    title: string;
    source_type: string;
  }>;

  const tools = [
    ...listToolsForChatbot(params.workspaceId, params.chatbot.id),
    ...(params.additionalTools || []),
  ];

  // Persist incoming user message
  const userMsgId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, workspace_id, role, content, created_at)
     VALUES (?, ?, ?, 'user', ?, ?)`
  ).run(userMsgId, conversationId, params.workspaceId, params.userMessage, now);

  const observations: Array<{ type: string; detail: unknown }> = [];
  const collectedEvidence: RetrievedEvidenceChunk[] = [];
  const toolCallsTrace: AgentExecutionTrace['toolCalls'] = [];
  const toolResultsTrace: AgentExecutionTrace['toolResults'] = [];
  const executionSummary: string[] = [];

  let totalModelLatency = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let tokensMeasured = false;
  let iterationsUsed = 0;
  let finalAnswer = '';
  let unanswered = false;
  let explicitFollowups: string[] | undefined;
  let lastDecision = 'respond';
  const activeModel = (params.chatbot.model_id || params.connection.default_model || '').trim();

  // 3. Bounded Agent Loop (Plan -> Act -> Observe -> Re-evaluate)
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterationsUsed = iteration;

    const plannerSystem = buildPlannerPrompt({
      chatbot: params.chatbot,
      memory,
      knowledgeCatalog,
      tools,
      observations,
      iteration,
      maxIterations,
    });

    const completion = await driver.complete({
      connection: params.connection,
      model: activeModel,
      systemInstruction: plannerSystem,
      messages: [
        ...historyRows,
        { role: 'user', content: params.userMessage },
      ],
      formatJson: true,
      maxOutputTokens: params.maxOutputTokens ?? params.chatbot.max_output_tokens ?? 1024,
    });

    totalModelLatency += completion.latencyMs;
    totalInputTokens += completion.inputTokens;
    totalOutputTokens += completion.outputTokens;
    if (completion.tokensMeasured) tokensMeasured = true;

    const plan = parseJsonObjectRobust(completion.text);
    if (!plan) {
      // Model produced natural text instead of JSON — deliver cleanly without crashing
      finalAnswer = completion.text.trim();
      executionSummary.push(`Iter ${iteration}: direct natural response (unstructured output)`);
      break;
    }

    lastDecision = plan.decision;
    if (Array.isArray(plan.suggested_followups) && plan.suggested_followups.length > 0) {
      explicitFollowups = plan.suggested_followups;
    }

    if (plan.memory_patch) {
      memory = applyMemoryPatch(memory, plan.memory_patch);
    }

    if (plan.thought_summary) {
      executionSummary.push(`Iter ${iteration} [${plan.decision}]: ${plan.thought_summary}`);
    } else {
      executionSummary.push(`Iter ${iteration}: decision=${plan.decision}`);
    }

    // Action A: Knowledge Retrieval (Hybrid FTS5 + Qdrant RRF)
    if (plan.decision === 'retrieve_knowledge') {
      const queries =
        Array.isArray(plan.knowledge_queries) && plan.knowledge_queries.length > 0
          ? plan.knowledge_queries.slice(0, 3)
          : [{ query: params.userMessage }];

      const batchHits: RetrievedEvidenceChunk[] = [];
      for (const q of queries) {
        const res = await retrieveHybridKnowledge({
          workspaceId: params.workspaceId,
          chatbotId: params.chatbot.id,
          query: q.query || params.userMessage,
          sourceIds: Array.isArray(q.sourceIds) && q.sourceIds.length > 0 ? q.sourceIds : undefined,
          topK: 4,
        });
        for (const ev of res.evidence) {
          batchHits.push(ev);
          if (!collectedEvidence.some((e) => e.chunkId === ev.chunkId)) {
            collectedEvidence.push(ev);
          }
        }
      }

      if (batchHits.length === 0) {
        unanswered = true;
      }

      observations.push({
        type: 'knowledge_retrieval',
        detail: {
          queries: queries.map((q) => q.query),
          hitCount: batchHits.length,
          hits: batchHits.map((h) => ({
            title: h.title,
            citation: h.citation,
            rrfScore: h.rrfScore,
            method: h.retrievalMethod,
            excerpt: h.content,
          })),
        },
      });
      continue;
    }

    // Action B: Tool Call or Confirm Pending Tool
    if (plan.decision === 'call_tool' || plan.decision === 'confirm_pending_tool') {
      const requestedName =
        plan.decision === 'confirm_pending_tool' && memory.pendingConfirmation
          ? memory.pendingConfirmation.toolName
          : plan.tool_call?.name || '';
      const requestedArgs =
        plan.decision === 'confirm_pending_tool' && memory.pendingConfirmation
          ? {
              ...memory.pendingConfirmation.arguments,
              ...(plan.tool_call?.arguments || {}),
            }
          : plan.tool_call?.arguments || {};

      const tool = tools.find((t) => t.name === requestedName);
      if (!tool) {
        const errText = `Tool "${requestedName}" is not registered for this chatbot. Explain honestly that this live system integration is not configured.`;
        toolCallsTrace.push({
          name: requestedName || 'unknown_tool',
          arguments: requestedArgs,
          status: 'failed',
        });
        toolResultsTrace.push({
          name: requestedName || 'unknown_tool',
          ok: false,
          summary: 'Tool unavailable',
          error: errText,
        });
        observations.push({ type: 'tool_error', detail: errText });
        continue;
      }

      // Check argument validation
      const validation = validateToolArguments(tool, requestedArgs);
      if (!validation.valid) {
        const callId = crypto.randomUUID();
        memory.previousToolCalls.push({
          id: callId,
          toolName: tool.name,
          arguments: requestedArgs,
          status: 'proposed',
          timestamp: new Date().toISOString(),
        });
        memory.unresolvedTasks = [
          {
            id: `pending_${tool.name}`,
            objective: memory.currentObjective || `Run ${tool.name}`,
            topic: memory.currentTopic || tool.name,
            missingFields: validation.missingFields,
            updatedAt: new Date().toISOString(),
          },
        ];
        toolCallsTrace.push({
          name: tool.name,
          arguments: requestedArgs,
          status: 'missing_fields',
        });
        observations.push({
          type: 'tool_validation',
          detail: {
            tool: tool.name,
            missingFields: validation.missingFields,
            instruction: `Ask user concisely ONLY for missing fields: ${validation.missingFields.join(', ')}.`,
          },
        });
        continue;
      }

      // Check write confirmation gate
      const isAlreadyConfirmed =
        plan.decision === 'confirm_pending_tool' &&
        memory.pendingConfirmation?.toolName === tool.name;

      if (tool.requiresConfirmation && !isAlreadyConfirmed) {
        const callId = crypto.randomUUID();
        memory.pendingConfirmation = {
          toolName: tool.name,
          arguments: requestedArgs,
          summary: `Execute ${tool.name} with ${JSON.stringify(requestedArgs)}`,
          missingFields: [],
          requestedAt: new Date().toISOString(),
        };
        memory.previousToolCalls.push({
          id: callId,
          toolName: tool.name,
          arguments: requestedArgs,
          status: 'awaiting_confirmation',
          timestamp: new Date().toISOString(),
        });
        toolCallsTrace.push({
          name: tool.name,
          arguments: requestedArgs,
          status: 'awaiting_confirmation',
        });
        observations.push({
          type: 'confirmation_required',
          detail: {
            tool: tool.name,
            arguments: requestedArgs,
            instruction:
              'Summarize the action details clearly and ask the user to confirm before executing.',
          },
        });
        continue;
      }

      // Execute verified tool!
      const callId = crypto.randomUUID();
      const execResult = await executeTool({
        tool,
        args: requestedArgs,
        workspaceId: params.workspaceId,
        chatbotId: params.chatbot.id,
        conversationId,
      });

      const execTime = new Date().toISOString();
      memory.pendingConfirmation = null;
      memory.previousToolCalls.push({
        id: callId,
        toolName: tool.name,
        arguments: requestedArgs,
        status: execResult.ok ? 'executed' : 'failed',
        timestamp: execTime,
      });

      if (execResult.ok) {
        const summary = JSON.stringify(execResult.data).slice(0, 600);
        memory.actualToolResults.push({
          toolCallId: callId,
          toolName: tool.name,
          ok: true,
          summary,
          data: execResult.data,
          executedAt: execTime,
        });
        memory.unresolvedTasks = memory.unresolvedTasks.filter(
          (t) => t.id !== `pending_${tool.name}`
        );
        memory = recordVerifiedFact(
          memory,
          `tool:${tool.name}`,
          summary,
          `tool:${tool.name}`
        );
        toolCallsTrace.push({ name: tool.name, arguments: requestedArgs, status: 'executed' });
        toolResultsTrace.push({ name: tool.name, ok: true, summary });
        observations.push({
          type: 'tool_result',
          detail: { tool: tool.name, ok: true, data: execResult.data },
        });
      } else {
        const errMsg = execResult.error || 'Tool execution failed';
        memory.actualToolResults.push({
          toolCallId: callId,
          toolName: tool.name,
          ok: false,
          summary: errMsg,
          error: errMsg,
          executedAt: execTime,
        });
        toolCallsTrace.push({ name: tool.name, arguments: requestedArgs, status: 'failed' });
        toolResultsTrace.push({
          name: tool.name,
          ok: false,
          summary: errMsg,
          error: errMsg,
        });
        observations.push({
          type: 'tool_result',
          detail: { tool: tool.name, ok: false, error: errMsg },
        });
      }
      continue;
    }

    // Action C: Final response / clarification / escalation
    if (plan.direct_response && plan.direct_response.trim()) {
      finalAnswer = plan.direct_response.trim();
      if (params.onToken) {
        params.onToken(finalAnswer);
      }
      break;
    }
  }

  // Fallback synthesis pass if loop exhausted iterations or didn't populate direct_response
  if (!finalAnswer) {
    const synthesisSystem = buildChatbotSystemInstruction({
      name: params.chatbot.name,
      purpose: params.chatbot.purpose,
      preset: params.chatbot.preset,
      language: params.chatbot.language,
      style: params.chatbot.style,
      escalationMode: params.chatbot.escalation_mode,
      customSystemInstructions: params.chatbot.system_instructions,
      knowledgeItems: collectedEvidence.map((e) => ({
        title: e.title,
        sourceType: e.sourceType,
        content: e.content,
        citation: e.citation,
      })),
    });

    const synthPrompt = `Memory:\n${JSON.stringify(memory)}\n\nObservations:\n${JSON.stringify(
      observations
    )}\n\nRespond naturally and concisely to the user's latest message using ONLY verified facts and retrieved evidence.`;

    const finalTurn = await driver.complete({
      connection: params.connection,
      model: activeModel,
      systemInstruction: `${synthesisSystem}\n\n${synthPrompt}`,
      messages: [
        ...historyRows,
        { role: 'user', content: params.userMessage },
      ],
      formatJson: false,
      maxOutputTokens: params.maxOutputTokens ?? params.chatbot.max_output_tokens ?? 1024,
      onToken: params.onToken,
    });
    totalModelLatency += finalTurn.latencyMs;
    totalInputTokens += finalTurn.inputTokens;
    totalOutputTokens += finalTurn.outputTokens;
    if (finalTurn.tokensMeasured) tokensMeasured = true;
    finalAnswer = finalTurn.text || 'I could not generate a response right now. Please try again.';
  }

  if (
    collectedEvidence.length === 0 &&
    knowledgeCatalog.length > 0 &&
    /tidak ada informasi|not available|unavailable|tidak ditemukan|don't have/i.test(finalAnswer)
  ) {
    unanswered = true;
  }

  // Persist memory state
  saveConversationMemory({
    conversationId,
    workspaceId: params.workspaceId,
    chatbotId: params.chatbot.id,
    memory,
  });

  const assistantTime = new Date().toISOString();
  const assistantMsgId = crypto.randomUUID();
  const totalResponseMs = Date.now() - startedAll;
  const estimatedCostUsd = estimateTokenCostUsd(
    activeModel,
    totalInputTokens,
    totalOutputTokens,
    params.connection.provider
  );

  const retrievalSources = collectedEvidence.map((e) => ({
    knowledgeItemId: e.knowledgeItemId,
    title: e.title,
    sourceType: e.sourceType,
    citation: e.citation,
    method: e.retrievalMethod,
    rrfScore: e.rrfScore,
  }));

  const finalFollowups = extractSuggestedFollowups({
    text: finalAnswer,
    explicitSuggestions: explicitFollowups,
    decision: lastDecision,
  });

  const trace: AgentExecutionTrace = {
    provider: params.connection.provider,
    model: activeModel,
    iterations: iterationsUsed,
    modelLatencyMs: totalModelLatency,
    totalResponseMs,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    tokensMeasured,
    estimatedCostUsd,
    unanswered,
    retrievalSources,
    retrievedEvidence: collectedEvidence,
    toolCalls: toolCallsTrace,
    toolResults: toolResultsTrace,
    memorySnapshot: memory,
    executionSummary,
    suggestedFollowups: finalFollowups,
  };

  db.prepare(
    `INSERT INTO messages
      (id, conversation_id, workspace_id, role, content, model_used, provider_used, input_tokens, output_tokens, latency_ms, trace_json, created_at)
     VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assistantMsgId,
    conversationId,
    params.workspaceId,
    finalAnswer,
    activeModel,
    params.connection.provider,
    totalInputTokens,
    totalOutputTokens,
    totalResponseMs,
    JSON.stringify(trace),
    assistantTime
  );

  db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
    assistantTime,
    conversationId
  );

  db.prepare(
    `INSERT INTO execution_logs
      (id, workspace_id, chatbot_id, conversation_id, message_id, channel_type, user_message, assistant_response, provider, model, model_latency_ms, total_response_ms, iterations, retrieval_count, retrieval_sources_json, retrieved_evidence_json, tool_calls_json, tool_results_json, memory_snapshot_json, unanswered, input_tokens, output_tokens, token_metrics_measured, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    params.workspaceId,
    params.chatbot.id,
    conversationId,
    assistantMsgId,
    params.channelType,
    params.userMessage,
    finalAnswer,
    params.connection.provider,
    activeModel,
    totalModelLatency,
    totalResponseMs,
    iterationsUsed,
    collectedEvidence.length,
    JSON.stringify(retrievalSources),
    JSON.stringify(collectedEvidence),
    JSON.stringify(toolCallsTrace),
    JSON.stringify(toolResultsTrace),
    JSON.stringify(memory),
    unanswered ? 1 : 0,
    totalInputTokens,
    totalOutputTokens,
    tokensMeasured ? 1 : 0,
    assistantTime
  );

  db.prepare(
    `INSERT INTO usage_events
      (id, workspace_id, chatbot_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, latency_ms, success, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    crypto.randomUUID(),
    params.workspaceId,
    params.chatbot.id,
    params.connection.provider,
    activeModel,
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUsd,
    totalResponseMs,
    assistantTime
  );

  return {
    conversationId,
    userMessage: {
      id: userMsgId,
      role: 'user',
      content: params.userMessage,
      created_at: now,
    },
    assistantMessage: {
      id: assistantMsgId,
      role: 'assistant',
      content: finalAnswer,
      model_used: activeModel,
      provider_used: params.connection.provider,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      latency_ms: totalResponseMs,
      trace_json: JSON.stringify(trace),
      created_at: assistantTime,
      suggested_followups: finalFollowups,
    },
    trace,
  };
}
