import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { closeDb, getDb } from './db.ts';
import {
  ingestManualKnowledgeRecord,
  ingestUploadedKnowledgeFile,
  parseCsvBuffer,
  parseHtmlText,
  parsePlainText,
  parseXlsxBuffer,
  removeKnowledgeItem,
} from './knowledge-pipeline.ts';
import { buildSafeFtsQuery, retrieveHybridKnowledge } from './retrieval.ts';

test('parseXlsxBuffer preserves sheet name, column headers, and row numbers', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('PoolOut_SOP');
  sheet.addRow(['Question', 'Answer', 'Category']);
  sheet.addRow([
    'Kenapa tidak bisa pool out?',
    'Pastikan status UTSP kendaraan valid dan tidak ada trip aktif.',
    'Operasional',
  ]);
  sheet.addRow([
    'Bagaimana cek UTSP unit?',
    'Sebutkan nomor plat kendaraan seperti AB1254GN untuk pemeriksaan langsung.',
    'UTSP',
  ]);

  const rawBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseXlsxBuffer(rawBuf, 'fleet-faq.xlsx', 'Fleet SOP');

  assert.equal(parsed.chunks.length, 2);
  assert.equal(parsed.chunks[0].metadata.sheetName, 'PoolOut_SOP');
  assert.equal(parsed.chunks[0].metadata.rowNumber, 2);
  assert.match(parsed.chunks[0].content, /Sheet "PoolOut_SOP" > Row 2/);
  assert.match(parsed.chunks[0].content, /Question: Kenapa tidak bisa pool out\?/);
  assert.match(parsed.chunks[1].content, /AB1254GN/);
});

test('parseCsvBuffer, parseHtmlText, and parsePlainText extract structured clean chunks', () => {
  const csv = 'Topic,Resolution\nRefund,Processed in 3-5 business days\nShipping,Track via order ID\n';
  const csvRes = parseCsvBuffer(Buffer.from(csv, 'utf8'), 'policy.csv', 'Store Policy');
  assert.equal(csvRes.chunks.length, 2);
  assert.match(csvRes.chunks[0].content, /Row 2/);
  assert.match(csvRes.chunks[0].content, /Refund/);

  const html = `
    <html>
      <head><title>Help Center</title><script>alert(1)</script></head>
      <body><main><h1>Password Reset</h1><p>Use the reset link from settings.</p></main></body>
    </html>
  `;
  const htmlRes = parseHtmlText(html, 'help.html', 'Help', 'html');
  assert.equal(htmlRes.extractedTitle, 'Help Center');
  assert.equal(htmlRes.chunks.length, 1);
  assert.doesNotMatch(htmlRes.chunks[0].content, /alert\(1\)/);
  assert.match(htmlRes.chunks[0].content, /Password Reset/);

  const txtRes = parsePlainText('Alpha section.\n\nBeta section.', 'notes.txt', 'Notes');
  assert.equal(txtRes.chunks.length, 1);
  assert.match(txtRes.chunks[0].content, /Alpha section/);
});

test('buildSafeFtsQuery sanitizes punctuation and slang safely', () => {
  const q = buildSafeFtsQuery('saya gabisa pool out!! (tolong cek: UTSP?)');
  assert.ok(q.includes('"gabisa"'));
  assert.ok(q.includes('"pool"'));
  assert.ok(q.includes('"utsp"'));
  assert.doesNotMatch(q, /[!?():]/);
});

test('full SQLite FTS5 knowledge ingestion, hybrid retrieval, and cleanup', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kresna-rag-test-'));
  const dbPath = path.join(tmpDir, 'rag.db');
  closeDb();
  const db = getDb(dbPath);

  const ws = db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as { id: string };
  const bot = db
    .prepare(`SELECT id FROM chatbots WHERE workspace_id = ? LIMIT 1`)
    .get(ws.id) as { id: string };

  let uploadedItemId: string | undefined;
  try {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('FAQ_Armada');
    sheet.addRow(['Question', 'Answer']);
    sheet.addRow([
      'Kendala gabisa pool out',
      'Periksa status UTSP kendaraan dan pastikan surat jalan sudah diterbitkan.',
    ]);
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const uploadRes = await ingestUploadedKnowledgeFile({
      workspaceId: ws.id,
      chatbotId: bot.id,
      fileName: 'armada-sop.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuf,
      title: 'Armada SOP Workbook',
    });
    uploadedItemId = String(uploadRes.item.id);
    assert.equal(uploadRes.indexing.ftsIndexed, true);
    assert.equal(uploadRes.indexing.chunkCount, 1);

    await ingestManualKnowledgeRecord({
      workspaceId: ws.id,
      chatbotId: bot.id,
      title: 'Panduan Login LOGis',
      sourceType: 'note',
      content: 'Jika aplikasi LOGis gagal login, lakukan clear cache terlebih dahulu.',
    });

    const retrieval = await retrieveHybridKnowledge({
      workspaceId: ws.id,
      chatbotId: bot.id,
      query: 'saya gabisa pool out',
      topK: 4,
    });

    assert.ok(retrieval.evidence.length >= 1);
    assert.equal(retrieval.evidence[0].title, 'Armada SOP Workbook');
    assert.match(retrieval.evidence[0].citation, /Sheet "FAQ_Armada" · Row 2/);
    assert.ok(retrieval.diagnostics.ftsHits >= 1);
  } finally {
    if (uploadedItemId) {
      await removeKnowledgeItem({ workspaceId: ws.id, itemId: uploadedItemId });
    }
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
