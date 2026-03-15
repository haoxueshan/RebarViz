'use client';

import { useState, useRef, useEffect, useCallback, memo, type ReactNode } from 'react';
import { Send, Trash2, ChevronDown, ChevronRight, Loader2, AlertCircle, Sparkles, Settings, Check, BookOpen, ShieldCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import { AI_PROVIDERS } from '@/lib/ai-providers';
import type { ChatMessage } from '@/lib/ai-providers';
import { getApiKey, getApiKeys } from '@/lib/api-keys';
import type { ComponentType, BeamParams, ColumnParams, SlabParams, JointParams, ShearWallParams, StairParams, FoundationParams, PileCapParams, RaftFoundationParams } from '@/lib/types';
import { parseAIResponse } from '@/lib/nl-rebar-parser';
import { mapSchemaToParams } from '@/lib/nl-rebar-mapper';
import { formatSchemaPreview } from '@/lib/nl-rebar-prompt';
import { buildSidebarSystemPrompt, PARAM_SUGGESTIONS, QA_SUGGESTIONS, ANALYSIS_SUGGESTIONS } from '@/lib/ai-sidebar-prompt';
import { tryParseNotation } from '@/lib/notation-parser';
import { checkCompliance, type ComplianceResult } from '@/lib/compliance';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type AnyParams = BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams | StairParams | FoundationParams | PileCapParams | RaftFoundationParams;

interface AISidebarProps {
  componentType: ComponentType;
  currentParams: AnyParams;
  onApplyParams: (partial: Partial<AnyParams>) => void;
  context: string;
  notationSlot?: ReactNode;
  initialMessage?: string; // 从首页跳转携带的 AI 消息，自动发送
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
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        h1: ({ children }) => <h3 className="text-sm font-bold text-gray-900 mt-3 mb-1">{children}</h3>,
        h2: ({ children }) => <h3 className="text-sm font-bold text-gray-900 mt-3 mb-1">{children}</h3>,
        h3: ({ children }) => <h4 className="text-[13px] font-semibold text-gray-900 mt-2 mb-1">{children}</h4>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 mb-2 ml-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 mb-2 ml-1">{children}</ol>,
        li: ({ children }) => <li className="text-[13px] leading-relaxed">{children}</li>,
        code: ({ className, children }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <pre className="bg-gray-800 text-gray-100 rounded-lg px-3 py-2 my-2 overflow-x-auto text-xs leading-relaxed">
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code className="bg-gray-200/60 text-red-600 px-1 py-0.5 rounded text-[12px] font-mono">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent/40 pl-3 my-2 text-gray-600 italic">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full text-xs border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-100">{children}</thead>,
        th: ({ children }) => <th className="border border-gray-200 px-2 py-1 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-gray-200 px-2 py-1">{children}</td>,
        hr: () => <hr className="my-2 border-gray-200" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {children}
          </a>
        ),
      }}
    >
      {displayContent}
    </ReactMarkdown>
  );
});

