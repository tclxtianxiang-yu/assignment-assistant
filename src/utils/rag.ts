import type { Env, RetrievalResult } from '../types';
import { queryVectors } from './vectorize';
import { cosineSimilarity } from './embeddings';

/**
 * RAG检索配置
 */
export interface RAGConfig {
  topK: number;
  similarityThreshold: number;
  maxTokens: number;
  mmrLambda: number; // MMR多样性参数 (0-1)
}

const DEFAULT_CONFIG: RAGConfig = {
  topK: 6,
  similarityThreshold: 0.5, // 降低阈值以提高召回率
  maxTokens: 3000,
  mmrLambda: 0.5,
};

/**
 * 执行RAG检索
 */
export async function retrieveContext(
  query: string,
  env: Env,
  config: Partial<RAGConfig> = {},
  filter?: any
): Promise<RetrievalResult[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 1. 向量检索
  let results = await queryVectors(query, env, {
    topK: cfg.topK * 2, // 获取更多结果用于MMR过滤
    filter,
  });

  // 2. 过滤低相似度结果
  results = results.filter(r => r.score >= cfg.similarityThreshold);

  if (results.length === 0) {
    return [];
  }

  // 3. MMR去冗余（最大边际相关性）
  results = applyMMR(results, cfg.topK, cfg.mmrLambda);

  // 4. 压缩和去重
  results = compressResults(results, cfg.maxTokens);

  return results;
}

/**
 * 应用MMR算法进行多样性选择
 * Maximal Marginal Relevance - 在相关性和多样性之间取平衡
 */
function applyMMR(
  results: RetrievalResult[],
  topK: number,
  lambda: number
): RetrievalResult[] {
  if (results.length <= topK) {
    return results;
  }

  const selected: RetrievalResult[] = [];
  const remaining = [...results];

  // 1. 选择最相关的作为第一个
  const first = remaining.shift()!;
  selected.push(first);

  // 2. 迭代选择剩余的文档
  while (selected.length < topK && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIndex = 0;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];

      // 计算与已选文档的最大相似度
      let maxSimilarity = 0;
      for (const sel of selected) {
        // 使用分数作为相似度的代理
        const similarity = Math.min(candidate.score, sel.score);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }

      // MMR分数 = λ * 相关性 - (1-λ) * 相似度
      const mmrScore = lambda * candidate.score - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }

    selected.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }

  return selected;
}

/**
 * 压缩检索结果
 * 按文档聚合相邻块，控制总token数
 */
function compressResults(
  results: RetrievalResult[],
  maxTokens: number
): RetrievalResult[] {
  const compressed: RetrievalResult[] = [];
  let totalTokens = 0;

  // 按文档ID和页码分组
  const grouped = new Map<string, RetrievalResult[]>();
  for (const result of results) {
    const key = `${result.metadata.doc_id}-p${result.metadata.page}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(result);
  }

  // 合并每组的文本
  for (const [key, group] of grouped.entries()) {
    // 按分数排序
    group.sort((a, b) => b.score - a.score);

    // 合并文本
    const combinedText = group.map(r => r.text).join('\n\n');
    const estimatedTokens = Math.ceil(combinedText.length / 4); // 粗略估计

    if (totalTokens + estimatedTokens > maxTokens) {
      break;
    }

    compressed.push({
      id: group[0].id,
      score: group[0].score,
      text: combinedText,
      metadata: group[0].metadata,
    });

    totalTokens += estimatedTokens;
  }

  return compressed;
}

/**
 * 格式化检索结果为提示词上下文
 */
export function formatContext(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return '未找到相关资料。';
  }

  const contextParts: string[] = [];

  results.forEach((result, index) => {
    const { section, page, doc_id } = result.metadata;
    const source = `[#${index + 1}] ${section} (第${page}页, ${doc_id.split('/').pop()})`;

    contextParts.push(`${source}\n${result.text}`);
  });

  return contextParts.join('\n\n---\n\n');
}

/**
 * 提取引用来源
 */
export function extractSources(results: RetrievalResult[]): string[] {
  return results.map((result, index) => {
    const { section, page, doc_id } = result.metadata;
    return `[#${index + 1}] ${section} - 第${page}页 (${doc_id.split('/').pop()})`;
  });
}
