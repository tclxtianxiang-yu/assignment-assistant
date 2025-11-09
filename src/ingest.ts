import type { Env } from './types';
import { parsePdf } from './utils/pdf-parser';
import { chunkText } from './utils/chunker';
import { upsertVectors } from './utils/vectorize';

/**
 * 从R2导入PDF并索引到向量数据库
 */
export async function ingestDocuments(env: Env): Promise<{
  success: boolean;
  processed: number;
  chunks: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processedCount = 0;
  let totalChunks = 0;

  try {
    console.log('Starting document ingestion...');

    // 1. 列出R2中的所有PDF文件
    const list = await env.R2_BUCKET.list({ prefix: 'assignments/' });
    console.log(`Found ${list.objects.length} files in R2`);

    // 2. 处理每个PDF文件
    for (const obj of list.objects) {
      try {
        console.log(`\nProcessing: ${obj.key}`);

        // 跳过非PDF文件
        if (!obj.key.endsWith('.pdf')) {
          console.log(`Skipping non-PDF file: ${obj.key}`);
          continue;
        }

        // 从R2获取文件
        const pdfObject = await env.R2_BUCKET.get(obj.key);
        if (!pdfObject) {
          errors.push(`Failed to fetch ${obj.key} from R2`);
          continue;
        }

        // 读取PDF内容
        const arrayBuffer = await pdfObject.arrayBuffer();
        console.log(`File size: ${arrayBuffer.byteLength} bytes`);

        // 3. 解析PDF文本
        console.log('Parsing PDF...');
        const text = await parsePdf(arrayBuffer);
        console.log(`Extracted ${text.length} characters`);

        if (text.length < 100) {
          errors.push(`${obj.key}: Extracted text too short (${text.length} chars)`);
          continue;
        }

        // 4. 提取元数据
        const metadata = extractMetadata(obj.key);

        // 5. 分片
        console.log('Chunking text...');
        const chunks = chunkText(
          text,
          {
            size: 900,
            overlap: 120,
            withHeadings: true,
          },
          {
            doc_id: obj.key,
            phase: metadata.phase,
            day: metadata.day,
            section: metadata.section,
            updated_at: Date.now(),
          }
        );
        console.log(`Created ${chunks.length} chunks`);

        // 6. 生成嵌入并写入向量数据库
        console.log('Generating embeddings and upserting to Vectorize...');
        await upsertVectors(chunks, env);

        processedCount++;
        totalChunks += chunks.length;
        console.log(`✓ Successfully processed ${obj.key}`);
      } catch (error) {
        const errorMsg = `Error processing ${obj.key}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    console.log('\n=== Ingestion Complete ===');
    console.log(`Processed: ${processedCount} documents`);
    console.log(`Total chunks: ${totalChunks}`);
    console.log(`Errors: ${errors.length}`);

    return {
      success: errors.length === 0,
      processed: processedCount,
      chunks: totalChunks,
      errors,
    };
  } catch (error) {
    console.error('Fatal error during ingestion:', error);
    return {
      success: false,
      processed: processedCount,
      chunks: totalChunks,
      errors: [...errors, `Fatal error: ${error}`],
    };
  }
}

/**
 * 从文件路径提取元数据
 * 例如: assignments/2025-Q4/一阶段作业.pdf
 */
function extractMetadata(filePath: string): {
  phase: string;
  section: string;
  day?: number;
} {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1].replace('.pdf', '');

  // 提取阶段信息
  let phase = '未知阶段';
  let section = filename;
  let day: number | undefined;

  // 尝试从路径提取阶段
  if (parts.length > 1) {
    const pathPhase = parts[parts.length - 2];
    if (pathPhase.match(/\d+/)) {
      phase = pathPhase;
    }
  }

  // 尝试从文件名提取阶段
  const phaseMatch = filename.match(/([一二三四五六七八九十]+)阶段/);
  if (phaseMatch) {
    phase = phaseMatch[1] + '阶段';
  }

  // 尝试提取日期/周
  const dayMatch = filename.match(/第?(\d+)[天日周]/);
  if (dayMatch) {
    day = parseInt(dayMatch[1]);
  }

  // 提取章节名称
  section = filename
    .replace(/^\d+[-_]/, '')
    .replace(/[-_]/g, ' ')
    .trim();

  return { phase, section, day };
}
