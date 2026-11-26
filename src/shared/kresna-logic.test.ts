import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatbotSystemInstruction,
  calculateRrfScores,
  estimateTokenCostUsd,
  evaluatePublishReadiness,
  extractSuggestedFollowups,
  validateWizardStep,
} from './kresna-logic.ts';

test('estimateTokenCostUsd returns 0 for local Ollama inference and accurate cost for legacy Gemini', () => {
  const localCost = estimateTokenCostUsd('llama3.1:8b', 500_000, 250_000, 'ollama');
  assert.equal(localCost, 0);

  const cloudCost = estimateTokenCostUsd('gemini-4-hydrogen', 1_000_000, 1_000_000, 'gemini');
  assert.equal(cloudCost, 0.75);
});

test('calculateRrfScores merges lexical and semantic hits with consensus boost', () => {
  const fused = calculateRrfScores({
    lexical: [
      { id: 'c1', item: { title: 'Pool Out SOP' } },
      { id: 'c2', item: { title: 'LOGis Guide' } },
    ],
    semantic: [
      { id: 'c3', item: { title: 'UTSP Rules' } },
      { id: 'c1', item: { title: 'Pool Out SOP' } },
    ],
  });

  assert.equal(fused[0].id, 'c1');
  assert.equal(fused[0].lexicalRank, 1);
  assert.equal(fused[0].semanticRank, 2);
  assert.ok(fused[0].rrfScore > fused[1].rrfScore);
});

test('validateWizardStep enforces chatbot identity on step 1 and Ollama model selection on step 3', () => {
  const invalidStep1 = validateWizardStep(1, {
    name: 'A',
    purpose: 'short',
    preset: 'customer_support',
    language: 'Indonesian',
    style: 'Warm',
    modelConnectionId: '',
    modelId: '',
  });
  assert.equal(invalidStep1.valid, false);
  assert.equal(invalidStep1.errors.length, 2);

  const invalidStep3 = validateWizardStep(3, {
    name: 'KRESNA Support',
    purpose: 'Helps customers resolve fleet and billing questions.',
    preset: 'customer_support',
    language: 'Indonesian',
    style: 'Warm',
    modelConnectionId: 'conn-ollama',
    modelId: '',
  });
  assert.equal(invalidStep3.valid, false);

  const valid = validateWizardStep(3, {
    name: 'KRESNA Support',
    purpose: 'Helps customers resolve fleet and billing questions.',
    preset: 'customer_support',
    language: 'Indonesian',
    style: 'Warm',
    modelConnectionId: 'conn-ollama',
    modelId: 'llama3.1:8b',
  });
  assert.equal(valid.valid, true);
});

test('evaluatePublishReadiness requires identity, model selection, and playground verification', () => {
  const notReady = evaluatePublishReadiness({
    name: 'Aria',
    purpose: 'Customer support desk assistant',
    modelConnectionStatus: 'connected',
    modelId: 'llama3.1:8b',
    hasTestedConversation: false,
  });
  assert.equal(notReady.ready, false);

  const ready = evaluatePublishReadiness({
    name: 'Aria',
    purpose: 'Customer support desk assistant',
    modelConnectionStatus: 'connected',
    modelId: 'llama3.1:8b',
    hasTestedConversation: true,
  });
  assert.equal(ready.ready, true);
});

test('buildChatbotSystemInstruction embeds retrieved knowledge, citations, and anti-repetition rules', () => {
  const prompt = buildChatbotSystemInstruction({
    name: 'Aria',
    purpose: 'Assist customers with returns',
    preset: 'customer_support',
    language: 'Indonesian',
    style: 'Concise',
    knowledgeItems: [
      {
        title: 'Return Policy',
        sourceType: 'xlsx',
        citation: 'Return Policy · Sheet "FAQ" · Row 2',
        content: '30-day return window.',
      },
    ],
  });
  assert.match(prompt, /30-day return window/);
  assert.match(prompt, /Sheet "FAQ"/);
  assert.match(prompt, /Never ask for details the user already gave/i);
});

test('extractSuggestedFollowups derives intuitive quick-reply chips for diagnostic queries and preserves explicit ones', () => {
  // Explicit suggestions pass through cleanly
  const explicit = extractSuggestedFollowups({
    text: 'Halo kak, ada yang bisa dibantu?',
    explicitSuggestions: ['Cek Status Pengiriman', 'Tanya Tagihan'],
  });
  assert.deepEqual(explicit, ['Cek Status Pengiriman', 'Tanya Tagihan']);

  // UJP troubleshooting yields status options and ticket offer
  const ujpFollowups = extractSuggestedFollowups({
    text: 'Status Failed atau Pending pada UJP umumnya karena kendala SAP atau nama rekening bank. Apakah status Anda saat ini Failed atau Pending?',
  });
  assert.ok(ujpFollowups.length >= 2);
  assert.ok(ujpFollowups.includes('Statusnya Failed'));
  assert.ok(ujpFollowups.includes('Statusnya Pending / Waiting SAP'));

  // Ticket creation offer yields confirmation chips
  const ticketFollowups = extractSuggestedFollowups({
    text: 'Boleh saya bantu buatkan tiket support agar tim kami bisa cek langsung?',
  });
  assert.ok(ticketFollowups.includes('Boleh, bantu buatkan tiket'));

  // Plain factual Q&A without options yields no clutter
  const plainFactual = extractSuggestedFollowups({
    text: 'SO terbentuk otomatis setelah POD Unloading selesai diverifikasi dan shipment berstatus Done.',
  });
  assert.equal(plainFactual.length, 0);
});
