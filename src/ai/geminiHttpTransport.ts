import { AIRequest } from './contracts';
import { GeminiTransport } from './geminiAdapter';

export interface GeminiHttpTransportOptions {
  apiKey: string;
  model: string;
  interactionsBaseUrl?: string;
  modelsBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface GeminiInteractionResponse {
  model?: string;
  status?: string;
  output_text?: string;
  steps?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
  };
}

function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function buildInteractionBody(input: AIRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    input: stringifyInput(input.input),
    store: false,
  };

  if (input.systemInstructions?.trim()) {
    body.system_instruction = input.systemInstructions.trim();
  }

  if (typeof input.maxOutputTokens === 'number') {
    body.generation_config = {
      max_output_tokens: input.maxOutputTokens,
    };
  }

  return body;
}

function parseStructuredOutput(text: string): Record<string, unknown> {
  // Provider output is untrusted: only strict JSON (no markdown wrappers) passes.
  if (text.length > 16384) throw new Error('Structured output too large.');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid structured provider output.');
  return parsed as Record<string, unknown>;
}

function extractText(payload: GeminiInteractionResponse): string {
  if (payload.output_text?.trim()) return payload.output_text.trim();

  return (payload.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('')
    .trim();
}

export class GeminiHttpTransport implements GeminiTransport {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly interactionsBaseUrl: string;
  private readonly modelsBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs:number;

  constructor(options: GeminiHttpTransportOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.interactionsBaseUrl = (options.interactionsBaseUrl ?? 'https://generativelanguage.googleapis.com/v1').replace(/\/$/, '');
    this.modelsBaseUrl = (options.modelsBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs=Math.max(1000,Math.min(30000,options.timeoutMs??10000));

    if (!this.apiKey) throw new Error('Gemini API key is required.');
    if (!this.model) throw new Error('Gemini model is required.');
  }

  async generate(request: AIRequest): Promise<{
    model: string;
    content?: string;
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: string;
    structuredData?: unknown;
  }> {
    const response = await this.fetchImpl(`${this.interactionsBaseUrl}/interactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(buildInteractionBody(request, this.model)),
      signal:AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error('Gemini interaction request failed.');
    }

    const payload = await response.json() as GeminiInteractionResponse;
    const content = extractText(payload);

    if (!content || !payload.status || !['completed', 'incomplete'].includes(payload.status)) {
      throw new Error('Gemini interaction response was invalid.');
    }

    return {
      model: payload.model?.trim() || this.model,
      content,
      inputTokens: payload.usage?.total_input_tokens,
      outputTokens: payload.usage?.total_output_tokens,
      finishReason: payload.status,
      structuredData: request.responseSchema === undefined ? undefined : parseStructuredOutput(content),
    };
  }

  async healthCheck(): Promise<boolean> {
    const url = `${this.modelsBaseUrl}/models/${encodeURIComponent(this.model)}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-goog-api-key': this.apiKey,
      },
      signal:AbortSignal.timeout(this.timeoutMs),
    });
    return response.ok;
  }
}

export function createGeminiHttpTransportFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiHttpTransport | null {
  const apiKey = env.GEMINI_API_KEY?.trim() ?? '';
  const model = env.GEMINI_MODEL?.trim() ?? '';
  if (!apiKey || !model) return null;
  return new GeminiHttpTransport({ apiKey, model });
}
