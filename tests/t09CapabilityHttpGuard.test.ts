import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {capabilityHttpGate} from '../src/capabilities/httpGuard';
import type {CapabilityRegistryService} from '../src/capabilities/service';
import type {CapabilityId,CapabilityResolution} from '../src/capabilities/model';
import {ApplicationError} from '../src/infrastructure/errors';
import {errorHandler} from '../src/api/middleware/errorHandler';
import type {TenantContext} from '../src/types/contracts';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CapabilityManager} from '../src/ui/CapabilityManager';

const actor=(tenantId:string):TenantContext=>({
 tenantId,userId:'operator-'+tenantId,role:'OWNER',requestId:'test-signed-membership',
});
const denied=()=>new ApplicationError({category:'FORBIDDEN',
 code:'CAPABILITY_EXECUTION_NOT_AUTHORIZED',message:'No operational grant.'});

describe('T09 — permissão de capabilities no caminho HTTP operacional',()=>{
 it('antes de provisionar FOOD_ORDERING nenhum request pode atravessar o router de pedidos',async()=>{
  const allow=new Set<string>(),checks:string[]=[];
  const fake={requireInternal:vi.fn(async(ctx:TenantContext,u:string,id:CapabilityId)=>{
   checks.push(JSON.stringify([ctx.tenantId,u,id]));
   if(!allow.has(JSON.stringify([ctx.tenantId,u,id])))throw denied();
   return {tenantId:ctx.tenantId,unitId:u,capability:id,authorized:true,
    assignmentVersion:1,commercialGoLiveAuthorized:false,
    status:'ALLOWED_INTERNAL'} as CapabilityResolution;
  })};
  const app=express();
  app.use('/orders',(req,_res,next)=>{
   const tenant=req.header('x-test-member');
   if(tenant)req.tenantContext=actor(tenant);
   next();
  },capabilityHttpGate('FOOD_ORDERING',fake as unknown as CapabilityRegistryService),
  (_req,res)=>res.json({ok:true,data:'DOMAIN_EXECUTED'}));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const root='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/orders';
   const request=async(path:string,tenant?:string)=>fetch(root+path,{
    headers:tenant?{'x-test-member':tenant}:{},
    signal:AbortSignal.timeout(4000),
   });
   expect((await request('/units/main')).status).toBe(403);
   expect((await request('/units/main','food-a')).status).toBe(403);
   expect((await request('/units/main','retail-a')).status).toBe(403);
   expect((await request('/units/main%2Fescape','food-a')).status).toBe(403);
   expect(fake.requireInternal).toHaveBeenCalledTimes(2);
   allow.add(JSON.stringify(['food-a','main','FOOD_ORDERING']));
   const granted=await request('/units/main/orders','food-a');
   expect(granted.status).toBe(200);
   expect((await granted.json()).data).toBe('DOMAIN_EXECUTED');
   expect((await request('/units/main/orders','retail-a')).status).toBe(403);
   expect((await request('/units/other/orders','food-a')).status).toBe(403);
   expect(checks).toContain(JSON.stringify(['food-a','main','FOOD_ORDERING']));
  }finally{
   await new Promise<void>((resolve,reject)=>{
    server.close(e=>e?reject(e):resolve());
    server.closeAllConnections();
   });
  }
 },15000);
 it('o mesmo guard funciona para produção e financeiro sem elevar ROLE ou aceitar falta de escopo',async()=>{
  const checked:CapabilityId[]=[];
  const fake={requireInternal:async(_ctx:TenantContext,_unit:string,id:CapabilityId)=>{
   checked.push(id);throw denied();
  }};
  const middlewareProduction=capabilityHttpGate('FOOD_PRODUCTION',fake as unknown as CapabilityRegistryService);
  const middlewareFinance=capabilityHttpGate('FOOD_FINANCE',fake as unknown as CapabilityRegistryService);
  const app=express();
  app.use('/fulfillment',(req,_res,next)=>{
   req.tenantContext=actor('food-a');next();
  },middlewareProduction,(_req,res)=>res.send('not expected'));
  app.use('/finance',(req,_res,next)=>{
   req.tenantContext=actor('food-a');next();
  },middlewareFinance,(_req,res)=>res.send('not expected'));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const root='http://127.0.0.1:'+(server.address() as AddressInfo).port;
   expect((await fetch(root+'/fulfillment/units/main/queue')).status).toBe(403);
   expect((await fetch(root+'/finance/units/main/snapshot')).status).toBe(403);
   expect(checked).toEqual(['FOOD_PRODUCTION','FOOD_FINANCE']);
  }finally{
   await new Promise<void>((resolve,reject)=>{
    server.close(e=>e?reject(e):resolve());
    server.closeAllConnections();
   });
  }
 });
 it('o painel multissetorial não renderiza KDS nem supõe dados de um cliente sem registro',()=>{
  const html=renderToStaticMarkup(createElement(CapabilityManager,{
   tenantId:'retail-a',role:'OWNER',
  }));
  expect(html).toContain('Módulos e capacidades da empresa');
  expect(html).not.toContain('Cozinha, retirada e delivery');
  expect(html).toContain('Configurações são');
 });
});
