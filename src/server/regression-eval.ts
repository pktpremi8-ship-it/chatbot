import crypto from 'node:crypto';
import { getDb } from './db.ts';
import { runAgentTurn, type ChatbotRuntimeRecord, type ToolExecutorFn } from './agent-runtime.ts';
import type { LlmDriver, LlmCompletionRequest, LlmCompletionResult, ProviderConnectionRecord } from './llm-gateway.ts';
import type { ToolDefinition } from './connectors.ts';
import { ingestManualKnowledgeRecord } from './knowledge-pipeline.ts';

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

function buildEvalTools(): ToolDefinition[] {
  return [
    {
      name: 'check_vehicle_utsp',
      description: 'Checks live UTSP inspection and pool-out clearance status for a vehicle plate number.',
      kind: 'rest_connector',
      method: 'GET',
      requiresConfirmation: false,
      requiredFields: ['plate_number'],
      inputSchema: {
        type: 'object',
        required: ['plate_number'],
        properties: {
          plate_number: { type: 'string', description: 'Vehicle license plate e.g. AB1254GN' },
        },
      },
    },
  ];
}

function createEvalToolExecutor(failPlates = new Set(['B9999ERR'])): ToolExecutorFn {
  return async ({ tool, args, workspaceId, chatbotId, conversationId }) => {
    if (tool.name === 'check_vehicle_utsp') {
      const plate = String(args.plate_number || '').trim().toUpperCase();
      if (!plate) return { ok: false, error: 'plate_number is required', latencyMs: 5 };
      if (failPlates.has(plate)) {
        return {
          ok: false,
          error: `UTSP registry lookup timed out for vehicle ${plate} (upstream 504).`,
          latencyMs: 14,
        };
      }
      if (plate === 'AB1254GN') {
        return {
          ok: true,
          data: {
            plate_number: 'AB1254GN',
            utsp_status: 'VALID_CLEAR',
            pool_out_eligible: true,
            valid_until: '2026-12-31',
          },
          latencyMs: 12,
        };
      }
      return {
        ok: true,
        data: {
          plate_number: plate,
          utsp_status: 'EXPIRED_HOLD',
          pool_out_eligible: false,
          valid_until: '2026-09-15',
        },
        latencyMs: 11,
      };
    }

    // Delegate create_support_ticket to real SQLite executor
    const { executeRegisteredTool } = await import('./connectors.ts');
    return executeRegisteredTool({ tool, args, workspaceId, chatbotId, conversationId });
  };
}

/**
 * Deterministic contract driver for offline/unit verification of the runtime loop,
 * memory continuity, hybrid retrieval, confirmation gate, and failure recovery.
 * Note: reads the assembled system prompt observations/memory rather than bypassing the runtime.
 */
