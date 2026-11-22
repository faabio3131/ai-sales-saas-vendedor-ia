import {describe,it,expect,vi} from 'vitest';
import {bookingTemplateBody,appointmentParameter,MetaBookingTemplateService} from '../src/bookingPacks/templates';
import {PackNoticeService} from '../src/bookingPacks/notices';
import {bookingConsentCommand} from '../src/bookingPacks/contactTrust';
import type {WhatsAppConnection} from '../src/channels/whatsappConnections';
import type {WhatsAppSendRecord} from '../src/channels/whatsappDelivery';
import type {NormalizedInboundMessage} from '../src/channels/contracts';
import {packFixture,packConfig,packInput,PHONE} from './t11PackSupport';
import {parseConfig} from '../src/scheduling/rules';

const conn:WhatsAppConnection={tenantId:'tenant-a',unitId:'main',phoneNumberId:'1234567890',wabaId:'9876543210',
 status:'ACTIVE',credentialRef:'mounted:test',version:1,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
const vault={load:async()=>({tenantId:conn.tenantId,unitId:conn.unitId,phoneNumberId:conn.phoneNumberId,wabaId:conn.wabaId,
 accessToken:'fixture-access-token',appSecret:'fixture-app-secret',verifyToken:'fixture-verify-token'})};
function fixture(){
 const rows=new Map<string,WhatsAppSendRecord>();
 const data={name:'booking_reminder',status:'APPROVED',category:'UTILITY',language:'pt_BR',parameter_format:'POSITIONAL',
  components:[{type:'BODY',text:bookingTemplateBody('REMINDER')}]};
 const http=vi.fn(async(_url:RequestInfo|URL,options?:RequestInit)=>new Response(JSON.stringify(
  options?.method==='POST'?{messages:[{id:'wamid.template_123'}]}:{data:[data]}),{status:200}));
 const service=new MetaBookingTemplateService({get:async()=>conn,write:async()=>{}},vault,{
  reserve:async r=>{const old=rows.get(r.idempotencyKey);if(old){if(old.payloadHash!==r.payloadHash)throw Error('conflict');return old;}
   rows.set(r.idempotencyKey,structuredClone(r));return r;},
  settle:async r=>{rows.set(r.idempotencyKey,structuredClone(r));}
 },http);
 const input={tenantId:'tenant-a',unitId:'main',recipient:PHONE,name:'booking_reminder',kind:'REMINDER' as const,
  parameter:'23/11/2026, 11:00 (America/Sao_Paulo)',idempotencyKey:'notice_'+'a'.repeat(48)};
 return {rows,data,http,service,input};
}
describe('T11 approved transactional utility templates and booking-specific consent',()=>{
 it('validates name/locale/category/body under the correct WABA, sends only one canonical parameter, deduplicates provider request',async()=>{
  const h=fixture(),send=await h.service.prepare(h.input);
  expect(h.http).toHaveBeenCalledTimes(1);
  expect(String(h.http.mock.calls[0][0])).toContain('/9876543210/message_templates?');
  expect(await send()).toMatchObject({externalMessageId:'wamid.template_123',duplicate:false});
  const body=JSON.parse(String(h.http.mock.calls[1][1]?.body));
  expect(body).toMatchObject({to:PHONE,type:'template',template:{name:'booking_reminder',language:{code:'pt_BR'},components:[{type:'body',parameters:[{type:'text',text:h.input.parameter}]}]}});
  expect(String(h.http.mock.calls[1][0])).toContain('/1234567890/messages');
  expect(await send()).toMatchObject({duplicate:true});expect(h.http).toHaveBeenCalledTimes(2);
 });
 it('rejects pending, marketing, wrong localized text, extra header, named parameter, invalid account scope and injected free-form parameter',async()=>{
  for(const patch of [{status:'PENDING'},{category:'MARKETING'},{language:'en_US'},{parameter_format:'NAMED'},
   {components:[{type:'BODY',text:'Buy now {{1}}'}]},{components:[{type:'BODY',text:bookingTemplateBody('REMINDER')},{type:'HEADER',text:'Promo'}]}]){
   const h=fixture();Object.assign(h.data,patch);
   await expect(h.service.prepare(h.input)).rejects.toMatchObject({code:'PACK_TEMPLATE_NOT_APPROVED_OR_CONTENT_MISMATCH'});
   expect(h.http).toHaveBeenCalledTimes(1);
  }
  const h=fixture();await expect(h.service.prepare({...h.input,tenantId:'foreign'})).rejects.toMatchObject({code:'PACK_TEMPLATE_CONNECTION_INVALID'});
  await expect(h.service.prepare({...h.input,parameter:'dados clínicos'})).rejects.toMatchObject({code:'PACK_TEMPLATE_INPUT_INVALID'});
  expect(h.http).not.toHaveBeenCalled();
 });
 it('ambiguous provider outcome never resends',async()=>{
  const h=fixture(),send=await h.service.prepare(h.input);
  h.http.mockRejectedValueOnce(Error('timeout'));
  await expect(send()).rejects.toMatchObject({code:'PACK_TEMPLATE_SEND_UNCERTAIN'});
  expect(h.rows.get(h.input.idempotencyKey)?.status).toBe('UNKNOWN');
  await expect(send()).rejects.toMatchObject({code:'PACK_TEMPLATE_SEND_UNCERTAIN'});
  expect(h.http).toHaveBeenCalledTimes(2);
 });
 it('closed window selects approved template port, requires signed consent, never falls back to free text',async()=>{
  const h=await packFixture('AESTHETICS_ADMIN');
  const c=packConfig('AESTHETICS_ADMIN');
  await h.service.configure(h.t,h.u,{...c,expectedVersion:1,pack:{...c.pack,utilityTemplates:{CONFIRMATION:'booking_confirm'}}});
  const held=await h.service.reserve(h.t,h.u,{...packInput(),expectedConfigVersion:2,acceptedPolicyVersion:2});
  const b=await h.service.confirm(h.t,h.u,held.id,{expectedVersion:1,idempotencyKey:'confirm'});
  const sent=vi.fn(async()=>({externalMessageId:'wamid.template_123',duplicate:false}));
  const prepare=vi.fn(async(_input:import('../src/bookingPacks/templates').TemplateInput)=>sent);
  const service=new PackNoticeService(h.store,h.service,h.customers,h.identities,h.consent,h.window,h.sender,()=>{},{prepare});
  h.closeWindow();expect(await service.processOne(h.s,b.id)).toBe('ACCEPTED_BY_PROVIDER');
  expect(prepare.mock.calls[0][0]).toMatchObject({name:'booking_confirm',kind:'CONFIRMATION',parameter:appointmentParameter(b),recipient:PHONE});
  expect(sent).toHaveBeenCalledTimes(1);expect(h.sender.send).not.toHaveBeenCalled();
 });
 it('parses only explicit booking consent and opt-out; rejects marketing permission, clinical content, malformed template name',()=>{
  const event:NormalizedInboundMessage={tenantId:'tenant-a',channel:'WHATSAPP',externalAccountRef:'1234567890',
   externalMessageId:'wamid.inbound_123',sender:PHONE,type:'TEXT',occurredAt:'2026-11-23T12:00:00Z'};
  const bid='booking_'+'f'.repeat(32);
  expect(bookingConsentCommand({...event,text:'AUTORIZO AVISOS DE AGENDAMENTO '+bid})).toEqual({kind:'OPT_IN',bookingId:bid});
  expect(bookingConsentCommand({...event,text:'PARAR'})).toEqual({kind:'OPT_OUT'});
  expect(bookingConsentCommand({...event,text:'AUTORIZO RECEBER OFERTAS'})).toBeNull();
  expect(bookingConsentCommand({...event,text:'AUTORIZO AVISOS DE AGENDAMENTO '+bid+' extra'})).toBeNull();
  const c=packConfig('SALON');expect(()=>parseConfig({...c,pack:{...c.pack,utilityTemplates:{REMINDER:'https://fake'}}})).toThrow();
 });
});
