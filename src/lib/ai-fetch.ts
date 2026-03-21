/**
 * AI Fetch — 统一的 AI 请求层
 * 
 * 支持两种模式:
 * 1. 直接调用 provider API (快速，但可能遇到 CORS)
 * 2. 通过 /api/chat 代理 (CORS 安全，适合部署环境)
 * 
 * 自动检测: 先尝试直连，如果遇到网络错误(CORS)则自动切换到代理模式
 */

import type { AIProvider } from './ai-providers';

interface AIFetchOptions {
  provider: AIProvider;
  model: string;
  apiKey: string;
  systemPrompt?: string;
  messages: Array<{ role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string; name?: string }>;
  tools?: unknown[];
  tool_choice?: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}

interface AIFetchResult {
  response: Response;
  proxied: boolean;
}

/** Provider IDs known to block CORS from browser origins */
const CORS_BLOCKED_PROVIDERS = new Set<string>(['kimi']);

/** Cache: track which providers need proxy */
const proxyRequired = new Set<string>();

/**
 * Make an AI API request, auto-falling back to /api/chat proxy on CORS errors.
 */
export async function aiFetch(opts: AIFetchOptions): Promise<AIFetchResult> {
  const { provider, model, apiKey, systemPrompt, messages, tools, tool_choice, stream = true, temperature = 0.3, max_tokens = 4096, signal } = opts;

  // If we know this provider needs proxy, skip direct attempt
  const needsProxy = proxyRequired.has(provider.id) || CORS_BLOCKED_PROVIDERS.has(provider.id);

  if (!needsProxy) {
    try {
      const response = await directFetch(opts);
      return { response, proxied: false };
    } catch (err) {
      // Network error (likely CORS) — try proxy
      // Chrome: "Failed to fetch", Firefox: "NetworkError...", Safari: "Load failed"
      if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
        proxyRequired.add(provider.id);
        console.info(`[aiFetch] Direct call to ${provider.name} failed (CORS?), switching to proxy`);
      } else {
        throw err;
      }
    }
  }

  // Proxy mode via /api/chat
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: provider.id,
      model,
      apiKey,
      systemPrompt,
      messages,
      tools,
      tool_choice,
      stream,
      temperature,
      max_tokens,
    }),
    signal,
  });

  return { response, proxied: true };
}

/** Direct fetch to the provider API */
async function directFetch(opts: AIFetchOptions): Promise<Response> {
  const { provider, model, apiKey, systemPrompt, messages, tools, tool_choice, stream = true, temperature = 0.3, max_tokens = 4096, signal } = opts;

  const payload: Record<string, unknown> = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ],
    stream,
    temperature,
    max_tokens,
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
    if (tool_choice) payload.tool_choice = tool_choice;
  }

  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
}
