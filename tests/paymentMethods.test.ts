import { describe, it, expect } from 'vitest';
import { PaymentMethodsService, InMemoryPaymentMethodsRepository } from '../src/payments/methods';
import { InMemoryPaymentRepository, InMemoryPaymentWebhookEventRepository } from '../src/payments/repository';
import { PaymentService } from '../src/payments/service';
import { QuoteRepository } from '../src/quotes/contracts';
import { Quote } from '../src/quotes/model';
import { StructuralPaymentProvider } from '../src/payments/provider';

const owner = (tenantId:string) => ({tenantId,role:'OWNER',requestId:'req-1'});
const staff = (tenantId:string) => ({tenantId,role:'STAFF',requestId:'req-2'});
const quote:Quote = {
  id:'quote-1',tenantId:'pizzaria',customerId:'customer-1',status:'ACCEPTED',
  currency:'BRL',subtotalMinor:4500,discountMinor:0,totalMinor:4500,
  createdAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:00:00Z',
};
const quotes:QuoteRepository = {
  async listByTenant(t) {return t===quote.tenantId?[quote]:[];},
  async findById(t,id) {return t===quote.tenantId && id===quote.id?quote:null;},
  async create(q) {return q;},async update(q) {return q;},
};

describe('Pizzaria payment method configuration',()=>{
  it('defaults all payment methods to disabled for a new tenant',async()=>{
    const s=new PaymentMethodsService(new InMemoryPaymentMethodsRepository());
    const a=await s.get(owner('pizzaria'));
    expect(a.pixManualEnabled).toBe(false);
    expect(a.cashOnDeliveryEnabled).toBe(false);
    expect(a.cardOnDeliveryEnabled).toBe(false);
  });
  it('requires OWNER and a Pix key; rejects unknown configuration fields',async()=>{
    const s=new PaymentMethodsService(new InMemoryPaymentMethodsRepository());
    const payload={pixManualEnabled:true,cardOnDeliveryEnabled:false,cashOnDeliveryEnabled:false,pixKey:'123@test'};
    await expect(s.update(staff('pizzaria'),payload)).rejects.toMatchObject({code:'PAYMENT_METHODS_FORBIDDEN'});
    await expect(s.update(owner('pizzaria'),{...payload,pixKey:''})).rejects.toMatchObject({code:'PAYMENT_PIX_KEY_REQUIRED'});
    await expect(s.update(owner('pizzaria'),{...payload,tenantId:'other'})).rejects.toMatchObject({code:'PAYMENT_METHODS_INVALID'});
    await s.update(owner('pizzaria'),payload);
    expect((await s.get(owner('other'))).pixManualEnabled).toBe(false);
  });
  it('tracks an enabled offline payment as PENDING, never CONFIRMED',async()=>{
    const methods=new PaymentMethodsService(new InMemoryPaymentMethodsRepository());
    const payments=new InMemoryPaymentRepository();
    const service=new PaymentService(payments,new InMemoryPaymentWebhookEventRepository(),quotes,new StructuralPaymentProvider(),undefined,methods);
    await expect(service.create(owner('pizzaria'),{quoteId:'quote-1',method:'PIX_MANUAL',idempotencyKey:'1'})).rejects.toMatchObject({code:'PAYMENT_METHOD_DISABLED'});
    await methods.update(owner('pizzaria'),{pixManualEnabled:true,pixKey:'123@test',cardOnDeliveryEnabled:true,cashOnDeliveryEnabled:true});
    const result=await service.create(owner('pizzaria'),{quoteId:'quote-1',method:'PIX_MANUAL',idempotencyKey:'1'});
    expect(result.status).toBe('PENDING');
    expect(result.provider).toBe('OFFLINE');
    expect(result.amountMinor).toBe(4500);
    expect(result.providerPaymentId).toBeUndefined();
    expect((await service.refresh(owner('pizzaria'),result.id)).status).toBe('PENDING');
    await expect(service.create(owner('pizzaria'),{quoteId:'quote-1',method:'CASH_ON_DELIVERY',idempotencyKey:'1'})).rejects.toMatchObject({code:'PAYMENT_IDEMPOTENCY_CONFLICT'});
    await expect(service.get(owner('other'),result.id)).rejects.toMatchObject({code:'PAYMENT_NOT_FOUND'});
    const card=await service.create(owner('pizzaria'),{quoteId:'quote-1',method:'CARD_ON_DELIVERY',idempotencyKey:'2'});
    expect(card.status).toBe('PENDING');
  });
  it('retains existing gateway Pix restrictions without configured PSP',async()=>{
    const service=new PaymentService(new InMemoryPaymentRepository(),new InMemoryPaymentWebhookEventRepository(),quotes,new StructuralPaymentProvider());
    await expect(service.create(owner('pizzaria'),{quoteId:'quote-1',method:'PIX',idempotencyKey:'real'})).rejects.toMatchObject({code:'PAYMENT_PROVIDER_NOT_CONFIGURED'});
  });
});
