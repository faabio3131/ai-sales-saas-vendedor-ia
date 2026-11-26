import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ProviderConnectionPanel} from '../src/ui/ProviderConnectionPanel';
type Status='DISCONNECTED'|'PAIRING'|'CONNECTED';
const root=createRoot(document.getElementById('app')!);
const qr='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
const calls:Array<{url:string;method:string;tenant:string;signal?:AbortSignal}>=[];
let state:Status='DISCONNECTED',rejectConfirm=false,hold=false;
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
 if(hold&&method==='GET'){hold=false;return new Promise<Response>(resolve=>{held={resolve,signal:init?.signal??undefined};});}
 if(url.endsWith('/connect')&&method==='POST'){state='PAIRING';return overview(state,true);}
 if(url.endsWith('/confirm')&&method==='POST'){
  if(rejectConfirm){rejectConfirm=false;return json({ok:false,error:{code:'EVOLUTION_OWNER_UNVERIFIED'}},403);}
  state='CONNECTED';return overview(state);
 }
 if(method==='GET')return overview(state);
 throw Error('unexpected fixture action');
};
const card=()=>document.querySelector<HTMLElement>('article[aria-label="WhatsApp por QR Code"]');
function check(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
function button(label:string){
 const b=Array.from(card()?.querySelectorAll<HTMLButtonElement>('button')??[]).find(x=>x.textContent?.trim()===label);
 check(b&&!b.disabled,'button unavailable: '+label);return b;
}
const realNow=Date.now.bind(Date);
async function until(predicate:()=>unknown,reason:string){
 for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}
 throw Error(reason);
}
const evoCalls=()=>calls.filter(c=>c.url.startsWith('/api/channels/evolution/'));
function mount(tenantId:string,role:string){flushSync(()=>root.render(<ProviderConnectionPanel tenantId={tenantId} role={role}/>));}
async function run(){
 mount('tenant-a','STAFF');check(!card(),'staff can see owner card');
 mount('tenant-a','OWNER');await until(()=>card()?.textContent?.includes('Desconectado'),'initial status');
 let n=evoCalls().length;button('Verificar conexão').click();
 await until(()=>evoCalls().length>n&&!buttonBusy(),'read-only verify');
 check(evoCalls().at(-1)?.method==='GET','disconnected verification mutated');
 button('Conectar WhatsApp').click();await until(()=>!!card()?.querySelector('img'),'QR not rendered');
 check(evoCalls().at(-1)?.method==='POST','connect not POST');
 rejectConfirm=true;button('Verificar conexão').click();
 await until(()=>card()?.querySelector('[role=alert]')?.textContent?.includes('número conectado'),'specific owner error missing');
 check(card()?.textContent?.includes('Último estado conhecido'),'last state lost');
 button('Gerar novo QR Code');button('Desconectar');
 button('Gerar novo QR Code').click();await until(()=>!!card()?.querySelector('img'),'second QR absent');
 Date.now=()=>realNow()+31000;
 await until(()=>!card()?.querySelector('img'),'QR not expired');
 Date.now=realNow;
 button('Verificar conexão').click();
 await until(()=>card()?.textContent?.includes('Sessão conectada'),'confirm did not connect');
 n=evoCalls().length;button('Verificar conexão').click();
 await until(()=>evoCalls().length>n&&!buttonBusy(),'connected GET');
 check(evoCalls().at(-1)?.method==='GET','connected verification mutated');
 hold=true;button('Verificar conexão').click();await until(()=>!!held,'old request missing');
 mount('tenant-b','OWNER');await until(()=>card()?.textContent?.includes('Desconectado'),'new tenant status');
 check(held?.signal?.aborted,'old request not aborted');
 held?.resolve(overview('CONNECTED'));await new Promise(r=>setTimeout(r,100));
 check(card()?.textContent?.includes('Desconectado'),'stale tenant result overwritten');
 const unit=document.querySelector<HTMLInputElement>('section[aria-label="Integrações e credenciais externas"] form input');
 check(unit,'unit input missing');
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;check(setter,'native input setter');
 setter.call(unit,'filial');unit.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,50));
 const select=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='Selecionar');check(select,'unit select missing');select.click();
 await until(()=>evoCalls().some(c=>c.tenant==='tenant-b'&&c.url.endsWith('/filial')),'unit change not scoped');
 check(card()?.textContent?.includes('Desconectado'),'unit status wrong');
}
function buttonBusy(){return card()?.textContent?.includes('Consultando Evolution...')===true;}
run().then(()=>{document.body.dataset.evolutionUi='PASS';}).catch(e=>{
 document.body.dataset.evolutionUi='FAIL';const out=document.createElement('pre');out.id='fixture-error';out.textContent=String(e);document.body.append(out);
});
