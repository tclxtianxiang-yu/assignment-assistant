项目 PRD（MVP）

一、产品定位

为学员提供“作业解答对话”的一站式小助手。
数据来源为 OSS 的 作业.pdf（可多个），系统自动抽取/索引，并结合 RAG 提供流程梳理、注意事项、答疑。

二、核心用户故事
	1.	查看当天作业：打开网页 → 自动显示“未完成的作业卡片”（标题/要求/提交方式/注意点）。
	2.	对话解答：问“第一周 周六的作业，帮我梳理项目开发流程和注意重点” → 流式返回分步骤流程与注意点，并附引用来源。
	3.	历史作业：可查看过去作业与答疑记录。

三、MVP 功能清单
	•	文档侧
	 •	R2 中保存 assignments/一阶段作业.pdf、assignments/二阶段作业.pdf 等等。 ￼
	 •	Worker 定时任务/手动触发抽取文本→分片→嵌入→写入向量库。向量库采用 Cloudflare Vectorize。 ￼
	 •	嵌入模型采用 OPENAI，PRD下方有密钥和要求。 ￼
	•	RAG 问答侧
	 •	检索 Top-k 片段 + 压缩/去重 + 生成回答（附引用来源）。
	•	前端侧
	 •	纯前端聊天页（UI 简洁，消息流式、展示引用来源、可切换“日期”）。

⸻

端到端流程（高层）

A. 用户流程
	1.	用户提问（如“帮我梳理第一周 周六作业项目流程与注意点”）→ RAG 检索 + 生成 → 流式返回，并在答案底部列出引用的段落与页码。

B. 系统流程（数据管道）

R2（PDF） → 解析(PDF→文本) → 切分(chunk) → 嵌入(OPENAI) → 写入 Vectorize → 对话时检索(Top-k) → 生成(LLM) → 流式返回。
	•	Cloudflare Workers 对 R2 的读写与绑定是官方一等能力。 ￼
	•	向量库与嵌入也可在 Workers 原生使用（Vectorize + Workers AI）。 ￼

⸻

技术方案

一、总体架构

[Browser SPA]
   ↓ HTTPS (SSE)
[Cloudflare Worker (Hono)]
   ├─ /api/chat        → Mastra Workflow.run()  (RAG)
   ├─ /api/reindex     → 手动触发导入/重建索引（管理员用）

说明：
	•	Mastra on Workers：Mastra 已有 Cloudflare 部署支持与示例，适合在 Workers 环境跑 Agent/Workflow（或作为轻量 orchestrator）。 ￼

二、数据模型

1) Chunk 元数据（写入 Vectorize 时）

{
  "id": "pdf-2025Q4-day03-p12-ck04",
  "text": "……分片文本……",
  "embedding": [ ... ],
  "metadata": {
    "doc_id": "assignments/2025-Q4/一阶段作业.pdf",
    "phase": "2025-Q4",
    "day": 3,
    "page": 12,
    "section": "一阶段作业",
    "updated_at": 1731148800
  }
}

三、RAG 策略
	•	检索：Top-k=6 + MMR 去冗余；低于阈值直接提示“资料中未找到”。
	•	压缩：按标题聚合相邻 chunks，控制总 tokens。
	•	生成：Prompt 要求“仅基于提供片段”，并带引用 [#n]。
	•	答案结构：
	1.	“流程梳理（步骤1-N）”；
	2.	“注意点（坑/Checklist）”；
	3.	“引用来源（页码/章节）”。

⸻

部署与配置（Cloudflare）

wrangler.toml（示例）

name = "web3-homework-assistant"
main = "src/worker.ts"
compatibility_date = "2025-11-01"

# R2 绑定
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "jingcheng-homeworks"

# Vectorize 绑定
[[vectorize]]
binding = "VECTOR_INDEX"
index_name = "homework-index"

（R2 in-Worker API、Vectorize 绑定皆为官方支持能力。 ￼）

⸻

关键代码骨架（精简示例）

使用 Hono 路由 + Mastra 工作流；嵌入与向量库分别用 Workers AI 与 Vectorize。

1) 导入/索引（手动）

