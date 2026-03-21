/**
 * AI Agent 执行引擎 — 支持多步工具调用的 Agent 循环
 * 
 * 流程: 用户消息 → AI (with tools) → tool_calls → 执行 → 反馈 → 继续循环
 */
import type { AIProvider, ChatMessage } from './ai-providers';
import { AGENT_TOOLS, executeToolCall, type AgentCallbacks, type AgentToolArgs, type ToolResult } from './ai-agent-tools';
import type { ComponentType } from './types';
import { buildSidebarSystemPrompt } from './ai-sidebar-prompt';
import { buildVisionSystemPrompt } from './ai-vision-prompt';
import { parseAIResponse } from './nl-rebar-parser';
import { mapSchemaToParams } from './nl-rebar-mapper';
import { aiFetch } from './ai-fetch';

/** Agent 执行过程中的步骤，用于 UI 展示 */
export interface AgentStep {
  type: 'tool_call' | 'tool_result' | 'thinking';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: ToolResult;
  message?: string;
  timestamp: number;
}

/** Agent 回合消息（扩展 ChatMessage） */
export interface AgentMessage extends ChatMessage {
  /** Agent 执行步骤（仅 assistant 消息有） */
  agentSteps?: AgentStep[];
  /** 是否包含 rebar-json 且已应用 */
  paramsApplied?: boolean;
}

/** Agent 引擎配置 */
interface AgentConfig {
  maxToolRounds: number;       // 最大工具调用轮次
  provider: AIProvider;        // full provider object for aiFetch
  model: string;
  apiKey: string;
  componentType: ComponentType;
  context: string;             // 当前参数上下文
  hasImages?: boolean;         // 是否包含图片 → 注入 vision prompt
}

/** Agent 状态回调 */
interface AgentStateCallbacks {
  onStreamUpdate: (content: string) => void;
  onStepAdded: (step: AgentStep) => void;
  onParamsApplied: (fields: string[]) => void;
}

