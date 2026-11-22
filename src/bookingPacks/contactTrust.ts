import {createHash} from 'node:crypto';
import type {Firestore,Transaction} from 'firebase-admin/firestore';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {WhatsAppConnection} from '../channels/whatsappConnections';
import type {NormalizedInboundMessage} from '../channels/contracts';
import type {VerifiedCustomerChannel} from '../fulfillment/trustedChannelIdentity';
import type {TrustedContactConsent} from '../governance/model';
import type {Booking} from '../scheduling/model';
import type {Customer} from '../customers/model';
const key=(...p:string[])=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
const PHONE=/^[1-9]\d{9,14}$/;
export type BookingConsentCommand={kind:'OPT_IN';bookingId:string}|{kind:'OPT_OUT'};
export function bookingConsentCommand(message:NormalizedInboundMessage):BookingConsentCommand|null{
 if(message.type!=='TEXT'||typeof message.text!=='string'||!PHONE.test(message.sender))return null;
 const text=message.text.trim();
 if(/^(PARAR|CANCELAR AVISOS DE AGENDAMENTO)$/i.test(text))return {kind:'OPT_OUT'};
 const m=/^AUTORIZO AVISOS DE AGENDAMENTO (booking_[a-f0-9]{32})$/i.exec(text);
 return m?{kind:'OPT_IN',bookingId:m[1].toLowerCase()}:null;
}
/** Only called inside the signature-verified inbox transaction. No public
 * endpoint or CRM field can manufacture proof. Consent for offers is NOT
 * consent for booking messages. Opt-out is per sender, tenant and unit.
 */
export async function stageBookingContactProof(db:Firestore,tx:Transaction,conn:WhatsAppConnection,
 msg:NormalizedInboundMessage,proofRef:string,now:number):Promise<()=>void>{
 const command=bookingConsentCommand(msg),occurred=Date.parse(msg.occurredAt);
 if(!command||msg.tenantId!==conn.tenantId||msg.externalAccountRef!==conn.phoneNumberId||
  msg.channel!=='WHATSAPP'||conn.status!=='ACTIVE'||!Number.isFinite(occurred)||
  occurred>now+300000||command.kind==='OPT_IN'&&occurred<now-86400000)return ()=>{};
 const t=conn.tenantId,u=conn.unitId,recipient=msg.sender;
 const ref=db.collection('bookingContactConsents').doc(key(t,u,recipient));
 const prior=(await tx.get(ref)).data() as TrustedContactConsent|undefined;
 if(prior&&(prior.tenantId!==t||prior.unitId!==u||prior.recipient!==recipient))throw Error('BOOKING_CONTACT_SCOPE');
 if(prior&&(Date.parse(prior.recordedAt)>occurred||
  Date.parse(prior.recordedAt)===occurred&&prior.preference==='OPT_OUT'))return ()=>{};
 let customerId=prior?.customerId??'unbound';
 let identityRef:FirebaseFirestore.DocumentReference|undefined;
 let identity:VerifiedCustomerChannel|undefined;
 if(command.kind==='OPT_IN'){
  const row=(await tx.get(db.collection('schedulingUnits').doc(key(t,u))
   .collection('bookings').doc(command.bookingId))).data() as Booking|undefined;
  if(!row||row.tenantId!==t||row.unitId!==u||row.id!==command.bookingId||!row.pack?.notifyWhatsApp||
   row.startMs<=now||!(row.status==='CONFIRMED'||row.status==='HELD'&&row.holdUntilMs>now))return ()=>{};
  const person=(await tx.get(db.collection('customers').doc(row.customerId))).data() as Customer|undefined;
  if(!person||person.tenantId!==t||person.id!==row.customerId||person.status!=='ACTIVE'||person.phone!==recipient)return ()=>{};
  customerId=person.id;
  identityRef=db.collection('bookingTrustedCustomerChannels').doc(key(t,u,customerId));
  const old=(await tx.get(identityRef)).data() as VerifiedCustomerChannel|undefined;
  if(old&&(old.tenantId!==t||old.customerId!==customerId||Date.parse(old.verifiedAt)>occurred))return ()=>{};
  identity={tenantId:t,customerId,channel:'WHATSAPP',recipient,
   verifiedAt:new Date(occurred).toISOString(),provenance:'SIGNED_PROVIDER_WEBHOOK',proofRef};
 }
 const consent:TrustedContactConsent={tenantId:t,unitId:u,customerId,channel:'WHATSAPP',
  preference:command.kind,provenance:'SIGNED_PROVIDER_WEBHOOK',recipient,
  providerEventId:msg.externalMessageId,recordedAt:new Date(occurred).toISOString()};
 return ()=>{
  tx.set(ref,consent);
  if(identityRef&&identity)tx.set(identityRef,{...identity,unitId:u});
 };
}
export class FirestoreBookingIdentityRepository{
 async get(t:string,c:string,_channel:'WHATSAPP',u:string):Promise<VerifiedCustomerChannel|null>{
  const db=getFirestore(ensureFirebaseAdminApp());
  const row=(await db.collection('bookingTrustedCustomerChannels').doc(key(t,u,c)).get()).data() as (VerifiedCustomerChannel&{unitId:string})|undefined;
  return row?.tenantId===t&&row.unitId===u&&row.customerId===c?row:null;
 }
}
export class FirestoreBookingConsentRepository{
 async get(t:string,u:string,c:string):Promise<TrustedContactConsent|null>{
  const db=getFirestore(ensureFirebaseAdminApp());
  const p=(await db.collection('customers').doc(c).get()).data() as Customer|undefined;
  if(!p||p.tenantId!==t||p.id!==c||p.status!=='ACTIVE'||!p.phone||!PHONE.test(p.phone))return null;
  const row=(await db.collection('bookingContactConsents').doc(key(t,u,p.phone)).get()).data() as TrustedContactConsent|undefined;
  return row?.tenantId===t&&row.unitId===u&&row.customerId===c&&row.recipient===p.phone?row:null;
 }
}
