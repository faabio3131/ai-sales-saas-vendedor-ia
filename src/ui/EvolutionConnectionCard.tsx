import {useEffect,useRef,useState} from 'react';
import {QrCode} from 'lucide-react';
type Status='DISABLED'|'NOT_PROVISIONED'|'DISCONNECTED'|'PAIRING'|'CONNECTED';
type Overview={status:Status;connected:boolean;qrCode?:string;expiresInSeconds?:number;commercialEnabled:false};
const labels:Record<Status,string>={DISABLED:'Homologação pendente',NOT_PROVISIONED:'Aguardando configuração segura',DISCONNECTED:'Desconectado',PAIRING:'Aguardando leitura ou confirmação',CONNECTED:'Sessão conectada'};
const messages:Record<string,string>={
 EVOLUTION_OWNER_REQUIRED:'Somente o proprietário pode configurar o WhatsApp.',
 EVOLUTION_UNIT_NOT_CONFIGURED:'Cadastre a empresa e a unidade primeiro.',
 EVOLUTION_PLAN_REQUIRED:'É necessário um plano ativo com atendimento por IA.',
 SUBSCRIPTION_INACTIVE:'Ative um plano antes de conectar.',
 SUBSCRIPTION_OUT_OF_PERIOD:'O período do plano terminou.',
 EVOLUTION_META_ACTIVE_CONFLICT:'Já existe uma conexão Meta ativa nesta unidade. Solicite a troca segura de canal.',
 EVOLUTION_BUSY:'Outra operação está em andamento. Verifique a conexão antes de tentar novamente.',
 EVOLUTION_INSTANCE_NOT_PROVISIONED:'A instância comercial ainda precisa ser provisionada.',
 EVOLUTION_VAULT_DENIED:'A credencial exclusiva ainda não foi liberada.',
 EVOLUTION_WEBHOOK_MISMATCH:'Não foi possível confirmar a configuração segura do webhook.',
 EVOLUTION_LOGOUT_UNCONFIRMED:'O encerramento remoto não foi confirmado. Verifique o estado antes de tentar novamente.',
};
export function EvolutionConnectionCard({tenantId,unitId}:{tenantId:string;unitId:string}){
 const [data,setData]=useState<Overview|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [expires,setExpires]=useState(0);
 const [remaining,setRemaining]=useState(0);
 const active=useRef<AbortController|null>(null);
 const root='/api/channels/evolution/units/'+encodeURIComponent(unitId);
 async function request(action:''|'connect'|'confirm'|'disconnect'){
  if(active.current)return;
  const ctrl=new AbortController();active.current=ctrl;setBusy(true);setError('');
  if(action!==''){setData(old=>old?{...old,qrCode:undefined}:null);setExpires(0);}
  try{
   const response=await fetch(root+(action?'/'+action:''),{
    method:action?'POST':'GET',credentials:'same-origin',cache:'no-store',
    headers:{'x-tenant-id':tenantId},signal:ctrl.signal});
   const result=await response.json() as {ok:boolean;data?:Overview;error?:{code:string}};
   if(!response.ok||!result.ok||!result.data||!(result.data.status in labels)||
    result.data.connected!==(result.data.status==='CONNECTED')||result.data.commercialEnabled!==false)
    throw new Error(messages[result.error?.code??'']??'Não foi possível verificar a conexão. Tente novamente.');
   if(ctrl.signal.aborted)return;
   const d=result.data;
   setData(d);
   const seconds=d.status==='PAIRING'&&d.qrCode?.startsWith('data:image/png;base64,')?Math.min(30,d.expiresInSeconds??0):0;
   setRemaining(seconds);setExpires(seconds?Date.now()+seconds*1000:0);
  }catch(e){if(!ctrl.signal.aborted){setData(null);setError(e instanceof Error?e.message:'Não foi possível consultar a Evolution.');}}
  finally{if(active.current===ctrl){active.current=null;if(!ctrl.signal.aborted)setBusy(false);}}
 }
 useEffect(()=>{void request('');return ()=>{active.current?.abort();active.current=null;};},[root,tenantId]);
 useEffect(()=>{
  if(!expires)return;
  const tick=()=>{const left=Math.max(0,Math.ceil((expires-Date.now())/1000));setRemaining(left);
   if(left===0){setData(old=>old?{...old,qrCode:undefined}:old);setExpires(0);}};
  const timer=window.setInterval(tick,500);tick();return ()=>window.clearInterval(timer);
 },[expires]);
 const available=!!data&&data.status!=='DISABLED'&&data.status!=='NOT_PROVISIONED';
 return <article className="rounded-xl border border-emerald-500/40 bg-slate-950/40 p-4" aria-label="WhatsApp por QR Code">
  <h3 className="flex items-center gap-2 text-lg font-semibold text-white"><QrCode className="h-5 w-5 text-emerald-400"/> WhatsApp por QR Code</h3>
  <p className="mt-1 text-sm font-medium text-emerald-300">Evolution API · opção principal</p>
  <p className="mt-2 text-sm text-slate-300">Conecte o número da sua empresa pelo celular. A sessão é exclusiva desta unidade.</p>
  <p className="mt-3 text-sm text-slate-200" role="status">{busy?'Consultando Evolution...':data?labels[data.status]:'Estado não verificado'}</p>
  {error&&<p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
  {data?.qrCode&&remaining>0&&<div className="mt-3 rounded-lg bg-white p-3">
   <img alt="QR Code temporário para conectar o WhatsApp" src={data.qrCode} className="mx-auto h-48 w-48" />
   <p className="mt-2 text-center text-sm text-slate-950">WhatsApp → Aparelhos conectados → Conectar aparelho. Expira em {remaining}s.</p>
  </div>}
  <div className="mt-3 flex flex-wrap gap-2">
   <button type="button" disabled={busy||!available||data?.connected} onClick={()=>void request('connect')} className="min-h-11 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-slate-950 disabled:opacity-50">{data?.status==='PAIRING'?'Gerar novo QR Code':'Conectar WhatsApp'}</button>
   <button type="button" disabled={busy} onClick={()=>void request(available?'confirm':'')} className="min-h-11 rounded-lg border border-slate-600 px-3 text-sm text-white disabled:opacity-50">Verificar conexão</button>
   {available&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm('Desconectar o WhatsApp desta unidade?'))void request('disconnect');}} className="min-h-11 rounded-lg border border-slate-600 px-3 text-sm text-white disabled:opacity-50">Desconectar</button>}
  </div>
  <p className="mt-3 text-sm text-slate-400">Pareamento não libera atendimento automático, mensagens comerciais nem cobrança.</p>
 </article>;
}
