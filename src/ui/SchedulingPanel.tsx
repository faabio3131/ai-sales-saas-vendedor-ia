import {useEffect,useState,type ReactNode} from 'react';
import type {Booking,ScheduleConfig,ScheduleSlot,ScheduleServiceDefinition,Shift,
 ScheduleProfessional,ScheduleResource,ScheduleBlock,BookingPack,PackPolicy} from '../scheduling/model';
type BlockInput=Omit<ScheduleBlock,'startMs'|'endMs'>&{startAt:string;endAt:string};
type Draft=Omit<ScheduleConfig,'tenantId'|'unitId'|'version'|'updatedAt'|'updatedBy'|'blocks'>&{
 expectedVersion:number;blocks:BlockInput[];
};
const field='w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';
const btn='rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-50';
const labels=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const status:Record<Booking['status'],string>={HELD:'Reservado temporariamente',CONFIRMED:'Confirmado',
 CANCELLED:'Cancelado',EXPIRED:'Expirado',COMPLETED:'Concluído',NO_SHOW:'Falta registrada'};
const packNames:Record<BookingPack,string>={SALON:'Salão de beleza',BARBERSHOP:'Barbearia',AESTHETICS_ADMIN:'Estética — administrativo',PROFESSIONAL_SERVICES:'Serviços profissionais'};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
function fresh():Draft{
 return {expectedVersion:0,timezone:'America/Sao_Paulo',holdMinutes:15,reminderMinutes:60,
  shifts:[],holidays:[],professionals:[],resources:[],services:[],blocks:[]};
}
function toDraft(c:ScheduleConfig):Draft{
 const {tenantId:_t,unitId:_u,version,updatedAt:_a,updatedBy:_b,blocks,...rest}=c;
 return {...rest,expectedVersion:version,blocks:blocks.map(({startMs,endMs,...b})=>
  ({...b,startAt:new Date(startMs).toISOString(),endAt:new Date(endMs).toISOString()}))};
}
function label(t:string,child:ReactNode){return <label className="block text-xs text-slate-400">{t}{child}</label>;}
function key(){return crypto.randomUUID().replace(/-/g,'');}
function fmtTime(minute:number){return String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');}
function minute(v:string){const [h,m]=v.split(':').map(Number);return h*60+m;}
function localDate(tz:string){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date()).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function ShiftEditor({value,onChange}:{value:Shift[];onChange:(s:Shift[])=>void}){
 return <div className="space-y-2">
  {value.map((s,i)=><div key={i} className="grid grid-cols-[70px_1fr_1fr_auto] gap-2">
   <select aria-label="Dia da semana" className={field} value={s.day} onChange={e=>onChange(value.map((x,j)=>j===i?{...x,day:Number(e.target.value)}:x))}>
    {labels.map((l,d)=><option value={d} key={d}>{l}</option>)}</select>
   <input aria-label="Início do turno" type="time" step={900} className={field} value={fmtTime(s.startMinute)}
    onChange={e=>onChange(value.map((x,j)=>j===i?{...x,startMinute:minute(e.target.value)}:x))}/>
   <select aria-label="Fim do turno" className={field} value={s.endMinute}
    onChange={e=>onChange(value.map((x,j)=>j===i?{...x,endMinute:Number(e.target.value)}:x))}>
    {Array.from({length:96},(_,k)=>(k+1)*15).map(m=><option key={m} value={m}>{fmtTime(m)}</option>)}</select>
   <button className={btn} onClick={()=>onChange(value.filter((_,j)=>j!==i))}>Remover</button>
  </div>)}
  <button className={btn} onClick={()=>onChange([...value,{day:1,startMinute:540,endMinute:1080}])}>Adicionar turno</button>
 </div>;
}
function PeopleEditor({title,items,onChange,unitShifts}:{title:string;items:ScheduleProfessional[];onChange:(x:ScheduleProfessional[])=>void;unitShifts:Shift[]}){
 return <div className="space-y-3"><h4 className="font-semibold text-slate-100">{title}</h4>
  {items.map((p,i)=><div key={i} className="rounded-lg border border-slate-800 p-3 space-y-2">
   <div className="grid gap-2 sm:grid-cols-2">
    {label('ID estável (mesmo ID em outras unidades = mesmo recurso)',<input className={field} value={p.id}
     onChange={e=>onChange(items.map((x,j)=>j===i?{...x,id:e.target.value}:x))}/>)}
    {label('Nome de exibição',<input className={field} value={p.name}
     onChange={e=>onChange(items.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>)}
   </div>
   {title==='Profissionais'&&label('Função profissional (opcional)',<input className={field} value={p.title??''} onChange={e=>onChange(items.map((x,j)=>{if(j!==i)return x;const {title:_title,...rest}=x;return e.target.value?{...rest,title:e.target.value}:rest;}))}/>)}
   <label className="text-sm text-slate-300"><input type="checkbox" checked={p.active}
    onChange={e=>onChange(items.map((x,j)=>j===i?{...x,active:e.target.checked}:x))}/> Ativo</label>
   <ShiftEditor value={p.shifts} onChange={shifts=>onChange(items.map((x,j)=>j===i?{...x,shifts}:x))}/>
   <div className="flex gap-2"><button className={btn} onClick={()=>onChange(items.map((x,j)=>j===i?{...x,shifts:structuredClone(unitShifts)}:x))}>Copiar turnos da unidade</button>
   <button className={btn} onClick={()=>onChange(items.filter((_,j)=>j!==i))}>Remover</button></div>
  </div>)}
  <button className={btn} onClick={()=>onChange([...items,{id:key(),name:'',active:true,shifts:structuredClone(unitShifts)}])}>Adicionar</button>
 </div>;
}
export function SchedulingPanel({tenantId,unitId,role,availablePacks=[]}:{tenantId:string;unitId:string;role:string;availablePacks?:BookingPack[]}){
 const admin=role==='OWNER'||role==='ADMIN',operator=['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF'].includes(role);
 const [config,setConfig]=useState<ScheduleConfig|null>(null),[draft,setDraft]=useState<Draft>(fresh);
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [customers,setCustomers]=useState<{id:string;name:string;status:string}[]>([]);
 const [date,setDate]=useState(''),[serviceId,setServiceId]=useState(''),[professionalId,setProfessionalId]=useState('');
 const [customerId,setCustomerId]=useState(''),[available,setAvailable]=useState<ScheduleSlot[]>([]);
 const [bookings,setBookings]=useState<Booking[]>([]),[selected,setSelected]=useState<Booking|null>(null);
 const [startAt,setStartAt]=useState(''),[why,setWhy]=useState('Solicitação do cliente');
 const [providerId,setProviderId]=useState(''),[providerPaymentId,setProviderPaymentId]=useState('');
 const [rangeDate,setRangeDate]=useState('');
 const [acceptedVersion,setAcceptedVersion]=useState<number|null>(null);
 const canMarkNoShow=admin||role==='MANAGER';
 const prefix='/api/scheduling/units/'+encodeURIComponent(unitId);
 async function api<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const res=await fetch(path,{method,credentials:'same-origin',signal,
   headers:{'x-tenant-id':tenantId,...(body===undefined?{}:{'content-type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await res.json() as {ok:boolean;data:T;error?:{code:string}};
  if(!res.ok||!data.ok)throw new Error(data.error?.code??'SCHEDULE_REQUEST_FAILED');
  return data.data;
 }
 useEffect(()=>{
  const ctrl=new AbortController();
  api<ScheduleConfig|null>(prefix+'/config','GET',undefined,ctrl.signal).then(c=>{
   if(ctrl.signal.aborted)return;
   setConfig(c);setDraft(c?toDraft(c):fresh());
   const today=localDate(c?.timezone??'America/Sao_Paulo');setDate(today);setRangeDate(today);
  }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e.message));});
  if(operator)api<{id:string;name:string;status:string}[]>('/api/customers','GET',undefined,ctrl.signal)
   .then(c=>{if(!ctrl.signal.aborted)setCustomers(c.filter(x=>x.status==='ACTIVE').map(x=>({id:x.id,name:x.name,status:x.status})));})
   .catch(()=>{if(!ctrl.signal.aborted)setError('Não foi possível carregar os clientes autorizados.');});
  return ()=>ctrl.abort();
 // The entire panel is keyed by tenant/unit; no old scope is reused.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tenantId,unitId,operator]);
 async function run(action:()=>Promise<void>){
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await action();}catch(e){setError(e instanceof Error?e.message:'Falha no agendamento');}
  finally{setBusy(false);}
 }
 const set=<K extends keyof Draft>(k:K,v:Draft[K])=>setDraft(d=>({...d,[k]:v}));
 const save=()=>run(async()=>{
  const c=await api<ScheduleConfig>(prefix+'/config','PUT',draft);
  setConfig(c);setDraft(toDraft(c));setEditing(false);setAvailable([]);setSelected(null);setAcceptedVersion(null);setNotice('Agenda configurada na versão '+c.version+'.');
 });
 const services=config?.services.filter(s=>s.active)??[];
 const selectedService=services.find(x=>x.id===serviceId),pros=config?.professionals.filter(p=>p.active&&selectedService?.professionalIds.includes(p.id))??[];
 const findSlots=()=>run(async()=>{
  setAvailable(await api<ScheduleSlot[]>(prefix+'/availability?'+new URLSearchParams({serviceId,professionalId,date})));
  setStartAt('');
 });
 function range(){
  const midnight=Date.parse(rangeDate+'T00:00:00Z');
  if(!Number.isFinite(midnight))throw Error('Data inválida');
  return {startAt:new Date(midnight-86400000).toISOString(),endAt:new Date(midnight+2*86400000).toISOString()};
 }
 const refresh=()=>run(async()=>{
  setBookings(await api<Booking[]>(prefix+'/bookings?'+new URLSearchParams(range())));
 });
 const reserve=()=>run(async()=>{
  if(!config||config.pack&&acceptedVersion!==config.version)return;
  const b=await api<Booking>(prefix+'/bookings','POST',{serviceId,professionalId,customerId,startAt,
   expectedConfigVersion:config.version,idempotencyKey:key(),...(config.pack?{acceptedPolicyVersion:acceptedVersion}:{})});
  setAcceptedVersion(null);
  setSelected(b);setAvailable([]);setNotice('Reserva temporária persistida; ainda não confirmada.');
 });
 const command=(path:string,extra:Record<string,unknown>={})=>run(async()=>{
  if(!selected)return;
  const b=await api<Booking>(prefix+'/bookings/'+selected.id+path,'POST',
   {expectedVersion:selected.version,idempotencyKey:key(),...extra});
  setSelected(b);setBookings(old=>old.map(x=>x.id===b.id?b:x));setAvailable([]);
  setNotice('Estado persistido: '+status[b.status]+'. Sinal: '+b.deposit.status+'.');
 });
 const depositRefresh=()=>run(async()=>{
  if(!selected)return;
  const b=await api<Booking>(prefix+'/bookings/'+selected.id+'/deposit/refresh','POST',
    providerPaymentId?{providerPaymentId}:{});
  setSelected(b);setNotice('Status verificado do sinal: '+b.deposit.status);
 });
 function changePack(patch:Partial<PackPolicy>){setDraft(d=>d.pack?{...d,pack:{...d.pack,...patch}}:d);}
 const retryNotice=(noticeKey:string)=>run(async()=>{
  if(!selected)return;
  const b=await api<Booking>(prefix+'/bookings/'+selected.id+'/notice/retry','POST',{expectedVersion:selected.version,noticeKey});
  setSelected(b);setBookings(old=>old.map(x=>x.id===b.id?b:x));setNotice('Comunicação recolocada na fila; envio ainda não confirmado.');
 });
 function changeService(i:number,patch:Partial<ScheduleServiceDefinition>){
  setDraft(d=>({...d,services:d.services.map((x,j)=>j===i?{...x,...patch}:x)}));
 }
 return <section className="mt-6 rounded-3xl border border-sky-800/40 bg-slate-900/70 p-5 space-y-5" aria-label="Agenda horizontal">
  <div><h2 className="text-xl font-bold text-white">Agenda e reservas</h2>
   <p className="text-sm text-slate-400">Unidade {unitId} · {config?.timezone??'Sem configuração'} · Operação interna. A seleção de um horário não equivale a uma confirmação.</p>
  </div>
  {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-300">{notice}</p>}
  {admin&&<button className={btn} onClick={()=>setEditing(x=>!x)}>{editing?'Fechar configuração':'Configurar agenda e serviços'}</button>}
  {admin&&editing&&<div className="space-y-5 rounded-xl border border-slate-700 p-4">
   <div className="grid gap-3 sm:grid-cols-3">
    {label('Fuso IANA',<input className={field} value={draft.timezone} onChange={e=>set('timezone',e.target.value)}/>)}
    {label('Validade da reserva (min)',<input type="number" className={field} min={5} max={60} value={draft.holdMinutes} onChange={e=>set('holdMinutes',Number(e.target.value))}/>)}
    {label('Antecedência do lembrete (min)',<input type="number" className={field} min={0} value={draft.reminderMinutes} onChange={e=>set('reminderMinutes',Number(e.target.value))}/>)}
   </div>
   <h3 className="font-semibold text-white">Pack de atendimento</h3>
   <select aria-label="Pack de atendimento" className={field} value={draft.pack?.kind??''} onChange={e=>{
    const kind=e.target.value as BookingPack;
    if(!kind){setDraft(d=>{const {pack:_pack,...rest}=d;return rest;});return;}
    set('pack',{kind,cancelNoticeMinutes:1440,noShowGraceMinutes:15,notifyWhatsApp:false});
   }}><option value="">Agenda horizontal (sem pack)</option>{availablePacks.map(k=><option key={k} value={k}>{packNames[k]}</option>)}</select>
   {draft.pack&&<div className="space-y-3 rounded-xl border border-slate-800 p-3">
    {label('Antecedência para cancelamento (min)',<input type="number" min={0} max={10080} className={field} value={draft.pack.cancelNoticeMinutes} onChange={e=>changePack({cancelNoticeMinutes:Number(e.target.value)})}/>)}
    {label('Tolerância de falta (min)',<input type="number" min={0} max={120} className={field} value={draft.pack.noShowGraceMinutes} onChange={e=>changePack({noShowGraceMinutes:Number(e.target.value)})}/>)}
    <label className="text-sm text-slate-300"><input type="checkbox" checked={draft.pack.notifyWhatsApp} onChange={e=>changePack({notifyWhatsApp:e.target.checked})}/> Solicitar comunicações transacionais via WhatsApp (consentimento verificado e gates de operação obrigatórios)</label>
    {draft.pack.notifyWhatsApp&&<div className="space-y-2">
     <p className="text-xs text-slate-400">Templates UTILITY opcionais para fora da janela de 24 h (pt_BR). O runtime verifica aprovação e texto exato no WABA; sem template aprovado, o envio fica bloqueado.</p>
     {(['CONFIRMATION','RESCHEDULE','CANCELLATION','REMINDER'] as const).map(kind=><label key={kind} className="block text-xs text-slate-400">{kind}<input className={field} value={draft.pack?.utilityTemplates?.[kind]??''} placeholder="nome_template_meta" onChange={e=>{
      const next={...draft.pack?.utilityTemplates};
      if(e.target.value)next[kind]=e.target.value;else delete next[kind];
      changePack({utilityTemplates:next});
     }}/></label>)}
    </div>}
    <p className="text-xs text-slate-400">Sinal sujeito a revisão humana em cancelamento/falta; nenhum confisco automático. Estética: somente atos administrativos, sem diagnóstico, indicação clínica ou avaliação automatizada.</p>
   </div>}
   <h3 className="font-semibold text-white">Turnos da unidade</h3><ShiftEditor value={draft.shifts} onChange={s=>set('shifts',s)}/>
   <PeopleEditor title="Profissionais" items={draft.professionals} onChange={p=>set('professionals',p)} unitShifts={draft.shifts}/>
   <PeopleEditor title="Recursos físicos" items={draft.resources} onChange={(p:ScheduleResource[])=>set('resources',p)} unitShifts={draft.shifts}/>
   <h3 className="font-semibold text-white">Serviços e duração</h3>
   {draft.services.map((s,i)=><div key={i} className="space-y-2 rounded-xl border border-slate-800 p-3">
    <div className="grid gap-2 sm:grid-cols-3">
     {label('Nome',<input className={field} value={s.name} onChange={e=>changeService(i,{name:e.target.value})}/>)}
     {label('Duração (min)',<input type="number" className={field} min={15} max={480} step={15} value={s.durationMinutes} onChange={e=>changeService(i,{durationMinutes:Number(e.target.value)})}/>)}
     {label('Sinal em centavos (0 = nenhum)',<input type="number" className={field} min={0} value={s.depositMinor} onChange={e=>changeService(i,{depositMinor:Number(e.target.value)})}/>)}
    </div>
    {draft.pack&&<div className="grid gap-2 sm:grid-cols-2">
     {label('Categoria comercial',<input className={field} value={s.category??''} onChange={e=>changeService(i,{category:e.target.value})}/>)}
     {label('Preço total em centavos',<input type="number" min={0} className={field} value={s.priceMinor??''} onChange={e=>changeService(i,{priceMinor:Number(e.target.value)})}/>)}
    </div>}
    <label className="text-sm text-slate-300"><input type="checkbox" checked={s.active} onChange={e=>changeService(i,{active:e.target.checked})}/> Ativo</label>
    <p className="text-xs text-slate-400">Profissionais autorizados</p>
    {draft.professionals.map(p=><label key={p.id} className="mr-3 text-sm text-slate-300"><input type="checkbox" checked={s.professionalIds.includes(p.id)}
     onChange={e=>changeService(i,{professionalIds:e.target.checked?[...s.professionalIds,p.id]:s.professionalIds.filter(x=>x!==p.id)})}/> {p.name||p.id}</label>)}
    <p className="text-xs text-slate-400">Recursos simultaneamente necessários</p>
    {draft.resources.map(p=><label key={p.id} className="mr-3 text-sm text-slate-300"><input type="checkbox" checked={s.resourceIds.includes(p.id)}
     onChange={e=>changeService(i,{resourceIds:e.target.checked?[...s.resourceIds,p.id]:s.resourceIds.filter(x=>x!==p.id)})}/> {p.name||p.id}</label>)}
    <button className={btn} onClick={()=>set('services',draft.services.filter((_,j)=>j!==i))}>Remover serviço</button>
   </div>)}
   <button className={btn} onClick={()=>set('services',[...draft.services,{id:key(),name:'',active:true,durationMinutes:30,depositMinor:0,professionalIds:[],resourceIds:[]}])}>Adicionar serviço</button>
   <h3 className="font-semibold text-white">Feriados e fechamentos</h3>
   {draft.holidays.map((d,i)=><div key={i} className="flex gap-2"><input type="date" className={field} value={d} onChange={e=>set('holidays',draft.holidays.map((x,j)=>j===i?e.target.value:x))}/>
    <button className={btn} onClick={()=>set('holidays',draft.holidays.filter((_,j)=>j!==i))}>Remover</button></div>)}
   <button className={btn} onClick={()=>set('holidays',[...draft.holidays,date])}>Adicionar feriado</button>
   <h3 className="font-semibold text-white">Bloqueios específicos</h3>
   {draft.blocks.map((b,i)=>{
    const edit=(p:Partial<BlockInput>)=>set('blocks',draft.blocks.map((x,j)=>j===i?{...x,...p}:x));
    return <div key={i} className="space-y-2 rounded-xl border border-slate-800 p-3">
     <select aria-label="Tipo de bloqueio" className={field} value={b.target} onChange={e=>{
      const target=e.target.value as BlockInput['target'];
      if(target==='UNIT'){const {targetId:_old,...rest}=b;set('blocks',draft.blocks.map((x,j)=>j===i?{...rest,target}:x));}
      else edit({target,targetId:''});
     }}><option value="UNIT">Unidade</option><option value="PROFESSIONAL">Profissional</option><option value="RESOURCE">Recurso</option></select>
     {b.target!=='UNIT'&&<select aria-label="Alvo do bloqueio" className={field} value={b.targetId??''} onChange={e=>edit({targetId:e.target.value})}>
      <option value="">Selecione</option>{(b.target==='PROFESSIONAL'?draft.professionals:draft.resources).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}
     {label('Início ISO com fuso (ex.: AAAA-MM-DDT09:00:00-03:00)',<input className={field} value={b.startAt} onChange={e=>edit({startAt:e.target.value})}/>)}
     {label('Fim ISO com fuso',<input className={field} value={b.endAt} onChange={e=>edit({endAt:e.target.value})}/>)}
     <button className={btn} onClick={()=>set('blocks',draft.blocks.filter((_,j)=>j!==i))}>Remover bloqueio</button>
    </div>;
   })}
   <button className={btn} onClick={()=>set('blocks',[...draft.blocks,{id:key(),target:'UNIT',startAt:'',endAt:''}])}>Adicionar bloqueio</button>
   <div><button disabled={busy} className={btn} onClick={()=>void save()}>Salvar versão da agenda</button>
    <p className="mt-2 text-xs text-slate-500">Reservas futuras ativas impedem alteração da configuração.</p></div>
  </div>}
  {config&&<div className="space-y-3">
   <h3 className="font-semibold text-white">Consultar disponibilidade</h3>
   <div className="grid gap-2 sm:grid-cols-3">
    {label('Serviço',<select className={field} value={serviceId} onChange={e=>{setServiceId(e.target.value);setAcceptedVersion(null);setProfessionalId('');setAvailable([]);setStartAt('');}}>
     <option value="">Selecione</option>{services.map(s=><option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min{s.priceMinor!==undefined?' · '+money(s.priceMinor):''}</option>)}</select>)}
    {label('Profissional',<select className={field} value={professionalId} onChange={e=>{setProfessionalId(e.target.value);setAvailable([]);setStartAt('');}}>
     <option value="">Selecione</option>{pros.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
    {label('Data local',<input type="date" className={field} value={date} onChange={e=>{setDate(e.target.value);setAvailable([]);setStartAt('');}}/>)}
   </div>
   <button disabled={busy||!date||!serviceId||!professionalId} className={btn} onClick={()=>void findSlots()}>Consultar horários</button>
   <div className="flex flex-wrap gap-2">{available.map(s=><button key={s.startAt} className={btn+(startAt===s.startAt?' border-emerald-400':'')} onClick={()=>{setStartAt(s.startAt);setAcceptedVersion(null);}}>
     {s.localTime.slice(11)} · {new Date(s.startAt).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})} UTC</button>)}</div>
   {config.pack&&selectedService&&<div className="rounded-xl border border-sky-800 p-3 text-sm text-slate-300">
    <p>{packNames[config.pack.kind]} · {selectedService.category} · Total {money(selectedService.priceMinor??0)} · Sinal {money(selectedService.depositMinor)}</p>
    <p className="mt-1 text-xs">Cancelamento com {config.pack.cancelNoticeMinutes} min de antecedência; tolerância de falta {config.pack.noShowGraceMinutes} min. Em cancelamento ou falta, valores pagos serão submetidos à revisão humana.</p>
    {operator&&<label className="mt-2 block"><input type="checkbox" checked={acceptedVersion===config.version} onChange={e=>setAcceptedVersion(e.target.checked?config.version:null)}/> Registrei o aceite explícito do cliente para preço, sinal e política desta versão.</label>}
   </div>}
   {operator&&<div className="flex flex-wrap items-end gap-3">
    {label('Cliente',<select className={field} value={customerId} onChange={e=>{setCustomerId(e.target.value);setAcceptedVersion(null);}}>
     <option value="">Selecione cliente cadastrado</option>{customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>)}
    <button disabled={busy||!startAt||!customerId||!!config.pack&&acceptedVersion!==config.version} className={btn} onClick={()=>void reserve()}>Reservar temporariamente</button>
   </div>}
  </div>}
  {operator&&<div className="space-y-3">
   <h3 className="font-semibold text-white">Reservas da unidade</h3>
   <div className="flex gap-2"><input aria-label="Data das reservas" type="date" className={field} value={rangeDate} onChange={e=>setRangeDate(e.target.value)}/>
    <button disabled={busy||!rangeDate} className={btn} onClick={()=>void refresh()}>Consultar</button></div>
   {bookings.map(b=><button key={b.id} className={btn+' block w-full text-left'} onClick={()=>setSelected(b)}>
    {new Date(b.startMs).toLocaleString('pt-BR',{timeZone:b.timezone})} · {status[b.status]} · {customers.find(c=>c.id===b.customerId)?.name??b.customerId} · Lembrete: {b.reminder?.state??'—'}</button>)}
   {selected&&<article className="space-y-3 rounded-xl border border-slate-700 p-4">
    <h4 className="font-semibold text-white">{status[selected.status]} · v{selected.version}</h4>
    <p className="text-sm text-slate-300">{new Date(selected.startMs).toLocaleString('pt-BR',{timeZone:selected.timezone})} · {selected.timezone}</p>
    <p className="text-sm text-slate-400">Sinal: {selected.deposit.status} · R$ {(selected.deposit.amountMinor/100).toFixed(2)} · Lembrete: {selected.reminder?.state??'—'}</p>
    <button disabled={busy} className={btn} onClick={()=>void run(async()=>{const b=await api<Booking>(prefix+'/bookings/'+selected.id);setSelected(b);setBookings(old=>old.map(x=>x.id===b.id?b:x));})}>Atualizar estado</button>
    {selected.pack&&<div className="space-y-1 text-sm text-slate-300"><p>{packNames[selected.pack.kind]} · Total {money(selected.pack.priceMinor)} · Política v{selected.pack.configVersion}</p>
     {selected.checkedInAt&&<p>Presença registrada: {new Date(selected.checkedInAt).toLocaleString('pt-BR',{timeZone:selected.timezone})}</p>}
     {selected.lateCancellation&&<p className="text-amber-300">Cancelamento fora da antecedência configurada; revisão humana.</p>}
     {selected.status==='NO_SHOW'&&<p className="text-amber-300">Falta registrada; revisar eventual sinal, sem desconto automático.</p>}
     {(selected.notices??[]).map(n=><div key={n.key} className="flex flex-wrap items-center gap-2 border-t border-slate-800 py-1"><span>{n.kind}: {n.state==='ACCEPTED_BY_PROVIDER'?'Aceito pelo provedor (não confirma entrega ao destinatário)':n.state}</span>{n.failureCode&&<span className="text-xs text-slate-400">{n.failureCode}</span>}{admin&&n.state==='BLOCKED'&&<button disabled={busy} className={btn} onClick={()=>void retryNotice(n.key)}>Reavaliar envio</button>}</div>)}
    </div>}
    {selected.status==='HELD'&&<>
     <button disabled={busy||!['CONFIRMED','NOT_REQUIRED'].includes(selected.deposit.status)} className={btn} onClick={()=>void command('/confirm')}>Confirmar reserva</button>
     {selected.deposit.status==='UNPAID'&&<div className="flex gap-2">
      <input aria-label="PSP opcional" className={field} placeholder="Provedor configurado (opcional)" value={providerId} onChange={e=>setProviderId(e.target.value)}/>
      <button disabled={busy} className={btn} onClick={()=>void command('/deposit/pix',providerId?{providerId}:{})}>Solicitar Pix de sinal</button>
     </div>}
    </>}
    {selected.deposit.provider&&<div className="space-y-2">
     {selected.deposit.pixCode&&<div className="break-all text-xs text-slate-400">Pix: {selected.deposit.pixCode}</div>}
     {admin&&!selected.deposit.providerPaymentId&&<input aria-label="ID PSP para recuperação" className={field} placeholder="ID do PSP para reconciliação" value={providerPaymentId} onChange={e=>setProviderPaymentId(e.target.value)}/>}
     <button disabled={busy} className={btn} onClick={()=>void depositRefresh()}>Verificar sinal no PSP</button>
    </div>}
    {(selected.status==='HELD'||selected.status==='CONFIRMED')&&<div className="space-y-2">
     <p className="text-xs text-slate-400">Para reagendar, consulte o mesmo serviço e selecione um novo horário disponível acima.</p>
     <button disabled={busy||!startAt||serviceId!==selected.serviceId||!professionalId} className={btn} onClick={()=>void command('/reschedule',{professionalId,startAt})}>Reagendar atomicamente</button>
     {label('Motivo do cancelamento',<input className={field} value={why} onChange={e=>setWhy(e.target.value)}/>)}
     <button disabled={busy||!why} className={btn} onClick={()=>void command('/cancel',{reason:why})}>Cancelar reserva</button>
    </div>}
    {selected.status==='CONFIRMED'&&<>
     {selected.pack&&!selected.checkedInAt&&<><button disabled={busy||Date.now()<selected.startMs-1800000||Date.now()>=selected.endMs} className={btn} onClick={()=>void command('/check-in')}>Registrar presença</button>
     {canMarkNoShow&&<button disabled={busy||Date.now()<selected.startMs+selected.pack.noShowGraceMinutes*60000} className={btn} onClick={()=>void command('/no-show')}>Registrar falta</button>}</>}
     <button disabled={busy||selected.endMs>Date.now()||!!selected.pack&&!selected.checkedInAt} className={btn} onClick={()=>void command('/complete')}>Concluir atendimento</button>
     {selected.reminder?.state==='READY'&&<button disabled={busy} className={btn} onClick={()=>void command('/reminder/ack',{reminderKey:selected.reminder!.key})}>Reconhecer lembrete interno</button>}
    </>}
   </article>}
  </div>}
 </section>;
}
