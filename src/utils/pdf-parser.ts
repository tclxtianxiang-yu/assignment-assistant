/**
 * 简化的PDF文本提取器
 * 用于从PDF中提取文本内容
 */

export async function parsePdf(arrayBuffer: ArrayBuffer): Promise<string> {
  // 将ArrayBuffer转换为字符串
  const bytes = new Uint8Array(arrayBuffer);
  let text = '';

  // 简单的文本提取：查找PDF流中的文本内容
  // 注意：这是一个简化版本，实际生产环境应使用专业的PDF解析库
  try {
    // 尝试直接从PDF字节流中提取文本
    const decoder = new TextDecoder('utf-8');
    const rawText = decoder.decode(bytes);

    // 提取PDF文本对象中的内容
    // PDF格式：BT ... Tj ET 或 BT ... TJ ET
    const textMatches = rawText.matchAll(/\(([^)]+)\)/g);
    const extractedTexts: string[] = [];

    for (const match of textMatches) {
      const content = match[1];
      // 清理PDF转义字符
      const cleaned = content
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\(.)/g, '$1');

      if (cleaned.trim() && cleaned.length > 1) {
        extractedTexts.push(cleaned);
      }
    }

    text = extractedTexts.join(' ');

    // 如果没有提取到文本，尝试另一种方法
    if (!text || text.length < 50) {
      // 查找stream对象
      const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
      const streams = [...rawText.matchAll(streamRegex)];

      const streamTexts: string[] = [];
      for (const stream of streams) {
        const content = stream[1];
        // 尝试提取可读文本
        const readableText = content.replace(/[^\x20-\x7E\u4e00-\u9fa5\n\r\t]/g, ' ');
        if (readableText.trim()) {
          streamTexts.push(readableText);
        }
      }

      if (streamTexts.length > 0) {
        text = streamTexts.join('\n');
      }
    }
  } catch (error) {
    console.error('PDF parsing error:', error);
    // 作为后备方案，返回原始可读文本
    const decoder = new TextDecoder('utf-8');
    const rawText = decoder.decode(bytes);
    text = rawText.replace(/[^\x20-\x7E\u4e00-\u9fa5\n\r\t]/g, ' ');
  }

  // 清理多余的空白
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}
