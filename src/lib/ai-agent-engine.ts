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
  reasoningContent?: string;
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
    let errMsg = `AI 接口错误 (${res.status})`;
    try { const j = JSON.parse(errText); errMsg = j?.error?.message || j?.error || j?.message || errMsg; } catch { /* not JSON */ }
    const err = new Error(errMsg);
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
    reasoningContent: choice.message?.reasoning_content || undefined,
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
    let errMsg = `AI 接口错误 (${res.status})`;
    try { const j = JSON.parse(errText); errMsg = j?.error?.message || j?.error || j?.message || errMsg; } catch { /* not JSON */ }
    throw new Error(errMsg);
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

    // Emit thinking step immediately so the user sees activity during the API call
    stateCallbacks.onStepAdded({
      type: 'thinking',
      message: round === 1
        ? (config.hasImages ? 'AI 正在识别图纸...' : 'AI 正在分析请求...')
        : `第 ${round} 轮：处理工具结果，继续分析...`,
      timestamp: Date.now(),
    });

    let response: { content: string | null; toolCalls: ToolCallChunk[] | null; reasoningContent?: string };

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
    const assistantMsg: AgentMsgPayload = {
      role: 'assistant',
      content: response.content || undefined,
      tool_calls: response.toolCalls,
    };
    // Kimi (and other thinking-enabled models) require reasoning_content to be
    // replayed in the assistant message during multi-turn tool-call conversations.
    if (response.reasoningContent) {
      (assistantMsg as Record<string, unknown>).reasoning_content = response.reasoningContent;
    }
    messages.push(assistantMsg);

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

你具备**工具调用**能力，可直接修改3D模型。**始终优先调用工具**，不要输出 rebar-json 代码块。

### 工具速查

| 工具 | 场景 |
|------|------|
| \`modify_params\` | 修改任意配筋参数 |
| \`run_compliance_check\` | 规范校验（修参数后自动调用） |
| \`get_current_state\` | 分析前获取当前参数 |
| \`run_calculation\` | 配筋率/用量/锚固计算 |
| \`switch_view\` | 切换面板视图 |
| \`highlight_element\` | 3D高亮钢筋 |
| \`navigate_component\` | 跳转构件页面 |
| \`apply_preset\` | 应用预设方案 |
| \`save_favorite\` | 保存当前方案 |
| \`reset_params\` | 重置为默认值 |
| \`compare_with_preset\` | 与预设对比 |

### modify_params 字段名（按构件）

**梁 beam:**
- 截面: \`sectionWidth\`, \`sectionHeight\`, \`span\`
- 通长筋: \`topRebar\`, \`bottomRebar\` → \`{ count, grade, diameter }\`
- 支座负筋: \`leftSupport\`, \`rightSupport\` → \`{ row1: { count, grade, diameter }, row2: ... }\`
- 箍筋: \`stirrup\` → \`{ grade, diameter, spacingDense, spacingNormal, legs }\`
- 腰筋: \`sideBar\` → \`{ count, grade, diameter, spacing }\`

**柱 column:**
- 截面: \`sectionWidth\`, \`sectionHeight\`, \`height\`
- 主筋: \`mainRebar\` → \`{ count, grade, diameter }\`
- 箍筋: \`stirrup\` → \`{ grade, diameter, spacingDense, spacingNormal, legs }\`

**板 slab:**
- \`thickness\`, \`span\`
- 底筋: \`bottomRebarX\`, \`bottomRebarY\` → \`{ diameter, spacing, grade }\`
- 顶筋: \`topRebarX\`, \`topRebarY\`
- 支座负筋: \`supportNegX\`, \`supportNegY\`

**剪力墙 shearwall:**
- \`length\`, \`thickness\`, \`height\`
- \`verticalRebar\` → \`{ diameter, spacing, grade }\`
- \`horizontalRebar\` → \`{ diameter, spacing, grade }\`
- \`boundaryColumn\` → \`{ width, height, mainRebar: { count, grade, diameter } }\`

**楼梯 stair:**
- \`width\`, \`flightHeight\`, \`stepCount\`, \`stepWidth\`, \`stepHeight\`
- \`longitudinalRebar\` → \`{ diameter, spacing, grade }\`

**独立基础 isolatedFooting:**
- \`bottomWidth\`, \`bottomLength\`, \`topWidth\`, \`topLength\`, \`height\`
- \`bottomRebarX\`, \`bottomRebarY\` → \`{ diameter, spacing, grade }\`

**条形基础 stripFoundation:**
- \`length\`, \`width\`, \`thickness\`
- \`bottomBar\`, \`distBar\`, \`topBar\`, \`topDistBar\`
- \`supportType\`, \`supportCount\`, \`supportWidth\`, \`supportSpacing\`

**承台 pileCapFoundation:**
- \`pileCount\`, \`pileDiameter\`, \`pileSpacing\`
- \`bottomRebar\` → \`{ diameter, spacing, grade }\`

**筏板 raftFoundation:**
- \`length\`, \`width\`, \`thickness\`
- \`bottomRebarX\`, \`bottomRebarY\`, \`topRebarX\`, \`topRebarY\`

### 关键规则

1. **修改参数后，若用户关心合规性，自动调用 \`run_compliance_check\`**
2. **分析当前状态时，先调用 \`get_current_state\`**
3. **不确定字段名时，只传确定的字段，跳过不确定的**
4. **纯问答无需工具，直接回答**
5. **grade 固定值**: HPB300（光圆）/ HRB400（带肋，最常用）/ HRB500

### 示例

"把底筋改6C25再检规范" → \`modify_params\`({bottomRebar:{count:6,grade:"HRB400",diameter:25}}) → \`run_compliance_check\`()

"分析当前配筋" → \`get_current_state\`() → \`run_compliance_check\`() → 文字分析

"高亮箍筋" → \`highlight_element\`({element:"stirrup"})

"标准梁" → \`apply_preset\`({preset:"standard"}) → \`run_compliance_check\`()

### 回复格式

- 工具调用完成后，**必须用简洁的中文总结**你做了什么、结果如何
- 如果规范校验发现问题，**主动提出修改建议**
- 计算结果引用具体公式和规范条文
- 不要在工具调用后输出 rebar-json 代码块（已通过工具修改）`;
