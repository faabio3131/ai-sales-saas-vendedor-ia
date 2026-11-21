import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
interface Index {collectionGroup:string;queryScope:string;
  fields:Array<{fieldPath:string;order:string}>;}
describe('T06 — build and deployment manifests remain fail-closed',()=>{
 const manifest=JSON.parse(readFileSync(resolve(process.cwd(),
  'deploy/t06-fulfillment.firestore-indexes.json'),'utf8')) as {
    indexes:Index[];fieldOverrides:unknown[];
  };
 it('versions the necessary tenant/unit operational and mode-safety indexes',()=>{
  const expected=[
   ['orders',['tenantId','unitId','status']],
   ['productionOperations',['tenantId','unitId']],
   ['productionOutbox',['deliveryStatus','nextAttemptAt']],
   ['productionOutbox',['deliveryStatus','leaseUntil']],
  ] as const;
  for(const [collection,fields] of expected){
   expect(manifest.indexes.some(x=>x.collectionGroup===collection&&
    x.queryScope==='COLLECTION'&&
    x.fields.map(f=>f.fieldPath).join('|')===fields.join('|'))).toBe(true);
  }
  expect(manifest.fieldOverrides).toEqual([]);
 });
 it('builds a separate production dispatch worker without secrets or mock provider fallbacks',()=>{
  const p=JSON.parse(readFileSync(resolve(process.cwd(),'package.json'),'utf8')) as {
    scripts:Record<string,string>;
  };
  expect(p.scripts.build).toContain('scripts/fulfillmentWorker.ts');
  expect(p.scripts.build).toContain('dist/fulfillment-worker.cjs');
  expect(p.scripts['run:fulfillment-cycle']).toBe('node dist/fulfillment-worker.cjs');
  const compose=readFileSync(resolve(process.cwd(),
   'deploy/fulfillment-worker.compose.yaml'),'utf8');
  expect(compose).toContain('node dist/fulfillment-worker.cjs');
  expect(compose).toContain('healthcheck:');
  expect(compose).toContain('ATENDEVENDEIA_IMAGE_REQUIRED');
  expect(compose).not.toMatch(/(?:secret|password|access.token):\s*['"]?[a-z0-9]{16}/i);
 });
});
