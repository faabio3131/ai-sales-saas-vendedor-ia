import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
type Index={collectionGroup:string;queryScope:string;fields:Array<{fieldPath:string;order:string}>};
describe('T05 — finance read indexes are versioned for deployment',()=>{
 const data=JSON.parse(readFileSync(resolve(process.cwd(),
  'deploy/t05-finance.firestore-indexes.json'),'utf8')) as {
   indexes:Index[];fieldOverrides:unknown[];
  };
 it('covers tenant+unit queries for canonical Order and transactional Outbox',()=>{
  for(const collectionGroup of ['orders','orderPaymentOutbox']){
   expect(data.indexes).toEqual(expect.arrayContaining([
    {collectionGroup,queryScope:'COLLECTION',fields:[
     {fieldPath:'tenantId',order:'ASCENDING'},
     {fieldPath:'unitId',order:'ASCENDING'},
    ]},
   ]));
  }
  expect(data.fieldOverrides).toEqual([]);
 });
});
