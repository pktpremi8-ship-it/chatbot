import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as cheerio from 'cheerio';
import { getDb } from './db.ts';
import { generateProviderEmbeddings, type ProviderConnectionRecord } from './llm-gateway.ts';
import { deleteQdrantPointsByItemId, upsertQdrantPoints } from './qdrant-client.ts';
import { assertSafeExternalUrl } from './ssrf.ts';

export interface ParsedChunkDraft {
  content: string;
  metadata: {
    title: string;
    sourceType: string;
    workbookName?: string;
    sheetName?: string;
    rowNumber?: number;
    headers?: string[];
    pageNumber?: number;
    sourceUrl?: string;
    sectionHeading?: string;
  };
  metadataText: string;
}

export function chunkProseText(
  text: string,
  maxChars = 750,
  overlapChars = 120
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const lastParagraph = normalized.lastIndexOf('\n\n', end);
      const lastSentence = normalized.lastIndexOf('. ', end);
      const lastSpace = normalized.lastIndexOf(' ', end);
      if (lastParagraph > start + maxChars * 0.45) {
        end = lastParagraph + 2;
      } else if (lastSentence > start + maxChars * 0.5) {
        end = lastSentence + 2;
      } else if (lastSpace > start + maxChars * 0.5) {
        end = lastSpace + 1;
      }
    }
    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

export function parseCsvRows(rawCsv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const text = rawCsv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        if (ch === '\r') i++;
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else if (ch !== '\r') {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function formatTableRowAsChunk(params: {
  title: string;
  sourceType: string;
  workbookName?: string;
  sheetName?: string;
  rowNumber: number;
  headers: string[];
  values: string[];
}): ParsedChunkDraft | null {
  const extraPairs: string[] = [];
  const allPairs: string[] = [];
  let questionText = '';
  let answerText = '';

  params.headers.forEach((header, idx) => {
    const val = (params.values[idx] ?? '').trim();
    if (!val) return;
    const cleanHeader = header.trim() || `Column ${idx + 1}`;
    const lower = cleanHeader.toLowerCase();
    allPairs.push(`${cleanHeader}: ${val}`);
    if (/^(question|pertanyaan|tanya|issue|problem|topic|masalah|faq)$/i.test(lower)) {
      questionText = questionText ? `${questionText} | ${val}` : val;
    } else if (/^(answer|jawaban|jawab|solution|solusi|resolution|langkah|steps|response)$/i.test(lower)) {
      answerText = answerText ? `${answerText}\n${val}` : val;
    } else {
      extraPairs.push(`${cleanHeader}: ${val}`);
    }
  });

  if (allPairs.length === 0) return null;

  const locationLabel = params.sheetName
    ? `${params.workbookName || params.title} > Sheet "${params.sheetName}" > Row ${params.rowNumber}`
    : `${params.workbookName || params.title} > Row ${params.rowNumber}`;

  const contentLines = [
    `[Source: ${locationLabel}]`,
    ...(questionText && answerText
      ? [`Question: ${questionText}`, `Answer: ${answerText}`, ...extraPairs]
      : allPairs),
  ];

  return {
    content: contentLines.join('\n'),
    metadata: {
      title: params.title,
      sourceType: params.sourceType,
      workbookName: params.workbookName,
      sheetName: params.sheetName,
      rowNumber: params.rowNumber,
      headers: params.headers,
    },
    metadataText: `${params.title} ${params.workbookName || ''} ${params.sheetName || ''} row ${params.rowNumber} ${params.headers.join(' ')}`.trim(),
  };
}

function cellValueToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).trim();
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'object') {
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((r) => r.text).join('').trim();
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
    }
    if ('result' in val && val.result !== undefined && val.result !== null) {
      return String(val.result).trim();
    }
  }
  return String(val).trim();
}

