/** Fail-closed source-secret regression gate, supplementary to Semgrep and review. */
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const patterns=[
 ['PRIVATE_KEY',/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
 ['GITHUB_TOKEN',/gh[pousr]_[A-Za-z0-9_]{36,}/],
 ['AWS_ACCESS_KEY',/(?:AKIA|ASIA)[0-9A-Z]{16}/],
 ['PAYMENT_PROVIDER_KEY',/(?:sk_live_|rk_live_|whsec_)[A-Za-z0-9]{20,}/],
 ['OPENAI_API_KEY',/sk-proj-[A-Za-z0-9_-]{30,}/],
 ['NVIDIA_API_KEY',/nvapi-[A-Za-z0-9_-]{30,}/],
 ['GOOGLE_API_KEY',/AIza[0-9A-Za-z_-]{35}/],
];
const skip=new Set(['node_modules','dist','coverage','.git','__pycache__']);
const targets=['src','scripts','deploy','cognitive_service','.github/workflows'];
function scan(content){return patterns.filter(([,regex])=>regex.test(content)).map(([id])=>id);}
if(process.argv.includes('--self-test')){
 const keys=[
  '-----BEGIN PRIVATE KEY-----',
  'AKIA'+'A'.repeat(16),
  'ghp_'+'X'.repeat(40),
  'nvapi-'+'X'.repeat(50),
  'sk_live_'+'Z'.repeat(30),
 ];
 for(const key of keys)if(scan(key).length!==1)throw Error('SECRET_GATE_FALSE_NEGATIVE');
 if(scan('SESSION_SECRET_FILE=/run/secrets/session').length)throw Error('SECRET_GATE_FALSE_POSITIVE');
 console.log('t13_source_secret_scanner_self_test_passed');
 process.exit(0);
}
const files=[];
function enumerate(dir){
 if(!fs.existsSync(dir))return;
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  if(skip.has(item.name))continue;
  const name=path.join(dir,item.name);
  if(item.isDirectory())enumerate(name);
  else if(item.isFile()&&/\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|py|sh|env)$/.test(item.name))
   files.push(name);
 }
}
for(const d of targets)enumerate(path.join(root,d));
const violations=[];
for(const filename of files){
 if(path.basename(filename)==='t13SecretGate.mjs')continue;
 const detected=scan(fs.readFileSync(filename,'utf8'));
 for(const id of detected)violations.push(path.relative(root,filename)+':'+id);
}
if(violations.length){
 for(const v of violations)console.error('T13_SECRET_GATE:'+v);
 throw Error('T13_REPOSITORY_SECRETS_DETECTED');
}
console.log('t13_source_secret_gate_passed:'+files.length);
