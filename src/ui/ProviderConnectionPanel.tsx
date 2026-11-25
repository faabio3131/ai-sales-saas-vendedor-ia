import {useEffect,useState,type FormEvent} from 'react';
import {CreditCard,MessageCircle,ShieldCheck} from 'lucide-react';
import {EvolutionConnectionCard} from './EvolutionConnectionCard';

type PaymentStatus='PENDING_VERIFICATION'|'ACTIVE'|'DISABLED';
interface ProviderInfo{id:string;displayName:string;status:string;kind:string;}
interface PaymentOverview{
 preference?:string;connections:Array<{providerId:string;status:PaymentStatus;
  recipientConfigured:boolean;credentialConfigured:boolean}>;
}
interface WhatsAppOverview{
 unitId:string;status:PaymentStatus|'NOT_CONFIGURED';
 credentialConfigured:boolean;phoneNumberConfigured:boolean;wabaConfigured:boolean;liveActivated:boolean;
}
const unitValid=(s:string)=>/^[A-Za-z0-9_-]{1,96}$/.test(s);
const metaId=(s:string)=>/^[1-9][0-9]{5,30}$/.test(s);
const recipientValid=(s:string)=>/^[a-zA-Z0-9._:@-]{3,140}$/.test(s);
const statusLabel=(s:string)=>s==='ACTIVE'?'Ativação externa verificada':
 s==='PENDING_VERIFICATION'?'Aguardando verificação externa':
 s==='DISABLED'?'Desativado':'Não configurado';

