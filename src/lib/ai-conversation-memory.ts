/**
 * 对话记忆管理 — 长对话消息压缩
 * 
 * 策略：
 * - 保留最近 N 轮完整对话
 * - 更早的消息压缩为摘要（提取关键操作和参数变更）
 * - 摘要注入为一条 system-like 消息，供 AI 参考上下文
 */
import type { ChatMessage } from './ai-providers';

/** 保留的完整对话轮次数 */
const KEEP_RECENT_ROUNDS = 6;

/** 超过此消息数才开始压缩 */
const COMPRESS_THRESHOLD = 14;

/** 从 assistant 消息中提取关键操作摘要 */
function summarizeAssistantMessage(content: string): string {
  const lines: string[] = [];

  // 检测参数修改
  const paramMatch = content.match(/已(?:更新|修改|设置).*?[:：]?\s*(.+?)(?:[。\n]|$)/);
  if (paramMatch) lines.push(`修改: ${paramMatch[1].slice(0, 60)}`);

  // 检测规范校验结果
  const complianceMatch = content.match(/校验.*?[:：]\s*(\d+).*?通过.*?(\d+).*?不通过/);
  if (complianceMatch) lines.push(`校验: ${complianceMatch[1]}通过/${complianceMatch[2]}不通过`);

  // 检测计算结果
  const calcMatch = content.match(/配筋率.*?[=＝]\s*([\d.]+%)/);
  if (calcMatch) lines.push(`配筋率: ${calcMatch[1]}`);

  // 检测 rebar-json 应用
  if (content.includes('rebar-json') || content.includes('已更新参数')) {
    lines.push('应用了参数修改');
  }

  // 如果没提取到具体操作，取前 80 字符
  if (lines.length === 0) {
    const cleaned = content.replace(/```[\s\S]*?```/g, '').replace(/\n+/g, ' ').trim();
    if (cleaned.length > 0) {
      lines.push(cleaned.slice(0, 80) + (cleaned.length > 80 ? '...' : ''));
    }
  }

  return lines.join('; ');
}

/** 从 user 消息中提取意图 */
function summarizeUserMessage(content: string): string {
  // 处理 multimodal content
  const text = typeof content === 'string'
    ? content
    : (Array.isArray(content)
      ? (content as Array<{ type: string; text?: string }>).filter(p => p.type === 'text').map(p => p.text || '').join('')
      : String(content));
  
  if (text.length <= 50) return text;
  return text.slice(0, 50) + '...';
}

/**
 * 压缩对话历史，返回用于 AI 请求的消息数组
 * 
 * @param messages 完整对话历史
 * @returns 压缩后的消息数组（最近消息完整保留，早期压缩为摘要）
 */
export function compressConversation(messages: ChatMessage[]): ChatMessage[] {
  // 消息数量未超阈值，直接返回
  if (messages.length <= COMPRESS_THRESHOLD) {
    return messages;
  }

  // 计算保留边界 — 保留最近 KEEP_RECENT_ROUNDS 轮
  // 一"轮"= 一条 user + 一条 assistant
  let keepFromIndex = messages.length;
  let roundCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      roundCount++;
      if (roundCount >= KEEP_RECENT_ROUNDS) {
        keepFromIndex = i;
        break;
      }
    }
  }

  // 如果所有消息都在保留范围内
  if (keepFromIndex === 0) return messages;

  // 压缩早期消息为摘要
  const earlyMessages = messages.slice(0, keepFromIndex);
  const summaryLines: string[] = [];

  for (const msg of earlyMessages) {
    if (msg.role === 'user') {
      const textContent = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as Array<{ type: string; text?: string }>).filter(p => p.type === 'text').map(p => p.text || '').join('');
      const summary = summarizeUserMessage(textContent);
      if (summary) summaryLines.push(`[用户] ${summary}`);
    } else if (msg.role === 'assistant') {
      const textContent = typeof msg.content === 'string' ? msg.content : '';
      const summary = summarizeAssistantMessage(textContent);
      if (summary) summaryLines.push(`[AI] ${summary}`);
    }
  }

  // 构建压缩后的消息数组
  const compressed: ChatMessage[] = [];

  // 插入摘要作为第一条 user 消息（让 AI 知道之前的上下文）
  if (summaryLines.length > 0) {
    compressed.push({
      role: 'user',
      content: `[对话历史摘要 - 之前 ${earlyMessages.length} 条消息]\n${summaryLines.join('\n')}\n[摘要结束，以下是近期对话]`,
    });
    compressed.push({
      role: 'assistant',
      content: '好的，我已了解之前的对话背景，请继续。',
    });
  }

  // 追加保留的完整消息
  compressed.push(...messages.slice(keepFromIndex));

  return compressed;
}

/**
 * 估算消息的 token 数量（粗略，中文约 1.5 token/字符）
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && 'text' in part) {
          chars += (part as { text: string }).text.length;
        }
      }
    }
  }
  // Rough estimate: Chinese averages ~1.5 tokens/char, English ~0.75 tokens/char
  // Use 1.2 as middle ground
  return Math.ceil(chars * 1.2);
}
