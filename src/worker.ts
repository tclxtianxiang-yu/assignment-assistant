import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, ChatRequest } from './types';
import { ingestDocuments } from './ingest';
import { runRAGPipeline } from './mastra/workflows/rag-pipeline';

const app = new Hono<{ Bindings: Env }>();

// 中间件
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// 健康检查
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'web3-homework-assistant',
  });
});

// 首页 - 提供简单的欢迎信息
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Web3精英班作业助手</title>
    </head>
    <body>
      <h1>Web3精英班作业助手 API</h1>
      <p>可用端点：</p>
      <ul>
        <li>GET /health - 健康检查</li>
        <li>POST /api/chat - 对话问答</li>
        <li>POST /api/reindex - 重建索引（管理员）</li>
        <li>GET /app - 前端应用</li>
      </ul>
    </body>
    </html>
  `);
});

// API: 对话问答
app.post('/api/chat', async (c) => {
  try {
    const body = await c.req.json<ChatRequest>();
    const { question, day } = body;

    if (!question || typeof question !== 'string') {
      return c.json({ error: 'Invalid question' }, 400);
    }

    console.log('Received chat request:', { question, day });

    // 运行RAG Pipeline
    const result = await runRAGPipeline(
      {
        question,
        day,
        stream: false, // 暂时使用非流式响应
      },
      c.env
    );

    // 构造响应
    const response = {
      answer: result.answer as string,
      sources: result.sources,
      timestamp: Date.now(),
    };

    return c.json(response);
  } catch (error) {
    console.error('Chat error:', error);
    return c.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// API: 流式对话（SSE）
app.post('/api/chat/stream', async (c) => {
  try {
    const body = await c.req.json<ChatRequest>();
    const { question, day } = body;

    if (!question || typeof question !== 'string') {
      return c.json({ error: 'Invalid question' }, 400);
    }

    console.log('Received streaming chat request:', { question, day });

    // 运行RAG Pipeline（流式）
    const result = await runRAGPipeline(
      {
        question,
        day,
        stream: true,
      },
      c.env
    );

    if (result.stream && result.answer instanceof ReadableStream) {
      // 返回SSE流
      return new Response(result.answer, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // 如果不是流，返回普通响应
      return c.json({
        answer: result.answer,
        sources: result.sources,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error('Streaming chat error:', error);
    return c.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// API: 重建索引（管理员功能）
app.post('/api/reindex', async (c) => {
  try {
    // 简单的认证检查（生产环境应使用更安全的方式）
    const authHeader = c.req.header('Authorization');
    const expectedToken = 'Bearer admin-secret-token'; // 应从环境变量读取

    if (authHeader !== expectedToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    console.log('Starting reindex operation...');

    const result = await ingestDocuments(c.env);

    console.log('Reindex completed:', result);

    return c.json({
      success: result.success,
      processed: result.processed,
      chunks: result.chunks,
      errors: result.errors,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Reindex error:', error);
    return c.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// 前端应用路由
app.get('/app', async (c) => {
  return c.html(FRONTEND_HTML);
});

// 内联前端HTML（嵌入完整的应用）
const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>京程一灯Web3精英班 - 作业助手</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      width: 100%;
      max-width: 800px;
      height: 90vh;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      text-align: center;
    }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header p { font-size: 14px; opacity: 0.9; }
    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .message {
      margin-bottom: 16px;
      display: flex;
      animation: fadeIn 0.3s ease-in;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .message.user { justify-content: flex-end; }
    .message-content {
      max-width: 70%;
      padding: 12px 16px;
      border-radius: 12px;
      word-wrap: break-word;
    }
    .message.user .message-content {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .message.assistant .message-content {
      background: white;
      color: #333;
      border: 1px solid #e0e0e0;
    }
    .message.assistant .message-content h2 {
      font-size: 16px;
      margin: 12px 0 8px 0;
      color: #667eea;
    }
    .sources {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e0e0e0;
      font-size: 12px;
      color: #666;
    }
    .input-container {
      display: flex;
      padding: 20px;
      background: white;
      border-top: 1px solid #e0e0e0;
      gap: 12px;
    }
    .input-wrapper { flex: 1; }
    textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      resize: none;
      font-family: inherit;
    }
    button {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .loading {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: white;
      border-radius: 12px;
    }
    .loading-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📚 京程一灯Web3精英班</h1>
      <p>作业助手 - 让学习更轻松</p>
    </div>
    <div class="chat-container" id="chatContainer">
      <div style="text-align: center; padding: 40px; color: #666;">
        <h2 style="color: #667eea;">欢迎使用作业助手！</h2>
        <p>我可以帮助你理解作业要求、梳理开发流程、提供注意事项</p>
      </div>
    </div>
    <div class="input-container">
      <div class="input-wrapper">
        <textarea id="questionInput" rows="2" placeholder="输入你的问题..."></textarea>
      </div>
      <button onclick="sendMessage()" id="sendButton">发送</button>
    </div>
  </div>
  <script>
    const API_BASE = window.location.origin;
    let isLoading = false;
    async function sendMessage() {
      if (isLoading) return;
      const input = document.getElementById('questionInput');
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      addMessage('user', question);
      const loadingId = showLoading();
      isLoading = true;
      document.getElementById('sendButton').disabled = true;
      try {
        const response = await fetch(API_BASE + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        });
        const data = await response.json();
        removeLoading(loadingId);
        addMessage('assistant', data.answer, data.sources);
      } catch (error) {
        removeLoading(loadingId);
        addMessage('assistant', '抱歉，发生了错误：' + error.message);
      } finally {
        isLoading = false;
        document.getElementById('sendButton').disabled = false;
      }
    }
    function addMessage(role, content, sources = []) {
      const container = document.getElementById('chatContainer');
      const welcome = container.querySelector('div[style*="text-align"]');
      if (welcome) welcome.remove();
      const div = document.createElement('div');
      div.className = 'message ' + role;
      let html = '<div class="message-content">' + content.replace(/\\n/g, '<br>') + '</div>';
      div.innerHTML = html;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
    function showLoading() {
      const container = document.getElementById('chatContainer');
      const div = document.createElement('div');
      const id = 'loading-' + Date.now();
      div.id = id;
      div.className = 'message assistant';
      div.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span>思考中...</span></div>';
      container.appendChild(div);
      return id;
    }
    function removeLoading(id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
  </script>
</body>
</html>`;

// 导出Worker
export default app;
