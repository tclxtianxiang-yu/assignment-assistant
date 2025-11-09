#!/usr/bin/env node

/**
 * 从 Cloudflare R2 下载 PDF 文件
 *
 * 运行方式：
 * node scripts/download-from-r2.mjs
 *
 * 需要环境变量：
 * - CLOUDFLARE_ACCOUNT_ID
 * - CLOUDFLARE_ACCESS_KEY_ID
 * - CLOUDFLARE_SECRET_ACCESS_KEY
 * - R2_BUCKET_NAME (默认: jingcheng-homeworks)
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const PDF_DIR = join(ROOT_DIR, 'pdfs');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logSuccess(msg) { log(`✓ ${msg}`, 'green'); }
function logError(msg) { log(`✗ ${msg}`, 'red'); }
function logWarning(msg) { log(`⚠ ${msg}`, 'yellow'); }
function logInfo(msg) { log(`ℹ ${msg}`, 'blue'); }

async function main() {
  console.log('\n' + '='.repeat(60));
  logInfo('📥 从 R2 下载 PDF 文件');
  console.log('='.repeat(60) + '\n');

  // 检查环境变量
  const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  const ACCESS_KEY_ID = process.env.CLOUDFLARE_ACCESS_KEY_ID;
  const SECRET_ACCESS_KEY = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
  const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'jingcheng-homeworks';

  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    logError('缺少必要的环境变量！');
    console.log('\n请设置以下环境变量：');
    console.log('  export CLOUDFLARE_ACCOUNT_ID="your-account-id"');
    console.log('  export CLOUDFLARE_ACCESS_KEY_ID="your-access-key-id"');
    console.log('  export CLOUDFLARE_SECRET_ACCESS_KEY="your-secret-key"');
    console.log('\n或者手动从 R2 控制台下载 PDF 到 ./pdfs/ 目录\n');
    process.exit(1);
  }

  // 创建 PDF 目录
  if (!existsSync(PDF_DIR)) {
    mkdirSync(PDF_DIR, { recursive: true });
  }

  // 配置 S3 客户端（R2 兼容 S3 API）
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });

  try {
    // 列出 R2 中的所有文件
    logInfo(`列出 R2 bucket: ${BUCKET_NAME}`);
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'assignments/',
    });

    const { Contents } = await s3Client.send(listCommand);

    if (!Contents || Contents.length === 0) {
      logWarning('R2 bucket 为空');
      process.exit(0);
    }

    // 过滤 PDF 文件
    const pdfFiles = Contents.filter(obj => obj.Key.endsWith('.pdf'));
    logSuccess(`找到 ${pdfFiles.length} 个 PDF 文件\n`);

    // 下载每个文件
    for (let i = 0; i < pdfFiles.length; i++) {
      const file = pdfFiles[i];
      const fileName = file.Key.split('/').pop();
      const localPath = join(PDF_DIR, fileName);

      try {
        logInfo(`[${i + 1}/${pdfFiles.length}] 下载: ${fileName}`);

        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: file.Key,
        });

        const response = await s3Client.send(getCommand);
        const chunks = [];

        for await (const chunk of response.Body) {
          chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        writeFileSync(localPath, buffer);

        logSuccess(`  保存到: ${localPath} (${(buffer.length / 1024).toFixed(2)} KB)`);
      } catch (error) {
        logError(`  下载失败: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    logSuccess('✓ 下载完成！');
    logInfo(`PDF 文件已保存到: ${PDF_DIR}`);
    logInfo('接下来运行: node scripts/local-import.mjs');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    logError('下载失败:');
    console.error(error);
    process.exit(1);
  }
}

main();
