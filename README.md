# Web3精英班作业助手

基于Cloudflare Workers的RAG (Retrieval-Augmented Generation) 系统，为学员提供"当日作业卡片 + 作业解答对话"的一站式小助手。

## 功能特性

- 📚 **文档索引**：自动从R2存储桶读取PDF作业文件，解析并索引到向量数据库
- 🤖 **智能问答**：基于RAG技术，提供精准的作业解答和流程梳理
- 🔍 **向量检索**：使用Cloudflare Vectorize进行高效的相似度搜索
- 💬 **友好界面**：简洁美观的聊天界面，支持流式响应
- 🎯 **精确引用**：每个回答都附带引用来源（页码、章节）

## 技术栈

- **运行环境**：Cloudflare Workers
- **Web框架**：Hono
- **向量数据库**：Cloudflare Vectorize
- **对象存储**：Cloudflare R2
- **嵌入模型**：OpenAI text-embedding-3-small
- **LLM**：OpenAI GPT-3.5-turbo
- **语言**：TypeScript

## 项目结构

\`\`\`
assignment-assistant/
├── src/
│   ├── worker.ts              # Worker入口，Hono路由
│   ├── types.ts               # TypeScript类型定义
│   ├── ingest.ts              # 文档导入和索引逻辑
│   ├── utils/
│   │   ├── pdf-parser.ts      # PDF文本解析
│   │   ├── chunker.ts         # 文本分片
│   │   ├── embeddings.ts      # OpenAI嵌入生成
│   │   ├── vectorize.ts       # Vectorize操作
│   │   └── rag.ts             # RAG检索和压缩
│   ├── mastra/
│   │   ├── agents/
│   │   │   └── assistant.ts   # 作业助手Agent
│   │   └── workflows/
│   │       └── rag-pipeline.ts # RAG工作流
│   └── public/
│       └── index.html         # 前端聊天界面
├── wrangler.toml              # Cloudflare配置
├── package.json
├── tsconfig.json
└── build.js                   # esbuild构建脚本
\`\`\`

## 配置说明

### 1. 环境变量

需要在Cloudflare Workers设置中添加以下环境变量：

\`\`\`bash
# OpenAI API密钥
wrangler secret put OPENAI_API_KEY
# 输入: sk-proj-GSpYQhjJvntoDQy83fBZ...
\`\`\`

### 2. R2存储桶

在 \`wrangler.toml\` 中配置R2绑定：

\`\`\`toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "jingcheng-homeworks"
\`\`\`

PDF文件应上传到 \`assignments/\` 目录下，例如：
- \`assignments/一阶段作业.pdf\`
- \`assignments/二阶段作业.pdf\`

### 3. Vectorize索引

在 \`wrangler.toml\` 中配置向量数据库绑定：

\`\`\`toml
[[vectorize]]
binding = "VECTOR_INDEX"
index_name = "homework-index"
\`\`\`

需要先创建Vectorize索引：

\`\`\`bash
wrangler vectorize create homework-index --dimensions=1536 --metric=cosine
\`\`\`

## 构建和部署

### 本地开发

\`\`\`bash
# 安装依赖
npm install

# 类型检查
npm run type-check

# 构建项目
npm run build
\`\`\`

### 手动部署

根据PRD要求，由于使用的是免费套餐，需要手动部署：

1. 运行构建命令生成 \`dist/worker.js\`
2. 在Cloudflare Dashboard中手动上传构建产物
3. 配置环境变量和绑定

## API端点

### GET /health
健康检查端点

**响应示例：**
\`\`\`json
{
  "status": "ok",
  "timestamp": "2025-11-09T10:00:00.000Z",
  "service": "web3-homework-assistant"
}
\`\`\`

### POST /api/chat
对话问答（非流式）

**请求：**
\`\`\`json
{
  "question": "帮我梳理第一周周六的作业项目开发流程",
  "day": 6
}
\`\`\`

**响应：**
\`\`\`json
{
  "answer": "## 开发流程\\n1. 环境准备...\\n\\n## 注意事项\\n- 确保Node.js版本...\\n\\n## 引用来源\\n[#1] 一阶段作业 - 第12页",
  "sources": [
    "[#1] 一阶段作业 - 第12页 (一阶段作业.pdf)"
  ],
  "timestamp": 1699545600000
}
\`\`\`

### POST /api/reindex
重建索引（管理员功能）

**请求头：**
\`\`\`
Authorization: Bearer admin-secret-token
\`\`\`

**响应：**
\`\`\`json
{
  "success": true,
  "processed": 3,
  "chunks": 245,
  "errors": [],
  "timestamp": 1699545600000
}
\`\`\`

### GET /app
前端聊天界面

访问此端点可使用可视化聊天界面。

## RAG策略

### 检索

- **Top-K**：默认检索6个最相关的文档片段
- **相似度阈值**：0.7（过滤低相关度结果）
- **MMR去冗余**：使用最大边际相关性算法平衡相关性和多样性

### 分片

- **分片大小**：900字符
- **重叠**：120字符
- **智能分割**：尝试在段落和标题处分割

### 生成

- **模型**：GPT-3.5-turbo
- **温度**：0.3（保证回答稳定性）
- **Prompt**：要求仅基于提供片段，结构化输出（流程+注意点+引用）

## 使用示例

### 问题示例

1. "帮我梳理第一周周六的作业项目开发流程和注意点"
2. "智能合约开发有哪些注意事项？"
3. "如何部署智能合约到测试网？"
4. "前端页面需要实现哪些功能？"

### 回答格式

助手会按以下结构回答：

\`\`\`
## 开发流程
1. 第一步：环境准备...
2. 第二步：创建项目...
3. 第三步：编写代码...

## 注意事项
- 重点1：确保版本兼容...
- 易错点：注意路径配置...
- 检查清单：测试完整性...

## 引用来源
[#1] 一阶段作业 - 第12页 (一阶段作业.pdf)
[#2] 二阶段作业 - 第5页 (二阶段作业.pdf)
\`\`\`

## 安全和合规

- ✅ 只读访问R2和Vectorize
- ✅ 管理员功能需要Token认证
- ✅ 相似度阈值过滤低质量结果
- ✅ 明确引用来源，减少幻觉
- ⚠️ 建议添加速率限制（可使用Workers KV或Durable Objects）

## 性能指标

根据PRD要求：

- **首Token时间**：< 1.5s (P95)
- **完成时间**：< 5s
- **索引成功率**：定时任务监控
- **检索质量**：人工评测1-5星

## 后续优化

- [ ] 实现流式响应（SSE）
- [ ] 添加速率限制
- [ ] 优化PDF解析（使用专业库）
- [ ] 实现向量删除和更新
- [ ] 添加用户历史记录
- [ ] 实现多轮对话上下文

## License

MIT

## 作者

京程一灯Web3精英班
