import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createErrorResult } from '../infrastructure/errors';
import type { Result } from '../types/contracts';
import type { AIProviderInterface, AIRequest, AIResponse, AICapability } from './contracts';
import { buildCognitiveContextPack } from './cognitiveContext';
import { verifyCognitiveReply } from './cognitiveGuard';

const MAX_RESPONSE_BYTES = 32768;
const VERSION = 'atendevende.cognitive/v1';

export interface CognitiveServiceSettings {
  endpoint: string;
  secret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

function verifyEndpoint(raw: string): string {
  const parsed = new URL(raw);
  const isLoopback = ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) ||
    parsed.username || parsed.password || parsed.hash || parsed.search ||
    (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('Cognitive service requires private HTTPS (or loopback testing).');
  }
  return parsed.origin;
}
async function limitedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) {
    throw new Error('Oversized cognitive response.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty cognitive response.');
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Oversized cognitive response.');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part,offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/** Read-only Python cognitive service implementing the approved S2S contract. */
export class CognitiveServiceAdapter implements AIProviderInterface {
  readonly id = 'fm-cognitive';
  private readonly base: string;
  private readonly secret: string;
  private readonly transport: typeof fetch;
  private readonly deadline: number;
  private readonly clock: () => number;

  constructor(options: CognitiveServiceSettings) {
    this.base = verifyEndpoint(options.endpoint);
    if (options.secret.length < 32) throw new Error('Cognitive S2S secret is required.');
    this.secret = options.secret;
    this.transport = options.fetchImpl ?? fetch;
    this.deadline = Math.max(500, Math.min(10000, options.timeoutMs ?? 4000));
    this.clock = options.now ?? Date.now;
  }

  supports(capability: AICapability): boolean {
    return capability === 'GENERAL_REASONING';
  }

  async healthCheck(): Promise<Result<unknown>> {
    try {
      const res = await this.transport(this.base+'/health', {
        method:'GET',redirect:'manual',signal:AbortSignal.timeout(this.deadline),
      });
      if (!res.ok || res.redirected) throw new Error('Cognitive service unavailable.');
      const body = await limitedJson(res) as {status?:string;contractVersion?:string};
      if (body?.status !== 'ok' || body?.contractVersion !== VERSION) throw new Error('Invalid cognitive health.');
      return {ok:true,data:{provider:this.id,status:'ok'}};
    } catch {
      return createErrorResult('PROVIDER','COGNITIVE_UNAVAILABLE','Cognitive service unavailable.',true);
    }
  }

  async generate(input: AIRequest): Promise<Result<AIResponse>> {
    if (!this.supports(input.capability)) return createErrorResult('PROVIDER','COGNITIVE_CAPABILITY_UNSUPPORTED','Cognitive capability unavailable.',false);
    try {
      const contextPack=buildCognitiveContextPack(input);
      const requestId=randomUUID().replace(/-/g,'');
      const body=JSON.stringify({
        contractVersion:VERSION,
        tenantId:contextPack.scopeTenantId,
        requestId,
        capability:input.capability,
        contextPack,
      });
      if (Buffer.byteLength(body,'utf8') > 65536) throw new Error('Cognitive payload limit.');
      const timestamp=String(Math.floor(this.clock()/1000));
      const nonce=randomBytes(16).toString('hex');
      const digest=createHmac('sha256',this.secret).update(timestamp+'.'+nonce+'.'+body).digest('hex');
      const started=this.clock();
      const response=await this.transport(this.base+'/v1/execute',{
        method:'POST',redirect:'manual',
        headers:{
          'content-type':'application/json',
          'x-av-signature':'t='+timestamp+',nonce='+nonce+',v1='+digest,
        },
        body,
        signal:AbortSignal.timeout(this.deadline),
      });
      if (!response.ok || response.redirected) throw new Error('Cognitive S2S rejected.');
      const verified=verifyCognitiveReply(await limitedJson(response),requestId,contextPack);
      return {ok:true,data:{...verified,latencyMs:Math.max(0,this.clock()-started)}};
    } catch {
      // No raw model data, private endpoint, HMAC or credentials in error messages.
      return createErrorResult('PROVIDER','COGNITIVE_REQUEST_FAILED','Cognitive request unavailable.',true);
    }
  }
}
export function cognitiveSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): CognitiveServiceSettings | null {
  const endpoint=env.COGNITIVE_SERVICE_URL?.trim();
  const secret=env.COGNITIVE_S2S_SECRET?.trim();
  if (!endpoint && !secret) return null;
  if (!endpoint || !secret) throw new Error('Cognitive service URL and S2S secret must both be configured.');
  return {endpoint,secret};
}
