import https from 'node:https';
import {ApplicationError} from '../infrastructure/errors';
import type {ProviderTransport,ProviderJson} from './bankCommon';
import type {MerchantBankSecrets} from './merchantVault';
import type {PaymentProviderId} from './providerCatalog';

interface Endpoints {api:string;oauth?:string;pixPrefix?:string;}
const ENDPOINTS:Record<string,Endpoints>={
 EFI:{api:'https://pix.api.efipay.com.br',oauth:'https://pix.api.efipay.com.br/oauth/token',pixPrefix:'/v2'},
 BANCO_INTER:{api:'https://cdpj.partners.bancointer.com.br',oauth:'https://cdpj.partners.bancointer.com.br/oauth/v2/token',pixPrefix:'/pix/v2'},
 BANCO_DO_BRASIL:{api:'https://api-pix.bb.com.br',oauth:'https://oauth.bb.com.br/oauth/token',pixPrefix:'/pix/v2'},
 ASAAS:{api:'https://api.asaas.com'},
 PAGARME:{api:'https://api.pagar.me'},
};
export function bankEndpoints(providerId:PaymentProviderId):Endpoints {
 const endpoints=ENDPOINTS[providerId];
 if(!endpoints)throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_PROVIDER_UNSUPPORTED',message:'Provider has no configured transport.'});
 return endpoints;
}
export interface JsonHttp {
 (url:string,method:string,body:unknown,headers:Record<string,string>,tls?:{cert:string;key:string}):Promise<ProviderJson>;
}
export const secureJsonHttp:JsonHttp=async(url,method,body,headers,tls)=>{
 const target=new URL(url);
 if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash)throw new Error('Invalid provider transport URL');
 return await new Promise<ProviderJson>((resolve,reject)=>{
  const request=https.request(target,{
   method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...headers},
   cert:tls?.cert,key:tls?.key,rejectUnauthorized:true,timeout:12000,
  },response=>{
   const bytes:Buffer[]=[];let size=0;
   response.on('data',(chunk:Buffer)=>{
    size+=chunk.length;if(size>1024*1024){request.destroy(new Error('Provider response too large'));return;}
    bytes.push(chunk);
   });
   response.on('end',()=>{
    const code=response.statusCode??0;
    if(code<200||code>=300){
     reject(new ApplicationError({category:'PROVIDER',code:'BANK_UPSTREAM_REJECTED',
      message:'Bank rejected the payment request.',retryable:code===429||code>=500}));return;
    }
    try {
     const data=JSON.parse(Buffer.concat(bytes).toString('utf8')) as unknown;
     if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid response');
     resolve(data as ProviderJson);
    }catch{reject(new ApplicationError({category:'PROVIDER',code:'BANK_RESPONSE_INVALID',message:'Invalid bank response.'}));}
   });
  });
  request.on('timeout',()=>request.destroy(new Error('timeout')));
  request.on('error',()=>reject(new ApplicationError({category:'PROVIDER',code:'BANK_TRANSPORT_UNAVAILABLE',
   message:'Bank connection unavailable.',retryable:true})));
  if(body!==undefined)request.write(typeof body==='string'?body:JSON.stringify(body));
  request.end();
 });
};
export function providerTransport(
 providerId:PaymentProviderId,
 secret:MerchantBankSecrets,
 http:JsonHttp=secureJsonHttp,
):ProviderTransport {
 const cfg=bankEndpoints(providerId);
 const tls=secret.clientCertificatePem&&secret.clientPrivateKeyPem?
  {cert:secret.clientCertificatePem,key:secret.clientPrivateKeyPem}:undefined;
 let bearer:string|undefined;
 let expiresAt=0;
 const accessToken=async():Promise<string>=>{
  if(bearer&&Date.now()<expiresAt-60000)return bearer;
  if(!secret.clientId||!secret.clientSecret||!cfg.oauth||!tls){
   throw new ApplicationError({category:'FORBIDDEN',code:'BANK_OAUTH_CREDENTIALS_REQUIRED',message:'Bank OAuth or mTLS credentials not configured.'});
  }
  const basic=Buffer.from(secret.clientId+':'+secret.clientSecret).toString('base64');
  const scope=providerId==='BANCO_INTER'?'cob.write cob.read pix.read':'';
  const form='grant_type=client_credentials'+(scope?'&scope='+encodeURIComponent(scope):'');
  const payload=await http(cfg.oauth,'POST',form,{
   Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded'},tls);
  if(typeof payload.access_token!=='string'||!payload.access_token)throw new Error('Invalid bank auth response');
  bearer=payload.access_token;
  expiresAt=Date.now()+Math.min(3600,Math.max(120,Number(payload.expires_in)||300))*1000;
  return bearer;
 };
 return async(path,method,body)=>{
  if(!/^\/(?:v2|v3|core\/v5|pix\/v2)\/[a-zA-Z0-9_/-]+$/.test(path)||path.includes('..')) {
   throw new ApplicationError({category:'VALIDATION',code:'BANK_ENDPOINT_INVALID',message:'Invalid bank endpoint.'});
  }
  if(method!=='POST'&&method!=='PUT'&&method!=='GET')throw new Error('Invalid provider operation');
  if(providerId==='ASAAS'){
   if(!secret.apiKey)throw new ApplicationError({category:'FORBIDDEN',code:'ASAAS_API_KEY_REQUIRED',message:'Asaas credentials unavailable.'});
   return http(cfg.api+path,method,body,{access_token:secret.apiKey});
  }
  if(providerId==='PAGARME'){
   if(!secret.apiKey)throw new ApplicationError({category:'FORBIDDEN',code:'PAGARME_API_KEY_REQUIRED',message:'Pagar.me credentials unavailable.'});
   return http(cfg.api+path,method,body,{Authorization:'Basic '+Buffer.from(secret.apiKey+':').toString('base64')});
  }
  if(!tls)throw new ApplicationError({category:'FORBIDDEN',code:'BANK_MTLS_REQUIRED',message:'A verified bank client certificate is required.'});
  const token=await accessToken();
  if(!cfg.pixPrefix)throw new Error('Missing bank Pix prefix');
  const actualPath=path.startsWith('/v2/')?cfg.pixPrefix+path.slice(3):path;
  const additional:Record<string,string>=providerId==='BANCO_DO_BRASIL'&&secret.applicationKey?{'gw-dev-app-key':secret.applicationKey}:{};
  if(providerId==='BANCO_DO_BRASIL'&&!secret.applicationKey)throw new ApplicationError({
   category:'FORBIDDEN',code:'BANK_APPLICATION_KEY_REQUIRED',message:'Banco do Brasil application key required.'});
  return http(cfg.api+actualPath,method,body,{Authorization:'Bearer '+token,...additional},tls);
 };
}
