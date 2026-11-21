import {describe,it,expect,vi} from 'vitest';
import {InMemoryPaymentCreationIntentRepository} from '../src/payments/creationIntent';
import {PaymentService} from '../src/payments/service';
import {InMemoryPaymentRepository,InMemoryPaymentWebhookEventRepository} from '../src/payments/repository';
import type {QuoteRepository} from '../src/quotes/contracts';
import type {Quote} from '../src/quotes/model';
import type {PaymentProviderInterface} from '../src/payments/contracts';
const q:Quote={id:'q1',tenantId:'tenant-a',customerId:'c1',status:'ACCEPTED',currency:'BRL',subtotalMinor:5000,
 discountMinor:0,totalMinor:5000,createdAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:00:00Z'};
const qr:QuoteRepository={
 async listByTenant(t){return t===q.tenantId?[q]:[];},
 async findById(t,id){return t===q.tenantId&&id===q.id?q:null;},
 async create(x){return x;},async update(x){return x;},
};
describe('Creation reserve avoids duplicate requests after uncertain provider outcome',()=>{
 it('reserves payment intent atomically before calling provider and refuses retries on unknown outcome',async()=>{
  const create=vi.fn(async()=>{throw new Error('Connection dropped after bank may have created charge');});
  const provider={id:'TEST',createPix:create} as unknown as PaymentProviderInterface;
  const intents=new InMemoryPaymentCreationIntentRepository();
  const svc=new PaymentService(new InMemoryPaymentRepository(),new InMemoryPaymentWebhookEventRepository(),qr,provider,
   undefined,undefined,undefined,intents);
  const ctx={tenantId:'tenant-a',requestId:'req-1'};
  const input={quoteId:'q1',method:'PIX' as const,idempotencyKey:'same'};
  await expect(svc.create(ctx,input)).rejects.toMatchObject({code:'PAYMENT_PROVIDER_ERROR'});
  await expect(svc.create(ctx,input)).rejects.toMatchObject({code:'PAYMENT_CREATION_UNCERTAIN'});
  expect(create).toHaveBeenCalledTimes(1);
 });
});
