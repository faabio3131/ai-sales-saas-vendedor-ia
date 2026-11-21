import {useEffect,useState,type FormEvent} from 'react';
import {Building2,ClipboardCheck,ShieldCheck,AlertTriangle,Save,RefreshCw} from 'lucide-react';
import type {PilotRegistrationDraft,PilotRegistrationRecord,PilotRegistrationReport,
 PilotPaymentPreference,PilotStaffRole,PilotWeeklyHour} from '../pilot/onboarding/model';

type Mode='NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS';
const HOURS=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const PAYMENTS:PilotPaymentPreference[]=['PIX','PAYMENT_LINK','CHECKOUT','PIX_MANUAL',
 'CASH_ON_DELIVERY','CARD_ON_DELIVERY'];
const ROLES:PilotStaffRole[]=['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF','CASHIER','DELIVERY'];
const T08_ATTESTATION='CONFIRMO OS DADOS E O MODO OPERACIONAL DA EMPRESA';
function fresh():PilotRegistrationDraft{
 return {vertical:'FOOD_SERVICE',businessName:'',address:{street:'',number:'',district:'',municipality:'',state:'',postalCode:''},
  contact:{whatsappE164:'',alternatePhoneE164:''},assistantName:'',
  schedule:HOURS.map((_,day)=>({day,closed:true,open:'',close:''})),
  menu:{sourceRef:'',catalogVersion:0,pizzaFlavorCount:0,comboCount:0,
   halfHalfPricing:null,ingredientsReviewed:false,allergenEscalationAcknowledged:false},
  fulfillment:{pickupEnabled:false,deliveryEnabled:false,postalFees:[],
   prepMinutes:0,deliveryMinutes:0,pickupMinutes:0},
  preferredPaymentMethods:[],plannedStaffRoles:[],
 };
}
function asHour(value:PilotWeeklyHour[],day:number){
 return value.find(x=>x.day===day)??{day,closed:true,open:'',close:''};
}
function toggle<T extends string>(current:T[],value:T):T[]{
 return current.includes(value)?current.filter(x=>x!==value):[...current,value];
}
interface PilotPayload {
 ok:boolean;data?:{record:PilotRegistrationRecord|null;report:PilotRegistrationReport;
  blankDraft:PilotRegistrationDraft};
 error?:{code?:string};
}
export function PilotOnboardingPanel({tenantId,role}:{tenantId:string;role:string}){
 const owner=role==='OWNER';
 const [unitId,setUnitId]=useState('main');
 const [unitField,setUnitField]=useState('main');
 const [form,setForm]=useState<PilotRegistrationDraft>(fresh);
 const [record,setRecord]=useState<PilotRegistrationRecord|null>(null);
 const [report,setReport]=useState<PilotRegistrationReport|null>(null);
 const [mode,setMode]=useState<Mode|'UNSELECTED'>('UNSELECTED');
 const [reason,setReason]=useState('');
 const [external,setExternal]=useState('');
 const [evidenceRef,setEvidenceRef]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const prefix='/api/establishments/units/'+encodeURIComponent(unitId);
 async function call(path:string,init?:RequestInit){
  const res=await fetch(prefix+path,{...init,credentials:'same-origin',
   headers:{'x-tenant-id':tenantId,...(init?.headers??{})}});
  const p=await res.json() as PilotPayload & {data?:never};
  if(!res.ok||!p.ok)throw new Error(p.error?.code??'PILOT_REQUEST_FAILED');
  return p as PilotPayload;
 }
 async function load(signal?:AbortSignal){
  const res=await fetch(prefix+'/configuration',{signal,credentials:'same-origin',headers:{'x-tenant-id':tenantId}});
  const payload=await res.json() as PilotPayload;
  if(!res.ok||!payload.ok||!payload.data)throw new Error(payload.error?.code??'PILOT_LOAD_FAILED');
  if(signal?.aborted)return;
  setRecord(payload.data.record);setReport(payload.data.report);
  setForm(payload.data.record?.data?{...payload.data.record.data,
   vertical:payload.data.record.data.vertical??'FOOD_SERVICE'}:fresh());
  setMode(payload.data.record?.modeDecision?.mode??'UNSELECTED');
  setReason(payload.data.record?.modeDecision?.reason??'');
  setExternal(payload.data.record?.modeDecision?.externalSystemName??'');
 }
 useEffect(()=>{
  if(!owner)return;
  const c=new AbortController();
  setForm(fresh());setRecord(null);setReport(null);setError('');setNotice('');
  void load(c.signal).catch(()=>{if(!c.signal.aborted)setError('Não foi possível ler o cadastro da unidade.');});
  return ()=>c.abort();
 // load is bound to current tenant and unit; cancel stale requests on switch.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,tenantId,unitId]);
 if(!owner)return null;
 function updateAddress(key:keyof PilotRegistrationDraft['address'],value:string){
  setForm(v=>({...v,address:{...v.address,[key]:value}}));
 }
 function updateContact(key:keyof PilotRegistrationDraft['contact'],value:string){
  setForm(v=>({...v,contact:{...v.contact,[key]:value}}));
 }
 function updateHour(day:number,key:'closed'|'open'|'close',value:boolean|string){
  setForm(v=>({...v,schedule:HOURS.map((_,i)=>{
   const h=asHour(v.schedule,i);
   if(i!==day)return h;
   if(key==='closed')return {...h,closed:Boolean(value),open:'',close:''};
   return {...h,[key]:value};
  })}));
 }
 async function send(path:string,payload:unknown,method:'PUT'|'POST'){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const res=await call(path,{method,headers:{'content-type':'application/json'},
    body:JSON.stringify(payload)});
   if(!res.ok)throw new Error('PILOT_REQUEST_FAILED');
   await load();
   setNotice(path==='/configuration'?'Configurações da unidade salvas sem ativar vendas.':
    path==='/operation-mode'?'Decisão de modo registrada sem ativar PDV ou cozinha.':
    'Aceite da proprietária registrado. Confira o relatório do gate.');
  }catch(e){setError(e instanceof Error?e.message:'Falha de autorização, validação ou versão.');}
  finally{setBusy(false);}
 }
 const input='mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500';
 const small='text-xs text-slate-400';
 return <section className="mt-6 rounded-3xl border border-violet-500/20 bg-slate-900/65 p-5 sm:p-6" aria-label="Configurações do estabelecimento">
  <div className="flex flex-wrap justify-between gap-3">
   <div><h2 className="flex items-center gap-2 text-xl font-bold text-white"><Building2 className="h-5 w-5 text-violet-400"/> Configurações do estabelecimento</h2>
    <p className="mt-1 text-sm text-slate-400">Dados particulares de cada empresa/unidade, salvos no banco de dados com versões. Somente o proprietário autenticado pode escolher o modo e confirmar o cadastro; nenhuma cobrança, mensagem ou integração é ativada aqui.</p></div>
   <form onSubmit={e=>{e.preventDefault();if(/^[A-Za-z0-9_-]{1,96}$/.test(unitField))setUnitId(unitField);else setError('Unidade inválida.');}} className="flex items-end gap-2">
    <label className={small}>Unidade<input aria-label="Unidade do piloto" value={unitField} onChange={e=>setUnitField(e.target.value)} className={input}/></label>
    <button type="submit" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Abrir</button>
   </form>
  </div>
  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
   <span className="rounded-lg border border-slate-600 px-3 py-2 text-slate-200">Revisão {record?.version??0}</span>
   <span className="rounded-lg border border-amber-700/40 px-3 py-2 text-amber-200">Gate {report?.status??'NO_GO'}</span>
   <span className="rounded-lg border border-slate-600 px-3 py-2 text-slate-300">Modo {report?.selectedMode??'não escolhido'}</span>
   <button type="button" disabled={busy} onClick={()=>void load().catch(()=>setError('Falha ao atualizar.'))} className="rounded-lg border border-slate-600 px-3 py-2"><RefreshCw className="inline h-3.5 w-3.5"/> Atualizar</button>
  </div>
  {error&&<p role="alert" className="mt-4 rounded-lg border border-rose-800 p-3 text-sm text-rose-300">{error}</p>}
  {notice&&<p role="status" className="mt-4 rounded-lg border border-sky-800 p-3 text-sm text-sky-300">{notice}</p>}
  <form className="mt-5 space-y-5" onSubmit={(e:FormEvent)=>{e.preventDefault();void send('/configuration',{expectedVersion:record?.version??0,data:form},'PUT');}}>
   <fieldset className="grid gap-3 md:grid-cols-2">
    <legend className="mb-3 font-semibold text-white">Identificação e contato</legend>
    <label className={small}>Segmento do negócio
     <select className={input} value={form.vertical} onChange={e=>setForm(v=>({...v,vertical:e.target.value as PilotRegistrationDraft['vertical']}))}>
      <option value="FOOD_SERVICE">Alimentação / restaurantes</option>
      <option value="RETAIL">Varejo / comércio</option>
      <option value="SERVICES">Serviços</option>
      <option value="BEAUTY">Beleza</option>
      <option value="HEALTH_SERVICE">Serviços de saúde</option>
      <option value="OTHER">Outro setor</option>
     </select>
    </label>
    <label className={small}>Nome do estabelecimento<input value={form.businessName} onChange={e=>setForm(v=>({...v,businessName:e.target.value}))} className={input}/></label>
    <label className={small}>Nome escolhido para atendente IA<input value={form.assistantName} onChange={e=>setForm(v=>({...v,assistantName:e.target.value}))} className={input}/></label>
    {(['street','number','district','municipality','state','postalCode'] as const).map((key)=>
     <label key={key} className={small}>{({street:'Rua/avenida',number:'Número',district:'Bairro',municipality:'Município',state:'UF',postalCode:'CEP (8 dígitos)'})[key]}
      <input value={form.address[key]} maxLength={key==='postalCode'?8:160}
       onChange={e=>updateAddress(key,e.target.value)} className={input}/></label>)}
    <label className={small}>WhatsApp 55 + DDD + número<input value={form.contact.whatsappE164} onChange={e=>updateContact('whatsappE164',e.target.value)} className={input}/></label>
    <label className={small}>Telefone adicional (opcional)<input value={form.contact.alternatePhoneE164} onChange={e=>updateContact('alternatePhoneE164',e.target.value)} className={input}/></label>
   </fieldset>
   <fieldset><legend className="font-semibold text-white">Horários por dia da semana</legend>
    <p className="mt-1 text-xs text-slate-400">Horários devem ser informados pela proprietária, inclusive os dias fechados.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{HOURS.map((label,day)=>{
     const h=asHour(form.schedule,day);
     return <div key={day} className="rounded-xl border border-slate-800 p-3 text-xs text-slate-300">
      <div className="flex items-center justify-between gap-2"><strong>{label}</strong>
       <label><input type="checkbox" checked={!h.closed} onChange={e=>updateHour(day,'closed',!e.target.checked)}/> Aberto</label></div>
      {!h.closed&&<div className="mt-2 flex gap-2">
       <input aria-label={'Abre '+label} placeholder="HH:mm" value={h.open} maxLength={5} onChange={e=>updateHour(day,'open',e.target.value)} className={input}/>
       <input aria-label={'Fecha '+label} placeholder="HH:mm" value={h.close} maxLength={5} onChange={e=>updateHour(day,'close',e.target.value)} className={input}/></div>}
     </div>;})}</div>
   </fieldset>
   <fieldset className="grid gap-3 md:grid-cols-2">
    <legend className="mb-2 font-semibold text-white">{form.vertical==='FOOD_SERVICE'?'Cardápio, preços e segurança alimentar':'Catálogo de serviços/produtos (pack específico a certificar)'}</legend>
    <label className={small}>Referência do cardápio aprovado<input value={form.menu.sourceRef} onChange={e=>setForm(v=>({...v,menu:{...v.menu,sourceRef:e.target.value}}))} className={input}/></label>
    <label className={small}>Versão real do catálogo T03<input type="number" min="0" value={form.menu.catalogVersion} onChange={e=>setForm(v=>({...v,menu:{...v.menu,catalogVersion:Number(e.target.value)}}))} className={input}/></label>
    <label className={small}>Quantidade de sabores verificados<input type="number" min="0" value={form.menu.pizzaFlavorCount} onChange={e=>setForm(v=>({...v,menu:{...v.menu,pizzaFlavorCount:Number(e.target.value)}}))} className={input}/></label>
    <label className={small}>Quantidade de combos verificados<input type="number" min="0" value={form.menu.comboCount} onChange={e=>setForm(v=>({...v,menu:{...v.menu,comboCount:Number(e.target.value)}}))} className={input}/></label>
    <label className={small}>Regra de pizza meio a meio
     <select className={input} value={form.menu.halfHalfPricing??''} onChange={e=>setForm(v=>({...v,menu:{...v.menu,halfHalfPricing:e.target.value===''?null:e.target.value as 'MAX_FLAVOR'|'AVERAGE_CEIL'}}))}>
      <option value="">A proprietária ainda não decidiu</option>
      <option value="MAX_FLAVOR">Cobra o maior preço dos dois sabores</option>
      <option value="AVERAGE_CEIL">Média dos sabores, arredondada em centavos</option>
     </select></label>
    <div className="space-y-2 text-xs text-slate-300">
     <label className="flex gap-2"><input type="checkbox" checked={form.menu.ingredientsReviewed} onChange={e=>setForm(v=>({...v,menu:{...v.menu,ingredientsReviewed:e.target.checked}}))}/> Ingredientes e preços conferidos com a proprietária</label>
     <label className="flex gap-2"><input type="checkbox" checked={form.menu.allergenEscalationAcknowledged} onChange={e=>setForm(v=>({...v,menu:{...v.menu,allergenEscalationAcknowledged:e.target.checked}}))}/> Alergias e restrições alimentares exigem confirmação humana</label>
    </div>
   </fieldset>
   <fieldset><legend className="font-semibold text-white">Retirada, delivery e valores</legend>
    <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-300">{(['pickupEnabled','deliveryEnabled'] as const).map(k=>
     <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={form.fulfillment[k]} onChange={e=>setForm(v=>({...v,fulfillment:{...v.fulfillment,[k]:e.target.checked}}))}/>{k==='pickupEnabled'?'Retirada':'Entrega'}</label>)}</div>
    <div className="mt-3 grid grid-cols-3 gap-2">{(['prepMinutes','pickupMinutes','deliveryMinutes'] as const).map(k=>
     <label key={k} className={small}>{({prepMinutes:'Preparo (min)',pickupMinutes:'Retirada (min)',deliveryMinutes:'Entrega (min)'})[k]}
      <input type="number" min="0" max="240" value={form.fulfillment[k]} className={input} onChange={e=>setForm(v=>({...v,fulfillment:{...v.fulfillment,[k]:Number(e.target.value)}}))}/></label>)}</div>
    <p className="mt-3 text-xs text-slate-400">Taxas em centavos de reais; as mesmas zonas e valores devem constar do catálogo T03. Nenhuma área é criada automaticamente.</p>
    {form.fulfillment.postalFees.map((fee,i)=><div key={i} className="mt-2 flex flex-wrap items-end gap-2">
     {(['zoneId','fromCep','toCep','feeMinor'] as const).map(k=><label key={k} className={small}>{({zoneId:'Zona',fromCep:'CEP inicial',toCep:'CEP final',feeMinor:'Taxa (centavos)'})[k]}
      <input className={input} value={fee[k]} onChange={e=>setForm(v=>({...v,fulfillment:{...v.fulfillment,postalFees:v.fulfillment.postalFees.map((p,j)=>j===i?{...p,[k]:k==='feeMinor'?Number(e.target.value):e.target.value}:p)}}))}/></label>)}
     <button type="button" className="rounded-lg border border-rose-800 px-3 py-2 text-xs" onClick={()=>setForm(v=>({...v,fulfillment:{...v.fulfillment,postalFees:v.fulfillment.postalFees.filter((_,j)=>j!==i)}}))}>Remover</button>
    </div>)}
    <button type="button" className="mt-3 rounded-lg border border-slate-600 px-3 py-2 text-xs text-white" onClick={()=>setForm(v=>({...v,fulfillment:{...v.fulfillment,postalFees:[...v.fulfillment.postalFees,{zoneId:'',fromCep:'',toCep:'',feeMinor:0}]}}))}>Adicionar zona por CEP</button>
   </fieldset>
   <fieldset className="grid gap-3 md:grid-cols-2">
    <legend className="mb-2 font-semibold text-white">Preferências de pagamento e funções</legend>
    <div><p className={small}>Pagamento previsto (não ativa cobranças)</p>{PAYMENTS.map(p=><label key={p} className="mt-2 block text-xs text-slate-300">
     <input type="checkbox" checked={form.preferredPaymentMethods.includes(p)} onChange={()=>setForm(v=>({...v,preferredPaymentMethods:toggle(v.preferredPaymentMethods,p)}))}/> {p}</label>)}</div>
    <div><p className={small}>Papéis planejados (não cria usuários)</p>{ROLES.map(p=><label key={p} className="mt-2 block text-xs text-slate-300">
     <input type="checkbox" checked={form.plannedStaffRoles.includes(p)} onChange={()=>setForm(v=>({...v,plannedStaffRoles:toggle(v.plannedStaffRoles,p)}))}/> {p}</label>)}</div>
   </fieldset>
   <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"><Save className="h-4 w-4"/> Salvar rascunho versionado</button>
  </form>
  <div className="mt-6 rounded-2xl border border-violet-500/20 bg-slate-950/50 p-4">
   <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-4 w-4 text-violet-300"/> Decisão explícita da proprietária</h3>
   <p className="mt-2 text-xs text-slate-400">Escolher um modo aqui não altera a operação real. O integrado só poderá funcionar após certificação de conector em T08.4.</p>
   <form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();if(mode!=='UNSELECTED')void send('/operation-mode',{
    expectedVersion:record?.version??0,mode,reason,
    ...(mode==='INTEGRATED_OPERATIONS'?{externalSystemName:external}:{})},'POST');}}>
    <label className={small}>Modo operacional
     <select value={mode} onChange={e=>setMode(e.target.value as Mode|'UNSELECTED')} className={input}>
      <option value="UNSELECTED">Não escolhido</option><option value="NATIVE_OPERATIONS">Painel operacional próprio do AtendeVendeIA</option>
      <option value="INTEGRATED_OPERATIONS">Integrado ao sistema da pizzaria (PDV/KDS)</option></select></label>
    {mode==='INTEGRATED_OPERATIONS'&&<label className={small}>Nome do sistema existente<input value={external} onChange={e=>setExternal(e.target.value)} className={input}/></label>}
    <label className={small}>Justificativa da escolha<input value={reason} onChange={e=>setReason(e.target.value)} className={input}/></label>
    <button type="submit" disabled={busy||!record||mode==='UNSELECTED'} className="rounded-lg border border-violet-500/50 px-4 py-2 text-sm text-violet-200 disabled:opacity-50">Registrar decisão de modo</button>
   </form>
  </div>
  <div className="mt-5 rounded-2xl border border-amber-600/20 bg-slate-950/50 p-4">
   <h3 className="flex items-center gap-2 font-semibold text-white"><ClipboardCheck className="h-4 w-4 text-amber-300"/> Critérios para homologação real do piloto alimentar</h3>
   <p className="mt-1 text-xs text-slate-400">A configuração pode ser salva independentemente da homologação externa. Setores adicionais terão critérios próprios de ativação.</p>
   <div className="mt-3 grid gap-2 md:grid-cols-2">{(report?.checks??[]).map(c=>
    <div key={c.code} className="rounded-lg border border-slate-800 p-3 text-xs">
     <strong className={c.status==='READY'?'text-emerald-300':'text-amber-300'}>{c.status==='READY'?'✓':'!'} {c.code}</strong>
     <p className="mt-1 text-slate-400">{c.detail}</p>
    </div>)}</div>
   {!report&&<p className="text-xs text-slate-400">Consulte os critérios após criar o rascunho.</p>}
   <form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();void send('/owner-approval',{
    expectedVersion:record?.version??0,statement:T08_ATTESTATION,evidenceRef},'POST');}}>
    <label className={small}>Referência da confirmação/documento da proprietária (document:... ou owner-approval:...)
     <input className={input} value={evidenceRef} onChange={e=>setEvidenceRef(e.target.value)} placeholder="owner-approval:referencia-validada"/></label>
    <p className="flex items-start gap-2 text-xs text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0"/> O aceite exige todas as informações e o catálogo operacional com valores conferidos. A referência informada é apenas declarada: não comprova identidade jurídica por si só.</p>
    <button type="submit" disabled={busy||!record||report?.checks.some(x=>x.code!=='OWNER_SIGNOFF'&&x.status!=='READY')} className="rounded-lg border border-amber-500/50 px-4 py-2 text-sm font-semibold text-amber-200 disabled:opacity-50">Confirmar dados como proprietária autenticada</button>
   </form>
   <p className="mt-3 text-xs text-slate-500">Status real: {report?.status??'NO_GO'} · T08.2 depende de aprovação separada. Este painel não ativa WhatsApp, Pix, PDV nem produção.</p>
  </div>
 </section>;
}
