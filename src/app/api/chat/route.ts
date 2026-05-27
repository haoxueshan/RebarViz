import { NextRequest } from 'next/server';
import { AI_PROVIDERS } from '@/lib/ai-providers';

export const runtime = 'edge';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Universal AI proxy — supports streaming, tool calling, and multimodal (vision) messages.
 * 
 * All client-side AI calls can optionally route through this endpoint to avoid
 * CORS issues with certain providers (Kimi, Qwen, etc.).
 * 
 * Request body: {
 *   providerId: string,
 *   model?: string,
 *   apiKey?: string,         // client-provided key from localStorage
 *   systemPrompt?: string,   // full system prompt (caller builds it)
 *   messages: Array<{ role, content, tool_calls?, tool_call_id?, name? }>,
 *   tools?: object[],        // OpenAI function calling tool definitions
 *   tool_choice?: string,    // 'auto' | 'none' | specific
 *   stream?: boolean,        // default true
 *   temperature?: number,
 *   max_tokens?: number,
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Add CORS on successful early-exit branches too (provider not found, no key)
    const body = await req.json();
    const {
      providerId,
      model,
      apiKey: clientKey,
      systemPrompt,
      messages,
      tools,
      tool_choice,
      stream = true,
      temperature = 0.3,
      max_tokens = 4096,
    } = body as {
      providerId: string;
      model?: string;
      apiKey?: string;
      systemPrompt?: string;
      messages: Array<{ role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string; name?: string }>;
      tools?: unknown[];
      tool_choice?: string;
      stream?: boolean;
      temperature?: number;
      max_tokens?: number;
    };

    const provider = AI_PROVIDERS.find(p => p.id === providerId);
    if (!provider) {
      return Response.json({ error: '未知的 AI 提供商' }, { status: 400, headers: CORS });
    }

    const apiKey = clientKey || process.env[provider.envKey];
    if (!apiKey) {
      return Response.json(
        { error: `未配置 ${provider.name} API Key，请在设置页面中添加` },
        { status: 400, headers: CORS }
      );
    }

    const selectedModel = model || provider.defaultModel;

    // Build request payload — only include optional fields when present
    const effectiveTemperature = provider.temperature ?? temperature;
    const payload: Record<string, unknown> = {
      model: selectedModel,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages,
      ],
      stream,
      temperature: effectiveTemperature,
      ...(provider.extraParams ?? {}),
    };
    payload[provider.maxTokensParam ?? 'max_tokens'] = max_tokens;

    if (tools && tools.length > 0) {
      payload.tools = tools;
      if (tool_choice) payload.tool_choice = tool_choice;
    }

    const authHeaders: Record<string, string> = provider.authHeader === 'api-key'
      ? { 'api-key': apiKey }
      : { 'Authorization': `Bearer ${apiKey}` };

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const errText = await response.text().catch(() => '');
      console.error(`${provider.name} API error (${response.status}):`, errText.slice(0, 500));

      // Always return clean JSON to the client — never forward raw HTML
      let errorMessage = `${provider.name} 接口错误 (${response.status})`;
      if (contentType.includes('application/json') || contentType.includes('text/plain')) {
        try {
          const errJson = JSON.parse(errText);
          errorMessage = errJson?.error?.message || errJson?.message || errJson?.error || errorMessage;
        } catch { /* not JSON, use default */ }
      } else if (response.status === 404) {
        errorMessage = `模型不存在或无权访问: ${selectedModel}。请在设置中切换到其他模型。`;
      } else if (response.status === 401) {
        errorMessage = `API Key 无效或已过期，请在设置中重新配置 ${provider.name} 的 API Key。`;
      } else if (response.status === 429) {
        errorMessage = `请求过于频繁，已触发 ${provider.name} 限流，请稍后再试。`;
      }

      // Use 400 instead of forwarding upstream status — dev proxies (e.g. Cascade)
      // intercept 404 responses and replace the body with their own HTML page.
      return Response.json({ error: errorMessage }, { status: 400, headers: CORS });
    }

    if (stream) {
      return new Response(response.body, {
        headers: {
          ...CORS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming: forward the JSON response directly
    const data = await response.json();
    return Response.json(data, { headers: CORS });
  } catch (err) {
    console.error('Chat API error:', err);
    return Response.json({ error: '服务器内部错误' }, { status: 500, headers: CORS });
  }
}
