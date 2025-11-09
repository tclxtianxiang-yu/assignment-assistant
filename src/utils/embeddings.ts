import type { Env } from '../types';
import OpenAI from 'openai';

/**
 * 使用OpenAI API生成文本嵌入（带重试）
 */
export async function generateEmbedding(
  text: string,
  env: Env,
  retries: number = 3
): Promise<number[]> {
  // OpenAI text-embedding-3-small 最大支持 8192 tokens
  // 粗略估计: 1 token ≈ 4 characters
  const MAX_CHARS = 8000 * 4; // 保守估计32000字符

  let processedText = text;
  if (text.length > MAX_CHARS) {
    console.warn(`Text too long (${text.length} chars), truncating to ${MAX_CHARS} chars`);
    processedText = text.substring(0, MAX_CHARS);
  }

  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: 30000, // 30秒超时
    maxRetries: 0, // 我们自己处理重试
  });

  let lastError: any;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Generating embedding (attempt ${attempt + 1}/${retries})...`);

      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: processedText,
        encoding_format: 'float',
      });

      return response.data[0].embedding;
    } catch (error: any) {
      lastError = error;
      console.error(`Embedding attempt ${attempt + 1} failed:`, error.message);

      // 如果是最后一次尝试，直接抛出错误
      if (attempt === retries - 1) {
        break;
      }

      // 等待后重试（指数退避）
      const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw new Error(`Failed to generate embedding after ${retries} attempts: ${lastError?.message || lastError}`);
}

/**
 * 批量生成嵌入（带重试机制）
 */
export async function generateEmbeddings(
  texts: string[],
  env: Env,
  batchSize: number = 10
): Promise<number[][]> {
  const embeddings: number[][] = [];

  // 分批处理以避免超时
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1}/${Math.ceil(texts.length / batchSize)}`);

    const batchResults = await Promise.all(
      batch.map(text => generateEmbedding(text, env))
    );

    embeddings.push(...batchResults);
  }

  return embeddings;
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
