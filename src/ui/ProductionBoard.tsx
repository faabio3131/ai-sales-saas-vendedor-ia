import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ChefHat,Truck,ShieldCheck,RefreshCw,AlertTriangle,PackageCheck} from 'lucide-react';

type Mode='NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS';
type State='AWAITING_ACK'|'QUEUED'|'IN_PREPARATION'|'READY'|'OUT_FOR_DELIVERY'|'COMPLETED'|'MANUAL_REVIEW_REQUIRED';
interface Operation {
  tenantId:string;unitId:string;orderId:string;orderNumber:number;customerId:string;
  state:State;operationMode:Mode;version:number;createdAt:string;updatedAt:string;
  fulfillment:{kind:'PICKUP'|'DELIVERY';zoneId?:string;address?:string};
  assessment:{etaMinutes:number;etaSource:'MERCHANT_CONFIGURED_WINDOW';gpsValidated:false};
  lines:Array<{name:string;quantity:number;size?:{name:string};flavors?:Array<{name:string}>}>;
  escalation?:{manualDispatchAuthorized:false;reason:string};
}
interface Settings{
  version:number;operationMode:Mode;prepMinutes:number;deliveryMinutes:number;
  pickupMinutes:number;connectorId?:string;
  postalRanges:Array<{zoneId:string;fromCep:string;toCep:string}>;
}
const PRIVILEGED=['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT','STAFF'];
const VALID_UNIT=/^[A-Za-z0-9_-]{1,96}$/;
const LABELS:Record<State,string>={
  AWAITING_ACK:'Aguardando ACK do PDV/KDS',
  QUEUED:'Na fila de produção',
  IN_PREPARATION:'Em preparo',
  READY:'Pronto',
  OUT_FOR_DELIVERY:'Saiu para entrega',
  COMPLETED:'Concluído',
  MANUAL_REVIEW_REQUIRED:'Revisão humana obrigatória',
};
function request(tenantId:string,unitId:string,suffix:string,init?:RequestInit){
  return fetch('/api/fulfillment/units/'+encodeURIComponent(unitId)+suffix,{
    ...init,credentials:'same-origin',
    headers:{'x-tenant-id':tenantId,...(init?.headers??{})},
  });
}
export function ProductionBoard({tenantId,role}:{tenantId:string;role:string}){
 const authorized=PRIVILEGED.includes(role);
 const admin=role==='OWNER'||role==='ADMIN';
 const canRelease=['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT'].includes(role);
 const canKitchen=['OWNER','ADMIN','MANAGER','OPERATOR','STAFF'].includes(role);
 const [unitInput,setUnitInput]=useState('main');
 const [unitId,setUnitId]=useState('main');
 const [orders,setOrders]=useState<Operation[]>([]);
 const [settings,setSettings]=useState<Settings|null>(null);
 const [profileMode,setProfileMode]=useState<Mode>('NATIVE_OPERATIONS');
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [orderId,setOrderId]=useState('');
 const [busy,setBusy]=useState<string|null>(null);
 const [postalRanges,setPostalRanges]=useState<Settings['postalRanges']>([
   {zoneId:'centro',fromCep:'11700000',toCep:'11799999'},
 ]);
 const [prep,setPrep]=useState(30);
 const [delivery,setDelivery]=useState(30);
 const [pickup,setPickup]=useState(10);
 const [connectorId,setConnectorId]=useState('');
 const [manualReason,setManualReason]=useState('Verificar recebimento externo antes de qualquer liberação manual');
 // The queue polls every 15 seconds; a refresh must not erase edits being
 // made to the versioned configuration form in another tab or slow connection.
 const loadedSettingsKey=useRef('');
 useEffect(()=>{
   if(!authorized||!VALID_UNIT.test(unitId))return;
   const controller=new AbortController();
   setOrders([]);setSettings(null);setError(null);setLoading(true);
   const run=async()=>{
     try{
       const common={signal:controller.signal};
       const [queue,config,profile]=await Promise.all([
         request(tenantId,unitId,'/queue',common),
         request(tenantId,unitId,'/settings',common),
         fetch('/api/business/units/'+encodeURIComponent(unitId)+'/active',{
           credentials:'same-origin',signal:controller.signal,
           headers:{'x-tenant-id':tenantId},
         }),
       ]);
       if(!queue.ok||!config.ok||!profile.ok)
         throw new Error('Não foi possível consultar a fila protegida.');
       const q=await queue.json() as {ok:boolean;data:Operation[]};
       const p=await config.json() as {ok:boolean;data:Settings|null};
       const b=await profile.json() as {ok:boolean;data:{capabilityRegistry?:{operationMode?:Mode}}|null};
       if(!q.ok||!p.ok||!b.ok)throw new Error('Resposta operacional inválida.');
       if(controller.signal.aborted)return;
       setOrders(q.data);
       setSettings(p.data);
       const mode=b.data?.capabilityRegistry?.operationMode??'NATIVE_OPERATIONS';
       setProfileMode(mode);
       if(p.data){
         const key=tenantId+':'+unitId+':'+p.data.version;
         if(loadedSettingsKey.current!==key){
           loadedSettingsKey.current=key;
           setPrep(p.data.prepMinutes);setDelivery(p.data.deliveryMinutes);
           setPickup(p.data.pickupMinutes);
           setConnectorId(p.data.connectorId??'');
           setPostalRanges(p.data.postalRanges);
         }
       }
     }catch{
       if(!controller.signal.aborted)setError('Fila indisponível ou acesso não autorizado. Confira a unidade.');
     }finally{if(!controller.signal.aborted)setLoading(false);}
   };
   void run();
   const poll=setInterval(()=>{if(!controller.signal.aborted)void run();},15000);
   return ()=>{controller.abort();clearInterval(poll);};
 },[authorized,tenantId,unitId]);
 if(!authorized)return null;
 async function call(path:string,body?:unknown,method='POST'){
  setBusy(path);setError(null);
  try{
   const res=await request(tenantId,unitId,path,{
     method,headers:{'content-type':'application/json'},
     body:body===undefined?undefined:JSON.stringify(body),
   });
   if(!res.ok)throw new Error('Operação não autorizada ou estado alterado.');
   const response=await request(tenantId,unitId,'/queue');
   if(!response.ok)throw new Error('A fila não pôde ser atualizada.');
   const result=await response.json() as {ok:boolean;data:Operation[]};
   if(!result.ok)throw new Error('A fila não pôde ser atualizada.');
   setOrders(result.data);
  }catch{setError('A operação não foi registrada. Atualize a fila e confira a autorização.');}
  finally{setBusy(null);}
 }
 async function saveSettings(e:FormEvent){
  e.preventDefault();if(!admin)return;
  const payload={
   expectedVersion:settings?.version??0,
   operationMode:profileMode,
   postalRanges,
   prepMinutes:prep,deliveryMinutes:delivery,pickupMinutes:pickup,
   ...(profileMode==='INTEGRATED_OPERATIONS'?{connectorId}:{}),
  };
  setBusy('settings');setError(null);
  try{
   const response=await request(tenantId,unitId,'/settings',{
     method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
   });
   if(!response.ok)throw new Error('Sem homologação do conector ou configuração inválida.');
   const result=await response.json() as {ok:boolean;data:Settings};
   if(!result.ok)throw new Error('Falha ao publicar.');
   setSettings(result.data);
  }catch{setError('Configuração recusada: confirme perfil, áreas de CEP, versão e conector certificado.');}
  finally{setBusy(null);}
 }
 const action=(op:Operation):'START'|'READY'|'DISPATCH_DELIVERY'|'COMPLETE'|null=>{
   if(op.operationMode!=='NATIVE_OPERATIONS'||!canKitchen)return null;
   if(op.state==='QUEUED')return 'START';
   if(op.state==='IN_PREPARATION')return 'READY';
   if(op.state==='READY')return op.fulfillment.kind==='PICKUP'?'COMPLETE':'DISPATCH_DELIVERY';
   if(op.state==='OUT_FOR_DELIVERY')return 'COMPLETE';
   return null;
 };
 const actionLabel:{[k:string]:string}={
   START:'Iniciar preparo',READY:'Marcar pronto',
   DISPATCH_DELIVERY:'Confirmar saída para entrega',COMPLETE:'Concluir',
 };
 return <section className="mt-6 rounded-3xl border border-sky-500/20 bg-slate-900/70 p-5 sm:p-6" aria-label="Operações de cozinha e delivery">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
     <h2 className="flex items-center gap-2 text-xl font-bold text-white">
      <ChefHat className="h-5 w-5 text-sky-400"/> Cozinha, retirada e delivery
     </h2>
     <p className="mt-1 text-sm text-slate-400">
      Fila por empresa/unidade, com confirmação de pagamento, ACK, histórico e eventos persistidos.
     </p>
    </div>
    <form onSubmit={e=>{e.preventDefault();if(VALID_UNIT.test(unitInput))setUnitId(unitInput);else setError('Unidade inválida.');}} className="flex gap-2">
     <input aria-label="Unidade" className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
       value={unitInput} maxLength={96} onChange={e=>setUnitInput(e.target.value)}/>
     <button type="submit" className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white">Selecionar</button>
    </form>
   </div>
   <div className="mt-4 flex flex-wrap gap-2 text-xs">
     <span className="rounded-lg bg-slate-800 px-3 py-2 text-slate-300">Modo: {settings?.operationMode??'Não configurado'}</span>
     {settings?.operationMode==='INTEGRATED_OPERATIONS'&&<span className="rounded-lg bg-amber-900/40 px-3 py-2 text-amber-200">Requer ACK de conector homologável</span>}
     <span className="rounded-lg bg-slate-800 px-3 py-2 text-slate-300">ETA de política: não é GPS</span>
   </div>
   {error&&<p role="alert" className="mt-4 rounded-xl border border-rose-700/30 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</p>}
   {admin&&<form onSubmit={e=>void saveSettings(e)} className="mt-5 rounded-2xl border border-slate-700/70 p-4">
     <h3 className="flex items-center gap-2 text-sm font-semibold text-sky-200">
       <ShieldCheck className="h-4 w-4"/> Política operacional versionada
     </h3>
     <p className="mt-1 text-xs text-slate-400">Modo herdado do perfil T02. CEP define uma faixa postal cadastrada, não geofencing ou rastreamento.</p>
     <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
       <div className="col-span-2 space-y-2 md:col-span-4">
        <p className="text-xs text-slate-400">Faixas de CEP por zona (preservadas integralmente ao publicar)</p>
        {postalRanges.map((range,i)=><div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-4">
         <label className="text-xs text-slate-400">Zona do catálogo
          <input value={range.zoneId} maxLength={96}
           onChange={e=>setPostalRanges(rows=>rows.map((r,j)=>j===i?{...r,zoneId:e.target.value}:r))}
           className="mt-1 block w-full rounded-lg bg-slate-950 px-2 py-2 text-white"/></label>
         <label className="text-xs text-slate-400">CEP inicial
          <input value={range.fromCep} maxLength={8} inputMode="numeric"
           onChange={e=>setPostalRanges(rows=>rows.map((r,j)=>j===i?{...r,fromCep:e.target.value}:r))}
           className="mt-1 block w-full rounded-lg bg-slate-950 px-2 py-2 text-white"/></label>
         <label className="text-xs text-slate-400">CEP final
          <input value={range.toCep} maxLength={8} inputMode="numeric"
           onChange={e=>setPostalRanges(rows=>rows.map((r,j)=>j===i?{...r,toCep:e.target.value}:r))}
           className="mt-1 block w-full rounded-lg bg-slate-950 px-2 py-2 text-white"/></label>
         <button type="button" disabled={Boolean(busy)}
          onClick={()=>setPostalRanges(rows=>rows.filter((_,j)=>j!==i))}
          className="self-end rounded-lg border border-rose-800/50 px-2 py-2 text-xs text-rose-300">
          Remover faixa
         </button>
        </div>)}
        <button type="button" disabled={Boolean(busy)||postalRanges.length>=60}
         onClick={()=>setPostalRanges(rows=>[...rows,{zoneId:'',fromCep:'',toCep:''}])}
         className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">
         Adicionar faixa de CEP
        </button>
       </div>
       <label className="text-xs text-slate-400">Preparo (min)<input type="number" min={1} max={240}
        value={prep} onChange={e=>setPrep(Number(e.target.value))}
        className="mt-1 block w-full rounded-lg bg-slate-950 px-2 py-2 text-white"/></label>
       <label className="text-xs text-slate-400">Entrega (min)<input type="number" min={1} max={240}
        value={delivery} onChange={e=>setDelivery(Number(e.target.value))}
        className="mt-1 block w-full rounded-lg bg-slate-950 px-2 py-2 text-white"/></label>
       <label className="text-xs text-slate-400">Retirada (min)<input type="number" min={1} max={240}
        value={pickup} onChange={e=>setPickup(Number(e.target.value))}
        className="mt-1 block w-full rounded-lg bg-slate-950 px-2 py-2 text-white"/></label>
       {profileMode==='INTEGRATED_OPERATIONS'&&<label className="col-span-2 text-xs text-slate-400">
        Conector instalado<input value={connectorId} onChange={e=>setConnectorId(e.target.value)}
         className="mt-1 block w-full rounded-lg bg-slate-950 px-2 py-2 text-white"/></label>}
     </div>
     <button disabled={Boolean(busy)} type="submit"
       className="mt-3 rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-200">
       Publicar política validada
     </button>
   </form>}
   {canRelease&&<form onSubmit={e=>{e.preventDefault();if(orderId.trim())void call('/orders/'+encodeURIComponent(orderId.trim())+'/release');}}
     className="mt-5 flex flex-wrap items-end gap-2">
     <label className="grow text-xs text-slate-400">ID de pedido confirmado
      <input value={orderId} onChange={e=>setOrderId(e.target.value)} placeholder="order_..."
        className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"/>
     </label>
     <button disabled={Boolean(busy)||!orderId.trim()} type="submit"
       className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">
       Liberar uma única vez
     </button>
   </form>}
   <div className="mt-5 flex items-center justify-between">
     <h3 className="text-sm font-semibold text-white">Fila operacional ({orders.length})</h3>
     <span className="flex items-center gap-1 text-xs text-slate-400">
      <RefreshCw className={loading?'h-3 w-3 animate-spin':'h-3 w-3'}/> Atualização a cada 15 s
     </span>
   </div>
   <div className="mt-3 grid gap-3 lg:grid-cols-2">
    {orders.length===0&&!loading&&<p className="text-sm text-slate-400">Nenhum pedido liberado nesta unidade.</p>}
    {orders.map(op=><article key={op.orderId} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
       <div>
        <p className="text-xs text-slate-500">{op.operationMode==='NATIVE_OPERATIONS'?'KDS nativo':'PDV/KDS integrado'}</p>
        <h4 className="mt-1 text-lg font-bold text-white">Pedido nº {op.orderNumber}</h4>
       </div>
       <span className="rounded-full bg-slate-800 px-3 py-1.5 text-xs text-sky-200">{LABELS[op.state]}</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-slate-300">
       {op.lines.map((line,i)=><li key={line.name+'-'+i}>{line.quantity}× {line.name}
        {line.size?' · '+line.size.name:''}{line.flavors?.length?' · '+line.flavors.map(f=>f.name).join(' / '):''}
       </li>)}
      </ul>
      <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
       {op.fulfillment.kind==='PICKUP'?<PackageCheck className="h-4 w-4"/>:<Truck className="h-4 w-4"/>}
       {op.fulfillment.kind==='PICKUP'?'Retirada':'Entrega'} · Janela configurada: {op.assessment.etaMinutes} min
      </p>
      {op.escalation&&<p className="mt-2 flex items-center gap-2 text-xs text-amber-300">
        <AlertTriangle className="h-4 w-4"/> Revisão humana: sem segundo despacho automático
      </p>}
      {action(op)&&<button disabled={Boolean(busy)} type="button"
       onClick={()=>void call('/orders/'+encodeURIComponent(op.orderId)+'/transition',{
         expectedVersion:op.version,action:action(op),
       })}
       className="mt-3 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">
       {actionLabel[action(op)!]}
      </button>}
      {admin&&op.operationMode==='INTEGRATED_OPERATIONS'&&op.state==='AWAITING_ACK'&&
       <div className="mt-3 flex flex-wrap gap-2">
        <input aria-label="Motivo da revisão" value={manualReason} onChange={e=>setManualReason(e.target.value)}
         className="min-w-0 flex-1 rounded-lg bg-slate-900 px-2 py-2 text-xs text-white"/>
        <button type="button" disabled={Boolean(busy)}
         onClick={()=>void call('/orders/'+encodeURIComponent(op.orderId)+'/escalate',{
           expectedVersion:op.version,reason:manualReason,
         })}
         className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs text-amber-200">
         Solicitar revisão humana
        </button>
       </div>}
     </article>)}
   </div>
 </section>;
}
