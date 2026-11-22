import type {BusinessVertical} from '../business/model';
import type {CapabilityId,CapabilityManifest,CapabilityTemplate,CapabilityTemplateId} from './model';
/**
 * Immutable code-owned **schemas**, not tenant data. Tenant selections,
 * contacts, addresses, pricing, credentials and settings live in versioned stores.
 * Adding a new executable module requires code, security review and certification.
 */
const manifests:readonly CapabilityManifest[]=[
 {id:'CORE_KNOWLEDGE',domain:'CORE',version:1,maturity:'READY_INTERNAL',dependsOn:[],certification:'INTERNAL_ONLY'},
 {id:'CORE_CUSTOMERS',domain:'CORE',version:1,maturity:'READY_INTERNAL',dependsOn:[],certification:'INTERNAL_ONLY'},
 {id:'CORE_AI_ASSIST',domain:'CORE',version:1,maturity:'READY_INTERNAL',dependsOn:['CORE_KNOWLEDGE'],certification:'INTERNAL_ONLY'},
 {id:'FOOD_ORDERING',domain:'FOOD_SERVICE',version:1,maturity:'READY_INTERNAL',dependsOn:['CORE_KNOWLEDGE'],certification:'INTERNAL_ONLY'},
 {id:'FOOD_PRODUCTION',domain:'FOOD_SERVICE',version:1,maturity:'READY_INTERNAL',dependsOn:['FOOD_ORDERING'],certification:'INTERNAL_ONLY'},
 {id:'FOOD_DELIVERY',domain:'FOOD_SERVICE',version:1,maturity:'READY_INTERNAL',dependsOn:['FOOD_ORDERING'],certification:'INTERNAL_ONLY'},
 {id:'FOOD_FINANCE',domain:'FOOD_SERVICE',version:1,maturity:'READY_INTERNAL',dependsOn:['FOOD_ORDERING'],certification:'INTERNAL_ONLY'},
 {id:'RETAIL_CATALOG',domain:'RETAIL',version:1,maturity:'PLANNED',dependsOn:[],certification:'FUTURE_IMPLEMENTATION'},
 {id:'RETAIL_CHECKOUT',domain:'RETAIL',version:1,maturity:'PLANNED',dependsOn:['RETAIL_CATALOG'],certification:'FUTURE_IMPLEMENTATION'},
 {id:'RETAIL_INVENTORY',domain:'RETAIL',version:1,maturity:'PLANNED',dependsOn:['RETAIL_CATALOG'],certification:'FUTURE_IMPLEMENTATION'},
 {id:'SERVICE_CATALOG',domain:'SERVICES',version:1,maturity:'PLANNED',dependsOn:[],certification:'FUTURE_IMPLEMENTATION'},
 {id:'SCHEDULING',domain:'SERVICES',version:1,maturity:'PLANNED',dependsOn:['SERVICE_CATALOG'],certification:'FUTURE_IMPLEMENTATION'},
 {id:'SERVICE_BOOKING',domain:'SERVICES',version:1,maturity:'PLANNED',dependsOn:['SCHEDULING'],certification:'FUTURE_IMPLEMENTATION'},
 {id:'BEAUTY_SERVICES',domain:'BEAUTY',version:1,maturity:'PLANNED',dependsOn:['SERVICE_CATALOG'],certification:'FUTURE_IMPLEMENTATION'},
 {id:'BEAUTY_BOOKING',domain:'BEAUTY',version:1,maturity:'PLANNED',dependsOn:['SCHEDULING','BEAUTY_SERVICES'],certification:'FUTURE_IMPLEMENTATION'},
 {id:'HEALTH_ADMIN',domain:'HEALTH_SERVICE',version:1,maturity:'PLANNED',dependsOn:['SERVICE_CATALOG'],certification:'FUTURE_IMPLEMENTATION'},
];
const templates:readonly CapabilityTemplate[]=[
 {id:'FOOD_SERVICE_STD',version:1,vertical:'FOOD_SERVICE',
  capabilities:['CORE_KNOWLEDGE','CORE_CUSTOMERS','CORE_AI_ASSIST','FOOD_ORDERING','FOOD_PRODUCTION','FOOD_DELIVERY','FOOD_FINANCE'],
  defaultEnabled:['CORE_KNOWLEDGE','CORE_CUSTOMERS']},
 {id:'RETAIL_STD',version:1,vertical:'RETAIL',
  capabilities:['CORE_KNOWLEDGE','CORE_CUSTOMERS','CORE_AI_ASSIST','RETAIL_CATALOG','RETAIL_CHECKOUT','RETAIL_INVENTORY'],
  defaultEnabled:['CORE_KNOWLEDGE','CORE_CUSTOMERS']},
 {id:'SERVICES_STD',version:1,vertical:'SERVICES',
  capabilities:['CORE_KNOWLEDGE','CORE_CUSTOMERS','CORE_AI_ASSIST','SERVICE_CATALOG','SCHEDULING','SERVICE_BOOKING'],
  defaultEnabled:['CORE_KNOWLEDGE','CORE_CUSTOMERS']},
 {id:'BEAUTY_STD',version:1,vertical:'BEAUTY',
  capabilities:['CORE_KNOWLEDGE','CORE_CUSTOMERS','CORE_AI_ASSIST','SERVICE_CATALOG','SCHEDULING','BEAUTY_SERVICES','BEAUTY_BOOKING'],
  defaultEnabled:['CORE_KNOWLEDGE','CORE_CUSTOMERS']},
 {id:'HEALTH_ADMIN_STD',version:1,vertical:'HEALTH_SERVICE',
  capabilities:['CORE_KNOWLEDGE','CORE_CUSTOMERS','CORE_AI_ASSIST','SERVICE_CATALOG','SCHEDULING','HEALTH_ADMIN'],
  defaultEnabled:['CORE_KNOWLEDGE','CORE_CUSTOMERS']},
 {id:'GENERAL_STD',version:1,vertical:'OTHER',
  capabilities:['CORE_KNOWLEDGE','CORE_CUSTOMERS','CORE_AI_ASSIST'],
  defaultEnabled:['CORE_KNOWLEDGE','CORE_CUSTOMERS']},
];
const manifestIndex=new Map(manifests.map(item=>[item.id,item] as const));
const templateIndex=new Map(templates.map(item=>[item.id,item] as const));
/** Immutable copies; never allow callers to mutate a shared schema. */
export function listCapabilityManifests():CapabilityManifest[]{
 return manifests.map(m=>({...m,dependsOn:[...m.dependsOn]}));
}
export function capabilityManifest(id:CapabilityId):CapabilityManifest|undefined{
 const m=manifestIndex.get(id);return m?{...m,dependsOn:[...m.dependsOn]}:undefined;
}
export function listCapabilityTemplates():CapabilityTemplate[]{
 return templates.map(t=>({...t,capabilities:[...t.capabilities],defaultEnabled:[...t.defaultEnabled]}));
}
export function capabilityTemplate(id:CapabilityTemplateId):CapabilityTemplate|undefined{
 const t=templateIndex.get(id);
 return t?{...t,capabilities:[...t.capabilities],defaultEnabled:[...t.defaultEnabled]}:undefined;
}
export function templateForVertical(vertical:BusinessVertical):CapabilityTemplate|undefined{
 const t=templates.find(t=>t.vertical===vertical);
 return t?capabilityTemplate(t.id):undefined;
}
