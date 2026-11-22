import {useEffect,useState} from 'react';
import type {OnboardingTemplate,OnboardingRecord} from '../onboarding/model';
import type {MultiSectorMetrics} from '../onboarding/report';
import type {RetailCatalog,RetailItem,RetailOrder,Stock} from '../retail/model';
const field='w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
const btn='rounded-lg border border-slate-600 px-3 py-2 text-sm text-white disabled:opacity-50';
const box='rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-3';
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const key=()=>crypto.randomUUID().replace(/-/g,'');
async function api<T>(tenant:string,path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const r=await fetch(path,{method,credentials:'same-origin',signal,headers:{'x-tenant-id':tenant,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const v=await r.json();if(!r.ok||!v.ok)throw Error(v.error?.code??'REQUEST_FAILED');return v.data as T;
}
export function MultisectorOnboardingPanel({tenantId,unitId,onSaved}:{tenantId:string;unitId:string;onSaved:()=>void}){
 const base='/api/onboarding/units/'+encodeURIComponent(unitId);
 const [templates,setTemplates]=useState<OnboardingTemplate[]>([]),[saved,setSaved]=useState<OnboardingRecord|null>(null);
 const [draft,setDraft]=useState({templateId:'',mode:'NATIVE_OPERATIONS',businessName:'',assistantName:'',timezone:'America/Sao_Paulo',memoryRetentionDays:90,contact:'',address:'',hours:'',reason:'Configuração inicial autorizada'});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const ctrl=new AbortController();Promise.all([api<OnboardingTemplate[]>(tenantId,base+'/templates','GET',undefined,ctrl.signal),api<OnboardingRecord|null>(tenantId,base,'GET',undefined,ctrl.signal)]).then(([t,r])=>{if(!ctrl.signal.aborted){setTemplates(t);setSaved(r);}}).catch(e=>{if(!ctrl.signal.aborted)setError(String(e.message));});return()=>ctrl.abort();},[tenantId,base]);
 const choice=templates.find(t=>t.id===draft.templateId);
 const apply=async()=>{setBusy(true);setError('');try{const r=await api<OnboardingRecord>(tenantId,base,'POST',draft);setSaved(r);onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className={box}><h3 className="font-semibold text-white">Onboarding comercial por segmento</h3>
  <p className="text-sm text-slate-400">Configura uma nova unidade de empresa já autenticada, com assinatura ativa. Não altera unidade existente nem libera go-live.</p>
  {error&&<p role="alert" className="text-rose-300">{error}</p>}
  {saved?<p role="status" className="text-emerald-300">Perfil {saved.templateId} e capabilities criados conjuntamente. Continue com a configuração do catálogo ou agenda.</p>:<form className="space-y-3" onSubmit={e=>{e.preventDefault();void apply();}}>
   <select aria-label="Segmento" required className={field} value={draft.templateId} onChange={e=>setDraft(d=>({...d,templateId:e.target.value}))}><option value="">Escolha o segmento</option>{templates.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select>
   <select aria-label="Modo operacional" className={field} value={draft.mode} onChange={e=>setDraft(d=>({...d,mode:e.target.value}))}><option value="NATIVE_OPERATIONS">Operação nativa</option><option value="INTEGRATED_OPERATIONS">Sistema existente / integrado</option></select>
   {choice&&<p className="text-xs text-slate-400">Módulos: {(draft.mode==='NATIVE_OPERATIONS'?choice.native:choice.integrated).join(', ')}. Integrações externas dependem de adaptador homologado.</p>}
   {([['businessName','Nome do estabelecimento'],['assistantName','Nome do assistente'],['contact','Contato comercial'],['address','Endereço'],['hours','Horários'],['timezone','Fuso IANA'],['reason','Motivo da configuração']] as const).map(([k,label])=><label key={k} className="block text-xs text-slate-400">{label}<input required className={field} value={draft[k]} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))}/></label>)}
   <label className="block text-xs text-slate-400">Retenção de memória (dias)<input type="number" min={1} max={365} required className={field} value={draft.memoryRetentionDays} onChange={e=>setDraft(d=>({...d,memoryRetentionDays:Number(e.target.value)}))}/></label>
   <button type="submit" disabled={busy||!choice} className={btn}>Criar unidade e módulos internos</button>
  </form>}
 </section>;
}
export function RetailPanel({tenantId,unitId,role,native,inventory,checkout}:{tenantId:string;unitId:string;role:string;native:boolean;inventory:boolean;checkout:boolean}){
 const base='/api/retail/units/'+encodeURIComponent(unitId),admin=['OWNER','ADMIN'].includes(role),operator=['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT','STAFF','CASHIER'].includes(role),cashier=['OWNER','ADMIN','MANAGER','CASHIER'].includes(role);
 const [catalog,setCatalog]=useState<RetailCatalog|null>(null),[items,setItems]=useState<RetailItem[]>([]);
 const [stock,setStock]=useState<{item:RetailItem;stock:Stock}[]>([]),[counts,setCounts]=useState<Record<string,number>>({});
 const [customers,setCustomers]=useState<{id:string;name:string;status:string}[]>([]),[customer,setCustomer]=useState('');
 const [quantities,setQuantities]=useState<Record<string,number>>({}),[selected,setSelected]=useState<RetailOrder|null>(null),[orders,setOrders]=useState<RetailOrder[]>([]);
 const [evidence,setEvidence]=useState(''),[method,setMethod]=useState('CASH'),[accept,setAccept]=useState(false),[why,setWhy]=useState('Solicitação do cliente');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const today=new Date().toISOString().slice(0,10),tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const [from,setFrom]=useState(today),[to,setTo]=useState(tomorrow);
 const load=async(signal?:AbortSignal)=>{
  const c=await api<RetailCatalog|null>(tenantId,base+'/catalog','GET',undefined,signal);if(signal?.aborted)return;setCatalog(c);setItems(c?.items??[]);
  if(admin&&inventory){const rows=await api<{item:RetailItem;stock:Stock}[]>(tenantId,base+'/inventory','GET',undefined,signal);if(!signal?.aborted){setStock(rows);setCounts(Object.fromEntries(rows.map(r=>[r.item.id,r.stock.onHand])));}}
 };
 useEffect(()=>{const ctrl=new AbortController();load(ctrl.signal).catch(e=>{if(!ctrl.signal.aborted)setError(String(e.message));});
  if(operator&&native&&checkout)api<{id:string;name:string;status:string}[]>(tenantId,'/api/customers','GET',undefined,ctrl.signal).then(r=>{if(!ctrl.signal.aborted)setCustomers(r.filter(c=>c.status==='ACTIVE'));}).catch(e=>{if(!ctrl.signal.aborted)setError(String(e.message));});return()=>ctrl.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tenantId,base,admin,inventory,operator,native,checkout]);
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const edit=(i:number,patch:Partial<RetailItem>)=>setItems(old=>old.map((x,j)=>j===i?{...x,...patch}:x));
 const lines=Object.entries(quantities).filter(([,q])=>q>0).map(([itemId,quantity])=>({itemId,quantity}));
 const cart=()=>run(async()=>{if(!catalog)return;const b=await api<RetailOrder>(tenantId,base+'/orders','POST',{customerId:customer,expectedCatalogVersion:catalog.version,lines,idempotencyKey:key()});setSelected(b);setAccept(false);setEvidence('');setMessage('Carrinho persistido. Ainda não é uma venda confirmada.');});
 const update=(b:RetailOrder)=>{setSelected(b);setOrders(old=>old.map(x=>x.id===b.id?b:x));setMessage('Estado persistido: '+b.status+' / '+b.payment.state);};
 const command=(cmd:string,extra:Record<string,unknown>={})=>run(async()=>{if(!selected)return;update(await api<RetailOrder>(tenantId,base+'/orders/'+selected.id+cmd,'POST',{expectedVersion:selected.version,idempotencyKey:key(),...extra}));});
 return <section className={box}><h3 className="font-semibold text-white">Comércio e checkout</h3>
  <p className="text-sm text-slate-400">Unidade {unitId} · {native?'Operação nativa':'Catálogo informativo — PDV externo não homologado'} · Nenhuma cobrança automática.</p>
  {error&&<p role="alert" className="text-rose-300">{error}</p>}{message&&<p role="status" className="text-emerald-300">{message}</p>}
  {admin&&<div className="space-y-2"><h4 className="text-white">Catálogo de produtos</h4>
   {items.map((i,n)=><div className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-3" key={i.id}>
    <label className="text-xs text-slate-400">SKU<input className={field} value={i.sku} disabled={catalog?.items.some(x=>x.id===i.id)} onChange={e=>edit(n,{sku:e.target.value})}/></label>
    <label className="text-xs text-slate-400">Produto<input className={field} value={i.name} onChange={e=>edit(n,{name:e.target.value})}/></label>
    <label className="text-xs text-slate-400">Categoria<input className={field} value={i.category} onChange={e=>edit(n,{category:e.target.value})}/></label>
    <label className="text-xs text-slate-400">Preço em centavos<input className={field} type="number" min={0} value={i.priceMinor} onChange={e=>edit(n,{priceMinor:Number(e.target.value)})}/></label>
    <label className="text-sm text-slate-300"><input type="checkbox" checked={i.active} onChange={e=>edit(n,{active:e.target.checked})}/> Ativo</label>
    <label className="text-sm text-slate-300"><input type="checkbox" checked={i.trackStock} disabled={!inventory||catalog?.items.some(x=>x.id===i.id)} onChange={e=>edit(n,{trackStock:e.target.checked})}/> Controlar estoque</label>
   </div>)}
   <button className={btn} onClick={()=>setItems(old=>[...old,{id:key(),sku:'',name:'',category:'',active:true,priceMinor:0,trackStock:inventory}])}>Adicionar produto</button>
   <button disabled={busy} className={btn} onClick={()=>void run(async()=>{const c=await api<RetailCatalog>(tenantId,base+'/catalog','PUT',{expectedVersion:catalog?.version??0,items});setCatalog(c);await load();setMessage('Catálogo versionado.');})}>Salvar catálogo</button>
  </div>}
  {admin&&inventory&&native&&<div className="space-y-2"><h4 className="text-white">Estoque básico / inventário</h4>
   {stock.map(r=><div key={r.item.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-300"><span>{r.item.name}: saldo {r.stock.onHand}, reservado {r.stock.reserved}, disponível {r.stock.onHand-r.stock.reserved}</span><input aria-label={'Saldo de '+r.item.name} className={field+' max-w-32'} type="number" min={r.stock.reserved} value={counts[r.item.id]??0} onChange={e=>setCounts(o=>({...o,[r.item.id]:Number(e.target.value)}))}/><button disabled={busy} className={btn} onClick={()=>void run(async()=>{await api(tenantId,base+'/inventory/'+r.item.id+'/adjust','POST',{expectedVersion:r.stock.version,onHand:counts[r.item.id],reason:why});await load();})}>Ajustar com motivo</button></div>)}
   <input aria-label="Motivo de ajuste" className={field} value={why} onChange={e=>setWhy(e.target.value)}/>
  </div>}
  {catalog?.items.filter(i=>i.active).map(i=><div key={i.id} className="flex items-center justify-between gap-3 text-sm text-slate-300"><span>{i.name} · {i.sku} · {money(i.priceMinor)}</span>{operator&&native&&checkout&&<input aria-label={'Quantidade de '+i.name} type="number" min={0} max={1000} className={field+' max-w-24'} value={quantities[i.id]??0} onChange={e=>{setQuantities(o=>({...o,[i.id]:Number(e.target.value)}));setAccept(false);}}/>}</div>)}
  {operator&&native&&checkout&&<div className="space-y-2"><select aria-label="Cliente do pedido" className={field} value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Selecione cliente ativo</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
   <button className={btn} disabled={busy||!customer||!lines.length} onClick={()=>void cart()}>Criar carrinho</button>
  </div>}
  {operator&&<div className="space-y-2"><h4 className="text-white">Pedidos (datas UTC)</h4><div className="flex flex-wrap gap-2"><input aria-label="Data inicial" type="date" className={field} value={from} onChange={e=>setFrom(e.target.value)}/><input aria-label="Data final exclusiva" type="date" className={field} value={to} onChange={e=>setTo(e.target.value)}/><button className={btn} disabled={busy} onClick={()=>void run(async()=>setOrders(await api<RetailOrder[]>(tenantId,base+'/orders?'+new URLSearchParams({from,to}))))}>Consultar</button></div>
   {orders.map(o=><button key={o.id} className={btn+' block w-full text-left'} onClick={()=>{setSelected(o);setAccept(false);setEvidence('');}}>{o.id} · {o.status} · {money(o.totalMinor)}</button>)}
  </div>}
  {selected&&operator&&<article className={box}><p className="text-white">{selected.status} · {money(selected.totalMinor)} · {selected.payment.state}</p>
   {selected.lines.map(l=><div className="text-sm text-slate-300" key={l.itemId}>{l.quantity} × {l.name} · {money(l.totalMinor)}</div>)}
   <button className={btn} disabled={busy} onClick={()=>void run(async()=>update(await api<RetailOrder>(tenantId,base+'/orders/'+selected.id)))}>Atualizar estado</button>
   {native&&checkout&&selected.status==='CART'&&<><button className={btn} disabled={busy||!catalog||!lines.length} onClick={()=>void command('/edit',{expectedCatalogVersion:catalog!.version,lines})}>Atualizar carrinho com quantidades acima</button><label className="block text-sm text-slate-300"><input type="checkbox" checked={accept} onChange={e=>setAccept(e.target.checked)}/> Cliente aceitou valor e itens</label><input className={field} placeholder="Referência do aceite humano" value={evidence} onChange={e=>setEvidence(e.target.value)}/><button className={btn} disabled={busy||!accept||!evidence} onClick={()=>void command('/confirm',{acceptedTotalMinor:selected.totalMinor,acceptanceRef:evidence})}>Confirmar e reservar estoque</button></>}
   {selected.status==='CONFIRMED'&&cashier&&selected.payment.state==='UNPAID'&&<><select className={field} value={method} onChange={e=>setMethod(e.target.value)}><option value="CASH">Dinheiro</option><option value="CARD">Cartão presencial</option><option value="PIX_MANUAL">Pix manual conferido</option></select><input className={field} placeholder="Referência do comprovante / caixa" value={evidence} onChange={e=>setEvidence(e.target.value)}/><button className={btn} disabled={busy||!evidence} onClick={()=>void command('/cashier',{method,amountMinor:selected.totalMinor,evidenceRef:evidence})}>Registrar recebimento manual (não PSP)</button><button disabled={busy||!native||!checkout} className={btn} onClick={()=>void command('/pix')}>Solicitar Pix ao PSP configurado</button></>}
   {selected.payment.pixCode&&<p className="break-all text-xs text-slate-300">Pix: {selected.payment.pixCode}</p>}
   {selected.payment.provider&&cashier&&<button className={btn} disabled={busy} onClick={()=>void run(async()=>update(await api<RetailOrder>(tenantId,base+'/orders/'+selected.id+'/payment/refresh','POST',{})))}>Verificar no PSP</button>}
   {selected.status==='CONFIRMED'&&<button className={btn} disabled={busy||selected.totalMinor>0&&!['VERIFIED','MANUAL_RECORDED'].includes(selected.payment.state)} onClick={()=>void command('/complete')}>Concluir e baixar estoque</button>}
   {(selected.status==='CONFIRMED'||selected.status==='CART')&&<><input className={field} aria-label="Motivo do cancelamento" value={why} onChange={e=>setWhy(e.target.value)}/><button className={btn} disabled={busy||!why} onClick={()=>void command('/cancel',{reason:why})}>Cancelar (revisão financeira se necessário)</button></>}
  </article>}
 </section>;
}
export function MultiSectorReportPanel({tenantId,unitId}:{tenantId:string;unitId:string}){
 const [period,setPeriod]=useState('month'),[result,setResult]=useState<{metrics:MultiSectorMetrics;plan:{code:string;features:string[]}|null;mode:string;window:{startLocalDate:string;endLocalDate:string};capabilities:string[]}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const report=async()=>{setBusy(true);setError('');try{setResult(await api(tenantId,'/api/onboarding/units/'+encodeURIComponent(unitId)+'/report?period='+period));}catch(e){setError((e as Error).message);setResult(null);}finally{setBusy(false);}};
 return <section className={box}><h3 className="font-semibold text-white">Relatórios multissetoriais e plano</h3><p className="text-sm text-slate-400">Coortes de pedidos criados e horários agendados; estado atual, não fluxo de caixa nem dados de sistema externo.</p>
  <select className={field} aria-label="Período do relatório" value={period} onChange={e=>setPeriod(e.target.value)}><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select><button className={btn} disabled={busy} onClick={()=>void report()}>Consultar relatório</button>{error&&<p role="alert" className="text-rose-300">{error}</p>}
  {result&&<div className="space-y-2 text-sm text-slate-300"><p>Plano: {result.plan?.code??'Sem assinatura ativa'} · {result.mode} · {result.window.startLocalDate} a {result.window.endLocalDate} (exclusivo)</p>
   <p>Alimentação: {result.metrics.food.confirmed} pedidos confirmados · {money(result.metrics.food.confirmedOrderValueMinor)} em pedidos.</p>
   <p>Varejo: {result.metrics.retail.completed} concluídos · {money(result.metrics.retail.completedValueMinor)} em vendas concluídas; PSP verificado {money(result.metrics.retail.verifiedCompletedMinor)}; manual {money(result.metrics.retail.manuallyRecordedCompletedMinor)}.</p>
   <p>Serviços: {result.metrics.services.completed} atendimentos concluídos · {result.metrics.services.noShows} faltas · {money(result.metrics.services.completedPricedValueMinor)} em serviços precificados; {result.metrics.services.completedWithoutPrice} sem preço registrado.</p>
   <p>Capabilities internas: {result.capabilities.join(', ')||'Nenhuma'}. Plano e capabilities não autorizam operação real.</p>
  </div>}
 </section>;
}
