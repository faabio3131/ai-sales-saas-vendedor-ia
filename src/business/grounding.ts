import type { AIRequest } from '../ai/contracts';
import type { CommercialContext,CommercialEvidence } from '../ai/cognitiveContext';
import type { CatalogRepository } from '../catalog/contracts';
import type { CatalogItem } from '../catalog/model';
import type { UnitCatalogRepository,UnitCatalogItem } from '../commerce/model';
import type { TenantContext } from '../types/contracts';
import type { BusinessProfileRepository } from './contracts';
import type { ApprovedBusinessFact,GroundedBusinessAnswer } from './model';
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
  constructor(
    private readonly profiles:BusinessProfileRepository,
    private readonly catalog:CatalogRepository,
    private readonly unitCatalog?:UnitCatalogRepository,
  ){}
  private async scope(ctx:TenantContext,unitId:string,at:string){
    const scope=requireBusinessScope(ctx,unitId);
    if(!Number.isFinite(new Date(at).valueOf()))return {
      ...scope,profile:null,products:[] as CatalogItem[],unitItems:[] as UnitCatalogItem[],
      unitVersion:undefined as number|undefined,
    };
    const asOf=new Date(at).toISOString();
    const [profile,legacyProducts,revision]=await Promise.all([
      this.profiles.effective(scope.tenantId,scope.unitId,asOf),
      this.unitCatalog?Promise.resolve([] as CatalogItem[]):this.catalog.listByTenant(scope.tenantId),
      this.unitCatalog?this.unitCatalog.effective(scope.tenantId,scope.unitId,asOf):Promise.resolve(null),
    ]);
    const unitItems=revision?.tenantId===scope.tenantId&&revision.unitId===scope.unitId?
      revision.items.filter(i=>i.active):[];
    return {...scope,profile,unitItems,unitVersion:revision?.version,
      products:legacyProducts.filter(p=>p.tenantId===scope.tenantId&&p.active)};
  }
  async answer(ctx:TenantContext,unitId:string,question:string,at=new Date().toISOString()):Promise<GroundedBusinessAnswer>{
    const unknown:GroundedBusinessAnswer={status:'UNKNOWN',evidenceIds:[],source:'NONE'};
    if(typeof question!=='string'||!question.trim()||question.length>500)return unknown;
    const s=await this.scope(ctx,unitId,at);
    if(!s.profile)return unknown;
    const q=normalizedQuestion(question);
    if(priceIntent.test(q)){
      if(this.unitCatalog){
        // Versioned T03 catalog is the only price authority when enabled for this API.
        const matches=s.unitItems.filter(i=>q.includes(normalizedQuestion(i.name)));
        if(matches.length>1)return {status:'CONFLICT',evidenceIds:matches.map(i=>'unitcatalog:'+i.id),
          profileVersion:s.profile.version,source:'NONE'};
        const item=matches[0];
        // Pizza depends on flavor/size/border. Variants have different prices.
        // Never invent an "average" or "from" price from an incomplete utterance.
        if(!item||item.kind==='PIZZA'||(item.variants?.length??0)>0||
          item.priceMinor===undefined||!Number.isSafeInteger(item.priceMinor))return unknown;
        return {status:'ANSWERED',answer:item.name+': '+monetary(item.priceMinor),
          evidenceIds:['unitcatalog:'+item.id],profileVersion:s.profile.version,source:'CATALOG'};
      }
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
    if(this.unitCatalog){
      for(const p of s.unitItems){
        if(evidence.length>=16)break;
        let body=p.name+' ('+p.kind+')';
        if(p.kind==='PIZZA'&&p.pizza){
          const sizes=p.pizza.sizes.filter(x=>x.active).map(x=>x.name).join(', ');
          const flavors=p.pizza.flavors.filter(x=>x.active).map(x=>x.name).join(', ');
          body+=' | Tamanhos: '+sizes+' | Sabores: '+flavors+
            ' | preço exato depende de tamanho, sabores, borda e adicionais; consultar motor de pedidos';
        }else if(p.kind==='ITEM'&&(p.variants?.length??0)>0){
          body+=' | Variações: '+p.variants!.filter(x=>x.active)
            .map(x=>x.name+' '+monetary(x.priceMinor)).join('; ');
        }else if(p.priceMinor!==undefined&&Number.isSafeInteger(p.priceMinor)){
          body+=' | preço fixo '+monetary(p.priceMinor);
        }
        evidence.push({id:'unitcatalog:'+p.id,tenantId:s.tenantId,unitId:s.unitId,
          origin:'unitcatalog:'+s.unitVersion+':'+p.id,body:body.slice(0,1000),trusted:true});
      }
    }else{
      for(const p of s.products){
        if(evidence.length>=16)break;
        if(!p.priceMinor&&p.priceMinor!==0)continue;
        if(!Number.isSafeInteger(p.priceMinor)||p.priceMinor<0)continue;
        evidence.push({id:'catalog:'+p.id,tenantId:s.tenantId,unitId:s.unitId,
          origin:'catalog:'+p.id,body:p.name+' '+monetary(p.priceMinor),trusted:true});
      }
    }
    return {unitId:s.unitId,evidence};
  }
  async groundedAIRequest(ctx:TenantContext,unitId:string,input:unknown,at?:string):Promise<AIRequest>{
    const {tenantId}=requireBusinessScope(ctx,unitId);
    return {tenantId,capability:'GENERAL_REASONING',input,context:await this.evidence(ctx,unitId,at)};
  }
}
