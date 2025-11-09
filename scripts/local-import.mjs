#!/usr/bin/env node

/**
 * 本地导入脚本 - 绕过 Workers CPU 限制
 *
 * 运行方式：
 * 1. 将 PDF 文件放到 ./pdfs/ 目录
 * 2. npm install
 * 3. node scripts/local-import.mjs
 *
 * 优势：
 * - 没有 10ms CPU 时间限制
 * - 本地网络更稳定
 * - 可以批量处理和缓存
 * - 进度可视化
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ==================== 配置 ====================

const CONFIG = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  WRANGLER_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  VECTORIZE_INDEX: 'homework-index',

  // 目录配置
  PDF_DIR: join(ROOT_DIR, 'pdfs'),
  CACHE_DIR: join(ROOT_DIR, '.cache'),

  // 分块配置
  CHUNK_SIZE: 900,
  CHUNK_OVERLAP: 120,

  // 并发配置
  BATCH_SIZE: 10,      // 每批处理的 chunks
  CONCURRENT: 3,       // 并发请求数
  RETRY_TIMES: 5,      // 重试次数
};

// ==================== 工具函数 ====================

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logSuccess(msg) { log(`✓ ${msg}`, 'green'); }
function logError(msg) { log(`✗ ${msg}`, 'red'); }
function logWarning(msg) { log(`⚠ ${msg}`, 'yellow'); }
function logInfo(msg) { log(`ℹ ${msg}`, 'blue'); }

// 进度条
function showProgress(current, total, prefix = '') {
  const percentage = Math.floor((current / total) * 100);
  const filled = Math.floor(percentage / 2);
  const empty = 50 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  process.stdout.write(`\r${prefix}[${bar}] ${percentage}% (${current}/${total})`);
  if (current === total) console.log('');
}

// ==================== PDF 解析 ====================

async function parsePDF(filePath) {
  logInfo(`解析 PDF: ${filePath}`);
  const dataBuffer = readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

// ==================== 文本分块 ====================

function chunkText(text, metadata = {}) {
  const { CHUNK_SIZE, CHUNK_OVERLAP } = CONFIG;
  const chunks = [];

  // 按段落分割
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  let currentChunk = '';
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    // 如果段落本身太长，强制分割
    if (paragraph.length > CHUNK_SIZE) {
      if (currentChunk) {
        chunks.push({
          id: `${metadata.doc_id}-ck${String(chunkIndex).padStart(3, '0')}`,
          text: currentChunk.trim(),
          metadata: { ...metadata, chunk_index: chunkIndex },
        });
        chunkIndex++;
        currentChunk = '';
      }

      // 分割长段落
      for (let i = 0; i < paragraph.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        const subChunk = paragraph.substring(i, i + CHUNK_SIZE);
        chunks.push({
          id: `${metadata.doc_id}-ck${String(chunkIndex).padStart(3, '0')}`,
          text: subChunk.trim(),
          metadata: { ...metadata, chunk_index: chunkIndex },
        });
        chunkIndex++;
      }
      continue;
    }

    // 检查是否超过大小限制
    if (currentChunk.length + paragraph.length + 2 > CHUNK_SIZE) {
      if (currentChunk) {
        chunks.push({
          id: `${metadata.doc_id}-ck${String(chunkIndex).padStart(3, '0')}`,
          text: currentChunk.trim(),
          metadata: { ...metadata, chunk_index: chunkIndex },
        });
        chunkIndex++;
      }

      // 保留部分重叠
      const overlapText = currentChunk.slice(-CHUNK_OVERLAP);
      currentChunk = overlapText + '\n\n' + paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  // 添加最后一个 chunk
  if (currentChunk.trim()) {
    chunks.push({
      id: `${metadata.doc_id}-ck${String(chunkIndex).padStart(3, '0')}`,
      text: currentChunk.trim(),
      metadata: { ...metadata, chunk_index: chunkIndex },
    });
  }

  return chunks;
}

// ==================== Embedding 生成 ====================

async function generateEmbedding(text, openai, retries = CONFIG.RETRY_TIMES) {
  const MAX_CHARS = 8000 * 4;
  const processedText = text.length > MAX_CHARS ? text.substring(0, MAX_CHARS) : text;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: processedText,
      });
      return response.data[0].embedding;
    } catch (error) {
      if (attempt < retries - 1) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        logWarning(`Embedding 失败，${waitTime}ms 后重试 (${attempt + 1}/${retries}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

async function generateEmbeddingsBatch(chunks, openai) {
  logInfo(`生成 ${chunks.length} 个 embeddings...`);

  const results = [];
  const { CONCURRENT } = CONFIG;

  for (let i = 0; i < chunks.length; i += CONCURRENT) {
    const batch = chunks.slice(i, Math.min(i + CONCURRENT, chunks.length));

    const batchResults = await Promise.allSettled(
      batch.map(chunk => generateEmbedding(chunk.text, openai))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const chunk = batch[j];

      if (result.status === 'fulfilled') {
        results.push({
          id: chunk.id,
          values: result.value,
          metadata: {
            ...chunk.metadata,
            text: chunk.text,
          },
        });
      } else {
        logError(`Chunk ${chunk.id} embedding 失败: ${result.reason.message}`);
        results.push(null);
      }
    }

    showProgress(Math.min(i + CONCURRENT, chunks.length), chunks.length, '生成进度: ');
  }

  return results.filter(r => r !== null);
}

// ==================== Vectorize 插入 ====================

async function insertToVectorize(vectors) {
  logInfo(`插入 ${vectors.length} 个向量到 Vectorize...`);

  // 准备数据文件
  const dataFile = join(CONFIG.CACHE_DIR, 'vectors.ndjson');
  const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');
  writeFileSync(dataFile, ndjson);

  logInfo(`数据已保存到: ${dataFile}`);
  logInfo('使用 wrangler 插入向量...');

  // 使用 wrangler 命令插入
  const { execSync } = await import('child_process');

  try {
    const cmd = `npx wrangler vectorize insert ${CONFIG.VECTORIZE_INDEX} --file=${dataFile}`;
    logInfo(`执行: ${cmd}`);

    const output = execSync(cmd, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: 'inherit',
    });

    logSuccess('向量插入成功！');
    return true;
  } catch (error) {
    logError(`Wrangler 插入失败: ${error.message}`);
    logWarning('你可以手动运行以下命令：');
    logWarning(`  cd ${ROOT_DIR}`);
    logWarning(`  npx wrangler vectorize insert ${CONFIG.VECTORIZE_INDEX} --file=${dataFile}`);
    return false;
  }
}

// ==================== 主流程 ====================

async function main() {
  console.log('\n' + '='.repeat(60));
  logInfo('📚 本地导入脚本 - Vectorize 批量导入工具');
  console.log('='.repeat(60) + '\n');

  // 检查配置
  if (!CONFIG.OPENAI_API_KEY) {
    logError('请设置环境变量 OPENAI_API_KEY');
    process.exit(1);
  }

  // 创建必要的目录
  if (!existsSync(CONFIG.PDF_DIR)) {
    mkdirSync(CONFIG.PDF_DIR, { recursive: true });
    logWarning(`已创建 PDF 目录: ${CONFIG.PDF_DIR}`);
    logWarning('请将 PDF 文件放入该目录后重新运行');
    process.exit(0);
  }

  if (!existsSync(CONFIG.CACHE_DIR)) {
    mkdirSync(CONFIG.CACHE_DIR, { recursive: true });
  }

  // 初始化 OpenAI
  const openai = new OpenAI({
    apiKey: CONFIG.OPENAI_API_KEY,
  });

  // 扫描 PDF 文件
  const pdfFiles = readdirSync(CONFIG.PDF_DIR)
    .filter(f => f.endsWith('.pdf'))
    .map(f => join(CONFIG.PDF_DIR, f));

  if (pdfFiles.length === 0) {
    logWarning(`PDF 目录为空: ${CONFIG.PDF_DIR}`);
    logWarning('请将 PDF 文件放入该目录后重新运行');
    process.exit(0);
  }

  logInfo(`找到 ${pdfFiles.length} 个 PDF 文件\n`);

  // 处理所有 PDF
  const allVectors = [];

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i];
    const fileName = filePath.split('/').pop();

    console.log(`\n[${ i + 1}/${pdfFiles.length}] 处理: ${fileName}`);
    console.log('-'.repeat(60));

    try {
      // 1. 解析 PDF
      const text = await parsePDF(filePath);
      logSuccess(`文本: ${text}`)
      logSuccess(`提取文本: ${text.length} 字符`);

      if (text.length < 100) {
        logWarning('文本太短，跳过');
        continue;
      }

      // 2. 分块
      const metadata = {
        doc_id: fileName.replace('.pdf', ''),
        phase: fileName.match(/([一二三四五六七八九十]+)阶段/)?.[1] + '阶段' || '未知阶段',
        section: fileName.replace('.pdf', ''),
        updated_at: Date.now(),
      };

      const chunks = chunkText(text, metadata);
      logSuccess(`生成 ${chunks.length} 个文本块`);

      // 3. 生成 embeddings
      const vectors = await generateEmbeddingsBatch(chunks, openai);
      logSuccess(`成功生成 ${vectors.length}/${chunks.length} 个 embeddings\n`);

      allVectors.push(...vectors);

    } catch (error) {
      logError(`处理失败: ${error.message}`);
      console.error(error.stack);
    }
  }

  // 4. 批量插入 Vectorize
  if (allVectors.length > 0) {
    console.log('\n' + '='.repeat(60));
    logInfo(`总共生成 ${allVectors.length} 个向量`);
    console.log('='.repeat(60) + '\n');

    const success = await insertToVectorize(allVectors);

    if (success) {
      console.log('\n' + '='.repeat(60));
      logSuccess('🎉 导入完成！');
      console.log('='.repeat(60) + '\n');
    } else {
      console.log('\n' + '='.repeat(60));
      logWarning('⚠️  部分操作未完成，请检查上方提示');
      console.log('='.repeat(60) + '\n');
    }
  } else {
    logWarning('没有生成任何向量');
  }
}

// 运行
main().catch(error => {
  logError('脚本执行失败:');
  console.error(error);
  process.exit(1);
});
