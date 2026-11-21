import {useEffect,useState,type FormEvent} from 'react';
import {BarChart3,LockKeyhole,CalendarDays,RefreshCw,Send,Wallet} from 'lucide-react';
type Period='day'|'week'|'month';
interface FinanceData {
 tenantId:string;unitId:string;generatedAt:string;
 coverage:string;source:string;
 window:{period:Period;timezone:string;startLocalDate:string;endLocalDate:string;startInclusive:string;endExclusive:string;asOf:string};
 metrics:{
  orderCount:number;grossSalesMinor:number;discountsMinor:number;netSalesMinor:number;
  confirmedReceiptsMinor:number;refundsMinor:number;netReceiptsMinor:number;
  pendingReceivablesMinor:number;averageTicketMinor:number;
  processingFeesMinor:number|null;feeCoverage:string;platformAICostsIncluded:boolean;
  ranking:Array<{catalogItemId:string;name:string;quantity:number;grossItemSalesMinor:number}>;
 };
 reconciliation:{orders:number;events:number;distinctPayments:number;verifiedEvents:number;errors:number};
}
interface Answer {answer:string;source:'DETERMINISTIC_LEDGER';metric:string;}
interface FinancePrefs {version:number;weekStartsOn:number;}
const money=(minor:number)=>new Intl.NumberFormat('pt-BR',{
 style:'currency',currency:'BRL',
}).format(minor/100);
function validUnit(unit:string):boolean{return /^[A-Za-z0-9_-]{1,96}$/.test(unit);}
function api(tenantId:string,unitId:string,suffix:string,init?:RequestInit){
 return fetch('/api/finance/units/'+encodeURIComponent(unitId)+suffix,{
  ...init,credentials:'same-origin',
  headers:{'x-tenant-id':tenantId,...(init?.headers??{})},
 });
}
export function FinancialPanel({tenantId,role}:{tenantId:string;role:string}){
 const [unitDraft,setUnitDraft]=useState('main');
 const [unitId,setUnitId]=useState('main');
 const [period,setPeriod]=useState<Period>('day');
 const [snapshot,setSnapshot]=useState<FinanceData|null>(null);
 const [prefs,setPrefs]=useState<FinancePrefs|null>(null);
 const [question,setQuestion]=useState('');
 const [answer,setAnswer]=useState<Answer|null>(null);
 const [pending,setPending]=useState(false);
 const [queryPending,setQueryPending]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const admin=role==='OWNER'||role==='ADMIN';
 useEffect(()=>{
  if(!admin||!validUnit(unitId))return;
  const ctrl=new AbortController();
  setSnapshot(null);setAnswer(null);setError(null);setPending(true);
  Promise.all([
   api(tenantId,unitId,'/snapshot?period='+period,{signal:ctrl.signal}),
   api(tenantId,unitId,'/settings',{signal:ctrl.signal}),
  ]).then(async([report,settings])=>{
   if(!report.ok||!settings.ok)throw new Error('Dados financeiros indisponíveis ou acesso não autorizado.');
   const rp=await report.json() as {ok:boolean;data:FinanceData};
   const sp=await settings.json() as {ok:boolean;data:FinancePrefs};
   if(!rp.ok||!sp.ok)throw new Error('Relatório não certificado pelo servidor.');
   if(ctrl.signal.aborted)return;
   setSnapshot(rp.data);setPrefs(sp.data);
  }).catch(()=>{
   if(!ctrl.signal.aborted)setError('Não foi possível obter dados financeiros verificados para esta unidade.');
  }).finally(()=>{if(!ctrl.signal.aborted)setPending(false);});
  return ()=>ctrl.abort();
 },[admin,tenantId,unitId,period]);
 if(!admin)return null;
 async function sendQuestion(e:FormEvent){
  e.preventDefault();
  if(!validUnit(unitId)||question.trim().length<4||queryPending)return;
  setAnswer(null);setQueryPending(true);setError(null);
  try{
   const response=await api(tenantId,unitId,'/ask',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({question,period}),
   });
   if(!response.ok)throw new Error('Consulta indisponível.');
   const result=await response.json() as {ok:boolean;data:Answer};
   if(!result.ok||result.data.source!=='DETERMINISTIC_LEDGER')
    throw new Error('Resultado sem evidência financeira.');
   setAnswer(result.data);
  }catch{setError('Não foi possível responder com dados financeiros verificados.');}
  finally{setQueryPending(false);}
 }
 async function setWeekStart(value:number){
  if(!prefs)return;
  try{
   const response=await api(tenantId,unitId,'/settings',{
    method:'PUT',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedVersion:prefs.version,weekStartsOn:value}),
   });
   if(!response.ok)throw new Error('Falha ao atualizar.');
   const data=await response.json() as {ok:boolean;data:FinancePrefs};
   if(!data.ok)throw new Error('Falha ao atualizar.');
   setPrefs(data.data);setPeriod('day');setSnapshot(null);
   // Explicitly refresh current period without falsely retaining older figures.
   const verified=await api(tenantId,unitId,'/snapshot?period=day');
   if(!verified.ok)throw new Error('Falha ao atualizar o relatório.');
   const result=await verified.json() as {ok:boolean;data:FinanceData};
   if(!result.ok)throw new Error('Falha ao atualizar o relatório.');
   setSnapshot(result.data);
  }catch{setError('A preferência da semana não pôde ser validada. Atualize o painel.');}
 }
 return (
  <section className="mt-6 rounded-3xl border border-slate-700/80 bg-slate-900/70 p-5 sm:p-6" aria-label="Painel financeiro administrativo">
   <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div>
     <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold uppercase tracking-widest">
      <LockKeyhole className="h-4 w-4"/> Acesso financeiro restrito
     </div>
     <h2 className="mt-2 flex items-center gap-2 text-xl font-semibold text-white">
      <BarChart3 className="h-5 w-5 text-emerald-400"/> Gestão financeira comercial
     </h2>
     <p className="mt-1 max-w-xl text-sm text-slate-400">
      Indicadores de pedidos e pagamentos confirmados, calculados no servidor. Valores não são lucro nem extrato bancário.
     </p>
    </div>
    <form onSubmit={e=>{e.preventDefault();if(validUnit(unitDraft))setUnitId(unitDraft);else setError('Unidade inválida.');}}
     className="flex items-end gap-2">
     <label className="text-xs text-slate-400">Unidade
      <input value={unitDraft} onChange={e=>setUnitDraft(e.target.value)} maxLength={96}
       className="mt-1 block w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"/>
     </label>
     <button type="submit" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-white hover:bg-slate-800">
      Selecionar
     </button>
    </form>
   </header>
   <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
    <div className="flex gap-2">
     {(['day','week','month'] as Period[]).map(p=>
      <button type="button" key={p} onClick={()=>setPeriod(p)}
       aria-pressed={p===period}
       className={'rounded-lg px-3 py-2 text-sm '+(p===period?
        'bg-emerald-500 text-slate-950 font-semibold':'bg-slate-800 text-slate-300')}>
       {p==='day'?'Hoje':p==='week'?'Semana':'Mês'}
      </button>)}
    </div>
    {prefs&&<label className="text-xs text-slate-400 flex items-center gap-2">
     <CalendarDays className="h-4 w-4"/> Início da semana
     <select value={prefs.weekStartsOn} onChange={e=>void setWeekStart(Number(e.target.value))}
      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-white">
      <option value={1}>Segunda-feira</option><option value={0}>Domingo</option>
     </select>
    </label>}
   </div>
   {pending&&<p className="mt-4 flex items-center gap-2 text-sm text-slate-400">
    <RefreshCw className="h-4 w-4 animate-spin"/> Consultando fonte financeira...
   </p>}
   {error&&<p className="mt-4 rounded-lg border border-rose-700/40 bg-rose-950/30 p-3 text-sm text-rose-300">
    {error}
   </p>}
   {snapshot&&<>
    <p className="mt-4 text-xs text-slate-500">
     {snapshot.window.timezone} · {snapshot.window.startLocalDate} a {snapshot.window.endLocalDate} (fim exclusivo).
    </p>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
     {[
      ['Vendas brutas',money(snapshot.metrics.grossSalesMinor)],
      ['Vendas após descontos',money(snapshot.metrics.netSalesMinor)],
      ['Recebimentos confirmados',money(snapshot.metrics.confirmedReceiptsMinor)],
      ['Recebimentos após estornos',money(snapshot.metrics.netReceiptsMinor)],
      ['Estornos',money(snapshot.metrics.refundsMinor)],
      ['A receber nos pedidos',money(snapshot.metrics.pendingReceivablesMinor)],
      ['Ticket médio',money(snapshot.metrics.averageTicketMinor)],
      ['Pedidos confirmados',String(snapshot.metrics.orderCount)],
     ].map(([name,value])=><article key={name}
      className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-lg font-bold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{name}</div>
     </article>)}
    </div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
     <article className="rounded-xl border border-slate-800 p-4">
      <h3 className="font-medium text-white">Produtos mais vendidos</h3>
      {snapshot.metrics.ranking.length===0?
       <p className="mt-2 text-sm text-slate-500">Sem produtos no período.</p>:
       <ol className="mt-2 space-y-2">
        {snapshot.metrics.ranking.slice(0,5).map(item=>
         <li key={item.catalogItemId} className="flex justify-between gap-3 text-sm text-slate-300">
          <span className="truncate">{item.name}</span>
          <span className="shrink-0">{item.quantity} un.</span>
         </li>)}
       </ol>}
     </article>
     <article className="rounded-xl border border-slate-800 p-4">
      <h3 className="flex items-center gap-2 font-medium text-white"><Wallet className="h-4 w-4"/> Qualidade dos números</h3>
      <p className="mt-2 text-sm text-slate-400">Reconciliação de {snapshot.reconciliation.orders} pedidos e {snapshot.reconciliation.events} eventos transacionais.</p>
      <p className="mt-2 text-sm text-amber-300">Taxas bancárias não verificadas: valor indisponível, não zero.</p>
      <p className="mt-2 text-xs text-slate-500">Custos de IA da FM Tecnologia não são custos do estabelecimento.</p>
      <p className="mt-2 text-xs text-slate-500">Cobertura atual: pedidos do Order Engine T03/T04. Cotações legadas sem unidade financeira atribuível não integram estes totais.</p>
     </article>
    </div>
   </>}
   <form onSubmit={e=>void sendQuestion(e)} className="mt-5 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
    <label className="block text-sm font-medium text-white" htmlFor="finance-question">
     Pergunte sobre suas vendas
    </label>
    <p className="mt-1 text-xs text-slate-500">
     Ex.: Quanto vendi hoje? Quanto recebi este mês? Qual o ticket médio? Quais produtos mais vendidos?
    </p>
    <div className="mt-3 flex gap-2">
     <input id="finance-question" value={question} onChange={e=>setQuestion(e.target.value)}
      maxLength={260} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
      placeholder="Digite sua pergunta" />
     <button disabled={queryPending||question.trim().length<4} type="submit"
      className="rounded-lg bg-emerald-500 px-4 text-slate-950 disabled:opacity-40">
      <Send className="h-4 w-4"/>
     </button>
    </div>
    {answer&&<p role="status" className="mt-3 rounded-lg bg-slate-900 p-3 text-sm text-slate-200">
     {answer.answer}
    </p>}
   </form>
  </section>
 );
}
