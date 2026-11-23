import { randomUUID } from 'node:crypto';
import { createErrorResult } from '../infrastructure/errors';
import type { Result } from '../types/contracts';
import type { AIRouterInterface, AIProviderInterface, AICapability, AIRequest, AIResponse } from './contracts';
import { estimateModelCost } from './cognitiveFinops';
import type { CognitiveMeteringSink, CognitiveMeteringEvent, AIPriceSnapshot } from './cognitiveFinops';

export interface CognitiveRouterOptions {
  timeoutMs?: number;
  maxInflightPerProvider?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  meter?: CognitiveMeteringSink;
  meterTimeoutMs?:number;
  maxMeterInflight?:number;
  priceSnapshots?: readonly AIPriceSnapshot[];
  now?: () => number;
}
interface ProviderState {
  inflight:number;
  failures:number;
  openedAt?:number;
  halfOpenProbe:boolean;
}

/** Guarded multi-model orchestration: failure isolation, bounded concurrency and safe fallback. */
export class ResilientAIRouter implements AIRouterInterface {
  private readonly providers:readonly AIProviderInterface[];
  private readonly state=new Map<string,ProviderState>();
  private readonly timeoutMs:number;
  private readonly maxInflight:number;
  private readonly threshold:number;
  private readonly cooldownMs:number;
  private readonly clock:()=>number;
  private readonly meter?:CognitiveMeteringSink;
  private readonly prices:readonly AIPriceSnapshot[];
  private readonly meterTimeoutMs:number;
  private readonly maxMeterInflight:number;
  private meterInflight=0;
  private readonly meterCounters={accepted:0,dropped:0,failed:0,timedOut:0};
  /** Low-cardinality metrics for Command/Prometheus adapters. Never export
   * tenant identifiers, request contents, secret refs, or PII in counters. */
  getMeteringHealth(){
    return {...this.meterCounters,inflight:this.meterInflight};
  }

  constructor(providers:AIProviderInterface[],opts:CognitiveRouterOptions={}) {
    const ids=new Set<string>();
    for(const provider of providers) {
      if(!provider.id.trim()||ids.has(provider.id))throw new Error('Cognitive provider id invalid or duplicated.');
      ids.add(provider.id);
      this.state.set(provider.id,{inflight:0,failures:0,halfOpenProbe:false});
    }
    this.providers=[...providers];
    this.timeoutMs=Math.max(250,Math.min(30000,opts.timeoutMs??6000));
    this.maxInflight=Math.max(1,Math.min(100,opts.maxInflightPerProvider??8));
    this.threshold=Math.max(1,Math.min(20,opts.failureThreshold??3));
    this.cooldownMs=Math.max(1000,Math.min(300000,opts.cooldownMs??30000));
    this.clock=opts.now??Date.now;
    this.meter=opts.meter;
    this.meterTimeoutMs=Math.max(10,Math.min(1000,opts.meterTimeoutMs??100));
    this.maxMeterInflight=Math.max(1,Math.min(100,opts.maxMeterInflight??16));
    this.prices=opts.priceSnapshots??[];
  }

  async resolveProvider(capability:AICapability):Promise<Result<string>> {
    const provider=this.providers.find(x=>x.supports(capability));
    return provider?{ok:true,data:provider.id}:
      createErrorResult('PROVIDER','AI_CAPABILITY_UNAVAILABLE','AI capability is unavailable.',false);
  }

