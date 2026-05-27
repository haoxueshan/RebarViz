'use client';

import NextImage from 'next/image';
import { useState, useRef, useEffect, useCallback, memo, type ReactNode } from 'react';
import { Send, Trash2, ChevronDown, ChevronRight, Loader2, AlertCircle, Sparkles, Settings, Check, BookOpen, ShieldCheck, ShieldAlert, TriangleAlert, Image as ImageIcon, X, Zap, Eye } from 'lucide-react';
import { AI_PROVIDERS, type AIProvider } from '@/lib/ai-providers';
import type { ChatMessage } from '@/lib/ai-providers';
import { getApiKey, getApiKeys } from '@/lib/api-keys';
import type { ComponentType, BeamParams, ColumnParams, SlabParams, JointParams, ShearWallParams, StairParams, FoundationParams, StripFoundationParams, PileCapParams, RaftFoundationParams } from '@/lib/types';
import { parseAIResponse } from '@/lib/nl-rebar-parser';
import { mapSchemaToParams } from '@/lib/nl-rebar-mapper';
import { formatSchemaPreview } from '@/lib/nl-rebar-prompt';
import { buildSidebarSystemPrompt, PARAM_SUGGESTIONS, QA_SUGGESTIONS, ANALYSIS_SUGGESTIONS } from '@/lib/ai-sidebar-prompt';
import { tryParseNotation } from '@/lib/notation-parser';
import { checkCompliance, type ComplianceResult } from '@/lib/compliance';
import { runAgent, type AgentStep } from '@/lib/ai-agent-engine';
import { type AgentCallbacks } from '@/lib/ai-agent-tools';
import { aiFetch } from '@/lib/ai-fetch';
import { AgentStepDisplay } from './AgentStepDisplay';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type AnyParams = BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams | StairParams | FoundationParams | StripFoundationParams | PileCapParams | RaftFoundationParams;

export interface AISidebarProps {
  componentType: ComponentType;
  currentParams: AnyParams;
  onApplyParams: (partial: Partial<AnyParams>) => void;
  context: string;
  notationSlot?: ReactNode;
  initialMessage?: string; // 从首页跳转携带的 AI 消息，自动发送
  // ─── Agent callbacks (provided by page components) ───
  onSwitchTab?: (tab: string) => void;
  onHighlightElement?: (element: string) => void;
  onNavigateComponent?: (type: ComponentType, message?: string) => void;
  onApplyPreset?: (preset: string) => void;
  onGetCurrentState?: () => string;
  onRunComplianceCheck?: () => { results: ComplianceResult[]; summary: string };
  onRunCalculation?: (type: string) => { summary: string };
  onSaveFavorite?: (name: string, note?: string) => void;
  onResetParams?: () => void;
  onCompareWithPreset?: (preset: string) => string; // returns diff summary
}

/** rebar-json 块检测正则 */
const REBAR_JSON_RE = /```rebar-json\s*\n([\s\S]*?)\n\s*```/;

/** 从消息中提取 rebar-json 块 */
function extractRebarJSON(content: string): { json: string; rest: string } | null {
  const match = content.match(REBAR_JSON_RE);
  if (!match) return null;
  const json = match[1].trim();
  const rest = content.replace(REBAR_JSON_RE, '').trim();
  return { json, rest };
}

/** 应用结果 */
interface ApplyResult {
  success: boolean;
  fields?: string[];
  error?: string;
  preview?: string;
  local?: boolean;  // 是否本地解析
  compliance?: ComplianceResult[]; // 合规性检查结果
}

/** Markdown renderer for assistant messages */
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  // Strip rebar-json blocks from display (they're shown as param cards instead)
  const displayContent = content.replace(REBAR_JSON_RE, '').trim();
  if (!displayContent) return null;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-gray-800">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-600">{children}</em>,
        h1: ({ children }) => <h3 className="text-sm font-bold text-gray-800 mt-3 mb-1.5">{children}</h3>,
        h2: ({ children }) => <h3 className="text-sm font-bold text-gray-800 mt-3 mb-1.5">{children}</h3>,
        h3: ({ children }) => <h4 className="text-[13px] font-semibold text-gray-800 mt-2 mb-1">{children}</h4>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 mb-2 ml-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 mb-2 ml-1">{children}</ol>,
        li: ({ children }) => <li className="text-[13px] leading-relaxed">{children}</li>,
        code: ({ className, children }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <pre className="bg-slate-800 text-slate-100 rounded-xl px-3.5 py-2.5 my-2 overflow-x-auto text-xs leading-relaxed ring-1 ring-white/5">
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded-md text-[12px] font-mono">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-violet-200 pl-3 my-2 text-gray-500 italic">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2 rounded-lg border border-gray-100">
            <table className="min-w-full text-xs border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
        th: ({ children }) => <th className="border-b border-gray-100 px-2.5 py-1.5 text-left font-semibold text-gray-600">{children}</th>,
        td: ({ children }) => <td className="border-b border-gray-50 px-2.5 py-1.5">{children}</td>,
        hr: () => <hr className="my-3 border-gray-100" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 hover:underline underline-offset-2">
            {children}
          </a>
        ),
      }}
    >
      {displayContent}
    </ReactMarkdown>
  );
});

