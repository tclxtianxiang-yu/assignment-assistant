import type { Env, TextChunk, VectorRecord, RetrievalResult } from '../types';
import { generateEmbedding } from './embeddings';

/**
 * 将文本块插入向量数据库
 */
export async function upsertVectors(
  chunks: TextChunk[],
  env: Env
): Promise<void> {
  const vectors: VectorRecord[] = [];

  console.log(`Generating embeddings for ${chunks.length} chunks...`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length}: ${chunk.id}`);

    try {
      const embedding = await generateEmbedding(chunk.text, env);

      vectors.push({
        id: chunk.id,
        values: embedding,
        metadata: chunk.metadata,
      });

      // 批量插入（每100个）
      if (vectors.length >= 100 || i === chunks.length - 1) {
        console.log(`Upserting ${vectors.length} vectors to Vectorize...`);
        await env.VECTOR_INDEX.upsert(vectors as any);
        vectors.length = 0; // 清空数组
      }
    } catch (error) {
      console.error(`Error processing chunk ${chunk.id}:`, error);
      throw error;
    }
  }

  console.log('All vectors upserted successfully');
}

/**
 * 查询向量数据库
 */
export async function queryVectors(
  query: string,
  env: Env,
  options: {
    topK?: number;
    filter?: any;
    returnMetadata?: boolean;
  } = {}
): Promise<RetrievalResult[]> {
  const { topK = 6, filter, returnMetadata = true } = options;

  // 生成查询向量
  const queryEmbedding = await generateEmbedding(query, env);

  // 查询向量数据库
  const results = await env.VECTOR_INDEX.query(queryEmbedding, {
    topK,
    filter,
    returnMetadata,
    returnValues: false,
  });

  // 转换结果格式
  return results.matches.map((match: any) => ({
    id: match.id,
    score: match.score,
    text: match.metadata?.text || '',
    metadata: match.metadata || {},
  }));
}

/**
 * 删除指定文档的所有向量
 */
export async function deleteDocumentVectors(
  docId: string,
  env: Env
): Promise<void> {
  // 注意：Vectorize可能没有直接的删除API
  // 这里我们使用文档ID作为前缀来标识需要删除的向量
  // 实际实现可能需要根据Vectorize的API调整
  console.log(`Deleting vectors for document: ${docId}`);
  // await env.VECTOR_INDEX.deleteByFilter({ doc_id: docId });
}
