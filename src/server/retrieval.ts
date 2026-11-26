import { getDb } from './db.ts';
import { calculateRrfScores } from '../shared/kresna-logic.ts';
import { generateProviderEmbeddings, type ProviderConnectionRecord } from './llm-gateway.ts';
import { searchQdrantPoints } from './qdrant-client.ts';

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

/**
 * Sanitizes natural user input into a safe FTS5 OR query across meaningful tokens
 * so slang, punctuation, or syntax characters never raise FTS5 parse errors.
 */
export function buildSafeFtsQuery(rawQuery: string): string {
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
    'have', 'has', 'had', 'not', 'but', 'you', 'your', 'our', 'can', 'how',
    'what', 'why', 'when', 'where', 'who', 'which', 'in', 'on', 'at', 'to',
    'of', 'is', 'or', 'an', 'as', 'by', 'if', 'be', 'do', 'does', 'did',
    'yang', 'dan', 'atau', 'untuk', 'dari', 'ini', 'itu', 'saya', 'aku',
    'kamu', 'anda', 'kita', 'kami', 'apa', 'kenapa', 'mengapa', 'bagaimana',
    'berapa', 'kapan', 'dimana', 'siapa', 'di', 'ke', 'ya', 'yg', 'dg',
    'ada', 'tidak', 'bisa', 'mau', 'akan', 'sudah', 'belum', 'terus',
    'kok', 'lah', 'kah', 'pun', 'nya', 'aja', 'saja', 'deh', 'dong', 'sih',
    'sekalian', 'tanya', 'tolong', 'mohon', 'bantu', 'jika', 'kalau', 'kalo',
  ]);
  const tokens = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stopWords.has(t))
    .slice(0, 12);

  if (tokens.length === 0) {
    const fallback = rawQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 1)
      .slice(0, 6);
    if (fallback.length === 0) return '';
    return fallback.map((t) => `"${t}"`).join(' OR ');
  }

  return tokens.map((t) => `"${t}"`).join(' OR ');
}

function formatCitationLabel(title: string, sourceType: string, meta: Record<string, unknown>): string {
  const parts = [title];
  if (typeof meta.sheetName === 'string' && meta.sheetName) {
    parts.push(`Sheet "${meta.sheetName}"`);
  }
  if (typeof meta.rowNumber === 'number') {
    parts.push(`Row ${meta.rowNumber}`);
  }
  if (typeof meta.pageNumber === 'number') {
    parts.push(`Page ${meta.pageNumber}`);
  }
  if (typeof meta.sourceUrl === 'string' && meta.sourceUrl) {
    parts.push(meta.sourceUrl);
  }
  if (parts.length === 1 && sourceType) {
    parts.push(sourceType.toUpperCase());
  }
  return parts.join(' · ');
}