export function ProviderConnectionPanel({tenantId,role}:{tenantId:string;role:string}){
 const owner=role==='OWNER';
 const [unitId,setUnitId]=useState('main');
 const [unitDraft,setUnitDraft]=useState('main');
 const [providers,setProviders]=useState<ProviderInfo[]>([]);
 const [payments,setPayments]=useState<PaymentOverview|null>(null);
 const [whatsapp,setWhatsApp]=useState<WhatsAppOverview|null>(null);
 const [providerId,setProviderId]=useState('EFI');
 const [recipientId,setRecipientId]=useState('');
 const [phoneNumberId,setPhoneNumberId]=useState('');
 const [wabaId,setWabaId]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const headers={'x-tenant-id':tenantId};
 const root='/api/channels/whatsapp/units/'+encodeURIComponent(unitId);
 async function request(url:string,init:RequestInit={}){
  const response=await fetch(url,{...init,credentials:'same-origin',
   headers:{...headers,...(init.headers??{})}});
  const result=await response.json() as {ok:boolean;data?:unknown;error?:{code:string}};
  if(!response.ok||!result.ok)throw Error(result.error?.code??'CONNECTION_REQUEST_FAILED');
  return result.data;
 }
 async function refresh(signal?:AbortSignal){
  const [catalog,overview,wa]=await Promise.all([
   request('/api/payments/providers',{signal}),
   request('/api/payments/connections',{signal}),
   request(root,{signal}),
  ]);
  if(signal?.aborted)return;
  setProviders(catalog as ProviderInfo[]);
  setPayments(overview as PaymentOverview);
  setWhatsApp(wa as WhatsAppOverview);
 }
 useEffect(()=>{
  if(!owner)return;
  const ctrl=new AbortController();
  setPayments(null);setWhatsApp(null);setError('');
  void refresh(ctrl.signal).catch(()=>{if(!ctrl.signal.aborted)setError('Não foi possível consultar os provedores desta empresa.');});
  return ()=>ctrl.abort();
 // Requests are scoped by tenant and selected unit.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,tenantId,unitId]);
 if(!owner)return null;
 async function submit(event:FormEvent,type:'PAYMENT'|'WHATSAPP'){
  event.preventDefault();if(busy)return;
  if(type==='PAYMENT'&&!recipientValid(recipientId)){setError('Identificador do recebedor inválido.');return;}
  if(type==='WHATSAPP'&&(!metaId(phoneNumberId)||!metaId(wabaId))){
   setError('Informe IDs numéricos válidos fornecidos pela Meta.');return;
  }
  setBusy(true);setError('');setNotice('');
  try{
   if(type==='PAYMENT'){
    await request('/api/payments/connections/enroll',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({providerId,recipientId}),
    });
   }else{
    await request(root+'/register',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({phoneNumberId,wabaId}),
    });
   }
   setNotice('Solicitação registrada. A operação permanece desativada até a configuração segura das credenciais e a verificação externa.');
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível registrar o provedor.');}
  finally{setBusy(false);}
 }
 const field='mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
 const label='text-sm text-slate-300';
 return <section className="mt-6 rounded-3xl border border-sky-500/20 bg-slate-900/65 p-5 sm:p-6" aria-label="Integrações e credenciais externas">
  <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
   <ShieldCheck className="h-5 w-5 text-sky-300"/> Canais de atendimento e recebimentos
  </h2>
  <p className="mt-2 text-sm text-slate-400">Os identificadores são configuráveis para cada empresa e unidade.
   Chaves, tokens e certificados nunca são enviados por este formulário: ficam no cofre operacional.
   Registrar um provedor NÃO ativa Pix, WhatsApp ou atendimento automático.</p>
  <form className="mt-4 flex items-end gap-2" onSubmit={e=>{
   e.preventDefault();if(unitValid(unitDraft))setUnitId(unitDraft);else setError('Unidade inválida.');
  }}>
   <label className={label}>Unidade<input className={field} value={unitDraft}
    onChange={e=>setUnitDraft(e.target.value)} maxLength={96}/></label>
   <button className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-white">Selecionar</button>
  </form>
  {error&&<p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
  {notice&&<p className="mt-3 text-sm text-sky-300" role="status">{notice}</p>}
  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
   <EvolutionConnectionCard key={tenantId+'-'+unitId} tenantId={tenantId} unitId={unitId}/>
   <article className="rounded-xl border border-slate-800 p-4">
    <h3 className="flex items-center gap-2 font-semibold text-white"><CreditCard className="h-4 w-4"/> Recebimento / Pix</h3>
    <p className="mt-1 text-xs text-slate-400">Provedores com adaptador implementado. O titular do recebimento deve ser validado fora do painel.</p>
    <form className="mt-3 space-y-3" onSubmit={e=>void submit(e,'PAYMENT')}>
     <label className={label}>Provedor
      <select value={providerId} onChange={e=>setProviderId(e.target.value)} className={field}>
       {providers.filter(p=>p.status==='ADAPTER_IMPLEMENTED').map(p=>
        <option value={p.id} key={p.id}>{p.displayName}</option>)}
      </select>
     </label>
     <label className={label}>ID do recebedor no provedor
      <input className={field} value={recipientId} maxLength={140}
       onChange={e=>setRecipientId(e.target.value)} placeholder="Identificador informado pelo provedor"/>
     </label>
     <button disabled={busy} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
      Solicitar vinculação segura
     </button>
    </form>
    <div className="mt-4 space-y-1 text-xs text-slate-400">
     {(payments?.connections??[]).map(p=><p key={p.providerId}>
      <strong>{p.providerId}</strong>: {statusLabel(p.status)}
      {' '}— cofre {p.credentialConfigured?'referenciado':'pendente'}
     </p>)}
     {payments&&payments.connections.length===0&&<p>Nenhum provedor vinculado.</p>}
    </div>
   </article>
   <article className="rounded-xl border border-slate-800 p-4">
    <h3 className="flex items-center gap-2 font-semibold text-white"><MessageCircle className="h-4 w-4"/> WhatsApp oficial (Meta)</h3>
    <p className="mt-1 text-xs text-slate-400">Opção alternativa ao QR Code. Use os identificadores da conta empresarial Meta.</p>
    <form className="mt-3 space-y-3" onSubmit={e=>void submit(e,'WHATSAPP')}>
     <label className={label}>ID do número de telefone
      <input className={field} value={phoneNumberId} maxLength={31}
       onChange={e=>setPhoneNumberId(e.target.value)}/>
     </label>
     <label className={label}>ID da conta empresarial WhatsApp (WABA)
      <input className={field} value={wabaId} maxLength={31}
       onChange={e=>setWabaId(e.target.value)}/>
     </label>
     <button disabled={busy} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
      Solicitar conexão Meta
     </button>
    </form>
    <p className="mt-4 text-xs text-slate-400">Status: {statusLabel(whatsapp?.status??'NOT_CONFIGURED')}.</p>
    <p className="mt-1 text-xs text-slate-500">Cofre {whatsapp?.credentialConfigured?'referenciado':'pendente'}; webhook sem ativação real até verificação da Meta.</p>
   </article>
  </div>
 </section>;
}
