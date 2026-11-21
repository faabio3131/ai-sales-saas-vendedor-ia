import type { BusinessProfileRevision } from './model';
import type { ScopedCustomerMemory } from './memoryModel';
export interface BusinessProfileRepository {
  latest(tenantId:string,unitId:string):Promise<BusinessProfileRevision|null>;
  effective(tenantId:string,unitId:string,asOf:string):Promise<BusinessProfileRevision|null>;
  createRevision(revision:BusinessProfileRevision,expectedVersion:number):Promise<void>;
}
export interface ScopedMemoryRepository {
  get(tenantId:string,unitId:string,customerId:string):Promise<ScopedCustomerMemory|null>;
  save(record:ScopedCustomerMemory,expectedVersion:number):Promise<void>;
  delete(tenantId:string,unitId:string,customerId:string):Promise<void>;
  purgeExpired(asOf:string,limit?:number):Promise<number>;
}