/** 从 AI 响应中解析 tool_calls */
interface ToolCallChunk {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/** 
 * Agent 消息格式 — 支持 multimodal content (string | content parts)
 * 也支持 tool_calls / tool results 
 */
type AgentMsgPayload = {
  role: string;
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: ToolCallChunk[];
  tool_call_id?: string;
  name?: string;
};

/** 判断 API 错误是否因为不支持 tools/function calling */
const TOOLS_UNSUPPORTED_RE = /tool|function|unsupported|not.?support|invalid.*param|unrecognized/i;

/**
 * 非流式请求（用于 tool_calls 循环中的请求）
 */
async function requestWithTools(
  config: AgentConfig,
  messages: AgentMsgPayload[],
  signal: AbortSignal,
): Promise<{
  content: string | null;
  toolCalls: ToolCallChunk[] | null;
}> {
  let systemContent = buildSidebarSystemPrompt(config.componentType, config.context) + AGENT_SYSTEM_SUFFIX;
  // Inject vision recognition prompt when images are present
  if (config.hasImages) {
    systemContent += '\n\n' + buildVisionSystemPrompt(config.componentType);
  }

  const { response: res } = await aiFetch({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    systemPrompt: systemContent,
    messages: messages as Array<{ role: string; content?: unknown }>,
    tools: AGENT_TOOLS,
    tool_choice: 'auto',
    stream: false,
    temperature: 0.3,
    max_tokens: 4096,
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`AI 接口错误: ${res.status}${errText ? ' - ' + errText.slice(0, 200) : ''}`);
    (err as Error & { statusCode?: number; bodyText?: string }).statusCode = res.status;
    (err as Error & { bodyText?: string }).bodyText = errText;
    throw err;
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error('AI 未返回有效回复');

  return {
    content: choice.message?.content || null,
    toolCalls: choice.message?.tool_calls || null,
  };
}

/**
 * 流式请求（用于最终文字回复）
 */
async function streamFinalResponse(
  config: AgentConfig,
  messages: AgentMsgPayload[],
  signal: AbortSignal,
  onUpdate: (content: string) => void,
): Promise<string> {
  const systemContent = buildSidebarSystemPrompt(config.componentType, config.context);

  const { response: res } = await aiFetch({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    systemPrompt: systemContent,
    messages: messages as Array<{ role: string; content?: unknown }>,
    stream: true,
    temperature: 0.3,
    max_tokens: 4096,
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI 接口错误: ${res.status}${errText ? ' - ' + errText.slice(0, 200) : ''}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let content = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          onUpdate(content);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return content;
}

/**
 * 运行 Agent 主循环
 * 
 * 支持两种模式：
 * 1. 如果 provider 支持 function calling → 使用 tools
 * 2. 如果不支持 → fallback 到传统 rebar-json 模式
 */
export async function runAgent(
  config: AgentConfig,
  conversationMessages: ChatMessage[],
  callbacks: AgentCallbacks,
  stateCallbacks: AgentStateCallbacks,
  signal: AbortSignal,
): Promise<{
  assistantContent: string;
  steps: AgentStep[];
  usedTools: boolean;
}> {
  const steps: AgentStep[] = [];

  // 构建消息历史 — 保留 multimodal content（图片）以支持 vision 模型
  const messages: AgentMsgPayload[] = conversationMessages.map(m => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }
    // multimodal content (text + images) → 保持原格式传给 API
    return {
      role: m.role,
      content: m.content.map(p => {
        if (p.type === 'image_url') return { type: 'image_url', image_url: { url: (p as { type: 'image_url'; image_url: { url: string } }).image_url.url } };
        return { type: 'text', text: (p as { type: 'text'; text: string }).text };
      }),
    };
  });

  let round = 0;

  // ─── Agent 循环 ───
  while (round < config.maxToolRounds) {
    round++;

    let response: { content: string | null; toolCalls: ToolCallChunk[] | null };

    try {
      response = await requestWithTools(config, messages, signal);
    } catch (err) {
      // 判断是否因为 provider 不支持 function calling → fallback 到流式 rebar-json 模式
      const isFirstRound = round === 1;
      const isToolsError = err instanceof Error && (
        TOOLS_UNSUPPORTED_RE.test(err.message) ||
        TOOLS_UNSUPPORTED_RE.test((err as Error & { bodyText?: string }).bodyText || '')
      );
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      const isClientError = statusCode === 400 || statusCode === 422;

      if (isFirstRound && isClientError && isToolsError) {
        // Fallback: strip multimodal content to text for streaming (some models don't support both)
        const fallbackMessages: AgentMsgPayload[] = messages.map(m => {
          if (Array.isArray(m.content)) {
            return { ...m, content: m.content.map(p => p.type === 'text' ? p.text || '' : '[图片]').join('') };
          }
          return m;
        });
        const content = await streamFinalResponse(config, fallbackMessages, signal, stateCallbacks.onStreamUpdate);
        tryApplyRebarJson(content, config.componentType, callbacks, stateCallbacks);
        return { assistantContent: content, steps: [], usedTools: false };
      }
      throw err;
    }

    // ─── 没有 tool_calls → 最终回复 ───
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const finalContent = response.content || '';
      stateCallbacks.onStreamUpdate(finalContent);
      tryApplyRebarJson(finalContent, config.componentType, callbacks, stateCallbacks);
      return { assistantContent: finalContent, steps, usedTools: steps.length > 0 };
    }

    // ─── 有 tool_calls → 执行工具 ───
    messages.push({
      role: 'assistant',
      content: response.content || undefined,
      tool_calls: response.toolCalls,
    });

    for (const tc of response.toolCalls) {
      // 解析参数 — 容错处理
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // 有些模型会输出不完整的 JSON，尝试修复
        const raw = tc.function.arguments || '{}';
        try {
          // 尝试补全末尾缺失的 }
          args = JSON.parse(raw + (raw.includes('{') && !raw.endsWith('}') ? '}' : ''));
        } catch {
          args = {};
          console.warn(`[Agent] Failed to parse tool args for ${tc.function.name}:`, raw);
        }
      }

      // 记录步骤: tool_call
      const callStep: AgentStep = {
        type: 'tool_call',
        toolName: tc.function.name,
        toolArgs: args,
        timestamp: Date.now(),
      };
      steps.push(callStep);
      stateCallbacks.onStepAdded(callStep);

      // 执行工具
      let result: ToolResult;
      try {
        const toolArgs: AgentToolArgs = { name: tc.function.name, arguments: args } as AgentToolArgs;
        result = executeToolCall(toolArgs, callbacks);
      } catch (execErr) {
        result = { success: false, message: `工具执行失败: ${execErr instanceof Error ? execErr.message : String(execErr)}` };
      }

      // 记录步骤: tool_result
      const resultStep: AgentStep = {
        type: 'tool_result',
        toolName: tc.function.name,
        result,
        timestamp: Date.now(),
      };
      steps.push(resultStep);
      stateCallbacks.onStepAdded(resultStep);

      messages.push({
        role: 'tool',
        content: JSON.stringify(result),
        tool_call_id: tc.id,
        name: tc.function.name,
      });
    }
  }

