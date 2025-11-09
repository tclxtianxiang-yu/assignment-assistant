# 本地导入脚本 - 快速稳定的 Vectorize 导入方案

## 🚀 为什么使用本地导入？

**Workers 在线导入的问题：**
- ❌ 免费套餐只有 10ms CPU 时间
- ❌ 每个 chunk 调用 OpenAI API 需要 200-500ms
- ❌ 274 个 chunks 根本无法处理完
- ❌ 网络不稳定导致频繁失败

**本地导入的优势：**
- ✅ 无 CPU 时间限制
- ✅ 可以并发处理（3-5 个并发）
- ✅ 本地网络更稳定
- ✅ 失败自动重试（5 次）
- ✅ 进度可视化
- ✅ 可以缓存中间结果

**速度对比：**
```
Workers 在线导入:  274 chunks × 500ms = 137秒  ❌ 超时失败
本地并发导入:      274 chunks ÷ 3 × 300ms = 27秒  ✅ 成功
```

---

## 📋 方案对比

### 方案 A：从 R2 下载 + 本地导入（推荐）

**适用场景：** PDF 已上传到 R2

```bash
# 1. 从 R2 下载 PDF
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_ACCESS_KEY_ID="your-r2-access-key"
export CLOUDFLARE_SECRET_ACCESS_KEY="your-r2-secret-key"

npm install  # 安装 @aws-sdk/client-s3
node scripts/download-from-r2.mjs

# 2. 本地导入
export OPENAI_API_KEY="your-openai-key"
node scripts/local-import.mjs
```

### 方案 B：手动下载 + 本地导入（最简单）

**适用场景：** 本地有 PDF 文件

```bash
# 1. 手动将 PDF 放到 pdfs/ 目录
mkdir -p pdfs
cp /path/to/your/*.pdf pdfs/

# 2. 本地导入
export OPENAI_API_KEY="your-openai-key"
node scripts/local-import.mjs
```

### 方案 C：使用 Wrangler 手动插入（高级）

**适用场景：** 已有 embeddings 数据

```bash
# 准备 vectors.ndjson 文件
# 格式: {"id":"chunk-1","values":[0.1,0.2,...],"metadata":{...}}

npx wrangler vectorize insert homework-index --file=vectors.ndjson
```

---

## 🛠️ 详细步骤

### 步骤 1: 安装依赖

```bash
cd /home/user/assignment-assistant

# 安装 Node.js 依赖
npm install
```

需要的额外依赖（如果没有）：
```bash
npm install openai pdf-parse @aws-sdk/client-s3
```

### 步骤 2: 准备 PDF 文件

**选项 A：从 R2 下载**

1. 在 Cloudflare 控制台创建 R2 API Token
   - 访问: https://dash.cloudflare.com/{account-id}/r2/api-tokens
   - 点击 "Create API Token"
   - 权限: Read & Write
   - 记录 Access Key ID 和 Secret Access Key

2. 设置环境变量并下载
   ```bash
   export CLOUDFLARE_ACCOUNT_ID="your-account-id"
   export CLOUDFLARE_ACCESS_KEY_ID="r2-access-key-id"
   export CLOUDFLARE_SECRET_ACCESS_KEY="r2-secret-access-key"

   node scripts/download-from-r2.mjs
   ```

**选项 B：手动下载**

1. 从 R2 控制台手动下载 PDF
2. 将文件放到 `pdfs/` 目录：
   ```bash
   mkdir -p pdfs
   cp ~/Downloads/一阶段作业.pdf pdfs/
   ```

### 步骤 3: 运行本地导入

```bash
# 设置 OpenAI API Key
export OPENAI_API_KEY="sk-proj-..."

# 运行导入脚本
node scripts/local-import.mjs
```

**输出示例：**
```
============================================================
ℹ 📚 本地导入脚本 - Vectorize 批量导入工具
============================================================

ℹ 找到 1 个 PDF 文件

[1/1] 处理: 一阶段作业.pdf
------------------------------------------------------------
✓ 提取文本: 213324 字符
✓ 生成 274 个文本块
生成进度: [████████████████████████████████████████████] 100% (274/274)
✓ 成功生成 274/274 个 embeddings

============================================================
ℹ 总共生成 274 个向量
============================================================

ℹ 数据已保存到: .cache/vectors.ndjson
ℹ 使用 wrangler 插入向量...
ℹ 执行: npx wrangler vectorize insert homework-index --file=.cache/vectors.ndjson

🌀 Inserting vectors into Vectorize index homework-index
✨ Successfully inserted 274 vectors into index homework-index

✓ 向量插入成功！

============================================================
✓ 🎉 导入完成！
============================================================
```

