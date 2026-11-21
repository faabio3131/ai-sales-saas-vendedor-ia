import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,chmod,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {MountedMerchantCredentialsVault,mountedSecretReference} from '../src/payments/mountedVault';
import type {MerchantProviderConnection} from '../src/payments/connections';

describe('Merchant mounted vault tenant security',()=>{
 it('loads only the exact tenant and provider matching a private regular secret file',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'merchant-vault-'));
  const conn:MerchantProviderConnection={
   tenantId:'tenant-pizza',providerId:'EFI',status:'ACTIVE',recipientId:'pix-beneficiary',
   credentialRef:mountedSecretReference('tenant-pizza','EFI'),
  };
  const file=path.join(root,conn.credentialRef!.slice('mounted:'.length)+'.json');
  try {
   await writeFile(file,JSON.stringify({
    tenantId:'tenant-pizza',providerId:'EFI',recipientId:'pix-beneficiary',pixKey:'key-123',
   }),{mode:0o600});
   const vault=new MountedMerchantCredentialsVault(root);
   expect((await vault.load(conn)).pixKey).toBe('key-123');
   await expect(vault.load({...conn,tenantId:'other'})).rejects.toMatchObject({code:'PAYMENT_MOUNT_SECRET_DENIED'});
   await expect(vault.load({...conn,recipientId:'other'})).rejects.toMatchObject({code:'PAYMENT_MOUNT_SECRET_DENIED'});
   await chmod(file,0o644);
   await expect(vault.load(conn)).rejects.toMatchObject({code:'PAYMENT_MOUNT_SECRET_DENIED'});
   await chmod(file,0o600);
   await rm(file);
   await symlink('/etc/hosts',file);
   await expect(vault.load(conn)).rejects.toMatchObject({code:'PAYMENT_MOUNT_SECRET_DENIED'});
  } finally {await rm(root,{recursive:true,force:true});}
 });
});