export function AISidebar({ componentType, currentParams, onApplyParams, context, notationSlot, initialMessage }: AISidebarProps) {
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
      const merged = { ...currentParamsRef.current, ...partial };
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
  ): Promise<string> => {
    const apiKey = getApiKey(providerId);
    if (!apiKey) throw new Error(`未配置 ${provider.name} API Key，请在设置中添加`);

    const systemContent = buildSidebarSystemPrompt(componentType, context);

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContent },
          ...allMessages,
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 4096,
      }),
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
      const merged = { ...currentParamsRef.current, ...notationResult.params };
      const compliance = runComplianceCheck(merged);
      const fields = Object.keys(notationResult.params);
      setApplyResults(prev => ({
        ...prev,
        [newMsgs.length - 1]: { success: true, fields, preview: notationResult.description, local: true, compliance },
      }));
      return;
    }

    // ─── Step 1: Normal AI flow ───
    const userMsg: ChatMessage = { role: 'user', content: trimmedText };
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
      );

      // After streaming completes, try to detect and apply params
      const parseError = tryApplyParams(assistantContent, assistantIndex);

      // ─── Step 2: Auto-retry if parse failed and content had rebar-json ───
      if (parseError && retryCountRef.current < 1) {
        retryCountRef.current += 1;

        // Append error correction request to conversation
        const correctionMsg: ChatMessage = {
          role: 'user',
          content: `你的JSON输出有以下错误，请修正后重新输出 rebar-json 代码块：\n${parseError}`,
        };
        const retryMessages = [
          ...newMessages,
          { role: 'assistant' as const, content: assistantContent },
          correctionMsg,
        ];

        // Show correction in UI
        const retryAssistantMsg: ChatMessage = { role: 'assistant', content: '' };
        setMessages([...retryMessages, retryAssistantMsg]);
        const retryIndex = retryMessages.length;

        // Update apply result to show "retrying"
        setApplyResults(prev => ({
          ...prev,
          [assistantIndex]: { success: false, error: '正在自动修正...' },
        }));

        const retryContent = await streamAIRequest(
          retryMessages,
          controller,
          (content) => {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content };
              return updated;
            });
          },
        );

        // Try apply again
        tryApplyParams(retryContent, retryIndex);
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
  }, [messages, loading, componentType, streamAIRequest, tryApplyParams, onApplyParams, runComplianceCheck]);

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
    setError(null);
    setLoading(false);
    retryCountRef.current = 0;
  };

  const hasAppliedParams = Object.values(applyResults).some(r => r.success);
  const paramChips = PARAM_SUGGESTIONS[componentType];
  const qaChips = QA_SUGGESTIONS[componentType];
  const analysisChips = ANALYSIS_SUGGESTIONS[componentType];

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col h-[calc(100vh-6rem)] sticky top-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-primary to-primary-light text-white shrink-0 rounded-t-xl">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          <span className="font-semibold text-sm">AI 助手</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={clearChat} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors cursor-pointer" title="清空对话">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Provider selector */}
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50 shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowProviderMenu(!showProviderMenu)}
            className="flex items-center gap-2 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
          >
            <span className="font-medium">{provider.name}</span>
            <span className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{model}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showProviderMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[240px]">
              {AI_PROVIDERS.map(p => (
                <div key={p.id}>
                  <div className="px-3 py-1.5 text-[11px] font-medium text-muted bg-gray-50 flex items-center justify-between">
                    {p.name}
                    {getApiKey(p.id) ? (
                      <span className="text-green-500 text-[10px]">已配置</span>
                    ) : (
                      <span className="text-gray-400 text-[10px]">未配置</span>
                    )}
                  </div>
                  {p.models.map(m => (
                    <button
                      key={m}
                      onClick={() => { setProviderId(p.id); setModel(m); setShowProviderMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent/5 cursor-pointer transition-colors ${
                        providerId === p.id && model === m ? 'text-accent font-medium' : 'text-gray-700'
                      }`}
                    >
                      {m}
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="space-y-4 pt-2">
            {!hasAnyKey ? (
              <div className="text-center space-y-3 pt-6">
                <Settings className="w-10 h-10 text-gray-300 mx-auto" />
                <div>
                  <p className="text-sm text-gray-600 font-medium">尚未配置 API Key</p>
                  <p className="text-xs text-muted mt-1">请先在设置中添加至少一个 AI 服务商的 API Key</p>
                </div>
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-xs font-medium rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  前往设置
                </Link>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <Sparkles className="w-8 h-8 text-accent/40 mx-auto mb-2" />
                  <p className="text-sm text-muted">描述配筋，AI 直接生成模型</p>
                  <p className="text-xs text-muted mt-1">也可以问任何 22G101 相关问题</p>
                </div>

                {/* Param suggestion chips */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted font-medium">配筋示例：</p>
                  <div className="flex flex-wrap gap-1.5">
                    {paramChips.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="px-2.5 py-1.5 text-[11px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer leading-tight"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* QA suggestion chips */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted font-medium">知识问答：</p>
                  <div className="flex flex-wrap gap-1.5">
                    {qaChips.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="px-2.5 py-1.5 text-[11px] text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer leading-tight"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Analysis suggestion chips */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted font-medium">🔍 智能分析：</p>
                  <div className="flex flex-wrap gap-1.5">
                    {analysisChips.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="px-2.5 py-1.5 text-[11px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer leading-tight"
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
          <div key={i}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap bg-accent text-white">
                  {typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join('')}
                </div>
              ) : (
                <div className="max-w-[95%] px-3 py-2 rounded-xl rounded-bl-md text-[13px] leading-relaxed bg-gray-50 text-gray-800 border border-gray-100">
                  {msg.content ? (
                    <MarkdownContent content={typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join('')} />
                  ) : (
                    loading && i === messages.length - 1 && (
                      <span className="flex items-center gap-1.5 text-muted">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        思考中...
                      </span>
                    )
                  )}
                </div>
              )}
            </div>

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
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(hasAppliedParams
              ? ['查看锚固长度计算', '优化箍筋间距', '加支座负筋', '换混凝土等级']
              : paramChips.slice(0, 3)
            ).map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                className="px-2 py-1 text-[11px] text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white shrink-0 rounded-b-xl">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述配筋或提问..."
            rows={1}
            className="flex-1 resize-none px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-colors max-h-24 overflow-y-auto"
            style={{ minHeight: '40px' }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="p-2.5 bg-accent text-white rounded-xl hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
            aria-label="发送"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
