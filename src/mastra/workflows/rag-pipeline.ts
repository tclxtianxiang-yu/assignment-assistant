import type { Env, RetrievalResult } from '../../types';
import { retrieveContext, formatContext, extractSources } from '../../utils/rag';
import { generateAnswer } from '../agents/assistant';

/**
 * RAG Pipeline工作流输入
 */
export interface RAGPipelineInput {
  question: string;
  day?: number;
  stream?: boolean;
}

/**
 * RAG Pipeline工作流输出
 */
export interface RAGPipelineOutput {
  answer: string | ReadableStream;
  sources: string[];
  retrievedDocs: RetrievalResult[];
  stream: boolean;
}

/**
 * RAG Pipeline - 检索增强生成工作流
 */
export async function runRAGPipeline(
  input: RAGPipelineInput,
  env: Env
): Promise<RAGPipelineOutput> {
  const { question, day, stream = false } = input;

  console.log('RAG Pipeline started');
  console.log('Question:', question);
  console.log('Day filter:', day);

  // Step 1: 检索相关文档
  console.log('Step 1: Retrieving context...');
  const filter = day ? { day } : undefined;

  const retrievedDocs = await retrieveContext(
    question,
    env,
    {
      topK: 6,
      similarityThreshold: 0.7,
    },
    filter
  );

  console.log(`Retrieved ${retrievedDocs.length} documents`);

  // 如果没有找到相关文档
  if (retrievedDocs.length === 0) {
    return {
      answer: '抱歉，在资料中未找到与您问题相关的内容。\n\n建议：\n- 尝试使用不同的关键词\n- 检查作业日期是否正确\n- 确保相关资料已上传到系统',
      sources: [],
      retrievedDocs: [],
      stream: false,
    };
  }

  // Step 2: 格式化上下文
  console.log('Step 2: Formatting context...');
  const context = formatContext(retrievedDocs);

  // Step 3: 生成答案
  console.log('Step 3: Generating answer...');
  const answer = await generateAnswer(question, context, env, { stream });

  // Step 4: 提取引用来源
  const sources = extractSources(retrievedDocs);

  console.log('RAG Pipeline completed');

  return {
    answer,
    sources,
    retrievedDocs,
    stream,
  };
}

/**
 * 简化的RAG调用（用于快速查询）
 */
export async function simpleRAG(
  question: string,
  env: Env
): Promise<string> {
  const result = await runRAGPipeline({ question }, env);

  if (typeof result.answer === 'string') {
    return result.answer + '\n\n' + result.sources.join('\n');
  }

  throw new Error('Stream response not supported in simpleRAG');
}