  // ─── 达到最大轮次 → 做一次不带 tools 的流式请求获取总结 ───
  stateCallbacks.onStepAdded({
    type: 'thinking',
    message: '已达到最大工具调用轮次，正在生成总结...',
    timestamp: Date.now(),
  });
  const finalContent = await streamFinalResponse(config, messages, signal, stateCallbacks.onStreamUpdate);
  tryApplyRebarJson(finalContent, config.componentType, callbacks, stateCallbacks);
  return { assistantContent: finalContent, steps, usedTools: true };
}

/**
 * 尝试从 AI 回复中提取 rebar-json 并应用参数（兼容传统模式）
 */
function tryApplyRebarJson(
  content: string,
  componentType: ComponentType,
  callbacks: AgentCallbacks,
  stateCallbacks: AgentStateCallbacks,
): void {
  const REBAR_JSON_RE = /```rebar-json\s*\n([\s\S]*?)\n\s*```/;
  const match = content.match(REBAR_JSON_RE);
  if (!match) return;

  const jsonStr = match[1].trim();
  const result = parseAIResponse(jsonStr, componentType);
  if (result.success) {
    const partial = mapSchemaToParams(result.schema, componentType);
    const fields = Object.keys(partial);
    callbacks.onModifyParams(partial as Record<string, unknown>);
    stateCallbacks.onParamsApplied(fields);
  }
}