export async function parseXlsxBuffer(
  buffer: Buffer,
  fileName: string,
  title: string
): Promise<{ chunks: ParsedChunkDraft[]; fullPreviewText: string; summaryMeta: Record<string, unknown> }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const chunks: ParsedChunkDraft[] = [];
  const sheetNames: string[] = [];
  const previewLines: string[] = [];

  workbook.eachSheet((worksheet) => {
    sheetNames.push(worksheet.name);
    let headers: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      const rawValues = Array.isArray(row.values) ? row.values.slice(1) : [];
      const rowStrings = rawValues.map((v) => cellValueToString(v as ExcelJS.CellValue));
      const nonEmptyCount = rowStrings.filter((s) => s.length > 0).length;
      if (nonEmptyCount === 0) return;

      if (headers.length === 0) {
        headers = rowStrings.map((h, i) => h || `Column_${i + 1}`);
        return;
      }

      const draft = formatTableRowAsChunk({
        title,
        sourceType: 'xlsx',
        workbookName: fileName,
        sheetName: worksheet.name,
        rowNumber,
        headers,
        values: rowStrings,
      });
      if (draft) {
        chunks.push(draft);
        if (previewLines.length < 40) {
          previewLines.push(draft.content);
        }
      }
    });
  });

  return {
    chunks,
    fullPreviewText: previewLines.join('\n\n'),
    summaryMeta: {
      workbookName: fileName,
      sheetNames,
      rowRecords: chunks.length,
    },
  };
}

export function parseCsvBuffer(
  buffer: Buffer,
  fileName: string,
  title: string
): { chunks: ParsedChunkDraft[]; fullPreviewText: string; summaryMeta: Record<string, unknown> } {
  const rows = parseCsvRows(buffer.toString('utf8'));
  if (rows.length === 0) {
    return { chunks: [], fullPreviewText: '', summaryMeta: { fileName, rowRecords: 0 } };
  }

  const headers = rows[0].map((h, i) => h || `Column_${i + 1}`);
  const chunks: ParsedChunkDraft[] = [];

  for (let i = 1; i < rows.length; i++) {
    const draft = formatTableRowAsChunk({
      title,
      sourceType: 'csv',
      workbookName: fileName,
      rowNumber: i + 1,
      headers,
      values: rows[i],
    });
    if (draft) chunks.push(draft);
  }

  return {
    chunks,
    fullPreviewText: chunks
      .slice(0, 40)
      .map((c) => c.content)
      .join('\n\n'),
    summaryMeta: {
      fileName,
      headers,
      rowRecords: chunks.length,
    },
  };
}

export async function parsePdfBuffer(
  buffer: Buffer,
  fileName: string,
  title: string
): Promise<{ chunks: ParsedChunkDraft[]; fullPreviewText: string; summaryMeta: Record<string, unknown> }> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const chunks: ParsedChunkDraft[] = [];
    const pages = Array.isArray(result.pages) ? result.pages : [];

    if (pages.length > 0) {
      for (const page of pages) {
        const pageChunks = chunkProseText(page.text || '');
        for (const text of pageChunks) {
          chunks.push({
            content: `[Source: ${fileName} · Page ${page.num}]\n${text}`,
            metadata: {
              title,
              sourceType: 'pdf',
              pageNumber: page.num,
            },
            metadataText: `${title} ${fileName} page ${page.num}`,
          });
        }
      }
    } else if (result.text) {
      for (const text of chunkProseText(result.text)) {
        chunks.push({
          content: `[Source: ${fileName}]\n${text}`,
          metadata: { title, sourceType: 'pdf' },
          metadataText: `${title} ${fileName}`,
        });
      }
    }

    return {
      chunks,
      fullPreviewText: (result.text || '').slice(0, 12000),
      summaryMeta: {
        fileName,
        totalPages: result.total ?? pages.length,
      },
    };
  } finally {
    await parser.destroy();
  }
}