export async function retrieveHybridKnowledge(params: {
  workspaceId: string;
  chatbotId: string;
  query: string;
  sourceIds?: string[];
  topK?: number;
}): Promise<HybridRetrievalResponse> {
  const db = getDb();
  const topK = params.topK ?? 6;
  const ftsQuery = buildSafeFtsQuery(params.query);

  type ChunkCandidate = {
    chunkId: string;
    knowledgeItemId: string;
    title: string;
    sourceType: string;
    content: string;
    metadata: Record<string, unknown>;
    vectorScore: number | null;
  };

  // 1. Lexical Search via SQLite FTS5
  const lexicalCandidates: Array<{ id: string; item: ChunkCandidate }> = [];
  if (ftsQuery) {
    try {
      const sourceFilterSql =
        params.sourceIds && params.sourceIds.length > 0
          ? ` AND f.knowledge_item_id IN (${params.sourceIds.map(() => '?').join(',')})`
          : '';
      const args: Array<string | number> = [
        ftsQuery,
        params.workspaceId,
        params.chatbotId,
        ...(params.sourceIds ?? []),
        12,
      ];
      const rows = db
        .prepare(
          `SELECT
            f.chunk_id,
            f.knowledge_item_id,
            f.title,
            ki.source_type,
            kc.content,
            kc.metadata_json,
            bm25(knowledge_chunks_fts) AS rank_score
          FROM knowledge_chunks_fts f
          JOIN knowledge_chunks kc ON kc.id = f.chunk_id
          JOIN knowledge_items ki ON ki.id = f.knowledge_item_id
          WHERE knowledge_chunks_fts MATCH ?
            AND f.workspace_id = ?
            AND f.chatbot_id = ?${sourceFilterSql}
          ORDER BY rank_score ASC
          LIMIT ?`
        )
        .all(...args) as Array<{
        chunk_id: string;
        knowledge_item_id: string;
        title: string;
        source_type: string;
        content: string;
        metadata_json: string;
      }>;

      for (const r of rows) {
        const meta = JSON.parse(r.metadata_json || '{}');
        lexicalCandidates.push({
          id: r.chunk_id,
          item: {
            chunkId: r.chunk_id,
            knowledgeItemId: r.knowledge_item_id,
            title: r.title,
            sourceType: r.source_type,
            content: r.content,
            metadata: meta,
            vectorScore: null,
          },
        });
      }
    } catch {
      // Fallback safely if FTS query cannot execute
    }
  }

  // 2. Semantic Vector Search via Ollama Embeddings + Qdrant
  const semanticCandidates: Array<{ id: string; item: ChunkCandidate }> = [];
  let vectorSearchUsed = false;
  let vectorNote: string | undefined;

  const hasVectorItems = db
    .prepare(
      `SELECT COUNT(*) AS count FROM knowledge_items WHERE workspace_id = ? AND chatbot_id = ? AND vector_indexed = 1`
    )
    .get(params.workspaceId, params.chatbotId) as { count: number };

  if (hasVectorItems.count > 0) {
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
      : undefined;

    const embedModel = (bot?.embedding_model_id || conn?.embedding_model || '').trim();
    if (conn && embedModel) {
      try {
        const embedRes = await generateProviderEmbeddings({
          connection: conn,
          embeddingModel: embedModel,
          texts: [params.query],
        });
        const hits = await searchQdrantPoints({
          vector: embedRes.vectors[0],
          workspaceId: params.workspaceId,
          chatbotId: params.chatbotId,
          sourceIds: params.sourceIds,
          limit: 12,
        });
        vectorSearchUsed = true;
        for (const h of hits) {
          semanticCandidates.push({
            id: h.chunkId,
            item: {
              chunkId: h.chunkId,
              knowledgeItemId: h.payload.knowledge_item_id,
              title: h.payload.title,
              sourceType: h.payload.source_type,
              content: h.payload.content,
              metadata: h.payload.metadata || {},
              vectorScore: h.score,
            },
          });
        }
      } catch (err: unknown) {
        vectorNote =
          err instanceof Error
            ? `Vector search unavailable (${err.message}); using SQLite FTS5.`
            : 'Vector search unavailable; using SQLite FTS5.';
      }
    }
  } else {
    vectorNote = 'Lexical FTS5 active (no Qdrant-indexed items on this chatbot yet).';
  }

  // 3. Reciprocal Rank Fusion (RRF)
  const merged = calculateRrfScores({
    lexical: lexicalCandidates,
    semantic: semanticCandidates,
  });

  // Preserve vectorScore if present in semantic list
  const semanticScoreMap = new Map<string, number>();
  for (const s of semanticCandidates) {
    if (typeof s.item.vectorScore === 'number') {
      semanticScoreMap.set(s.id, s.item.vectorScore);
    }
  }

  const evidence: RetrievedEvidenceChunk[] = merged.slice(0, topK).map((entry) => {
    const vectorScore = semanticScoreMap.get(entry.id) ?? entry.item.vectorScore;
    const method: RetrievedEvidenceChunk['retrievalMethod'] =
      entry.lexicalRank !== null && entry.semanticRank !== null
        ? 'hybrid'
        : entry.semanticRank !== null
          ? 'vector_qdrant'
          : 'lexical_fts5';

    return {
      chunkId: entry.id,
      knowledgeItemId: entry.item.knowledgeItemId,
      title: entry.item.title,
      sourceType: entry.item.sourceType,
      content: entry.item.content,
      citation: formatCitationLabel(entry.item.title, entry.item.sourceType, entry.item.metadata),
      metadata: entry.item.metadata,
      rrfScore: Number(entry.rrfScore.toFixed(6)),
      lexicalRank: entry.lexicalRank,
      semanticRank: entry.semanticRank,
      vectorScore: typeof vectorScore === 'number' ? Number(vectorScore.toFixed(4)) : null,
      retrievalMethod: method,
    };
  });

  return {
    query: params.query,
    evidence,
    diagnostics: {
      ftsHits: lexicalCandidates.length,
      vectorHits: semanticCandidates.length,
      vectorSearchUsed,
      vectorNote,
    },
  };
}