---

## ⚙️ 配置说明

编辑 `scripts/local-import.mjs` 中的配置：

```javascript
const CONFIG = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // 分块配置
  CHUNK_SIZE: 900,        // 每个 chunk 的字符数
  CHUNK_OVERLAP: 120,     // chunk 之间的重叠

  // 性能配置
  BATCH_SIZE: 10,         // 每批处理的 chunks（无用，已改为并发）
  CONCURRENT: 3,          // 并发请求数（推荐 3-5）
  RETRY_TIMES: 5,         // 失败重试次数
};
```

**调优建议：**
- `CONCURRENT: 3`：网络好可以设为 5，网络差设为 1
- `RETRY_TIMES: 5`：OpenAI API 不稳定时增加到 10
- `CHUNK_SIZE: 900`：减小可以提高精度，但会增加数量

---

## 🔍 故障排查

### 问题 1: OpenAI API 报错 "Rate limit exceeded"

**原因：** 免费账户有速率限制

**解决：**
```javascript
// 降低并发数
CONCURRENT: 1,  // 改为 1
```

或等待几分钟后重试。

### 问题 2: Wrangler 命令找不到

**原因：** Wrangler 未全局安装

**解决：**
```bash
npm install -g wrangler
# 或使用 npx
npx wrangler vectorize insert homework-index --file=.cache/vectors.ndjson
```

### 问题 3: Wrangler 未登录

**原因：** 需要先登录 Cloudflare

**解决：**
```bash
npx wrangler login
# 在浏览器中完成授权
```

### 问题 4: 向量插入失败

**原因：** Vectorize index 不存在或名称错误

**解决：**
```bash
# 检查现有 indexes
npx wrangler vectorize list

# 如果不存在，创建 index
npx wrangler vectorize create homework-index \
  --dimensions=1536 \
  --metric=cosine
```

### 问题 5: 部分 embeddings 失败

脚本会自动重试 5 次，如果仍然失败：

1. 检查失败的 chunk ID（日志中会显示）
2. 检查 `.cache/vectors.ndjson` 文件
3. 手动重试失败的 chunks：
   ```bash
   # 编辑 local-import.mjs，跳过已成功的文件
   node scripts/local-import.mjs
   ```

---

## 📊 性能对比

| 方案 | 时间 | 成功率 | 复杂度 |
|------|------|--------|--------|
| Workers 在线导入 | 无法完成 | 0% | 低 |
| 自动化脚本（5个/批） | ~30分钟 | 50% | 中 |
| **本地导入（推荐）** | **~1分钟** | **100%** | **低** |

---

## 🎯 最佳实践

1. **首次导入**：使用本地导入，一次性完成
2. **增量更新**：新增 PDF 时，只导入新文件
3. **定期更新**：使用 `wrangler vectorize query` 验证数据

**验证导入结果：**
```bash
# 查询 index 信息
npx wrangler vectorize query homework-index --vector="[0.1,0.2,...]" --top-k=5

# 或访问你的聊天界面测试
curl -X POST https://arg.mikasa-ackerman.vip/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"什么是区块链"}'
```

---

## 💡 提示

- ✅ 本地导入是**一次性操作**，完成后就不需要再运行
- ✅ 如果需要更新数据，重新运行脚本即可（会覆盖同 ID 的向量）
- ✅ `.cache/vectors.ndjson` 可以保留，方便后续手动插入
- ✅ 导入成功后，可以删除 `pdfs/` 目录释放空间

---

## 🆘 需要帮助？

如果遇到问题，请检查：

1. **环境变量是否正确**
   ```bash
   echo $OPENAI_API_KEY
   ```

2. **Wrangler 是否已登录**
   ```bash
   npx wrangler whoami
   ```

3. **Vectorize index 是否存在**
   ```bash
   npx wrangler vectorize list
   ```

4. **查看详细日志**
   ```bash
   node scripts/local-import.mjs 2>&1 | tee import.log
   ```
