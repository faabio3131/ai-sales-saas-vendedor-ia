import { AIRequest } from './contracts';
import { GeminiTransport } from './geminiAdapter';

export interface GeminiHttpTransportOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
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

function buildRequestBody(input: AIRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [{
      role: 'user',
      parts: [{ text: stringifyInput(input.input) }],
    }],
  };

  if (input.systemInstructions?.trim()) {
    body.system_instruction = {
      parts: [{ text: input.systemInstructions.trim() }],
    };
  }

  const generationConfig: Record<string, unknown> = {};
  if (typeof input.temperature === 'number') generationConfig.temperature = input.temperature;
  if (typeof input.maxOutputTokens === 'number') generationConfig.maxOutputTokens = input.maxOutputTokens;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  return body;
}

export class GeminiHttpTransport implements GeminiTransport {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiHttpTransportOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.apiKey) throw new Error('Gemini API key is required.');
    if (!this.model) throw new Error('Gemini model is required.');
  }

  async generate(request: AIRequest): Promise<{
    model: string;
    content?: string;
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: string;
  }> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(buildRequestBody(request)),
    });

    if (!response.ok) {
      throw new Error('Gemini generateContent request failed.');
    }

    const payload = await response.json() as GeminiGenerateContentResponse;
    const candidate = payload.candidates?.[0];
    const content = candidate?.content?.parts
      ?.map((part) => part.text)
      .filter((text): text is string => Boolean(text))
      .join('')
      .trim();

    if (!candidate || !content) {
      throw new Error('Gemini generateContent response was invalid.');
    }

    return {
      model: this.model,
      content,
      inputTokens: payload.usageMetadata?.promptTokenCount,
      outputTokens: payload.usageMetadata?.candidatesTokenCount,
      finishReason: candidate.finishReason,
    };
  }

  async healthCheck(): Promise<boolean> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-goog-api-key': this.apiKey,
      },
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
