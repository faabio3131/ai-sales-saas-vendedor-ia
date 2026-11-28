import {closeSync,constants,fstatSync,lstatSync,openSync,readSync} from 'node:fs';

/** A single credential source; legacy Evolution mount remains supported.
 * Never put file contents into process.env, logs, error messages or argv.
 */
export function geminiRuntimeSecret(env:NodeJS.ProcessEnv=process.env):string|null {
 const direct=env.GEMINI_API_KEY?.trim();
 const files=[env.GEMINI_API_KEY_FILE?.trim(),env.EVOLUTION_GEMINI_SECRET_FILE?.trim()].filter(Boolean) as string[];
 if(files.length>1||(direct&&files.length))throw Error('GEMINI_SECRET_SOURCE_AMBIGUOUS');
 if(!files.length)return direct||null;
 let fd:number|undefined;
 try {
  const before=lstatSync(files[0]);
  if(!before.isFile()||before.isSymbolicLink())throw Error('invalid');
  fd=openSync(files[0],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=fstatSync(fd),mode=info.mode&0o7777;
  if(!info.isFile()||before.dev!==info.dev||before.ino!==info.ino||
     (mode!==0o400&&mode!==0o600)||info.size<20||info.size>1024)throw Error('invalid');
  const buffer=Buffer.alloc(1025);
  let total=0;
  try {
   while(total<buffer.length){
    const n=readSync(fd,buffer,total,buffer.length-total,null);
    if(n===0)break;
    total+=n;
   }
   if(total!==info.size||total>1024)throw Error('invalid');
   const key=buffer.subarray(0,total).toString('utf8').trim();
   if(!/^[\x21-\x7e]{20,1024}$/.test(key))throw Error('invalid');
   return key;
  }finally{buffer.fill(0);}
 }catch{throw Error('GEMINI_SECRET_FILE_INVALID');}
 finally{if(fd!==undefined)closeSync(fd);}
}
