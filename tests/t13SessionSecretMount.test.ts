import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {sessionSecretFromRuntime} from '../src/auth/runtimeSecret';
describe('T13 production mounted session secret',()=>{
 it('accepts private secret files, denies broad permissions, symlinks, and ambiguity',()=>{
  const tmp=mkdtempSync(path.join(os.tmpdir(),'av-secret-'));
  const file=path.join(tmp,'secret'),link=path.join(tmp,'link');
  try{
   writeFileSync(file,'fixture-session-secret-0123456789abcdef\n',{mode:0o600});
   chmodSync(file,0o600);
   expect(sessionSecretFromRuntime({SESSION_SECRET_FILE:file}))
    .toBe('fixture-session-secret-0123456789abcdef');
   expect(()=>sessionSecretFromRuntime({SESSION_SECRET_FILE:file,SESSION_SECRET:'other'}))
    .toThrowError(expect.objectContaining({code:'SESSION_SECRET_AMBIGUOUS'}));
   chmodSync(file,0o644);
   expect(()=>sessionSecretFromRuntime({SESSION_SECRET_FILE:file}))
    .toThrowError(expect.objectContaining({code:'SESSION_SECRET_MOUNT_INVALID'}));
   chmodSync(file,0o600);
   symlinkSync(file,link);
   expect(()=>sessionSecretFromRuntime({SESSION_SECRET_FILE:link}))
    .toThrowError(expect.objectContaining({code:'SESSION_SECRET_MOUNT_INVALID'}));
  }finally{rmSync(tmp,{recursive:true,force:true});}
 });
});
