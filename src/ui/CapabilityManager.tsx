import {useEffect,useState,type FormEvent} from 'react';
import {Boxes,RefreshCw,ShieldCheck,RotateCcw,Save,AlertTriangle} from 'lucide-react';
import type {BusinessVertical} from '../business/model';
import type {CapabilityAssignment,CapabilityId,CapabilityManifest,
 CapabilityTemplate,CapabilityTemplateId} from '../capabilities/model';
import {ProductionBoard} from './ProductionBoard';
import {CompanyProfilePanel} from './CompanyProfilePanel';
import {SchedulingPanel} from './SchedulingPanel';
import {MultisectorOnboardingPanel,RetailPanel,MultiSectorReportPanel} from './MultisectorPanel';
import type {BookingPack} from '../scheduling/model';

interface CatalogResponse {
 schemaVersion:1;manifests:CapabilityManifest[];templates:CapabilityTemplate[];
 commercialGoLiveAuthorized:false;
}
const LABELS:Record<CapabilityId,string>={
 CORE_KNOWLEDGE:'Conhecimento da empresa',CORE_CUSTOMERS:'Clientes e CRM',
 CORE_AI_ASSIST:'Assistência cognitiva',
 FOOD_ORDERING:'Pedidos de alimentação',FOOD_PRODUCTION:'Cozinha e produção',
 FOOD_DELIVERY:'Entrega',FOOD_FINANCE:'Financeiro alimentar',
 RETAIL_CATALOG:'Catálogo de varejo',RETAIL_CHECKOUT:'Checkout de varejo',
 RETAIL_INVENTORY:'Estoque básico de varejo',
 SERVICE_CATALOG:'Catálogo de serviços',SCHEDULING:'Agenda horizontal',
 SERVICE_BOOKING:'Reservas de serviços',
 BEAUTY_SERVICES:'Serviços de estética (T11)',BEAUTY_BOOKING:'Agendamento de estética (T11)',
 HEALTH_ADMIN:'Administração clínica (não clínica)',
};
const SECTORS:Record<BusinessVertical,string>={
 FOOD_SERVICE:'Restaurantes e alimentação',RETAIL:'Comércio e varejo',
 SERVICES:'Serviços profissionais',BEAUTY:'Salão, barbearia e estética',
 HEALTH_SERVICE:'Serviços de saúde (administrativo)',OTHER:'Outros segmentos',
};
const FIELD='rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400';
export function CapabilityManager({tenantId,role}:{tenantId:string;role:string}){
 const admin=role==='OWNER'||role==='ADMIN';
 const [unitId,setUnitId]=useState('main');
 const [unitDraft,setUnitDraft]=useState('main');
 const [catalog,setCatalog]=useState<CatalogResponse|null>(null);
 const [assignment,setAssignment]=useState<CapabilityAssignment|null>(null);
 const [vertical,setVertical]=useState<BusinessVertical|null>(null);
 const [legacyProductionAllowed,setLegacyProductionAllowed]=useState(false);
 const [templateId,setTemplateId]=useState<CapabilityTemplateId|'UNSELECTED'>('UNSELECTED');
 const [enabled,setEnabled]=useState<CapabilityId[]>([]);
 const [reason,setReason]=useState('Atualizar capacidades internas da unidade');
 const [rollbackVersion,setRollbackVersion]=useState('1');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [reload,setReload]=useState(0);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [createdScope,setCreatedScope]=useState('');
 const prefix='/api/capabilities/units/'+encodeURIComponent(unitId);
 async function api<T>(url:string,options?:RequestInit):Promise<T>{
  const res=await fetch(url,{credentials:'same-origin',...options,
   headers:{'x-tenant-id':tenantId,...(options?.headers??{})}});
  const body=await res.json() as {ok:boolean;data:T;error?:{code:string}};
  if(!res.ok||!body.ok)throw new Error(body.error?.code??'CAPABILITY_REQUEST_FAILED');
  return body.data;
 }
 useEffect(()=>{
  const ctrl=new AbortController();
  setLoading(true);setError('');setMessage('');
  Promise.all([
   api<CatalogResponse>(prefix+'/catalog',{signal:ctrl.signal}),
   api<CapabilityAssignment|null>(prefix+'/assignment',{signal:ctrl.signal}),
   api<{capabilityRegistry:{vertical:BusinessVertical;operationMode:string;capabilities:string[]}}|null>(
    '/api/business/units/'+encodeURIComponent(unitId)+'/active',{signal:ctrl.signal}),
  ]).then(([c,a,p])=>{
   if(ctrl.signal.aborted)return;
   setCatalog(c);setAssignment(a);setVertical(p?.capabilityRegistry.vertical??null);
   setLegacyProductionAllowed(Boolean(p?.capabilityRegistry.capabilities.includes('PRODUCTION'))&&
    p?.capabilityRegistry.operationMode==='NATIVE_OPERATIONS');
   setTemplateId(a?.templateId??c.templates.find(t=>t.vertical===p?.capabilityRegistry.vertical)?.id??'UNSELECTED');
   setEnabled(a?.enabledCapabilities??[]);
  }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível consultar módulos.');})
   .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return ()=>ctrl.abort();
 // Requests are re-created for the currently selected tenant and unit; old responses are ignored.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tenantId,unitId,reload]);
 const template=catalog?.templates.find(t=>t.id===templateId&&t.vertical===vertical);
 function toggle(capability:CapabilityId){
  if(!catalog)return;
  if(enabled.includes(capability)){
   const next=new Set(enabled.filter(x=>x!==capability));
   let changed=true;
   while(changed){
    changed=false;
    for(const item of [...next]){
     const manifest=catalog.manifests.find(m=>m.id===item);
     if(manifest?.dependsOn.some(dep=>!next.has(dep))){next.delete(item);changed=true;}
    }
   }
   setEnabled([...next]);
  }else{
   const manifest=catalog.manifests.find(m=>m.id===capability);
   if(!manifest||manifest.maturity!=='READY_INTERNAL')return;
   const next=new Set(enabled);
   function enableWithDependencies(id:CapabilityId){
    const entry=catalog!.manifests.find(m=>m.id===id);
    if(!entry||entry.maturity!=='READY_INTERNAL'||!template?.capabilities.includes(id))return;
    for(const dep of entry.dependsOn)enableWithDependencies(dep);
    next.add(id);
   }
   enableWithDependencies(capability);setEnabled([...next]);
  }
 }
 async function mutate(path:string,payload:unknown){
  setBusy(true);setMessage('');setError('');
  try{
   const next=await api<CapabilityAssignment>(prefix+path,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   setAssignment(next);setTemplateId(next.templateId);setEnabled(next.enabledCapabilities);
   setMessage('Configuração interna versão '+next.version+
    ' registrada. Nenhum módulo foi liberado comercialmente.');
  }catch(e){setError(e instanceof Error?e.message:'Falha ao alterar capacidades.');}
  finally{setBusy(false);}
 }
 const allowed=vertical!==null&&template!==undefined;
 const allowFoodBoard=legacyProductionAllowed&&assignment?.state==='ENABLED_INTERNAL'&&
  assignment?.vertical==='FOOD_SERVICE'&&vertical==='FOOD_SERVICE'&&
  assignment.operationMode==='NATIVE_OPERATIONS'&&
  assignment.enabledCapabilities.includes('FOOD_PRODUCTION')&&
  assignment.enabledCapabilities.includes('FOOD_ORDERING');
 function unitSubmit(e:FormEvent){e.preventDefault();
  if(/^[A-Za-z0-9_-]{1,96}$/.test(unitDraft))setUnitId(unitDraft);
  else setError('Identificador de unidade inválido.');
 }
 return <>
 {createdScope===tenantId+'-'+unitId&&vertical&&<p role="status" className="mt-5 rounded-xl border border-emerald-700 bg-slate-900 p-4 text-base text-emerald-300">Cadastro e módulos internos salvos com sucesso.</p>}
 {!loading&&admin&&vertical&&<CompanyProfilePanel key={'profile-'+tenantId+'-'+unitId} tenantId={tenantId} unitId={unitId}/>}
 <section className="mt-5 rounded-3xl border border-violet-500/20 bg-slate-900/70 p-5 sm:p-6"
  aria-label="Registro de capacidades por empresa e unidade">
  <div className="flex flex-wrap items-start justify-between gap-4">
   <div>
    <h2 className="flex items-center gap-2 text-xl font-bold text-white">
     <Boxes className="h-5 w-5 text-violet-400"/> Módulos e capacidades da empresa
    </h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
     Selecione o setor e as capacidades internas da unidade. Configurações são
     versionadas e isoladas por empresa. Recursos futuros não podem ser ativados
     e nenhuma ação aqui autoriza pagamentos, atendimento real ou go-live.
    </p>
   </div>
   <form onSubmit={unitSubmit} className="flex items-end gap-2">
    <label className="text-xs text-slate-400">Unidade
     <input className={'mt-1 block w-36 '+FIELD} aria-label="Unidade das capacidades"
      value={unitDraft} onChange={e=>setUnitDraft(e.target.value)}/>
    </label>
    <button className={'flex items-center gap-1 '+FIELD} type="submit">
     <RefreshCw className="h-3.5 w-3.5"/> Consultar
    </button>
   </form>
  </div>
  {loading&&<p className="mt-4 text-sm text-slate-400">Consultando registro seguro...</p>}
  {error&&<p role="alert" className="mt-4 rounded-xl border border-rose-700/50 bg-rose-950/20 p-3 text-sm text-rose-300">{error}</p>}
  {message&&<p role="status" className="mt-4 rounded-xl border border-emerald-700/30 p-3 text-sm text-emerald-300">{message}</p>}
  {!loading&&catalog&&<>
   <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
    <span className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300">
     {vertical?SECTORS[vertical]:'Perfil de negócio não configurado'}
    </span>
    <span className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300">
     {assignment?'Versão '+assignment.version:'Sem seleção registrada'}
    </span>
    <span className="rounded-lg border border-amber-800/40 px-2.5 py-1.5 text-amber-300">
     Produção real não habilitada
    </span>
   </div>
   {admin&&<>
    <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
     <label className="text-xs text-slate-400">
      Template por segmento (alinhado ao perfil T02)
      <select className={'mt-1 block w-full '+FIELD} value={templateId}
       onChange={e=>{const id=e.target.value as CapabilityTemplateId;setTemplateId(id);
        setEnabled(catalog.templates.find(t=>t.id===id)?.defaultEnabled.slice()??[]);}}>
       <option value="UNSELECTED">Selecione um segmento</option>
       {catalog.templates.filter(t=>t.vertical===vertical).map(t=>
        <option key={t.id} value={t.id}>{SECTORS[t.vertical]} — {t.id}</option>)}
      </select>
     </label>
     <button type="button" disabled={busy||!vertical} className={'self-end '+FIELD}
      onClick={()=>void mutate('/provision-defaults',{
       expectedVersion:assignment?.version??0,reason,
      })}>Provisionar padrão seguro</button>
    </div>
    <label className="mt-3 block text-xs text-slate-400">Motivo auditável
     <input aria-label="Motivo da alteração de capacidades" className={'mt-1 block w-full '+FIELD}
      value={reason} onChange={e=>setReason(e.target.value)}/>
    </label>
   </>}
   {template?<div className="mt-4 grid gap-2 sm:grid-cols-2">
    {template.capabilities.map(id=>{
     const manifest=catalog.manifests.find(m=>m.id===id)!;
     const planned=manifest.maturity!=='READY_INTERNAL';
     const active=enabled.includes(id);
     return <label key={id} className={'flex items-center gap-3 rounded-xl border px-3 py-3 text-sm '+
      (planned?'border-slate-800 bg-slate-950/30 text-slate-500':
       'border-slate-700 bg-slate-950/40 text-slate-200')}>
      <input type="checkbox" disabled={!admin||busy||planned} checked={active}
       onChange={()=>toggle(id)} className="accent-violet-400"/>
      <span className="min-w-0 flex-1">{LABELS[id]}
       {manifest.dependsOn.length>0&&<small className="block text-[11px] text-slate-500">
        Requer {manifest.dependsOn.map(x=>LABELS[x]).join(', ')}
       </small>}
      </span>
      <span className={'text-[11px] '+(planned?'text-amber-400':'text-emerald-400')}>
       {planned?'Planejado':'Interno'}
      </span>
     </label>;
    })}
   </div>:<p className="mt-4 text-sm text-amber-300">
     É necessário cadastrar o perfil da unidade antes de selecionar capacidades.
    </p>}
   {admin&&allowed&&<div className="mt-4 flex flex-wrap items-center gap-3">
    <button disabled={busy} type="button"
     className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
     onClick={()=>void mutate('/revisions',{
      expectedVersion:assignment?.version??0,templateId,templateVersion:1,
      enabledCapabilities:enabled,reason,
     })}><Save className="h-4 w-4"/> Salvar versão interna</button>
    {assignment&&assignment.version>1&&<>
     <label className="text-xs text-slate-400">Restaurar versão
      <input aria-label="Versão para rollback" type="number" min={1}
       max={assignment.version-1} value={rollbackVersion}
       onChange={e=>setRollbackVersion(e.target.value)}
       className={'ml-2 w-20 '+FIELD}/>
     </label>
     <button disabled={busy} type="button" className={'inline-flex items-center gap-2 '+FIELD}
      onClick={()=>void mutate('/rollback',{
       expectedVersion:assignment.version,restoreVersion:Number(rollbackVersion),reason,
      })}><RotateCcw className="h-4 w-4"/> Rollback auditável</button>
    </>}
   </div>}
   <div className="mt-4 flex items-start gap-2 text-xs text-slate-400">
    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400"/>
    A ativação é exclusivamente interna. Unidades reais continuam sujeitas
    à homologação dos provedores, aprovação humana e flags operacionais T08.3.
   </div>
   {assignment?.pendingCapabilities.length? <div className="mt-2 flex items-start gap-2 text-xs text-slate-500">
    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400"/>
    Capacidades planejadas aparecem para preparação; a execução permanece bloqueada
    até que as tarefas T10–T12 sejam implementadas e certificadas.
   </div>:null}
  </>}
 </section>
 {!loading&&admin&&!vertical&&<MultisectorOnboardingPanel key={tenantId+'-'+unitId} tenantId={tenantId} unitId={unitId} onSaved={()=>{setCreatedScope(tenantId+'-'+unitId);setReload(x=>x+1);}}/>}
 {!loading&&assignment?.state==='ENABLED_INTERNAL'&&assignment.vertical==='RETAIL'&&vertical==='RETAIL'&&assignment.enabledCapabilities.includes('RETAIL_CATALOG')&&<RetailPanel key={tenantId+'-'+unitId} tenantId={tenantId} unitId={unitId} role={role} native={assignment.operationMode==='NATIVE_OPERATIONS'} inventory={assignment.enabledCapabilities.includes('RETAIL_INVENTORY')} checkout={assignment.enabledCapabilities.includes('RETAIL_CHECKOUT')}/>}
 {!loading&&admin&&vertical&&<MultiSectorReportPanel key={'report-'+tenantId+'-'+unitId} tenantId={tenantId} unitId={unitId}/>}
 {allowFoodBoard&&<ProductionBoard tenantId={tenantId} role={role}/>}
 {!loading&&assignment?.state==='ENABLED_INTERNAL'&&assignment.operationMode==='NATIVE_OPERATIONS'&&assignment.vertical===vertical&&
  assignment.enabledCapabilities.includes('SCHEDULING')&&assignment.enabledCapabilities.includes('SERVICE_CATALOG')&&
  <SchedulingPanel key={tenantId+'-'+unitId} tenantId={tenantId} unitId={unitId} role={role} availablePacks={(
   assignment.vertical==='BEAUTY'&&assignment.enabledCapabilities.includes('BEAUTY_BOOKING')&&assignment.enabledCapabilities.includes('BEAUTY_SERVICES')?['SALON','BARBERSHOP','AESTHETICS_ADMIN']:
   assignment.vertical==='HEALTH_SERVICE'&&assignment.enabledCapabilities.includes('HEALTH_ADMIN')?['AESTHETICS_ADMIN']:
   assignment.vertical==='SERVICES'&&assignment.enabledCapabilities.includes('SERVICE_BOOKING')?['PROFESSIONAL_SERVICES']:[]) as BookingPack[]}/>}
 {!loading&&assignment?.operationMode==='INTEGRATED_OPERATIONS'&&assignment.enabledCapabilities.includes('SCHEDULING')&&
  <p className="text-sm text-amber-300">Agenda nativa não habilitada no modo integrado. Aguarde um adaptador de agenda externa certificado; nenhum horário é confirmado em duplicidade.</p>}
 </>;
}