export async function parseDocxBuffer(
  buffer: Buffer,
  fileName: string,
  title: string
): Promise<{ chunks: ParsedChunkDraft[]; fullPreviewText: string; summaryMeta: Record<string, unknown> }> {
  const result = await mammoth.extractRawText({ buffer });
  const rawText = (result.value || '').trim();
  const chunks = chunkProseText(rawText).map((text, idx) => ({
    content: `[Source: ${fileName} · Section ${idx + 1}]\n${text}`,
    metadata: {
      title,
      sourceType: 'docx',
      sectionHeading: `Section ${idx + 1}`,
    },
    metadataText: `${title} ${fileName} section ${idx + 1}`,
  }));

  return {
    chunks,
    fullPreviewText: rawText.slice(0, 12000),
    summaryMeta: {
      fileName,
      warnings: result.messages?.length ?? 0,
    },
  };
}

export function parseHtmlText(
  rawHtml: string,
  sourceLabel: string,
  title: string,
  sourceType: 'html' | 'website',
  sourceUrl?: string
): {
  extractedTitle: string;
  chunks: ParsedChunkDraft[];
  fullPreviewText: string;
  summaryMeta: Record<string, unknown>;
} {
  const $ = cheerio.load(rawHtml);
  $('script, style, noscript, iframe, svg').remove();
  const pageTitle = $('title').text().trim() || title;

  // Prefer main/article content if present, falling back to body
  const mainEl = $('main').length ? $('main') : $('article').length ? $('article') : $('body');
  const lines: string[] = [];
  mainEl.find('h1, h2, h3, h4, p, li, td, th').each((_, el) => {
    const tag = el.tagName?.toLowerCase() || '';
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    if (!txt) return;
    if (tag.startsWith('h')) {
      lines.push(`\n## ${txt}`);
    } else {
      lines.push(txt);
    }
  });

  const cleanText = (lines.length > 0 ? lines.join('\n') : mainEl.text())
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const chunks = chunkProseText(cleanText).map((text, idx) => ({
    content: `[Source: ${pageTitle}${sourceUrl ? ` (${sourceUrl})` : ''} · Part ${idx + 1}]\n${text}`,
    metadata: {
      title: pageTitle,
      sourceType,
      sourceUrl,
      sectionHeading: `Part ${idx + 1}`,
    },
    metadataText: `${pageTitle} ${sourceLabel} ${sourceUrl || ''}`.trim(),
  }));

  return {
    extractedTitle: pageTitle,
    chunks,
    fullPreviewText: cleanText.slice(0, 12000),
    summaryMeta: {
      sourceLabel,
      sourceUrl,
      pageTitle,
    },
  };
}

export function parsePlainText(
  rawText: string,
  fileName: string,
  title: string,
  sourceType = 'txt'
): { chunks: ParsedChunkDraft[]; fullPreviewText: string; summaryMeta: Record<string, unknown> } {
  const clean = rawText.trim();
  const chunks = chunkProseText(clean).map((text, idx) => ({
    content: `[Source: ${fileName || title} · Part ${idx + 1}]\n${text}`,
    metadata: {
      title,
      sourceType,
      sectionHeading: `Part ${idx + 1}`,
    },
    metadataText: `${title} ${fileName}`.trim(),
  }));

  return {
    chunks,
    fullPreviewText: clean.slice(0, 12000),
    summaryMeta: { fileName },
  };
}

