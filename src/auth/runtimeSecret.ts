import fs from 'node:fs';
import {ApplicationError} from '../infrastructure/errors';
/** Server-side session secret from a private 0400/0600 secret mount. */
export function sessionSecretFromRuntime(env:NodeJS.ProcessEnv=process.env):string{
 const file=env.SESSION_SECRET_FILE?.trim();
 if(!file)return env.SESSION_SECRET??'';
 if(env.SESSION_SECRET?.trim())throw new ApplicationError({category:'INTERNAL',
  code:'SESSION_SECRET_AMBIGUOUS',message:'Only one session-secret source is allowed.',statusCode:503});
 try{
  const info=fs.lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))
   throw Error('Unsafe secret permissions');
  const value=fs.readFileSync(file,'utf8').trimEnd();
  if(value.length<32||value.length>4096)throw Error('Invalid secret length');
  return value;
 }catch{
  throw new ApplicationError({category:'INTERNAL',code:'SESSION_SECRET_MOUNT_INVALID',
   message:'Private session secret file is missing or unsafe.',statusCode:503});
 }
}
