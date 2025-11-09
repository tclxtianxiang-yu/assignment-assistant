// 环境变量类型定义
export interface Env {
  R2_BUCKET: R2Bucket;
  VECTOR_INDEX: VectorizeIndex;
  OPENAI_API_KEY: string;
}

// 向量数据块元数据
export interface ChunkMetadata {
  doc_id: string;
  phase: string;
  day?: number;
  page: number;
  section: string;
  updated_at: number;
}

// 文本分片
export interface TextChunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

// 向量记录
export interface VectorRecord {
  id: string;
  values: number[];
  metadata: ChunkMetadata;
  namespace?: string;
}

// RAG 检索结果
export interface RetrievalResult {
  id: string;
  score: number;
  text: string;
  metadata: ChunkMetadata;
}

// 聊天消息
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// API 请求/响应
export interface ChatRequest {
  question: string;
  day?: number;
}

export interface ChatResponse {
  answer: string;
  sources: RetrievalResult[];
  timestamp: number;
}
