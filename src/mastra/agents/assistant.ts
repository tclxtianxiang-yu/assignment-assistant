import type { Env, RetrievalResult } from '../../types';
import OpenAI from 'openai';

/**
 * 作业助手Agent配置
 */
// RAG模式：基于文档回答
export const ASSISTANT_RAG_PROMPT = `你是"京程一灯Web3精英班课后作业小助手"。

你的职责是帮助学员理解和完成作业，提供清晰的指导和注意事项。

回答规则：
1. 仅基于提供的参考资料作答，不要编造信息
2. 如果资料不足以回答问题，明确说"资料中未找到相关内容"，并建议相关的关键词
3. 回答要结构化，包含：
   ① 开发流程（分步骤，1-N）
   ② 注意事项（重点、易错点、检查清单）
   ③ 引用来源（标注[#n]）
4. 使用中文，简洁专业，使用命令式动词开头
5. 对于技术问题，给出具体可操作的建议

示例回答格式：
## 开发流程
1. 第一步：做什么...
2. 第二步：做什么...

## 注意事项
- 重点1：...
- 易错点：...
- 检查清单：...

## 引用来源
[#1] 一阶段作业 - 第12页
[#2] 二阶段作业 - 第5页
`;

// 普通对话模式：自由对话
export const ASSISTANT_CHAT_PROMPT = `你是"京程一灯Web3精英班课后作业小助手"。

你的职责是帮助学员理解Web3和区块链相关知识，提供友好的帮助。

回答规则：
1. 使用中文，友好专业的语气
2. 对于问候语（如"你好"、"谢谢"等）要自然回应
3. 对于技术问题，尽可能提供有用的建议
4. 如果学员询问具体作业内容，建议他们提供更多关键词以便查找相关资料
5. 保持简洁，避免过于冗长
`;

// 兼容旧代码
export const ASSISTANT_SYSTEM_PROMPT = ASSISTANT_RAG_PROMPT;

/**
 * 调用LLM生成回答
 */
export async function generateAnswer(
  question: string,
  context: string,
  env: Env,
  options: {
    stream?: boolean;
    temperature?: number;
    mode?: 'rag' | 'chat'; // 模式：RAG（基于文档）或 Chat（普通对话）
  } = {}
): Promise<string | ReadableStream> {
  const { stream = false, temperature = 0.3, mode = 'rag' } = options;

  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

  // 根据模式选择不同的prompt
  const systemPrompt = mode === 'chat' ? ASSISTANT_CHAT_PROMPT : ASSISTANT_RAG_PROMPT;

  let userMessage: string;
  if (mode === 'chat') {
    // 普通对话模式：直接提问
    userMessage = question;
  } else {
    // RAG模式：提供上下文
    userMessage = `参考资料：\n\n${context}\n\n问题：${question}\n\n请基于以上资料回答问题。`;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userMessage,
    },
  ];

  if (stream) {
    // 流式响应
    const streamResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature,
      stream: true,
    });

    // 创建一个TransformStream来处理SSE
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamResponse) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return readable;
  } else {
    // 非流式响应
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature,
      stream: false,
    });

    return response.choices[0]?.message?.content || '抱歉，生成回答时出现错误。';
  }
}

/**
 * 验证答案质量
 */
export function validateAnswer(answer: string, context: string): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // 检查是否太短
  if (answer.length < 50) {
    issues.push('回答过于简短');
  }

  // 检查是否包含结构化内容
  const hasStructure = answer.includes('##') || answer.includes('1.') || answer.includes('- ');
  if (!hasStructure) {
    issues.push('缺少结构化格式');
  }

  // 检查是否包含引用
  const hasCitation = answer.includes('[#');
  if (!hasCitation && context.length > 100) {
    issues.push('缺少引用来源');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