export function AISidebar({ componentType, currentParams, onApplyParams, context, notationSlot, initialMessage, onSwitchTab, onHighlightElement, onNavigateComponent, onApplyPreset, onGetCurrentState, onRunComplianceCheck: onRunComplianceCheckProp, onRunCalculation, onSaveFavorite, onResetParams, onCompareWithPreset }: AISidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState('deepseek');
  const [model, setModel] = useState('');
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [hasAnyKey, setHasAnyKey] = useState(false);
  const [applyResults, setApplyResults] = useState<Record<number, ApplyResult>>({});
  const [showNotation, setShowNotation] = useState(false);
  // ─── Agent mode state ───
  const [agentSteps, setAgentSteps] = useState<Record<number, AgentStep[]>>({});
  const [agentMode, setAgentMode] = useState(true); // Agent 模式默认开启
  // ─── Image upload state ───
  const [pendingImages, setPendingImages] = useState<string[]>([]); // base64 data URLs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Image compression helper ───
  const compressImage = async (dataUrl: string, maxSize = 1024): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = Math.round((height / width) * maxSize); width = maxSize; }
          else { width = Math.round((width / height) * maxSize); height = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    });
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0); // auto-retry counter
  // Track currentParams as ref so streaming callback always has latest
  const currentParamsRef = useRef(currentParams);
  currentParamsRef.current = currentParams;

  const provider = AI_PROVIDERS.find(p => p.id === providerId) || AI_PROVIDERS[0];

  useEffect(() => {
    setModel(provider.defaultModel);
  }, [provider]);

  useEffect(() => {
    const keys = getApiKeys();
    const configured = Object.entries(keys).filter(([, v]) => !!v);
    setHasAnyKey(configured.length > 0);
    if (configured.length > 0 && !getApiKey(providerId)) {
      setProviderId(configured[0][0]);
    }
  }, [providerId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Auto-send initialMessage from homepage redirect
  const initialSentRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !initialSentRef.current && hasAnyKey) {
      initialSentRef.current = true;
      // Small delay to ensure component is fully mounted
      const timer = setTimeout(() => sendMessage(initialMessage), 300);
      return () => clearTimeout(timer);
    }
  }, [initialMessage, hasAnyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Run compliance check after params applied */
  const runComplianceCheck = useCallback((mergedParams: AnyParams): ComplianceResult[] => {
    try {
      return checkCompliance(componentType, mergedParams as BeamParams & ColumnParams & SlabParams & ShearWallParams);
    } catch {
      return [];
    }
  }, [componentType]);

  /** Try to detect and apply rebar-json from completed message, returns parse error if failed */
  const tryApplyParams = useCallback((content: string, msgIndex: number): string | null => {
    const extracted = extractRebarJSON(content);
    if (!extracted) return null;

    const result = parseAIResponse(extracted.json, componentType);
    if (result.success) {
      const partial = mapSchemaToParams(result.schema, componentType);
      const fields = Object.keys(partial);
      const preview = formatSchemaPreview(result.schema, componentType);
      onApplyParams(partial);
      // Run compliance check on the merged params
      const merged = { ...currentParamsRef.current, ...partial } as AnyParams;
      const compliance = runComplianceCheck(merged);
      setApplyResults(prev => ({ ...prev, [msgIndex]: { success: true, fields, preview, compliance } }));
      return null;
    } else {
      setApplyResults(prev => ({ ...prev, [msgIndex]: { success: false, error: result.error } }));
      return result.error;
    }
  }, [componentType, onApplyParams, runComplianceCheck]);

  /** Stream an AI request and return assistant content */
  const streamAIRequest = useCallback(async (
    allMessages: ChatMessage[],
    controller: AbortController,
    onUpdate: (content: string) => void,
    modelOverride?: string,
    providerOverride?: { provider: AIProvider; apiKey: string },
  ): Promise<string> => {
    const effectiveProvider = providerOverride?.provider ?? provider;
    const apiKey = providerOverride?.apiKey ?? getApiKey(providerId);
    if (!apiKey) throw new Error(`未配置 ${effectiveProvider.name} API Key，请在设置中添加`);

    const systemContent = buildSidebarSystemPrompt(componentType, context);

    const { response: res } = await aiFetch({
      provider: effectiveProvider,
      model: modelOverride || model,
      apiKey,
      systemPrompt: systemContent,
      messages: allMessages as Array<{ role: string; content?: unknown }>,
      stream: true,
      temperature: 0.3,
      max_tokens: 4096,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`${provider.name} 接口错误: ${res.status}${errText ? ' - ' + errText.slice(0, 100) : ''}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let assistantContent = '';
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
            assistantContent += delta;
            onUpdate(assistantContent);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    if (!assistantContent) {
      throw new Error('AI 未返回有效回复');
    }

    return assistantContent;
  }, [providerId, model, context, componentType, provider]);

  // ─── Build Agent callbacks from page-level props ───
  const buildAgentCallbacks = useCallback((): AgentCallbacks => ({
    onModifyParams: (params) => {
      try {
        // Try parsing as rebar-json schema first
        const result = parseAIResponse(JSON.stringify({ componentType, ...params }), componentType);
        if (result.success) {
          const partial = mapSchemaToParams(result.schema, componentType);
          // If schema mapping produced non-empty result, apply it
          if (Object.keys(partial).length > 0) {
            onApplyParams(partial);
            const merged = { ...currentParamsRef.current, ...partial } as AnyParams;
            const compliance = runComplianceCheck(merged);
            const hasIssues = compliance.some(c => c.status !== 'pass');
            return { success: true, message: `已更新 ${Object.keys(partial).join(', ')}${hasIssues ? '（规范校验发现问题）' : ''}` };
          }
          // Schema parsing succeeded but no fields mapped — AI likely used internal names, fall through
        }
        // Direct param apply — works when AI uses internal field names (b, h, top, bottom, etc.)
        onApplyParams(params as Partial<AnyParams>);
        const merged = { ...currentParamsRef.current, ...params } as AnyParams;
        const compliance = runComplianceCheck(merged);
        const hasIssues = compliance.some(c => c.status !== 'pass');
        return { success: true, message: `已更新参数: ${Object.keys(params).join(', ')}${hasIssues ? '（规范校验发现问题）' : ''}` };
      } catch (err) {
        return { success: false, message: `参数更新失败: ${err instanceof Error ? err.message : '未知错误'}` };
      }
    },
    onRunComplianceCheck: () => {
      if (onRunComplianceCheckProp) {
        const { results, summary } = onRunComplianceCheckProp();
        return { success: true, message: summary, data: results };
      }
      const results = runComplianceCheck(currentParamsRef.current);
      const pass = results.filter(r => r.status === 'pass').length;
      const fail = results.filter(r => r.status === 'fail').length;
      const warn = results.filter(r => r.status === 'warn').length;
      const summary = `校验完成: ${pass}项通过, ${fail}项不通过, ${warn}项警告\n${results.filter(r => r.status !== 'pass').map(r => `- [${r.status === 'fail' ? '❌' : '⚠️'}] ${r.message} (${r.rule})`).join('\n')}`;
      return { success: true, message: summary, data: results };
    },
    onRunCalculation: (type) => {
      if (onRunCalculation) {
        const { summary } = onRunCalculation(type);
        return { success: true, message: summary };
      }
      return { success: true, message: `已切换到${type === 'ratio' ? '配筋率' : type === 'weight' ? '用量估算' : type === 'anchor' ? '锚固计算' : '混凝土量'}面板` };
    },
    onSwitchView: (tab) => {
      if (onSwitchTab) {
        onSwitchTab(tab);
        const tabNames: Record<string, string> = { section: '截面图', ratio: '配筋率', compliance: '规范校验', weight: '用量估算', concrete: '混凝土量', bbs: '弯折详图', compare: '方案对比' };
        return { success: true, message: `已切换到「${tabNames[tab] || tab}」面板` };
      }
      return { success: false, message: '当前页面不支持切换面板' };
    },
    onHighlightElement: (element) => {
      if (onHighlightElement) {
        onHighlightElement(element);
        return { success: true, message: `已高亮: ${element}` };
      }
      return { success: false, message: '当前页面不支持高亮' };
    },
    onNavigateComponent: (type, message) => {
      if (onNavigateComponent) {
        onNavigateComponent(type, message);
        return { success: true, message: `正在跳转到 ${type} 页面...` };
      }
      return { success: false, message: '当前页面不支持跳转' };
    },
    onApplyPreset: (preset) => {
      if (onApplyPreset) {
        onApplyPreset(preset);
        return { success: true, message: `已应用预设: ${preset}` };
      }
      return { success: false, message: '当前页面不支持预设' };
    },
    onGetCurrentState: () => {
      if (onGetCurrentState) {
        return { success: true, message: onGetCurrentState() };
      }
      return { success: true, message: context };
    },
    onSaveFavorite: (name, note) => {
      if (onSaveFavorite) {
        onSaveFavorite(name, note);
        return { success: true, message: `已保存方案「${name}」${note ? `（备注: ${note}）` : ''}到收藏` };
      }
      return { success: false, message: '当前页面不支持保存收藏' };
    },
    onResetParams: () => {
      if (onResetParams) {
        onResetParams();
        return { success: true, message: '已重置为默认参数' };
      }
      return { success: false, message: '当前页面不支持重置' };
    },
    onCompareWithPreset: (preset) => {
      if (onCompareWithPreset) {
        const diff = onCompareWithPreset(preset);
        return { success: true, message: diff };
      }
      return { success: false, message: '当前页面不支持方案对比' };
    },
  }), [componentType, onApplyParams, runComplianceCheck, onRunComplianceCheckProp, onRunCalculation, onSwitchTab, onHighlightElement, onNavigateComponent, onApplyPreset, onGetCurrentState, context, onSaveFavorite, onResetParams, onCompareWithPreset]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const trimmedText = text.trim();

    // ─── Step 0: Try local notation parsing first ───
    const notationResult = tryParseNotation(trimmedText, componentType);
    if (notationResult.success) {
      const userMsg: ChatMessage = { role: 'user', content: trimmedText };
      const assistantMsg: ChatMessage = { role: 'assistant', content: notationResult.description };
      const newMsgs = [...messages, userMsg, assistantMsg];
      setMessages(newMsgs);
      setInput('');

      // Apply params directly
      onApplyParams(notationResult.params);
      const merged = { ...currentParamsRef.current, ...notationResult.params } as AnyParams;
      const compliance = runComplianceCheck(merged);
      const fields = Object.keys(notationResult.params);
      setApplyResults(prev => ({
        ...prev,
        [newMsgs.length - 1]: { success: true, fields, preview: notationResult.description, local: true, compliance },
      }));
      return;
    }

    // ─── Build user message (with images if any) ───
    const hasImages = pendingImages.length > 0;
    let userContent: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
    if (hasImages) {
      userContent = [
        { type: 'text' as const, text: trimmedText || '请识别这张图纸中的配筋信息，并生成对应的3D模型' },
        ...pendingImages.map(img => ({
          type: 'image_url' as const,
          image_url: { url: img },
        })),
      ];
      setPendingImages([]);
    } else {
      userContent = trimmedText;
    }

    const userMsg: ChatMessage = { role: 'user', content: userContent };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setError(null);
    setLoading(true);
    retryCountRef.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
      setMessages([...newMessages, assistantMsg]);
      const assistantIndex = newMessages.length;

      // ─── Agent mode: use tool-calling agent engine ───
      if (agentMode) {
        // Auto-switch provider when images present but current provider lacks vision
        let activeProvider = provider;
        let activeProviderId = providerId;
        let activeModel = model;
        let visionSwitchNote = '';

        if (hasImages) {
          if (provider.visionModel) {
            activeModel = provider.visionModel;
          } else {
            // Find a vision-capable provider with a valid API key
            const visionProvider = AI_PROVIDERS.find(p => p.visionModel && getApiKey(p.id));
            if (visionProvider) {
              activeProvider = visionProvider;
              activeProviderId = visionProvider.id;
              activeModel = visionProvider.visionModel!;
              visionSwitchNote = `> 📷 已自动切换到 **${visionProvider.name}** (${visionProvider.visionModel}) 进行图片识别\n\n`;
            } else {
              throw new Error('当前没有支持图片识别的模型可用。请在设置中配置 Qwen 或 OpenAI 的 API Key');
            }
          }
        }

        const apiKey = getApiKey(activeProviderId);
        if (!apiKey) throw new Error(`未配置 ${activeProvider.name} API Key，请在设置中添加`);

        const agentResult = await runAgent(
          {
            maxToolRounds: 5,
            provider: activeProvider,
            model: activeModel,
            apiKey,
            componentType,
            context,
            hasImages,
          },
          newMessages,
          buildAgentCallbacks(),
          {
            onStreamUpdate: (content) => {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content };
                return updated;
              });
            },
            onStepAdded: (step) => {
              setAgentSteps(prev => ({
                ...prev,
                [assistantIndex]: [...(prev[assistantIndex] || []), step],
              }));
            },
            onParamsApplied: (fields) => {
              const merged = { ...currentParamsRef.current };
              const compliance = runComplianceCheck(merged);
              setApplyResults(prev => ({
                ...prev,
                [assistantIndex]: { success: true, fields, compliance },
              }));
            },
          },
          controller.signal,
        );

        // Final message update (prepend vision switch note if applicable)
        const finalContent = visionSwitchNote + agentResult.assistantContent;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: finalContent };
          return updated;
        });

        // If agent didn't use tools, try legacy rebar-json parsing
        if (!agentResult.usedTools) {
          const parseError = tryApplyParams(agentResult.assistantContent, assistantIndex);
          // Auto-retry on parse error
          if (parseError && retryCountRef.current < 1) {
            retryCountRef.current += 1;
            const correctionMsg: ChatMessage = {
              role: 'user',
              content: `你的JSON输出有以下错误，请修正后重新输出 rebar-json 代码块：\n${parseError}`,
            };
            const retryMessages = [...newMessages, { role: 'assistant' as const, content: agentResult.assistantContent }, correctionMsg];
            const retryAssistantMsg: ChatMessage = { role: 'assistant', content: '' };
            setMessages([...retryMessages, retryAssistantMsg]);
            const retryIndex = retryMessages.length;
            setApplyResults(prev => ({ ...prev, [assistantIndex]: { success: false, error: '正在自动修正...' } }));
            const retryContent = await streamAIRequest(retryMessages, controller, (content) => {
              setMessages(prev => { const updated = [...prev]; updated[updated.length - 1] = { role: 'assistant', content }; return updated; });
            });
            tryApplyParams(retryContent, retryIndex);
          }
        }
      } else {
        // ─── Legacy mode: direct streaming without tools ───
        let legacyModel: string | undefined;
        let legacyProviderOverride: { provider: AIProvider; apiKey: string } | undefined;

        if (hasImages) {
          if (provider.visionModel) {
            legacyModel = provider.visionModel;
          } else {
            const vp = AI_PROVIDERS.find(p => p.visionModel && getApiKey(p.id));
            if (vp) {
              legacyModel = vp.visionModel!;
              legacyProviderOverride = { provider: vp, apiKey: getApiKey(vp.id)! };
            } else {
              throw new Error('当前没有支持图片识别的模型可用。请在设置中配置 Qwen 或 OpenAI 的 API Key');
            }
          }
        }

        const assistantContent = await streamAIRequest(
          newMessages,
          controller,
          (content) => {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content };
              return updated;
            });
          },
          legacyModel,
          legacyProviderOverride,
        );

        const parseError = tryApplyParams(assistantContent, assistantIndex);

        if (parseError && retryCountRef.current < 1) {
          retryCountRef.current += 1;
          const correctionMsg: ChatMessage = {
            role: 'user',
            content: `你的JSON输出有以下错误，请修正后重新输出 rebar-json 代码块：\n${parseError}`,
          };
          const retryMessages = [...newMessages, { role: 'assistant' as const, content: assistantContent }, correctionMsg];
          const retryAssistantMsg: ChatMessage = { role: 'assistant', content: '' };
          setMessages([...retryMessages, retryAssistantMsg]);
          const retryIndex = retryMessages.length;
          setApplyResults(prev => ({ ...prev, [assistantIndex]: { success: false, error: '正在自动修正...' } }));
          const retryContent = await streamAIRequest(retryMessages, controller, (content) => {
            setMessages(prev => { const updated = [...prev]; updated[updated.length - 1] = { role: 'assistant', content }; return updated; });
          });
          tryApplyParams(retryContent, retryIndex);
        }
      }

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '请求失败');
      setMessages(prev => prev.filter(m => m.content !== ''));
    } finally {
      setLoading(false);
      abortRef.current = null;
      retryCountRef.current = 0;
    }
  }, [messages, loading, componentType, streamAIRequest, tryApplyParams, onApplyParams, runComplianceCheck, agentMode, providerId, model, provider, context, buildAgentCallbacks, pendingImages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    if (loading && abortRef.current) abortRef.current.abort();
    setMessages([]);
    setApplyResults({});
    setAgentSteps({});
    setError(null);
    setLoading(false);
    retryCountRef.current = 0;
  };

  const hasAppliedParams = Object.values(applyResults).some(r => r.success);
  const paramChips = PARAM_SUGGESTIONS[componentType];
  const qaChips = QA_SUGGESTIONS[componentType];
  const analysisChips = ANALYSIS_SUGGESTIONS[componentType];

  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)] flex flex-col h-[calc(100vh-6rem)] sticky top-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 text-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center ring-1 ring-white/20">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-[13px] leading-tight">AI 助手</span>
            <span className="text-[10px] text-white/50 leading-tight">钢筋计算 · 规范问答</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setAgentMode(a => !a)}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${agentMode ? 'bg-violet-500/30 text-violet-200 ring-1 ring-violet-400/30 hover:bg-violet-500/40' : 'hover:bg-white/10 text-white/50'}`}
            title={agentMode ? 'Agent 模式已开启（支持工具调用）' : 'Agent 模式已关闭（仅文本）'}
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
          <button onClick={clearChat} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer" title="清空对话">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Provider selector */}
      <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50/30 shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowProviderMenu(!showProviderMenu)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors cursor-pointer group"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            <span className="font-medium text-gray-600">{provider.name}</span>
            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-mono">{model}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showProviderMenu ? 'rotate-180' : ''}`} />
          </button>
          {showProviderMenu && (
            <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl shadow-lg border border-gray-200/80 py-1 z-10 min-w-[240px] ring-1 ring-black/5">
              {AI_PROVIDERS.map(p => (
                <div key={p.id}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                    {p.name}
                    {getApiKey(p.id) ? (
                      <span className="flex items-center gap-1 text-green-500 normal-case tracking-normal"><span className="w-1 h-1 rounded-full bg-green-400" />已配置</span>
                    ) : (
                      <span className="text-gray-300 normal-case tracking-normal">未配置</span>
                    )}
                  </div>
                  {p.models.map(m => (
                    <button
                      key={m}
                      onClick={() => { setProviderId(p.id); setModel(m); setShowProviderMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer transition-colors flex items-center gap-2 ${
                        providerId === p.id && model === m ? 'text-accent font-medium bg-accent/5' : 'text-gray-600'
                      }`}
                    >
                      {providerId === p.id && model === m && <Check className="w-3 h-3 text-accent shrink-0" />}
                      <span className={providerId === p.id && model === m ? '' : 'ml-5'}>{m}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Collapsible notation slot */}
      {notationSlot && (
        <div className="border-b border-gray-100 shrink-0">
          <button
            onClick={() => setShowNotation(!showNotation)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted hover:text-primary transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>标注解读</span>
            {showNotation ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          {showNotation && (
            <div className="px-4 pb-3 max-h-[40vh] overflow-y-auto">
              {notationSlot}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 scrollbar-thin">
        {messages.length === 0 && !loading && (
          <div className="space-y-5 pt-4">
            {!hasAnyKey ? (
              <div className="text-center space-y-4 pt-8">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
                  <Settings className="w-7 h-7 text-gray-300" />
                </div>
                <div>
                  <p className="text-sm text-gray-700 font-semibold">尚未配置 API Key</p>
                  <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">请先在设置中添加至少一个<br/>AI 服务商的 API Key</p>
                </div>
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-accent text-white text-xs font-medium rounded-xl hover:bg-blue-600 transition-all shadow-sm shadow-accent/20 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  前往设置
                </Link>
              </div>
            ) : (
              <>
                <div className="text-center pt-2">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-500/20">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-sm font-semibold text-gray-800">描述配筋，AI 直接生成模型</p>
                  <p className="text-xs text-gray-400 mt-1">支持标注识别 · 规范校验 · 智能问答</p>
                </div>

                {/* Param suggestion chips */}
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-3.5 h-[1.5px] bg-blue-300 rounded-full" />
                    配筋示例
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {paramChips.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="px-2.5 py-1.5 text-[11px] text-blue-600 bg-blue-50/80 hover:bg-blue-100 rounded-lg transition-all cursor-pointer leading-tight hover:shadow-sm border border-blue-100/60"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* QA suggestion chips */}
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-3.5 h-[1.5px] bg-gray-300 rounded-full" />
                    知识问答
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {qaChips.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="px-2.5 py-1.5 text-[11px] text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-all cursor-pointer leading-tight hover:shadow-sm border border-gray-100/80"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Analysis suggestion chips */}
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-3.5 h-[1.5px] bg-emerald-300 rounded-full" />
                    智能分析
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {analysisChips.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="px-2.5 py-1.5 text-[11px] text-emerald-600 bg-emerald-50/80 hover:bg-emerald-100 rounded-lg transition-all cursor-pointer leading-tight hover:shadow-sm border border-emerald-100/60"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className="animate-message-in">
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[85%] space-y-1.5">
                  {/* Show image thumbnails in message */}
                  {Array.isArray(msg.content) && msg.content.some(p => p.type === 'image_url') && (
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {msg.content.filter(p => p.type === 'image_url').map((p, pi) => (
                        <NextImage
                          key={pi}
                          src={(p as { type: 'image_url'; image_url: { url: string } }).image_url.url}
                          alt="上传图片"
                          width={80}
                          height={80}
                          unoptimized
                          className="h-20 w-20 rounded-xl border border-white/20 object-cover shadow-sm"
                        />
                      ))}
                    </div>
                  )}
                  {/* Text bubble */}
                  {(typeof msg.content === 'string' ? msg.content : msg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('')).trim() && (
                    <div className="px-3.5 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-500/15">
                      {typeof msg.content === 'string' ? msg.content : msg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('')}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`max-w-[95%] px-3.5 py-2.5 rounded-2xl rounded-bl-md text-[13px] leading-relaxed bg-gray-50/80 text-gray-700 border border-gray-100/80 ${!msg.content && loading && i === messages.length - 1 && agentMode ? 'hidden' : ''}`}>
                  {msg.content ? (
                    <MarkdownContent content={typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join('')} />
                  ) : (
                    loading && i === messages.length - 1 && !agentMode && (
                      <span className="flex items-center gap-2 text-gray-400 py-0.5">
                        <span className="flex gap-1">
                          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-violet-400" />
                          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-violet-400" />
                          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-violet-400" />
                        </span>
                        <span className="text-xs">思考中</span>
                      </span>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Agent steps (tool calls) — show even when steps empty but streaming, for initial spinner */}
            {msg.role === 'assistant' && agentMode && (agentSteps[i]?.length > 0 || (loading && i === messages.length - 1)) && (
              <AgentStepDisplay
                steps={agentSteps[i] || []}
                isStreaming={loading && i === messages.length - 1}
              />
            )}

            {/* Apply result chip */}
            {applyResults[i] && (
              <div className={`mt-1.5 space-y-1.5 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {applyResults[i].success ? (
                  <>
                    <div className="inline-flex items-start gap-1.5 px-2.5 py-1.5 bg-green-50 rounded-lg text-[11px] text-green-700 border border-green-100">
                      <Check className="w-3 h-3 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">
                          {applyResults[i].local ? '已识别标注并更新' : '已更新参数'}
                        </span>
                        {applyResults[i].local && (
                          <span className="ml-1.5 px-1 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">本地解析</span>
                        )}
                        {applyResults[i].preview && (
                          <p className="mt-0.5 text-green-600 whitespace-pre-line">{applyResults[i].preview}</p>
                        )}
                      </div>
                    </div>
                    {/* Compliance check results */}
                    {applyResults[i].compliance && applyResults[i].compliance!.some(c => c.status !== 'pass') && (
                      <div className="inline-block text-left">
                        <div className="px-2.5 py-1.5 bg-orange-50 rounded-lg text-[11px] border border-orange-100 space-y-1">
                          <div className="flex items-center gap-1 text-orange-700 font-medium">
                            <ShieldAlert className="w-3 h-3 shrink-0" />
                            <span>规范校验</span>
                          </div>
                          {applyResults[i].compliance!.filter(c => c.status !== 'pass').map((c, ci) => (
                            <div key={ci} className="flex items-start gap-1">
                              {c.status === 'fail' ? (
                                <TriangleAlert className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                              ) : (
                                <AlertCircle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                              )}
                              <div>
                                <span className={c.status === 'fail' ? 'text-red-700' : 'text-amber-700'}>
                                  {c.message}
                                </span>
                                <span className="text-gray-400 ml-1">({c.rule})</span>
                                {c.suggestion && (
                                  <p className="text-orange-600 mt-0.5">{c.suggestion}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {applyResults[i].compliance && applyResults[i].compliance!.every(c => c.status === 'pass') && (
                      <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 rounded-lg text-[10px] text-emerald-700 border border-emerald-100">
                        <ShieldCheck className="w-3 h-3" />
                        <span>满足规范要求</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="inline-flex items-start gap-1.5 px-2.5 py-1.5 bg-amber-50 rounded-lg text-[11px] text-amber-700 border border-amber-100">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{applyResults[i].error === '正在自动修正...' ? '正在自动修正...' : '参数解析失败，请重新描述'}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-50 rounded-lg text-xs text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Post-apply suggestions */}
        {messages.length > 0 && !loading && hasAnyKey && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {(hasAppliedParams
              ? ['查看锚固长度计算', '优化箍筋间距', '加支座负筋', '换混凝土等级']
              : paramChips.slice(0, 3)
            ).map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                className="px-2.5 py-1.5 text-[11px] text-gray-500 bg-white hover:bg-gray-50 rounded-lg transition-all cursor-pointer border border-gray-150 hover:border-gray-200 hover:text-gray-600 hover:shadow-sm"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-100 bg-gray-50/30 shrink-0">
        {/* Image preview */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2.5 px-1">
            {pendingImages.map((img, idx) => (
              <div key={idx} className="relative group">
                <NextImage
                  src={img}
                  alt="上传图片"
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 rounded-xl border border-gray-200 object-cover shadow-sm"
                />
                <button
                  onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-sm"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Unified input group */}
        <div className="flex items-end gap-2 bg-white rounded-2xl border border-gray-200 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all shadow-sm">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (!files) return;
              Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                  const dataUrl = ev.target?.result as string;
                  if (dataUrl) {
                    const compressed = await compressImage(dataUrl);
                    setPendingImages(prev => [...prev, compressed]);
                  }
                };
                reader.readAsDataURL(file);
              });
              e.target.value = '';
            }}
          />
          {/* Image upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 ml-1 mb-1 rounded-xl transition-colors cursor-pointer shrink-0 text-gray-300 hover:text-blue-500 hover:bg-blue-50"
            title={provider.visionModel ? '上传图纸/图片（支持 Vision）' : `上传图片（发送时将自动切换到支持 Vision 的模型）`}
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={async (e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of Array.from(items)) {
                if (item.type.startsWith('image/')) {
                  e.preventDefault();
                  const file = item.getAsFile();
                  if (!file) continue;
                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                    const dataUrl = ev.target?.result as string;
                    if (dataUrl) {
                      const compressed = await compressImage(dataUrl);
                      setPendingImages(prev => [...prev, compressed]);
                    }
                  };
                  reader.readAsDataURL(file);
                }
              }
            }}
            placeholder={pendingImages.length > 0 ? '描述图纸内容或直接发送...' : '描述配筋或提问...'}
            rows={1}
            className="flex-1 resize-none py-2.5 text-sm outline-none bg-transparent max-h-24 overflow-y-auto placeholder:text-gray-300"
            style={{ minHeight: '40px' }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={(!input.trim() && pendingImages.length === 0) || loading}
            className="p-2 mr-1 mb-1 rounded-xl transition-all cursor-pointer shrink-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-500/20 hover:shadow-md hover:shadow-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
            aria-label="发送"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {/* Mode indicator */}
        <div className="flex items-center gap-2 mt-2 px-1">
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            {agentMode && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-50 text-violet-500 rounded-full font-medium">
                <Zap className="w-2.5 h-2.5" />Agent
              </span>
            )}
            {pendingImages.length > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-cyan-50 text-cyan-500 rounded-full font-medium">
                <Eye className="w-2.5 h-2.5" />Vision
              </span>
            )}
          </div>
          <span className="ml-auto text-[10px] text-gray-300">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>
    </div>
  );
}
