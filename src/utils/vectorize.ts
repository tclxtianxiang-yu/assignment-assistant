import type { Env, TextChunk, VectorRecord, RetrievalResult } from '../types';
import { generateEmbedding } from './embeddings';

/**
 * 将文本块插入向量数据库（带重试和节流）
 * 改进版：每个小批次独立提交，避免一个失败导致全部回滚
 */
export async function upsertVectors(
  chunks: TextChunk[],
  env: Env
): Promise<{ success: number; failed: number; errors: string[] }> {
  const BATCH_SIZE = 10; // 每批10个，避免并发过高
  const BATCH_DELAY = 1000; // 每批之间延迟1秒

  console.log(`Generating embeddings for ${chunks.length} chunks...`);

  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(batchStart, batchEnd);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

    console.log(`Processing batch ${batchNum}/${totalBatches} (chunks ${batchStart + 1}-${batchEnd})...`);

    const vectors: VectorRecord[] = [];

    // 顺序处理每个chunk（避免并发问题）
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i];
      const globalIndex = batchStart + i;

      try {
        console.log(`  [${globalIndex + 1}/${chunks.length}] Generating embedding for chunk: ${chunk.id}`);

        const embedding = await generateEmbedding(chunk.text, env);

        vectors.push({
          id: chunk.id,
          values: embedding,
          metadata: {
            ...chunk.metadata,
            text: chunk.text, // 存储原文以便检索时返回
          } as any,
        });
      } catch (error: any) {
        console.error(`  ✗ Error processing chunk ${chunk.id}:`, error.message);
        console.warn(`  Skipping chunk ${chunk.id}`);
        failedCount++;
        errors.push(`${chunk.id}: ${error.message}`);
        // 继续处理下一个chunk，不中断整个流程
      }
    }

    // 批量插入到Vectorize（每批独立提交）
    if (vectors.length > 0) {
      try {
        console.log(`  Upserting ${vectors.length} vectors to Vectorize...`);
        await env.VECTOR_INDEX.upsert(vectors as any);
        successCount += vectors.length;
        console.log(`  ✓ Batch ${batchNum} completed: ${vectors.length} vectors upserted`);
      } catch (error: any) {
        console.error(`  ✗ Failed to upsert batch ${batchNum}:`, error.message);
        failedCount += vectors.length;
        errors.push(`Batch ${batchNum} upsert failed: ${error.message}`);
        // 不抛出错误，继续处理下一批
      }
    } else {
      console.warn(`  Batch ${batchNum} has no valid vectors to upsert`);
    }

    // 在批次之间延迟（最后一批不需要）
    if (batchEnd < chunks.length) {
      console.log(`  Waiting ${BATCH_DELAY}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }

  console.log(`\n✓ Vector upsert completed: ${successCount} succeeded, ${failedCount} failed`);

  return {
    success: successCount,
    failed: failedCount,
    errors,
  };
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
