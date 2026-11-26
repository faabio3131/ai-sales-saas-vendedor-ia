import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ProviderConnectionPanel} from '../src/ui/ProviderConnectionPanel';
type Status='DISCONNECTED'|'PAIRING'|'CONNECTED';
const root=createRoot(document.getElementById('app')!);
const qr='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
const calls:Array<{url:string;method:string;tenant:string;signal?:AbortSignal}>=[];
let state:Status='DISCONNECTED',rejectConfirm=false,hold=false;
let failure:'html'|'network'|'unmapped'|null=null;
let rejectLogout=false;
let held:{resolve:(r:Response)=>void;signal?:AbortSignal}|undefined;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const overview=(status:Status,withQr=false)=>json({ok:true,data:{status,connected:status==='CONNECTED',commercialEnabled:false,...(withQr?{qrCode:qr,expiresInSeconds:30}:{})}});
window.fetch=async(input,init)=>{
 const url=String(input),method=init?.method??'GET',tenant=new Headers(init?.headers).get('x-tenant-id')??'';
 calls.push({url,method,tenant,signal:init?.signal??undefined});
 if(url==='/api/payments/providers')return json({ok:true,data:[]});
 if(url==='/api/payments/connections')return json({ok:true,data:{connections:[]}});
 if(url.startsWith('/api/channels/whatsapp/units/'))return json({ok:true,data:{status:'NOT_CONFIGURED',credentialConfigured:false}});
 if(!url.startsWith('/api/channels/evolution/units/'))throw Error('unexpected fixture URL');
 if(tenant==='tenant-b')return overview('DISCONNECTED');
 if(failure){
  const kind=failure;failure=null;
  if(kind==='network')throw new TypeError('Failed to fetch');
  if(kind==='html')return new Response('<html>502 Bad Gateway</html>',{status:502,headers:{'content-type':'text/html'}});
  return json({ok:false,error:{code:'__proto__',message:'untrusted internal detail'}},500);
 }
 if(hold&&method==='GET'){hold=false;return new Promise<Response>(resolve=>{held={resolve,signal:init?.signal??undefined};});}
 if(url.endsWith('/connect')&&method==='POST'){state='PAIRING';return overview(state,true);}
 if(url.endsWith('/confirm')&&method==='POST'){
  if(rejectConfirm){rejectConfirm=false;return json({ok:false,error:{code:'EVOLUTION_OWNER_UNVERIFIED'}},403);}
  state='CONNECTED';return overview(state);
 }
 if(url.endsWith('/disconnect')&&method==='POST'){
  if(rejectLogout){rejectLogout=false;return json({ok:false,error:{code:'EVOLUTION_LOGOUT_RECONCILIATION_REQUIRED'}},409);}
  state='DISCONNECTED';return overview(state);
 }
 if(method==='GET')return overview(state);
 throw Error('unexpected fixture action');
};
const card=()=>document.querySelector<HTMLElement>('article[aria-label="WhatsApp por QR Code"]');
function check(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
function findButton(label:string){
 return Array.from(card()?.querySelectorAll<HTMLButtonElement>('button')??[]).find(x=>x.textContent?.trim()===label);
}
function button(label:string){
 const b=findButton(label);
 check(b&&!b.disabled,'button unavailable: '+label);return b;
}
const realNow=Date.now.bind(Date);
async function until(predicate:()=>unknown,reason:string){
 for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}
 throw Error(reason+'; status='+card()?.querySelector('[role=status]')?.textContent+'; calls='+JSON.stringify(evoCalls().map(({url,method,tenant})=>({url,method,tenant}))));
}
const evoCalls=()=>calls.filter(c=>c.url.startsWith('/api/channels/evolution/'));
const statusText=()=>card()?.querySelector('[role=status]')?.textContent??'';
const idle=()=>findButton('Verificar conexão')?.disabled===false&&!statusText().includes('Consultando Evolution...');
function mount(tenantId:string,role:string){flushSync(()=>root.render(<ProviderConnectionPanel tenantId={tenantId} role={role}/>));}
// A recorded fetch alone is not proof React committed the busy state. Force
// the click's synchronous update, assert the actual disabled button, then
// wait for the matching request and its final committed DOM state.
async function clickAction(label:string,method:string,suffix:string,tenant='tenant-a'){
 await until(()=>idle()&&findButton(label)?.disabled===false,'ready for '+label);
 const before=evoCalls().length;
 flushSync(()=>button(label).click());
 const issued=evoCalls();
 check(issued.length===before+1,'expected exactly one request for '+label);
 const last=issued.at(-1);
 check(last?.method===method&&last.url.endsWith(suffix)&&last.tenant===tenant,'wrong request for '+label);
 check(findButton('Verificar conexão')?.disabled===true,'busy not committed for '+label);
}
async function settled(predicate:()=>unknown,reason:string){
 await until(()=>idle()&&predicate(),reason);
}
async function run(){
 mount('tenant-a','STAFF');check(!card(),'staff can see owner card');
 mount('tenant-a','OWNER');
 await settled(()=>statusText()==='Desconectado','initial status');
 await clickAction('Verificar conexão','GET','/main');
 await settled(()=>statusText()==='Desconectado','read-only verify');
 await clickAction('Conectar WhatsApp','POST','/main/connect');
 await settled(()=>!!card()?.querySelector('img'),'QR not rendered');
 rejectConfirm=true;await clickAction('Verificar conexão','POST','/main/confirm');
 await settled(()=>card()?.querySelector('[role=alert]')?.textContent?.includes('número conectado'),'specific owner error missing');
 check(statusText().includes('Último estado conhecido'),'last state lost');
 button('Gerar novo QR Code');button('Desconectar');
 await clickAction('Gerar novo QR Code','POST','/main/connect');
 await settled(()=>!!card()?.querySelector('img'),'second QR absent');
 try{
  Date.now=()=>realNow()+31000;
  await settled(()=>!card()?.querySelector('img'),'QR not expired');
 }finally{Date.now=realNow;}
 await clickAction('Verificar conexão','POST','/main/confirm');
 await settled(()=>statusText()==='Sessão conectada','confirm did not connect');
 await clickAction('Verificar conexão','GET','/main');
 await settled(()=>statusText()==='Sessão conectada','connected GET');
 for(const kind of ['html','network','unmapped'] as const){
  failure=kind;await clickAction('Verificar conexão','GET','/main');
  await settled(()=>card()?.querySelector('[role=alert]')?.textContent==='Não foi possível verificar a conexão. Tente novamente.','controlled Portuguese error '+kind);
  check(statusText()==='Último estado conhecido: Sessão conectada','known state lost after '+kind);
  await clickAction('Verificar conexão','GET','/main');
  await settled(()=>statusText()==='Sessão conectada'&&!card()?.querySelector('[role=alert]'),'recovery after '+kind);
 }
 const oldConfirm=window.confirm;
 try{
  let dialogs=0;const dialogCount=()=>dialogs;window.confirm=()=>{dialogs++;return false;};
  const before=evoCalls().length;
  flushSync(()=>button('Desconectar').click());
  check(dialogCount()===1&&evoCalls().length===before&&idle()&&statusText()==='Sessão conectada','cancelled logout mutated');
  window.confirm=()=>{dialogs++;return true;};
  rejectLogout=true;
  await clickAction('Desconectar','POST','/main/disconnect');
  await settled(()=>card()?.querySelector('[role=alert]')?.textContent?.includes('encerramento da sessão não foi comprovado'),'unsafe logout not explained');
  check(statusText()==='Último estado conhecido: Sessão conectada','ambiguous logout falsely displayed disconnected');
  await clickAction('Desconectar','POST','/main/disconnect');
  await settled(()=>statusText()==='Desconectado','logout did not settle');
  check(dialogCount()===3,'logout confirmation not required');
 }finally{window.confirm=oldConfirm;}
 hold=true;await clickAction('Verificar conexão','GET','/main');await until(()=>!!held,'old request missing');
 mount('tenant-b','OWNER');
 await settled(()=>statusText()==='Desconectado'&&evoCalls().at(-1)?.tenant==='tenant-b','new tenant status');
 check(held?.signal?.aborted,'old request not aborted');
 held?.resolve(overview('CONNECTED'));await new Promise(r=>setTimeout(r,100));
 check(idle()&&statusText()==='Desconectado','stale tenant result overwritten');
 const unit=document.querySelector<HTMLInputElement>('section[aria-label="Integrações e credenciais externas"] form input');
 check(unit,'unit input missing');
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;check(setter,'native input setter');
 flushSync(()=>{setter.call(unit,'filial');unit.dispatchEvent(new Event('input',{bubbles:true}));});
 const select=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='Selecionar');check(select,'unit select missing');
 flushSync(()=>select.click());
 await settled(()=>evoCalls().some(c=>c.tenant==='tenant-b'&&c.url.endsWith('/filial'))&&statusText()==='Desconectado','unit change not scoped or status wrong');
}
run().then(()=>{document.body.dataset.evolutionUi='PASS';}).catch(e=>{
 document.body.dataset.evolutionUi='FAIL';const out=document.createElement('pre');out.id='fixture-error';out.textContent=String(e);document.body.append(out);
});
