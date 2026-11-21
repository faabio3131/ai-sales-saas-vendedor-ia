import type { AIRequest } from '../ai/contracts';
import type { CommercialContext,CommercialEvidence } from '../ai/cognitiveContext';
import type { CatalogRepository } from '../catalog/contracts';
import type { CatalogItem } from '../catalog/model';
import type { TenantContext } from '../types/contracts';
import type { BusinessProfileRepository } from './contracts';
import type { ApprovedBusinessFact,BusinessProfileRevision,GroundedBusinessAnswer } from './model';
import { normalizedQuestion,requireBusinessScope } from './service';

const priceIntent=/\b(preco|valor|quanto custa|quanto e|quanto fica|custa|reais)\b/;
function catalogMatches(question:string,products:CatalogItem[]):CatalogItem[]{
  return products.filter(x=>x.active&&x.name&&question.includes(normalizedQuestion(x.name)));
}
function factEvidence(unitId:string,version:number,f:ApprovedBusinessFact):string{
  return 'business:'+unitId+':'+version+':'+f.id;
}
function monetary(priceMinor:number):string {
  return (priceMinor/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
/** Grounded text is strictly derived from verified tenant scope, versioned policy and current catalog. */
export class BusinessGroundingService {
  constructor(private readonly profiles:BusinessProfileRepository,private readonly catalog:CatalogRepository){}
  private async scope(ctx:TenantContext,unitId:string,at:string){
    const scope=requireBusinessScope(ctx,unitId);
    if(!Number.isFinite(new Date(at).valueOf()))return {...scope,profile:null,products:[] as CatalogItem[]};
    const [profile,products]=await Promise.all([
      this.profiles.effective(scope.tenantId,scope.unitId,new Date(at).toISOString()),
      this.catalog.listByTenant(scope.tenantId),
    ]);
    return {...scope,profile,products:products.filter(p=>p.tenantId===scope.tenantId&&p.active)};
  }
  async answer(ctx:TenantContext,unitId:string,question:string,at=new Date().toISOString()):Promise<GroundedBusinessAnswer>{
    const unknown:GroundedBusinessAnswer={status:'UNKNOWN',evidenceIds:[],source:'NONE'};
    if(typeof question!=='string'||!question.trim()||question.length>500)return unknown;
    const s=await this.scope(ctx,unitId,at);
    if(!s.profile)return unknown;
    const q=normalizedQuestion(question);
    if(priceIntent.test(q)){
      const matches=catalogMatches(q,s.products);
      if(matches.length>1)return {status:'CONFLICT',evidenceIds:matches.map(m=>'catalog:'+m.id),profileVersion:s.profile.version,source:'NONE'};
      if(matches.length===0||matches[0].priceMinor===undefined||
        !Number.isSafeInteger(matches[0].priceMinor)||matches[0].priceMinor<0)return unknown;
      const item=matches[0];
      return {status:'ANSWERED',answer:item.name+': '+monetary(item.priceMinor!),
        evidenceIds:['catalog:'+item.id],profileVersion:s.profile.version,source:'CATALOG'};
    }
    const facts=s.profile.facts.filter(f=>normalizedQuestion(f.question)===q);
    if(facts.length>1)return {
      status:'CONFLICT',evidenceIds:facts.map(f=>factEvidence(s.unitId,s.profile!.version,f)),
      profileVersion:s.profile.version,source:'NONE',
    };
    if(facts.length===0)return unknown;
    return {status:'ANSWERED',answer:facts[0].answer,
      evidenceIds:[factEvidence(s.unitId,s.profile.version,facts[0])],
      profileVersion:s.profile.version,source:'BUSINESS_APPROVED'};
  }
  async evidence(ctx:TenantContext,unitId:string,at=new Date().toISOString()):Promise<CommercialContext>{
    const s=await this.scope(ctx,unitId,at);
    if(!s.profile)return {unitId:s.unitId,evidence:[]};
    const evidence:CommercialEvidence[]=[];
    for(const f of s.profile.facts){
      if(evidence.length>=16)break;
      evidence.push({id:factEvidence(s.unitId,s.profile.version,f),tenantId:s.tenantId,unitId:s.unitId,
        origin:'approved:'+f.sourceRef,body:f.question+' => '+f.answer,trusted:true});
    }
    for(const p of s.products){
      if(evidence.length>=16)break;
      if(!p.priceMinor&&p.priceMinor!==0)continue;
      if(!Number.isSafeInteger(p.priceMinor)||p.priceMinor<0)continue;
      evidence.push({id:'catalog:'+p.id,tenantId:s.tenantId,unitId:s.unitId,
        origin:'catalog:'+p.id,body:p.name+' '+monetary(p.priceMinor),trusted:true});
    }
    return {unitId:s.unitId,evidence};
  }
  async groundedAIRequest(ctx:TenantContext,unitId:string,input:unknown,at?:string):Promise<AIRequest>{
    const {tenantId}=requireBusinessScope(ctx,unitId);
    return {tenantId,capability:'GENERAL_REASONING',input,context:await this.evidence(ctx,unitId,at)};
  }
}
