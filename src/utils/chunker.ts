import type { TextChunk, ChunkMetadata } from '../types';

export interface ChunkOptions {
  size: number;        // 每个分片的字符数
  overlap: number;     // 分片之间的重叠字符数
  withHeadings: boolean; // 是否尝试在标题处分割
}

/**
 * 将文本分割成重叠的块以用于向量嵌入
 */
export function chunkText(
  text: string,
  options: ChunkOptions,
  baseMetadata: Omit<ChunkMetadata, 'page'>
): TextChunk[] {
  const { size, overlap, withHeadings } = options;
  const chunks: TextChunk[] = [];

  // 按段落分割
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';
  let currentPage = 1;
  let chunkIndex = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i].trim();
    if (!paragraph) continue;

    // 检测页码标记
    const pageMatch = paragraph.match(/第\s*(\d+)\s*页|Page\s*(\d+)/i);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1] || pageMatch[2]);
      continue;
    }

    // 如果当前块加上新段落超过大小限制
    if (currentChunk.length + paragraph.length + 2 > size) {
      if (currentChunk.length > 0) {
        // 保存当前块
        chunks.push({
          id: `${baseMetadata.doc_id}-p${currentPage}-ck${String(chunkIndex).padStart(3, '0')}`,
          text: currentChunk.trim(),
          metadata: {
            ...baseMetadata,
            page: currentPage
          }
        });
        chunkIndex++;

        // 如果段落本身就超过size限制，需要强制分割
        if (paragraph.length > size) {
          // 按size分割超大段落
          for (let start = 0; start < paragraph.length; start += size - overlap) {
            const subChunk = paragraph.substring(start, start + size);
            chunks.push({
              id: `${baseMetadata.doc_id}-p${currentPage}-ck${String(chunkIndex).padStart(3, '0')}`,
              text: subChunk.trim(),
              metadata: {
                ...baseMetadata,
                page: currentPage
              }
            });
            chunkIndex++;
          }
          currentChunk = '';
        } else {
          // 保留重叠部分
          if (overlap > 0) {
            const words = currentChunk.split(/\s+/);
            const overlapWords = words.slice(-Math.ceil(overlap / 6)); // 假设平均每个词6个字符
            currentChunk = overlapWords.join(' ') + '\n\n' + paragraph;
          } else {
            currentChunk = paragraph;
          }
        }
      } else {
        // currentChunk为空但paragraph超大，直接强制分割
        if (paragraph.length > size) {
          for (let start = 0; start < paragraph.length; start += size - overlap) {
            const subChunk = paragraph.substring(start, start + size);
            chunks.push({
              id: `${baseMetadata.doc_id}-p${currentPage}-ck${String(chunkIndex).padStart(3, '0')}`,
              text: subChunk.trim(),
              metadata: {
                ...baseMetadata,
                page: currentPage
              }
            });
            chunkIndex++;
          }
          currentChunk = '';
        } else {
          currentChunk = paragraph;
        }
      }
    } else {
      // 添加到当前块
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  // 保存最后一个块
  if (currentChunk.length > 0) {
    chunks.push({
      id: `${baseMetadata.doc_id}-p${currentPage}-ck${String(chunkIndex).padStart(3, '0')}`,
      text: currentChunk.trim(),
      metadata: {
        ...baseMetadata,
        page: currentPage
      }
    });
  }

  return chunks;
}

/**
 * 生成唯一ID
 */
export function generateChunkId(docId: string, page: number, index: number): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${docId}-p${page}-${index}-${timestamp}-${random}`;
}