  private canTry(state:ProviderState):boolean {
    if(state.inflight>=this.maxInflight)return false;
    if(state.openedAt===undefined)return true;
    if(this.clock()-state.openedAt < this.cooldownMs || state.halfOpenProbe)return false;
    state.halfOpenProbe=true;
    return true;
  }
  private success(state:ProviderState):void {
    state.failures=0;state.openedAt=undefined;state.halfOpenProbe=false;
  }
  private failure(state:ProviderState):void {
    state.failures++;
    if(state.failures>=this.threshold||state.openedAt!==undefined)state.openedAt=this.clock();
    state.halfOpenProbe=false;
  }
  private async record(event:CognitiveMeteringEvent):Promise<void> {
    if(!this.meter)return;
    if(this.meterInflight>=this.maxMeterInflight){
      this.meterCounters.dropped++;
      console.warn('cognitive_usage_metering_saturated');return;
    }
    this.meterInflight++;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const pending=Promise.resolve().then(()=>this.meter!.record(event))
      .finally(()=>{this.meterInflight--;});
    try {
      await Promise.race([pending,new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('metering_timeout')),this.meterTimeoutMs);
      })]);
      this.meterCounters.accepted++;
    }catch(error){
      this.meterCounters.failed++;
      if(error instanceof Error&&error.message==='metering_timeout')this.meterCounters.timedOut++;
      console.warn('cognitive_usage_metering_failed');
    }
    finally{if(timer)clearTimeout(timer);}
  }

  async execute(request:AIRequest):Promise<Result<AIResponse>> {
    if(!request.tenantId?.trim())return createErrorResult('VALIDATION','AI_TENANT_REQUIRED','Tenant is required.',false);
    if(request.input===null||request.input===undefined)return createErrorResult('VALIDATION','AI_INPUT_REQUIRED','AI input is required.',false);
    const candidates=this.providers.filter(p=>p.supports(request.capability));
    if(!candidates.length)return createErrorResult('PROVIDER','AI_CAPABILITY_UNAVAILABLE','AI capability is unavailable.',false);
    const req={...request,tenantId:request.tenantId.trim()};
    let fallbackUsed=false;
    for(const provider of candidates) {
      const state=this.state.get(provider.id)!;
      const started=this.clock();
      const eventBase={
        tenantId:req.tenantId, requestId:randomUUID(), capability:req.capability, provider:provider.id,
        occurredAt:new Date(started).toISOString(), fallbackUsed,
      };
      if(!this.canTry(state)) {
        await this.record({...eventBase,model:'unknown',outcome:'SKIPPED',latencyMs:0,cost:{status:'UNKNOWN'}});
        fallbackUsed=true;continue;
      }
      state.inflight++;
      let timer:ReturnType<typeof setTimeout>|undefined;
      let timedOut=false;
      try {
        // Do not release the bulkhead when a timeout fires: an abandoned request
        // can still consume provider capacity until it settles.
        const pending=Promise.resolve().then(()=>provider.generate(req)).finally(()=>{
          state.inflight=Math.max(0,state.inflight-1);
        });
        const timeout=new Promise<never>((_,reject)=>{
          timer=setTimeout(()=>{timedOut=true;reject(new Error('cognitive_deadline'));},this.timeoutMs);
        });
        const result=await Promise.race([pending,timeout]);
        if(!result.ok||!result.data||result.data.provider!==provider.id||
          typeof result.data.model!=='string'||!result.data.model.trim()||
          (typeof result.data.content!=='string' && result.data.structuredData===undefined)) {
          throw new Error('invalid_cognitive_provider_result');
        }
        this.success(state);
        const output=result.data;
        await this.record({
          ...eventBase,model:output.model,outcome:'SUCCESS',
          latencyMs:Math.max(0,this.clock()-started),
          inputTokens:output.inputTokens,outputTokens:output.outputTokens,
          cost:estimateModelCost(provider.id,output.model,output,this.prices),
        });
        return result;
      } catch {
        this.failure(state);
        await this.record({
          ...eventBase,model:'unknown',outcome:timedOut?'TIMEOUT':'FAILED',
          latencyMs:Math.max(0,this.clock()-started),cost:{status:'UNKNOWN'},
        });
        fallbackUsed=true;
      } finally {if(timer)clearTimeout(timer);}
    }
    return createErrorResult('PROVIDER','AI_PROVIDER_UNAVAILABLE','All available AI routes failed.',true);
  }
}
