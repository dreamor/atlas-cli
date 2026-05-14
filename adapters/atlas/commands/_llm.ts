import { request } from 'undici';

export interface LlmCallOpts {
  readonly model: string;
  readonly prompt: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
}

interface AnthropicResponse {
  readonly content?: ReadonlyArray<{ type: string; text?: string }>;
}

/**
 * Minimal Anthropic Messages API client. Returns the assistant's text content.
 * Caller is responsible for JSON-parsing if a structured response is expected.
 */
export async function callClaude(opts: LlmCallOpts): Promise<string> {
  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model: opts.model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: opts.prompt }],
  };

  const res = await request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    bodyTimeout: opts.timeoutMs ?? 30000,
  });

  if (res.statusCode >= 400) {
    const text = await res.body.text();
    throw new Error(
      `Claude API ${res.statusCode}: ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.body.json()) as AnthropicResponse;
  const block = json.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

export function getAnthropicKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}
