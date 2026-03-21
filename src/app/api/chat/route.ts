import { NextRequest } from 'next/server';
import { AI_PROVIDERS } from '@/lib/ai-providers';

export const runtime = 'edge';

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
      return Response.json({ error: '未知的 AI 提供商' }, { status: 400 });
    }

    const apiKey = clientKey || process.env[provider.envKey];
    if (!apiKey) {
      return Response.json(
        { error: `未配置 ${provider.name} API Key，请在设置页面中添加` },
        { status: 400 }
      );
    }

    const selectedModel = model || provider.defaultModel;

    // Build request payload — only include optional fields when present
    const payload: Record<string, unknown> = {
      model: selectedModel,
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

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`${provider.name} API error (${response.status}):`, errText.slice(0, 500));
      // Forward the status and body so the client can make fallback decisions
      return new Response(errText || JSON.stringify({ error: `${provider.name} 接口错误: ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (stream) {
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming: forward the JSON response directly
    const data = await response.json();
    return Response.json(data);
  } catch (err) {
    console.error('Chat API error:', err);
    return Response.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