// src/ingest.ts
export async function ingest(env: Env) {
  const list = await env.R2_BUCKET.list({ prefix: "assignments/" }); // R2 列表
  for (const obj of list.objects) {
    const pdf = await env.R2_BUCKET.get(obj.key);
    if (!pdf) continue;

    const text = await parsePdf(await pdf.arrayBuffer()); // 轻量 PDF 文本解析器
    const chunks = chunkText(text, { size: 900, overlap: 120, withHeadings: true });

    // 生成嵌入（Workers AI）
    const vectors = [];
    for (const c of chunks) {
      const embedding = await env.AI.run("@cf/baai/bge-m3:embed", { text: c.text });
      vectors.push({ id: genId(), values: embedding.data[0], metadata: c.meta, text: c.text });
    }

    // 写入 Vectorize
    await env.VECTOR_INDEX.upsert(vectors);
  }
}

2) RAG Workflow（Mastra）

// src/mastra/workflows/ragPipeline.ts
import { defineWorkflow } from "mastra"; // 假设 ESM 入口；若用官方包按文档引
import { wikiAgent } from "../agents/wikiAgent";

export const ragPipeline = defineWorkflow({
  id: "ragPipeline",
  inputSchema: { question: "string", day: "number?" },
  steps: {
    retrieve: async (ctx) => {
      const query = ctx.input.question;
      const filterDay = ctx.input.day;
      // Vectorize 相似检索 + 条件过滤
      const hits = await ctx.env.VECTOR_INDEX.query({
        topK: 6,
        vector: await embed(ctx.env, query),
        filter: filterDay ? { op: "=", field: "day", value: filterDay } : undefined
      });
      return { docs: compress(hits) };
    },
    generate: async (ctx) => {
      const answer = await wikiAgent.run({
        input: ctx.input.question,
        context: formatContext(ctx.steps.retrieve.docs)
      });
      return { answer, sources: ctx.steps.retrieve.docs };
    }
  },
  outputSchema: { answer: "string", sources: "any" }
});

3) Agent（回答器）

// src/mastra/agents/wikiAgent.ts
import { defineAgent } from "mastra";

export const wikiAgent = defineAgent({
  id: "homeworkAssistant",
  instructions: `
你是“京程一灯Web3精英班课后作业小助手”。
- 只基于提供的片段作答；若资料不足，明确说“资料中未找到”并给建议关键词。
- 输出结构：①开发流程(1-n步骤) ②注意点(checklist) ③引用来源[#n]。
- 中文简洁，命令式动词开头。
`,
});

4) Worker 路由（Hono）

// src/worker.ts
import { Hono } from "hono";
import { ingest } from "./ingest";
import { ragPipeline } from "./mastra/workflows/ragPipeline";

export interface Env {
  R2_BUCKET: R2Bucket;
  VECTOR_INDEX: VectorizeIndex;
}

const app = new Hono<{ Bindings: Env }>();

app.post("/api/reindex", async (c) => {
  await ingest(c.env);
  return c.json({ ok: true });
});

app.post("/api/chat", async (c) => {
  const { question } = await c.req.json();
  const result = await ragPipeline.run({ question }, { env: c.env });
  return c.json(result);
});


⸻

安全与合规
	•	只读 R2 & Vectorize；上传改动走运营侧（受保护的 Admin 路由/Token）。
	•	模型防幻觉：阈值过滤 + “无相关资料”策略 + 源文引用。
	•	速率限制：基于 IP/会话做轻量限流（Workers KV/DO 实现）。

⸻

质量评测（MVP）
	•	检索质量：Top-k 覆盖率（命中正确段落的概率）、MMR 去冗余率。
	•	答案质量：人工评 1–5 星（流程清晰度、正确性、引用充分）。
	•	体验：P95 首 token < 1.5s，完成时间 < 5s（按文档大小与模型调整）。
	•	稳定性：Cron 成功率、索引时延、向量条目一致性。

⸻

你需要知道的“平台可行性”要点（已验证文档）
	•	Workers 原生读写 R2（绑定方式与 API 示例）。 ￼
	•	Vectorize 是 Cloudflare 的全球分布式向量数据库，Workers 通过 binding 直接用，支持插入/查询。 ￼
	•	Workers 使用 OpenAI ，直接把密钥通过wrangler命令行添加到Workers设置中，密钥: sk-proj-GSpY************************************S4rUA（已模糊处理，实际部署时请使用真实密钥）。 ￼
	•	Workers ingest/重建索引。 ￼
	•	Mastra × Cloudflare 有部署器与示例，可在 Workers 上运行多 Agent/Workflow。 ￼
  •	项目开发到构建步骤即可，因为我cloudfare是用的0$套餐，不支持wrangler命令行部署，所以我会进行手动部署。
