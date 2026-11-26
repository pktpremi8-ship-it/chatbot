export interface QdrantHealthResult {
  reachable: boolean;
  url: string;
  collectionExists: boolean;
  pointsCount?: number;
  error?: string;
}

export interface QdrantPointPayload {
  workspace_id: string;
  chatbot_id: string;
  knowledge_item_id: string;
  chunk_id: string;
  title: string;
  source_type: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
}

export function getQdrantUrl(): string {
  return (process.env.QDRANT_URL || 'http://qdrant:6333').trim().replace(/\/+$/, '');
}

const DEFAULT_COLLECTION = 'kresna_chunks';

export async function checkQdrantHealth(collectionName = DEFAULT_COLLECTION): Promise<QdrantHealthResult> {
  const url = getQdrantUrl();
  try {
    const res = await fetch(`${url}/collections/${collectionName}`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404) {
      return { reachable: true, url, collectionExists: false, pointsCount: 0 };
    }
    if (!res.ok) {
      return {
        reachable: false,
        url,
        collectionExists: false,
        error: `Qdrant returned HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      result?: { points_count?: number };
    };
    return {
      reachable: true,
      url,
      collectionExists: true,
      pointsCount: data.result?.points_count ?? 0,
    };
  } catch (err: unknown) {
    return {
      reachable: false,
      url,
      collectionExists: false,
      error: `Qdrant unreachable at ${url} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

export async function ensureQdrantCollection(
  vectorSize: number,
  collectionName = DEFAULT_COLLECTION
): Promise<void> {
  const url = getQdrantUrl();
  const check = await fetch(`${url}/collections/${collectionName}`, {
    method: 'GET',
    signal: AbortSignal.timeout(4000),
  });
  if (check.ok) return;

  const createRes = await fetch(`${url}/collections/${collectionName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Failed to create Qdrant collection (${createRes.status}): ${text.slice(0, 180)}`);
  }
}

export async function upsertQdrantPoints(params: {
  points: Array<{
    id: string;
    vector: number[];
    payload: QdrantPointPayload;
  }>;
  collectionName?: string;
}): Promise<void> {
  if (params.points.length === 0) return;
  const collectionName = params.collectionName || DEFAULT_COLLECTION;
  const vectorSize = params.points[0].vector.length;
  await ensureQdrantCollection(vectorSize, collectionName);

  const url = getQdrantUrl();
  const res = await fetch(`${url}/collections/${collectionName}/points?wait=true`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points: params.points }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant upsert failed (${res.status}): ${text.slice(0, 180)}`);
  }
}

export async function searchQdrantPoints(params: {
  vector: number[];
  workspaceId: string;
  chatbotId: string;
  sourceIds?: string[];
  limit?: number;
  collectionName?: string;
}): Promise<Array<{ chunkId: string; score: number; payload: QdrantPointPayload }>> {
  const collectionName = params.collectionName || DEFAULT_COLLECTION;
  const url = getQdrantUrl();

  const mustFilters: Array<Record<string, unknown>> = [
    { key: 'workspace_id', match: { value: params.workspaceId } },
    { key: 'chatbot_id', match: { value: params.chatbotId } },
  ];
  if (params.sourceIds && params.sourceIds.length > 0) {
    mustFilters.push({
      key: 'knowledge_item_id',
      match: { any: params.sourceIds },
    });
  }

  const res = await fetch(`${url}/collections/${collectionName}/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector: params.vector,
      filter: { must: mustFilters },
      limit: params.limit ?? 10,
      with_payload: true,
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Qdrant search failed (${res.status})`);
  }

  const data = (await res.json()) as {
    result?: Array<{ id: string; score: number; payload: QdrantPointPayload }>;
  };

  return (data.result || []).map((hit) => ({
    chunkId: hit.payload?.chunk_id || String(hit.id),
    score: hit.score,
    payload: hit.payload,
  }));
}

export async function deleteQdrantPointsByItemId(
  knowledgeItemId: string,
  collectionName = DEFAULT_COLLECTION
): Promise<void> {
  const url = getQdrantUrl();
  try {
    await fetch(`${url}/collections/${collectionName}/points/delete?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: {
          must: [{ key: 'knowledge_item_id', match: { value: knowledgeItemId } }],
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Non-fatal if Qdrant is offline during local deletion
  }
}
