import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ApplicationError} from '../infrastructure/errors';
import type {MerchantProviderConnection} from './connections';
import type {MerchantBankSecrets,MerchantCredentialsVault} from './merchantVault';

function restricted():never {
 throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_MOUNT_SECRET_DENIED',message:'Merchant secret inaccessible or invalid.'});
}
export function mountedSecretReference(tenantId:string,providerId:string):string {
 const fingerprint=createHash('sha256').update(tenantId+'\x00'+providerId).digest('hex');
 return 'mounted:'+fingerprint;
}
/** A non-GCP vault backend for servers using root-managed, readonly per-merchant secret mounts. */
export class MountedMerchantCredentialsVault implements MerchantCredentialsVault {
 constructor(private readonly root=process.env.PAYMENT_SECRET_MOUNT_DIR??'/run/secrets/atendevende-payments'){}
 async load(conn:MerchantProviderConnection):Promise<MerchantBankSecrets> {
  if(conn.status!=='ACTIVE'||!conn.recipientId||
    conn.credentialRef!==mountedSecretReference(conn.tenantId,conn.providerId)||
    !path.isAbsolute(this.root))return restricted();
  const filename=conn.credentialRef.slice('mounted:'.length)+'.json';
  const file=path.join(this.root,filename);
  try {
   const rootMeta=await lstat(this.root);
   const metadata=await lstat(file);
   if(!rootMeta.isDirectory()||rootMeta.isSymbolicLink()||!metadata.isFile()||metadata.isSymbolicLink()||
     (metadata.mode&0o077)!==0||metadata.size>16384||metadata.size===0) return restricted();
   const content=await readFile(file,'utf8');
   const secret=JSON.parse(content) as MerchantBankSecrets;
   if(!secret||secret.tenantId!==conn.tenantId||secret.providerId!==conn.providerId||
     secret.recipientId!==conn.recipientId)return restricted();
   return secret;
  } catch {return restricted();}
 }
}