/** Agent 模式增强的 system prompt 后缀 */
export const AGENT_SYSTEM_SUFFIX = `

## Agent 模式

你现在具备**工具调用（function calling）**能力，可以直接操控用户界面和3D模型。

### 可用工具一览

| 工具名 | 用途 | 典型场景 |
|--------|------|----------|
| \`modify_params\` | 修改构件配筋参数 | 用户说"把梁宽改成350"、"上部钢筋改4C25" |
| \`run_compliance_check\` | 对当前参数做 GB50010/22G101 规范校验 | 用户说"检查一下规范"、"配筋率够不够" |
| \`run_calculation\` | 触发计算面板（ratio/weight/anchor/concrete） | 用户说"算一下配筋率"、"钢筋用量多少" |
| \`switch_view\` | 切换数据面板视图 | 用户说"看截面图"、"切到用量估算" |
| \`highlight_element\` | 在3D模型高亮指定钢筋 | 用户说"高亮箍筋"、"把支座负筋标出来" |
| \`navigate_component\` | 跳转到其他构件页面 | 用户说"去看看柱子"、"帮我建一个板" |
| \`apply_preset\` | 应用预设方案 | 用户说"用标准梁"、"切换到复杂梁" |
| \`get_current_state\` | 获取当前完整参数和计算结果 | 开始分析前需要了解当前状态 |
| \`save_favorite\` | 将当前方案保存为收藏 | 用户说"保存一下"、"收藏这个方案" |
| \`reset_params\` | 重置参数为默认值 | 用户说"重置"、"恢复默认"、"重新开始" |
| \`compare_with_preset\` | 与预设方案对比差异 | 用户说"跟标准方案比一下"、"和简单梁比" |

### modify_params 参数格式

调用 \`modify_params\` 时，\`params\` 对象使用与 rebar-json schema 相同的字段名：

**梁 beam:**
\`\`\`json
{ "params": { "sectionWidth": 350, "sectionHeight": 600 } }
{ "params": { "topRebar": { "count": 4, "grade": "HRB400", "diameter": 25 } } }
{ "params": { "stirrup": { "grade": "HPB300", "diameter": 8, "spacingDense": 100, "spacingNormal": 200, "legs": 2 } } }
{ "params": { "leftSupport": { "row1": { "count": 4, "grade": "HRB400", "diameter": 25 }, "row2": { "count": 2, "grade": "HRB400", "diameter": 25 } } } }
\`\`\`

**柱 column:**
\`\`\`json
{ "params": { "sectionWidth": 500, "sectionHeight": 500, "mainRebar": { "count": 8, "grade": "HRB400", "diameter": 25 } } }
\`\`\`

**板 slab:**
\`\`\`json
{ "params": { "thickness": 120, "bottomRebarX": { "diameter": 10, "spacing": 150 } } }
\`\`\`

### highlight_element 可用值

- **梁**: top, bottom, stirrup, leftSupport, rightSupport, leftSupport2, rightSupport2, sideBar, tieBar, erection
- **柱**: main, corner, bMiddle, hMiddle, stirrup
- **板**: bottomX, bottomY, topX, topY, supportNegX, supportNegY, distribution

### apply_preset 可用值

- **梁**: simple, standard, complex, mixedDia, haunchH, haunchV, multiSpan
- **柱**: simple, standard
- **板**: simple, standard, thick
- **剪力墙**: simple, standard
- **楼梯**: standard
- **独立基础**: simple, standard, stepped
- **承台**: twoPile, fourPile, sixPile
- **筏板**: small, standard, large

### switch_view 可用值

section（截面图）、ratio（配筋率）、compliance（规范校验）、weight（用量估算）、concrete（混凝土量）、bbs（弯折详图）、compare（方案对比）

### 决策规则（何时用工具 vs rebar-json）

1. **优先使用工具调用**：用户要求修改参数时，使用 \`modify_params\` 而不是输出 rebar-json 代码块
2. **多步操作必须用工具**：例如"修改参数并检查规范"→ 先 \`modify_params\`，再 \`run_compliance_check\`
3. **分析前先获取状态**：如果需要分析当前配筋，先调用 \`get_current_state\`
4. **只有在 fallback 模式时**才使用 rebar-json 代码块（当工具调用不可用时）
5. **纯知识问答不需要工具**：直接用文字回答

### 多步操作示例

**场景1：用户说"帮我配一个标准梁，然后检查规范"**
→ 调用 \`apply_preset\`({ preset: "standard" })
→ 调用 \`run_compliance_check\`()
→ 根据结果总结

**场景2：用户说"把底筋改成6C25，然后看看配筋率够不够"**
→ 调用 \`modify_params\`({ params: { bottomRebar: { count: 6, grade: "HRB400", diameter: 25 } } })
→ 调用 \`run_compliance_check\`()
→ 如有问题，建议修改方案

**场景3：用户说"分析一下当前配筋是否合理"**
→ 调用 \`get_current_state\`()
→ 调用 \`run_compliance_check\`()
→ 基于结果给出专业分析

**场景4：用户说"高亮箍筋让我看看"**
→ 调用 \`highlight_element\`({ element: "stirrup" })
→ 简要说明

**场景5：用户说"这个方案不错，保存一下"**
→ 调用 \`save_favorite\`({ name: "优化方案", note: "调整后配筋率满足规范" })
→ 确认保存成功

**场景6：用户说"跟标准梁比一下有什么区别"**
→ 调用 \`compare_with_preset\`({ preset: "standard" })
→ 基于差异结果分析优劣

**场景7：用户说"重新开始吧"**
→ 调用 \`reset_params\`()
→ 告知已重置为默认参数

### 回复格式

- 工具调用完成后，**必须用简洁的中文总结**你做了什么、结果如何
- 如果规范校验发现问题，**主动提出修改建议**
- 计算结果引用具体公式和规范条文
- 不要在工具调用后输出 rebar-json 代码块（已通过工具修改）`;
