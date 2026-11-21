import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface IndexField {fieldPath:string;order:string;}
interface IndexDefinition {collectionGroup:string;queryScope:string;fields:IndexField[];}
describe('T04 — Firestore index deployment manifest',()=>{
 const manifest=JSON.parse(readFileSync(resolve(process.cwd(),
  'deploy/order-payments.firestore-indexes.json'),'utf8')) as {
  indexes:IndexDefinition[];fieldOverrides:unknown[];
 };
 it('includes a cross-merchant provider-transaction unique lookup index',()=>{
  expect(manifest.indexes).toEqual(expect.arrayContaining([
   expect.objectContaining({collectionGroup:'orderPayments',queryScope:'COLLECTION',
    fields:[
     {fieldPath:'tenantId',order:'ASCENDING'},
     {fieldPath:'provider',order:'ASCENDING'},
     {fieldPath:'providerPaymentId',order:'ASCENDING'},
    ]}),
  ]));
 });
 it('includes tenant+unit order index and durable reconciliation scan index',()=>{
  const items=manifest.indexes;
  expect(items.some(i=>i.collectionGroup==='orders'&&
   i.fields.map(f=>f.fieldPath).join('|')==='tenantId|unitId')).toBe(true);
  expect(items.some(i=>i.collectionGroup==='orderPayments'&&
   i.fields.map(f=>f.fieldPath).join('|')==='status|__name__')).toBe(true);
  expect(manifest.fieldOverrides).toEqual([]);
 });
});