async function indexChunksToStorageAndVectors(params: {
  workspaceId: string;
  chatbotId: string;
  knowledgeItemId: string;
  title: string;
  sourceType: string;
  chunks: ParsedChunkDraft[];
}): Promise<{
  chunkCount: number;
  ftsIndexed: boolean;
  vectorIndexed: boolean;
  vectorNote?: string;
}> {
  const db = getDb();
  const now = new Date().toISOString();

  // Clear any prior chunks for reindexing
  db.prepare(`DELETE FROM knowledge_chunks_fts WHERE knowledge_item_id = ?`).run(
    params.knowledgeItemId
  );
  db.prepare(`DELETE FROM knowledge_chunks WHERE knowledge_item_id = ?`).run(
    params.knowledgeItemId
  );
  await deleteQdrantPointsByItemId(params.knowledgeItemId);

  const insertedChunks: Array<{ id: string; index: number; draft: ParsedChunkDraft }> = [];

  for (let i = 0; i < params.chunks.length; i++) {
    const draft = params.chunks[i];
    const chunkId = crypto.randomUUID();
    const metadataJson = JSON.stringify(draft.metadata);
    const tokenEstimate = Math.ceil(draft.content.length / 4);

    db.prepare(
      `INSERT INTO knowledge_chunks
        (id, workspace_id, chatbot_id, knowledge_item_id, chunk_index, content, metadata_json, token_estimate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      chunkId,
      params.workspaceId,
      params.chatbotId,
      params.knowledgeItemId,
      i,
      draft.content,
      metadataJson,
      tokenEstimate,
      now
    );

    db.prepare(
      `INSERT INTO knowledge_chunks_fts
        (chunk_id, workspace_id, chatbot_id, knowledge_item_id, title, content, metadata_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      chunkId,
      params.workspaceId,
      params.chatbotId,
      params.knowledgeItemId,
      params.title,
      draft.content,
      draft.metadataText
    );

    insertedChunks.push({ id: chunkId, index: i, draft });
  }

  let vectorIndexed = false;
  let vectorNote: string | undefined;

  // Look up chatbot embedding config or workspace Ollama connection
  const bot = db
    .prepare(
      `SELECT embedding_connection_id, embedding_model_id, model_connection_id
       FROM chatbots WHERE id = ? AND workspace_id = ?`
    )
    .get(params.chatbotId, params.workspaceId) as
    | {
        embedding_connection_id: string | null;
        embedding_model_id: string;
        model_connection_id: string | null;
      }
    | undefined;

  const connId = bot?.embedding_connection_id || bot?.model_connection_id;
  const conn = connId
    ? (db
        .prepare(
          `SELECT id, provider, auth_mode, encrypted_api_key, endpoint, default_model, embedding_model
           FROM model_connections WHERE id = ? AND workspace_id = ?`
        )
        .get(connId, params.workspaceId) as ProviderConnectionRecord | undefined)
    : (db
        .prepare(
          `SELECT id, provider, auth_mode, encrypted_api_key, endpoint, default_model, embedding_model
           FROM model_connections WHERE workspace_id = ? AND provider = 'ollama' ORDER BY created_at ASC LIMIT 1`
        )
        .get(params.workspaceId) as ProviderConnectionRecord | undefined);

  const embedModel = (bot?.embedding_model_id || conn?.embedding_model || '').trim();

  if (insertedChunks.length > 0 && conn && embedModel) {
    try {
      const BATCH_SIZE = 16;
      for (let i = 0; i < insertedChunks.length; i += BATCH_SIZE) {
        const batch = insertedChunks.slice(i, i + BATCH_SIZE);
        const embedRes = await generateProviderEmbeddings({
          connection: conn,
          embeddingModel: embedModel,
          texts: batch.map((b) => b.draft.content),
        });
        await upsertQdrantPoints({
          points: batch.map((b, idx) => ({
            id: b.id,
            vector: embedRes.vectors[idx],
            payload: {
              workspace_id: params.workspaceId,
              chatbot_id: params.chatbotId,
              knowledge_item_id: params.knowledgeItemId,
              chunk_id: b.id,
              title: params.title,
              source_type: params.sourceType,
              chunk_index: b.index,
              content: b.draft.content,
              metadata: b.draft.metadata,
            },
          })),
        });
      }
      vectorIndexed = true;
    } catch (err: unknown) {
      vectorIndexed = false;
      vectorNote =
        err instanceof Error
          ? `Lexical FTS5 indexed; vector indexing skipped (${err.message})`
          : 'Lexical FTS5 indexed; vector indexing skipped.';
    }
  } else if (insertedChunks.length > 0) {
    vectorNote = 'Lexical FTS5 indexed; configure an Ollama embedding model in AI Models to enable Qdrant vector search.';
  }

  db.prepare(
    `UPDATE knowledge_items
     SET status = 'indexed', chunk_count = ?, fts_indexed = 1, vector_indexed = ?, error_message = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    insertedChunks.length,
    vectorIndexed ? 1 : 0,
    vectorNote || null,
    now,
    params.knowledgeItemId
  );

  return {
    chunkCount: insertedChunks.length,
    ftsIndexed: true,
    vectorIndexed,
    vectorNote,
  };
}

export async function ingestUploadedKnowledgeFile(params: {
  workspaceId: string;
  chatbotId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  title?: string;
}): Promise<{
  item: Record<string, unknown>;
  indexing: { chunkCount: number; ftsIndexed: boolean; vectorIndexed: boolean; vectorNote?: string };
}> {
  const db = getDb();
  const ext = path.extname(params.fileName).toLowerCase();
  const baseTitle = params.title?.trim() || path.basename(params.fileName, ext) || params.fileName;
  const itemId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Save persistent file inside data/uploads/<workspaceId>/
  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads', params.workspaceId);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const safeFileName = path.basename(params.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedPath = path.resolve(uploadsDir, `${itemId}-${safeFileName}`);
  if (!storedPath.startsWith(uploadsDir + path.sep)) {
    throw new Error('Invalid upload filename.');
  }
  fs.writeFileSync(storedPath, params.buffer);

  let sourceType = 'txt';
  let parsed: {
    chunks: ParsedChunkDraft[];
    fullPreviewText: string;
    summaryMeta: Record<string, unknown>;
  };

  try {
    if (ext === '.xlsx') {
      sourceType = 'xlsx';
      parsed = await parseXlsxBuffer(params.buffer, params.fileName, baseTitle);
    } else if (ext === '.csv') {
      sourceType = 'csv';
      parsed = parseCsvBuffer(params.buffer, params.fileName, baseTitle);
    } else if (ext === '.pdf') {
      sourceType = 'pdf';
      parsed = await parsePdfBuffer(params.buffer, params.fileName, baseTitle);
    } else if (ext === '.docx') {
      sourceType = 'docx';
      parsed = await parseDocxBuffer(params.buffer, params.fileName, baseTitle);
    } else if (ext === '.html' || ext === '.htm') {
      sourceType = 'html';
      parsed = parseHtmlText(
        params.buffer.toString('utf8'),
        params.fileName,
        baseTitle,
        'html'
      );
    } else if (ext === '.txt' || ext === '.md') {
      sourceType = 'txt';
      parsed = parsePlainText(params.buffer.toString('utf8'), params.fileName, baseTitle, 'txt');
    } else {
      throw new Error(
        `Unsupported file format "${ext || params.mimeType}". Supported formats: XLSX, CSV, PDF, DOCX, TXT, MD, HTML.`
      );
    }
  } catch (err: unknown) {
    fs.rmSync(storedPath, { force: true });
    throw err;
  }

  if (parsed.chunks.length === 0) {
    fs.rmSync(storedPath, { force: true });
    throw new Error(`No readable text or rows were extracted from "${params.fileName}".`);
  }

  db.prepare(
    `INSERT INTO knowledge_items
      (id, workspace_id, chatbot_id, title, source_type, content, file_name, mime_type, status, chunk_count, metadata_json, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0, ?, ?, ?, ?)`
  ).run(
    itemId,
    params.workspaceId,
    params.chatbotId,
    baseTitle,
    sourceType,
    parsed.fullPreviewText,
    params.fileName,
    params.mimeType,
    JSON.stringify(parsed.summaryMeta),
    storedPath,
    now,
    now
  );

  const indexing = await indexChunksToStorageAndVectors({
    workspaceId: params.workspaceId,
    chatbotId: params.chatbotId,
    knowledgeItemId: itemId,
    title: baseTitle,
    sourceType,
    chunks: parsed.chunks,
  });

  const item = db.prepare(`SELECT * FROM knowledge_items WHERE id = ?`).get(itemId) as Record<
    string,
    unknown
  >;
  return { item, indexing };
}

export async function ingestWebsiteUrl(params: {
  workspaceId: string;
  chatbotId: string;
  url: string;
  title?: string;
}): Promise<{
  item: Record<string, unknown>;
  indexing: { chunkCount: number; ftsIndexed: boolean; vectorIndexed: boolean; vectorNote?: string };
}> {
  const safeUrl = await assertSafeExternalUrl(params.url);

  const res = await fetch(safeUrl.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'KRESNA-KnowledgeIngest/1.0',
      Accept: 'text/html,application/xhtml+xml,text/plain',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Website returned HTTP ${res.status} while fetching ${safeUrl.toString()}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const bodyText = await res.text();
  if (!bodyText.trim()) {
    throw new Error('Fetched webpage contained no readable text.');
  }

  const parsed =
    contentType.includes('text/plain')
      ? {
          extractedTitle: params.title?.trim() || safeUrl.hostname,
          ...parsePlainText(bodyText, safeUrl.hostname, params.title?.trim() || safeUrl.hostname, 'website'),
        }
      : parseHtmlText(
          bodyText,
          safeUrl.hostname,
          params.title?.trim() || safeUrl.hostname,
          'website',
          safeUrl.toString()
        );

  if (parsed.chunks.length === 0) {
    throw new Error('No readable sections were extracted from the webpage.');
  }

  const db = getDb();
  const itemId = crypto.randomUUID();
  const now = new Date().toISOString();
  const finalTitle = params.title?.trim() || parsed.extractedTitle || safeUrl.hostname;

  db.prepare(
    `INSERT INTO knowledge_items
      (id, workspace_id, chatbot_id, title, source_type, content, source_url, status, chunk_count, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'website', ?, ?, 'processing', 0, ?, ?, ?)`
  ).run(
    itemId,
    params.workspaceId,
    params.chatbotId,
    finalTitle,
    parsed.fullPreviewText,
    safeUrl.toString(),
    JSON.stringify(parsed.summaryMeta),
    now,
    now
  );

  const indexing = await indexChunksToStorageAndVectors({
    workspaceId: params.workspaceId,
    chatbotId: params.chatbotId,
    knowledgeItemId: itemId,
    title: finalTitle,
    sourceType: 'website',
    chunks: parsed.chunks,
  });

  const item = db.prepare(`SELECT * FROM knowledge_items WHERE id = ?`).get(itemId) as Record<
    string,
    unknown
  >;
  return { item, indexing };
}

export async function ingestManualKnowledgeRecord(params: {
  workspaceId: string;
  chatbotId: string;
  title: string;
  sourceType: 'faq' | 'note';
  content: string;
}): Promise<{
  item: Record<string, unknown>;
  indexing: { chunkCount: number; ftsIndexed: boolean; vectorIndexed: boolean; vectorNote?: string };
}> {
  const db = getDb();
  const itemId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO knowledge_items
      (id, workspace_id, chatbot_id, title, source_type, content, status, chunk_count, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'processing', 0, ?, ?, ?)`
  ).run(
    itemId,
    params.workspaceId,
    params.chatbotId,
    params.title.trim(),
    params.sourceType,
    params.content.trim(),
    JSON.stringify({ title: params.title.trim(), sourceType: params.sourceType }),
    now,
    now
  );

  const chunks = chunkProseText(params.content.trim()).map((text, idx) => ({
    content: `[Source: ${params.title.trim()} (${params.sourceType.toUpperCase()})]\n${text}`,
    metadata: {
      title: params.title.trim(),
      sourceType: params.sourceType,
      sectionHeading: idx > 0 ? `Part ${idx + 1}` : undefined,
    },
    metadataText: `${params.title.trim()} ${params.sourceType}`,
  }));

  const indexing = await indexChunksToStorageAndVectors({
    workspaceId: params.workspaceId,
    chatbotId: params.chatbotId,
    knowledgeItemId: itemId,
    title: params.title.trim(),
    sourceType: params.sourceType,
    chunks,
  });

  const item = db.prepare(`SELECT * FROM knowledge_items WHERE id = ?`).get(itemId) as Record<
    string,
    unknown
  >;
  return { item, indexing };
}

export async function reindexKnowledgeItem(params: {
  workspaceId: string;
  itemId: string;
}): Promise<{ chunkCount: number; ftsIndexed: boolean; vectorIndexed: boolean; vectorNote?: string }> {
  const db = getDb();
  const item = db
    .prepare(`SELECT * FROM knowledge_items WHERE id = ? AND workspace_id = ?`)
    .get(params.itemId, params.workspaceId) as
    | {
        id: string;
        workspace_id: string;
        chatbot_id: string;
        title: string;
        source_type: string;
        content: string;
        file_name: string | null;
        file_path: string | null;
        source_url: string | null;
      }
    | undefined;

  if (!item) {
    throw new Error('Knowledge item not found.');
  }

  let drafts: ParsedChunkDraft[] = [];
  if (item.file_path && fs.existsSync(item.file_path)) {
    const buffer = fs.readFileSync(item.file_path);
    if (item.source_type === 'xlsx') {
      drafts = (await parseXlsxBuffer(buffer, item.file_name || item.title, item.title)).chunks;
    } else if (item.source_type === 'csv') {
      drafts = parseCsvBuffer(buffer, item.file_name || item.title, item.title).chunks;
    } else if (item.source_type === 'pdf') {
      drafts = (await parsePdfBuffer(buffer, item.file_name || item.title, item.title)).chunks;
    } else if (item.source_type === 'docx') {
      drafts = (await parseDocxBuffer(buffer, item.file_name || item.title, item.title)).chunks;
    }
  }

  if (drafts.length === 0) {
    const existingChunks = db
      .prepare(
        `SELECT content, metadata_json FROM knowledge_chunks WHERE knowledge_item_id = ? ORDER BY chunk_index ASC`
      )
      .all(item.id) as Array<{ content: string; metadata_json: string }>;

    if (existingChunks.length > 0) {
      drafts = existingChunks.map((c) => {
        const meta = JSON.parse(c.metadata_json || '{}');
        return {
          content: c.content,
          metadata: meta,
          metadataText: `${item.title} ${meta.sheetName || ''} ${item.source_type}`.trim(),
        };
      });
    } else {
      drafts = chunkProseText(item.content).map((text) => ({
        content: text,
        metadata: { title: item.title, sourceType: item.source_type },
        metadataText: `${item.title} ${item.source_type}`,
      }));
    }
  }

  return indexChunksToStorageAndVectors({
    workspaceId: item.workspace_id,
    chatbotId: item.chatbot_id,
    knowledgeItemId: item.id,
    title: item.title,
    sourceType: item.source_type,
    chunks: drafts,
  });
}

export async function removeKnowledgeItem(params: {
  workspaceId: string;
  itemId: string;
}): Promise<boolean> {
  const db = getDb();
  const item = db
    .prepare(`SELECT id, file_path FROM knowledge_items WHERE id = ? AND workspace_id = ?`)
    .get(params.itemId, params.workspaceId) as { id: string; file_path: string | null } | undefined;

  if (!item) return false;

  db.prepare(`DELETE FROM knowledge_chunks_fts WHERE knowledge_item_id = ?`).run(item.id);
  await deleteQdrantPointsByItemId(item.id);
  const res = db
    .prepare(`DELETE FROM knowledge_items WHERE id = ? AND workspace_id = ?`)
    .run(item.id, params.workspaceId);

  if (item.file_path && fs.existsSync(item.file_path)) {
    fs.rmSync(item.file_path, { force: true });
  }
  return res.changes > 0;
}