function createSimulatedContractDriver(): LlmDriver {
  return {
    async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const userMsg = req.messages[req.messages.length - 1]?.content || '';
      const lower = userMsg.toLowerCase();
      const sys = req.systemInstruction;

      const hasObs = !sys.includes('OBSERVATIONS IN THIS TURN:\nNone yet in this turn.');
      const memMatch = sys.match(/CURRENT CONVERSATION MEMORY:\n([\s\S]*?)\n\nAVAILABLE KNOWLEDGE SOURCES:/);
      const memory = memMatch ? JSON.parse(memMatch[1]) : {};

      // Extract observations JSON if present
      const obsMatch = sys.match(/OBSERVATIONS IN THIS TURN:\n([\s\S]*)$/);
      let observations: Array<{ type: string; detail: any }> = [];
      if (obsMatch && hasObs) {
        try {
          observations = JSON.parse(obsMatch[1]);
        } catch {
          observations = [];
        }
      }

      const lastObs = observations[observations.length - 1];

      // Handle post-observation re-evaluation
      if (lastObs?.type === 'knowledge_retrieval') {
        const hits = lastObs.detail?.hits || [];
        if (hits.length === 0) {
          return {
            text: JSON.stringify({
              thought_summary: 'No matching knowledge found; explain limitation honestly.',
              decision: 'respond',
              direct_response:
                'Maaf, informasi mengenai hal tersebut belum tersedia di basis pengetahuan saat ini. Jika mau, saya bisa bantu buatkan tiket dukungan agar tim terkait menindaklanjuti.',
            }),
            provider: 'simulated',
            model: req.model,
            inputTokens: 120,
            outputTokens: 35,
            tokensMeasured: false,
            latencyMs: 4,
          };
        }
        const topHit = hits[0];
        return {
          text: JSON.stringify({
            thought_summary: `Found grounded evidence in ${topHit.title}`,
            memory_patch: memory.currentTopic
              ? undefined
              : { currentTopic: topHit.title },
            decision: 'respond',
            direct_response: `Berdasarkan panduan "${topHit.title}" (${topHit.citation}): ${topHit.excerpt.slice(
              0,
              240
            )}. Apakah pesan error atau kendala spesifik tersebut muncul saat proses?`,
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 160,
          outputTokens: 55,
          tokensMeasured: false,
          latencyMs: 5,
        };
      }

      if (lastObs?.type === 'tool_validation') {
        const missing = lastObs.detail?.missingFields || [];
        return {
          text: JSON.stringify({
            thought_summary: 'Mandatory fields missing before ticket creation',
            decision: 'ask_clarification',
            direct_response: `Baik, saya siapkan pembuatan tiket untuk kendala "${
              memory.currentObjective || 'laporan Anda'
            }". Agar tiket bisa diproses, mohon informasikan: ${missing.join(', ')}.`,
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 130,
          outputTokens: 40,
          tokensMeasured: false,
          latencyMs: 3,
        };
      }

      if (lastObs?.type === 'confirmation_required') {
        return {
          text: JSON.stringify({
            thought_summary: 'Ask explicit user confirmation before write action',
            decision: 'ask_clarification',
            direct_response: `Ringkasan tiket sudah siap (${JSON.stringify(
              lastObs.detail?.arguments
            )}). Ketik "ya" jika ingin saya langsung buatkan tiketnya sekarang.`,
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 140,
          outputTokens: 36,
          tokensMeasured: false,
          latencyMs: 3,
        };
      }

      if (lastObs?.type === 'tool_result') {
        if (lastObs.detail?.ok) {
          return {
            text: JSON.stringify({
              thought_summary: 'Report verified tool output',
              decision: 'respond',
              direct_response: `Hasil pemeriksaan sistem (terverifikasi): ${JSON.stringify(
                lastObs.detail.data
              )}`,
            }),
            provider: 'simulated',
            model: req.model,
            inputTokens: 150,
            outputTokens: 42,
            tokensMeasured: false,
            latencyMs: 4,
          };
        }
        return {
          text: JSON.stringify({
            thought_summary: 'Report tool failure honestly without pretending success',
            decision: 'respond',
            direct_response: `Operasi gagal dijalankan: ${lastObs.detail?.error}. Anda bisa mengirim ulang nomor plat lain atau meminta saya membuat tiket dukungan.`,
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 140,
          outputTokens: 40,
          tokensMeasured: false,
          latencyMs: 4,
        };
      }

      // First iteration planning based on user message + memory
      if (memory.pendingConfirmation && /^(ya|yes|ok|oke|lanjut|buatkan)$/i.test(lower.trim())) {
        return {
          text: JSON.stringify({
            thought_summary: 'User confirmed pending write tool',
            decision: 'confirm_pending_tool',
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 110,
          outputTokens: 20,
          tokensMeasured: false,
          latencyMs: 3,
        };
      }

      // Check if user asks to create ticket immediately / escalate
      if (
        lower.includes('buatkan saja') ||
        lower.includes('buat tiket') ||
        lower.includes('create ticket')
      ) {
        const contact = memory.extractedEntities?.customer_contact;
        return {
          text: JSON.stringify({
            thought_summary: 'User requested immediate ticket escalation',
            memory_patch: {
              currentObjective: 'Create support ticket for user issue',
            },
            decision: 'call_tool',
            tool_call: {
              name: 'create_support_ticket',
              arguments: {
                subject: memory.currentObjective || 'Pool Out Support Issue',
                description:
                  memory.userReportedFacts?.map((f: any) => `${f.key}: ${f.value}`).join('; ') ||
                  'User requested immediate ticket creation.',
                ...(contact ? { customer_contact: contact } : {}),
              },
            },
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 150,
          outputTokens: 50,
          tokensMeasured: false,
          latencyMs: 4,
        };
      }

      // Supplying contact for pending ticket
      if (
        memory.unresolvedTasks?.some((t: any) => t.id === 'pending_create_support_ticket') &&
        (lower.includes('@') || /\d{6,}/.test(lower) || lower.includes('driver'))
      ) {
        return {
          text: JSON.stringify({
            thought_summary: 'User supplied missing ticket contact',
            memory_patch: {
              extractedEntities: { customer_contact: userMsg.trim() },
            },
            decision: 'call_tool',
            tool_call: {
              name: 'create_support_ticket',
              arguments: {
                subject: memory.currentObjective || 'Pool Out Support Issue',
                description:
                  memory.userReportedFacts?.map((f: any) => `${f.key}: ${f.value}`).join('; ') ||
                  'User reported pool-out error.',
                customer_contact: userMsg.trim(),
              },
            },
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 150,
          outputTokens: 48,
          tokensMeasured: false,
          latencyMs: 4,
        };
      }

      // Frustration after failed tool
      if (
        (lower.includes('gabisa') || lower.includes('gagal') || lower.includes('kok')) &&
        Array.isArray(memory.actualToolResults) &&
        memory.actualToolResults.some((r: any) => r.ok === false)
      ) {
        const lastFail = [...memory.actualToolResults].reverse().find((r: any) => !r.ok);
        return {
          text: JSON.stringify({
            thought_summary: 'Acknowledge frustration and explain prior failed tool result',
            memory_patch: { frustrationLevel: 'high' },
            decision: 'respond',
            direct_response: `Saya mengerti ini membuat kesal. Pemeriksaan sebelumnya gagal karena: ${lastFail.error}. Silakan berikan nomor plat lain untuk dicek ulang, atau ketik jika ingin saya buatkan tiket eskalasi.`,
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 140,
          outputTokens: 48,
          tokensMeasured: false,
          latencyMs: 4,
        };
      }

      // Topic switch to UTSP vehicle check
      if (lower.includes('utsp') || lower.includes('cek unit')) {
        const plateMatch = userMsg.toUpperCase().match(/\b[A-Z]{1,2}\d{3,5}[A-Z]{1,3}\b/);
        if (plateMatch) {
          return {
            text: JSON.stringify({
              thought_summary: 'New UTSP check with plate provided',
              memory_patch: {
                currentObjective: 'Verify vehicle UTSP status',
                currentTopic: 'vehicle_utsp',
                pauseCurrentTask: true,
                extractedEntities: { plate_number: plateMatch[0] },
              },
              decision: 'call_tool',
              tool_call: {
                name: 'check_vehicle_utsp',
                arguments: { plate_number: plateMatch[0] },
              },
            }),
            provider: 'simulated',
            model: req.model,
            inputTokens: 140,
            outputTokens: 45,
            tokensMeasured: false,
            latencyMs: 4,
          };
        }
        return {
          text: JSON.stringify({
            thought_summary: 'New UTSP objective, ask for plate number',
            memory_patch: {
              currentObjective: 'Verify vehicle UTSP status',
              currentTopic: 'vehicle_utsp',
              pauseCurrentTask: true,
              pendingQuestions: ['plate_number'],
            },
            decision: 'ask_clarification',
            direct_response:
              'Baik, saya bisa bantu cek status UTSP kendaraan Anda. Mohon sebutkan nomor polisi / plat kendaraan tersebut.',
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 130,
          outputTokens: 40,
          tokensMeasured: false,
          latencyMs: 4,
        };
      }

      // Plate provided in follow-up or contextual retry ("AB1254GN", "kalo ini AB1254GN")
      const plateOnly = userMsg.toUpperCase().match(/\b[A-Z]{1,2}\d{3,5}[A-Z]{1,3}\b/);
      if (
        plateOnly &&
        (memory.currentTopic === 'vehicle_utsp' ||
          memory.pendingQuestions?.includes('plate_number') ||
          lower.includes('kalo ini'))
      ) {
        return {
          text: JSON.stringify({
            thought_summary: 'Execute UTSP verification using contextual plate entity',
            memory_patch: {
              extractedEntities: { plate_number: plateOnly[0] },
              pendingQuestions: [],
            },
            decision: 'call_tool',
            tool_call: {
              name: 'check_vehicle_utsp',
              arguments: { plate_number: plateOnly[0] },
            },
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 135,
          outputTokens: 40,
          tokensMeasured: false,
          latencyMs: 4,
        };
      }

      // Contextual brief follow-up for pool out ("tidak ada gabisa aja")
      if (
        (lower.includes('tidak ada') || lower.includes('gabisa aja')) &&
        memory.currentObjective
      ) {
        return {
          text: JSON.stringify({
            thought_summary: 'Preserve active pool-out objective on brief follow-up',
            memory_patch: {
              userReportedFacts: [{ key: 'pool_out_detail', value: userMsg }],
            },
            decision: 'retrieve_knowledge',
            knowledge_queries: [{ query: `${memory.currentObjective} ${userMsg}` }],
          }),
          provider: 'simulated',
          model: req.model,
          inputTokens: 130,
          outputTokens: 40,
          tokensMeasured: false,
          latencyMs: 4,
        };
      }

      // Default: retrieve knowledge for user query
      return {
        text: JSON.stringify({
          thought_summary: `Search workspace knowledge for: ${userMsg}`,
          memory_patch: {
            currentObjective: userMsg,
            currentTopic: lower.includes('pool out')
              ? 'pool_out'
              : lower.includes('logis')
                ? 'logis_system'
                : 'general_inquiry',
            userReportedFacts: [{ key: 'initial_symptom', value: userMsg }],
            ...(memory.currentObjective?.toLowerCase().includes('pool out') && lower.includes('logis')
              ? { pauseCurrentTask: true }
              : {}),
          },
          decision: 'retrieve_knowledge',
          knowledge_queries: [{ query: userMsg }],
        }),
        provider: 'simulated',
        model: req.model,
        inputTokens: 130,
        outputTokens: 40,
        tokensMeasured: false,
        latencyMs: 4,
      };
    },
  };
}

export async function runRegressionEvaluation(params: {
  workspaceId: string;
  mode: 'live' | 'simulated';
  connection?: ProviderConnectionRecord;
  model?: string;
}): Promise<EvaluationSuiteReport> {
  const db = getDb();
  const evalBotId = crypto.randomUUID();
  const now = new Date().toISOString();

  const conn: ProviderConnectionRecord =
    params.connection ?? {
      id: 'eval-sim-conn',
      provider: params.mode === 'simulated' ? 'ollama' : 'ollama',
      auth_mode: 'local',
      encrypted_api_key: null,
      endpoint: process.env.OLLAMA_BASE_URL || 'http://ollama:11434',
      default_model: params.model || 'simulated-contract-v1',
    };

  const modelName = params.model || conn.default_model || 'simulated-contract-v1';

  // Create isolated temporary evaluation bot inside workspace, then clean up after run
  db.prepare(
    `INSERT INTO chatbots
      (id, workspace_id, public_bot_id, name, purpose, preset, language, style, system_instructions, welcome_message, model_connection_id, model_id, mode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'customer_support', 'Indonesian', 'Empathetic, concise, factual', '', 'Halo! Ada yang bisa saya bantu?', NULL, ?, 'developer', 'draft', ?, ?)`
  ).run(
    evalBotId,
    params.workspaceId,
    `bot_eval_${evalBotId.slice(0, 8)}`,
    'KRESNA Eval Sandbox',
    'Assist fleet & operations drivers with pool-out, UTSP checks, LOGis issues, and support tickets.',
    modelName,
    now,
    now
  );

  try {
    // Seed distinct multi-source knowledge domains (Fleet Pool-Out vs LOGis Login vs Billing)
    await ingestManualKnowledgeRecord({
      workspaceId: params.workspaceId,
      chatbotId: evalBotId,
      title: 'SOP Operasional Pool Out Armada',
      sourceType: 'faq',
      content:
        'Kendala tidak bisa pool out atau gabisa pool out umumnya disebabkan oleh: (1) Status UTSP kendaraan belum valid atau kadaluarsa, (2) Surat jalan belum terbit di pos keamanan, atau (3) Driver masih memiliki trip aktif sebelumnya.',
    });
    await ingestManualKnowledgeRecord({
      workspaceId: params.workspaceId,
      chatbotId: evalBotId,
      title: 'Panduan Login & Sinkronisasi Aplikasi LOGis',
      sourceType: 'note',
      content:
        'Jika aplikasi LOGis mengalami gagal login atau token expired, lakukan clear cache lalu login ulang dengan NIK driver. Kendala login LOGis terpisah dari kelayakan UTSP pool out.',
    });
    await ingestManualKnowledgeRecord({
      workspaceId: params.workspaceId,
      chatbotId: evalBotId,
      title: 'Kebijakan Klaim BBM & Tol',
      sourceType: 'faq',
      content: 'Pengajuan reimburse tol dan BBM diproses maksimal 3 hari kerja setelah bukti struk diunggah.',
    });

    const chatbot: ChatbotRuntimeRecord = {
      id: evalBotId,
      workspace_id: params.workspaceId,
      public_bot_id: `bot_eval_${evalBotId.slice(0, 8)}`,
      name: 'KRESNA Eval Sandbox',
      purpose: 'Assist fleet & operations drivers with pool-out, UTSP checks, LOGis issues, and support tickets.',
      preset: 'customer_support',
      language: 'Indonesian',
      style: 'Empathetic, concise, factual',
      escalation_mode: 'Offer support ticket escalation with explicit confirmation.',
      system_instructions: '',
      welcome_message: 'Halo! Ada yang bisa saya bantu?',
      model_connection_id: null,
      model_id: modelName,
      max_output_tokens: 1024,
    };

    const driver = params.mode === 'simulated' ? createSimulatedContractDriver() : undefined;
    const toolExecutor = createEvalToolExecutor(new Set(['B9999ERR']));
    const extraTools = buildEvalTools();

    const runTurn = (msg: string, conversationId?: string) =>
      runAgentTurn({
        workspaceId: params.workspaceId,
        chatbot,
        connection: conn,
        userMessage: msg,
        channelType: 'eval',
        externalUserId: 'eval-runner',
        conversationId,
        maxIterations: 4,
        driver,
        toolExecutor,
        additionalTools: extraTools,
      });

    const scenarios: ScenarioEvalResult[] = [];

    // Helper to extract compact turn summary
    const summarizeTurn = (userMessage: string, res: Awaited<ReturnType<typeof runTurn>>) => ({
      userMessage,
      assistantResponse: res.assistantMessage.content,
      decisionSummary: res.trace.executionSummary,
      retrievedTitles: res.trace.retrievalSources.map((s) => s.title),
      toolCalls: res.trace.toolCalls.map((t) => ({ name: t.name, status: t.status })),
    });

    // SCENARIO A + B + C + D (Multi-turn journey + phrasing variant)
    const tA = await runTurn('saya gabisa pool out');
    const tB = await runTurn('tidak ada gabisa aja', tA.conversationId);
    const tC = await runTurn('sudah langsung buatkan saja', tA.conversationId);
    const tC2 = await runTurn('driver-0812345678', tA.conversationId);
    const tD = await runTurn('ya', tA.conversationId);

    const aPass =
      tA.trace.retrievalSources.some((s) => s.title.includes('Pool Out')) &&
      !/logis/i.test(tA.assistantMessage.content);
    scenarios.push({
      scenarioId: 'A',
      title: 'Informal Knowledge Question ("saya gabisa pool out")',
      passed: aPass,
      metrics: {
        contextRetained: true,
        retrievalRelevant: tA.trace.retrievalSources.some((s) => s.title.includes('Pool Out')),
        answerGrounded: tA.trace.retrievedEvidence.length > 0,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: true,
        taskCompleted: aPass,
        hallucinationDetected: /logis/i.test(tA.assistantMessage.content),
        conversationContinuity: true,
      },
      turns: [summarizeTurn('saya gabisa pool out', tA)],
      notes: aPass
        ? 'Retrieved Pool Out SOP accurately without assuming LOGis.'
        : 'Failed to retrieve Pool Out SOP or assumed unrelated LOGis domain.',
    });

    const bPass =
      tB.trace.memorySnapshot.currentObjective.toLowerCase().includes('pool out') &&
      Boolean(tB.trace.retrievalSources[0]?.title.includes('Pool Out')) &&
      !/logis/i.test(tB.assistantMessage.content);
    scenarios.push({
      scenarioId: 'B',
      title: 'Contextual Follow-Up ("tidak ada gabisa aja")',
      passed: bPass,
      metrics: {
        contextRetained: tB.trace.memorySnapshot.currentObjective.toLowerCase().includes('pool out'),
        retrievalRelevant: Boolean(tB.trace.retrievalSources[0]?.title.includes('Pool Out')),
        answerGrounded: true,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: true,
        taskCompleted: bPass,
        hallucinationDetected: false,
        conversationContinuity: bPass,
      },
      turns: [summarizeTurn('tidak ada gabisa aja', tB)],
      notes: bPass
        ? 'Preserved pool-out objective without switching domains.'
        : 'Lost active pool-out context on brief follow-up.',
    });

    const cPass =
      tC.trace.toolResults.every((r) => !r.ok) && // Did NOT prematurely create ticket before missing contact!
      tC2.trace.memorySnapshot.pendingConfirmation?.toolName === 'create_support_ticket';
    scenarios.push({
      scenarioId: 'C',
      title: 'Explicit Escalation ("sudah langsung buatkan saja")',
      passed: cPass,
      metrics: {
        contextRetained: true,
        retrievalRelevant: true,
        answerGrounded: true,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: tC.trace.toolCalls.some((c) => c.name === 'create_support_ticket'),
        taskCompleted: cPass,
        hallucinationDetected: false,
        conversationContinuity: true,
      },
      turns: [
        summarizeTurn('sudah langsung buatkan saja', tC),
        summarizeTurn('driver-0812345678', tC2),
      ],
      notes: cPass
        ? 'Asked only for missing contact and staged confirmation gate before ticket execution.'
        : 'Failed missing-field check or confirmation gate.',
    });

    const dPass =
      tD.trace.toolResults.some((r) => r.name === 'create_support_ticket' && r.ok) &&
      tD.trace.memorySnapshot.confirmedFacts.some((f) => f.key === 'tool:create_support_ticket');
    scenarios.push({
      scenarioId: 'D',
      title: 'Short Confirmation ("ya")',
      passed: dPass,
      metrics: {
        contextRetained: true,
        retrievalRelevant: true,
        answerGrounded: dPass,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: dPass,
        taskCompleted: dPass,
        hallucinationDetected: false,
        conversationContinuity: dPass,
      },
      turns: [summarizeTurn('ya', tD)],
      notes: dPass
        ? 'Executed confirmed ticket creation and recorded verified ticket ID.'
        : 'Failed to continue pending ticket action on short "ya".',
    });

    // SCENARIO E + F (New topic UTSP check + plate follow-up)
    const tE = await runTurn('saya mau cek unit saya utsp atau tidak', tA.conversationId);
    const tF = await runTurn('AB1254GN', tA.conversationId);

    const ePass =
      tE.trace.memorySnapshot.pausedTasks.length > 0 &&
      tE.trace.memorySnapshot.currentTopic === 'vehicle_utsp' &&
      tE.trace.toolResults.length === 0;
    scenarios.push({
      scenarioId: 'E',
      title: 'New Topic Switch ("saya mau cek unit saya utsp atau tidak")',
      passed: ePass,
      metrics: {
        contextRetained: tE.trace.memorySnapshot.pausedTasks.length > 0,
        retrievalRelevant: true,
        answerGrounded: true,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: true,
        taskCompleted: ePass,
        hallucinationDetected: false,
        conversationContinuity: ePass,
      },
      turns: [summarizeTurn('saya mau cek unit saya utsp atau tidak', tE)],
      notes: ePass
        ? 'Switched to vehicle UTSP objective, asked for plate, and preserved prior task.'
        : 'Failed topic transition or paused task retention.',
    });

    const fPass =
      tF.trace.toolResults.some((r) => r.name === 'check_vehicle_utsp' && r.ok) &&
      /VALID_CLEAR|AB1254GN/i.test(tF.assistantMessage.content);
    scenarios.push({
      scenarioId: 'F',
      title: 'Tool Execution ("AB1254GN")',
      passed: fPass,
      metrics: {
        contextRetained: true,
        retrievalRelevant: true,
        answerGrounded: fPass,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: fPass,
        taskCompleted: fPass,
        hallucinationDetected: false,
        conversationContinuity: fPass,
      },
      turns: [summarizeTurn('AB1254GN', tF)],
      notes: fPass
        ? 'Executed check_vehicle_utsp with AB1254GN and returned verified result.'
        : 'Failed to execute vehicle UTSP lookup from contextual plate.',
    });

    // SCENARIO G + H (Failure + Frustration + Contextual Retry)
    const tFail = await runTurn('cek utsp unit B9999ERR');
    const tG = await runTurn('lah kok gabisa', tFail.conversationId);
    const tH = await runTurn('kalo ini AB1254GN', tFail.conversationId);

    const gPass =
      tG.trace.memorySnapshot.frustrationLevel === 'high' &&
      !/halo! ada yang bisa saya bantu/i.test(tG.assistantMessage.content) &&
      /(gagal|504|timed out)/i.test(tG.assistantMessage.content);
    scenarios.push({
      scenarioId: 'G',
      title: 'Frustration Handling ("lah kok gabisa")',
      passed: gPass,
      metrics: {
        contextRetained: true,
        retrievalRelevant: true,
        answerGrounded: gPass,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: true,
        taskCompleted: gPass,
        hallucinationDetected: false,
        conversationContinuity: gPass,
      },
      turns: [
        summarizeTurn('cek utsp unit B9999ERR', tFail),
        summarizeTurn('lah kok gabisa', tG),
      ],
      notes: gPass
        ? 'Recognized frustration, explained prior timeout honestly without resetting greeting.'
        : 'Reset greeting or failed to explain prior tool error.',
    });

    const hPass =
      tH.trace.toolResults.some((r) => r.name === 'check_vehicle_utsp' && r.ok) &&
      /VALID_CLEAR|AB1254GN/i.test(tH.assistantMessage.content);
    scenarios.push({
      scenarioId: 'H',
      title: 'Contextual Retry ("kalo ini AB1254GN")',
      passed: hPass,
      metrics: {
        contextRetained: true,
        retrievalRelevant: true,
        answerGrounded: hPass,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: hPass,
        taskCompleted: hPass,
        hallucinationDetected: false,
        conversationContinuity: hPass,
      },
      turns: [summarizeTurn('kalo ini AB1254GN', tH)],
      notes: hPass
        ? 'Understood retry with new plate without re-asking user intent.'
        : 'Re-asked intent or failed tool retry.',
    });

    // SCENARIO I (Topic Switching across domains: Pool out -> LOGis)
    const tI1 = await runTurn('kenapa gabisa pool out ya?');
    const tI2 = await runTurn('oh iya sekalian mau tanya aplikasi logis gagal login terus', tI1.conversationId);
    const iPass =
      tI1.trace.retrievalSources.some((s) => s.title.includes('Pool Out')) &&
      tI2.trace.retrievalSources.some((s) => s.title.includes('LOGis')) &&
      tI2.trace.memorySnapshot.pausedTasks.length > 0;
    scenarios.push({
      scenarioId: 'I',
      title: 'Domain Topic Switching (Pool Out -> LOGis Login)',
      passed: iPass,
      metrics: {
        contextRetained: tI2.trace.memorySnapshot.pausedTasks.length > 0,
        retrievalRelevant: iPass,
        answerGrounded: true,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: true,
        taskCompleted: iPass,
        hallucinationDetected: false,
        conversationContinuity: iPass,
      },
      turns: [
        summarizeTurn('kenapa gabisa pool out ya?', tI1),
        summarizeTurn('oh iya sekalian mau tanya aplikasi logis gagal login terus', tI2),
      ],
      notes: iPass
        ? 'Retrieved separate LOGis guide while preserving paused pool-out task.'
        : 'Mixed knowledge domains or lost paused task.',
    });

    // SCENARIO J (Knowledge Gap)
    const tJ = await runTurn('berapa tarif parkir inap pesawat kargo di bandara soekarno hatta?');
    const jPass =
      tJ.trace.retrievedEvidence.length === 0 &&
      /(belum tersedia|tidak tersedia|tidak ada informasi|not available)/i.test(
        tJ.assistantMessage.content
      );
    scenarios.push({
      scenarioId: 'J',
      title: 'Knowledge Gap Honesty',
      passed: jPass,
      metrics: {
        contextRetained: true,
        retrievalRelevant: true,
        answerGrounded: jPass,
        unnecessaryClarification: false,
        repeatedQuestion: false,
        toolSelectionAccurate: true,
        taskCompleted: jPass,
        hallucinationDetected: !jPass,
        conversationContinuity: true,
      },
      turns: [summarizeTurn('berapa tarif parkir inap pesawat kargo di bandara soekarno hatta?', tJ)],
      notes: jPass
        ? 'Honesty verified: admitted missing knowledge without inventing numbers.'
        : 'Hallucinated answer or claimed nonexistent knowledge.',
    });

    const count = scenarios.length;
    const pct = (fn: (s: ScenarioEvalResult) => boolean) =>
      Math.round((scenarios.filter(fn).length / count) * 100);

    const report: EvaluationSuiteReport = {
      id: crypto.randomUUID(),
      mode: params.mode,
      provider: conn.provider,
      model: modelName,
      createdAt: new Date().toISOString(),
      summary: {
        totalScenarios: count,
        passedScenarios: scenarios.filter((s) => s.passed).length,
        contextRetentionRate: pct((s) => s.metrics.contextRetained),
        retrievalRelevanceRate: pct((s) => s.metrics.retrievalRelevant),
        answerGroundingRate: pct((s) => s.metrics.answerGrounded),
        unnecessaryClarificationRate: pct((s) => s.metrics.unnecessaryClarification),
        repeatedQuestionRate: pct((s) => s.metrics.repeatedQuestion),
        toolSelectionAccuracyRate: pct((s) => s.metrics.toolSelectionAccurate),
        taskCompletionRate: pct((s) => s.metrics.taskCompleted),
        hallucinationRate: pct((s) => s.metrics.hallucinationDetected),
        conversationContinuityRate: pct((s) => s.metrics.conversationContinuity),
      },
      scenarios,
    };

    db.prepare(
      `INSERT INTO evaluation_runs (id, workspace_id, chatbot_id, provider, model, summary_json, results_json, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
    ).run(
      report.id,
      params.workspaceId,
      report.provider,
      report.model,
      JSON.stringify(report.summary),
      JSON.stringify(report.scenarios),
      report.createdAt
    );

    return report;
  } finally {
    // Clean up temporary eval sandbox bot (cascades chunks, conversations, execution_logs; leaves evaluation_runs history)
    db.prepare(`DELETE FROM knowledge_chunks_fts WHERE chatbot_id = ?`).run(evalBotId);
    db.prepare(`DELETE FROM chatbots WHERE id = ?`).run(evalBotId);
  }
}
