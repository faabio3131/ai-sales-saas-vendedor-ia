import {createHmac} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {MercadoPagoPixProvider, mercadoPagoSettingsFromEnv} from '../src/payments/mercadoPago';
import {PaymentService} from '../src/payments/service';
import {InMemoryPaymentRepository,InMemoryPaymentWebhookEventRepository} from '../src/payments/repository';
import {QuoteRepository} from '../src/quotes/contracts';
import {Quote} from '../src/quotes/model';

const cfg={tenantId:'tenant-pizza',accessToken:'test-secret',webhookSecret:'hook-secret',collectorId:'123'};
const payment=(status='pending',amount=45,reference='tenant-pizza:q1')=>({
  id:12345,status,transaction_amount:amount,external_reference:reference,collector_id:123,
  point_of_interaction:{transaction_data:{qr_code:'000201...',qr_code_base64:'cG5n',ticket_url:'https://www.mercadopago.com.br/payments/test'}}
});
const quote:Quote={id:'q1',tenantId:'tenant-pizza',customerId:'c1',status:'ACCEPTED',currency:'BRL',
  subtotalMinor:4500,discountMinor:0,totalMinor:4500,createdAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:00:00Z'};
const quotes:QuoteRepository={
  async listByTenant(t){return t===quote.tenantId?[quote]:[];},
  async findById(t,id){return t===quote.tenantId&&id===quote.id?quote:null;},
  async create(q){return q;},async update(q){return q;}
};
const ctx={tenantId:'tenant-pizza',requestId:'req-1'};
const fetchMock=vi.fn(async (_url:string,init?:RequestInit) =>
  new Response(JSON.stringify(payment(init?.method==='POST'?'pending':'approved')),{status:200}));
const provider=()=>new MercadoPagoPixProvider({...cfg,baseUrl:'https://api.mercadopago.com',fetchImpl:fetchMock as unknown as typeof fetch});
describe('Mercado Pago Pix deterministic payment integration',()=>{
  it('fails closed when credentials are missing',()=>{
    expect(mercadoPagoSettingsFromEnv({MP_PIX_TENANT_ID:'tenant-pizza'})).toBeNull();
  });
  it('creates Pix with correct amount, idempotency and QR while protecting merchant',async()=>{
    fetchMock.mockClear();
    const p=provider();
    const out=await p.createPix({tenantId:'tenant-pizza',customerId:'c1',referenceId:'q1',currency:'BRL',amountMinor:4500,
      idempotencyKey:'idem-1',payerEmail:'customer@example.com'});
    expect(out).toMatchObject({status:'PENDING',providerPaymentId:'12345',amountMinor:4500,pixCode:'000201...',pixQrCodeBase64:'cG5n'});
    const [url,init]=fetchMock.mock.calls[0] as [string,RequestInit];
    expect(url).toBe('https://api.mercadopago.com/v1/payments');
    expect((init.headers as Record<string,string>)['X-Idempotency-Key']).toContain('idem-1');
    expect(JSON.parse(String(init.body)).external_reference).toBe('tenant-pizza:q1');
    await expect(p.createPix({tenantId:'other',customerId:'c1',referenceId:'q1',currency:'BRL',
      amountMinor:4500,idempotencyKey:'2',payerEmail:'customer@example.com'})).rejects.toMatchObject({code:'MP_TENANT_DENIED'});
    await expect(p.createPix({tenantId:'tenant-pizza',customerId:'c1',referenceId:'q1',currency:'BRL',
      amountMinor:4500,idempotencyKey:'2'})).rejects.toMatchObject({code:'PAYMENT_PAYER_EMAIL_REQUIRED'});
  });
  it('rejects merchant and amount mismatch',async()=>{
    const fake=vi.fn(async()=>new Response(JSON.stringify(payment('approved',99)),{status:200}));
    const p=new MercadoPagoPixProvider({...cfg,baseUrl:'https://api.mercadopago.com',fetchImpl:fake as unknown as typeof fetch});
    const svc=new PaymentService(new InMemoryPaymentRepository(),new InMemoryPaymentWebhookEventRepository(),quotes,p);
    await expect(svc.create(ctx,{quoteId:'q1',method:'PIX',idempotencyKey:'i',payerEmail:'c@example.com'})).rejects.toMatchObject({code:'MP_PAYMENT_MISMATCH'});
  });
  it('only confirms after verified provider GET and never lets webhook fabricate payment',async()=>{
    const responses=vi.fn(async(_url:string,init?:RequestInit)=>
      new Response(JSON.stringify(payment(init?.method==='POST'?'pending':'approved')),{status:200}));
    const p=new MercadoPagoPixProvider({...cfg,baseUrl:'https://api.mercadopago.com',fetchImpl:responses as unknown as typeof fetch});
    const payments=new InMemoryPaymentRepository();
    const svc=new PaymentService(payments,new InMemoryPaymentWebhookEventRepository(),quotes,p);
    const created=await svc.create(ctx,{quoteId:'q1',method:'PIX',idempotencyKey:'i',payerEmail:'c@example.com'});
    expect(created.status).toBe('PENDING');
    const confirmed=await svc.refresh(ctx,created.id);
    expect(confirmed.status).toBe('CONFIRMED');
    expect((await svc.refresh(ctx,created.id)).confirmedAt).toBe(confirmed.confirmedAt);
    const other=vi.fn(async()=>new Response(JSON.stringify(payment('approved',45,'other:q1')),{status:200}));
    const evil=new MercadoPagoPixProvider({...cfg,baseUrl:'https://api.mercadopago.com',fetchImpl:other as unknown as typeof fetch});
    const svc2=new PaymentService(payments,new InMemoryPaymentWebhookEventRepository(),quotes,evil);
    await expect(svc2.refresh(ctx,created.id)).rejects.toMatchObject({code:'PAYMENT_PROVIDER_RECONCILIATION_FAILED'});
  });
  it('verifies HMAC and rejects replayed or invalid signatures',async()=>{
    const p=provider();const ts=String(Math.floor(Date.now()/1000)),id='12345',requestId='req-1';
    const manifest='id:'+id+';request-id:'+requestId+';ts:'+ts+';';
    const hash=createHmac('sha256',cfg.webhookSecret).update(manifest).digest('hex');
    const headers={'x-signature':'ts='+ts+',v1='+hash,'x-request-id':requestId};
    expect(await p.validateWebhook(headers,{data:{id}})).toBe(true);
    expect(await p.validateWebhook({...headers,'x-request-id':'spoofed'},{data:{id}})).toBe(false);
    expect(await p.validateWebhook({...headers,'x-signature':'ts=1000000000,v1='+hash},{data:{id}})).toBe(false);
    expect(await p.validateWebhook(headers,{data:{id:'12346'}})).toBe(false);
  });
});
