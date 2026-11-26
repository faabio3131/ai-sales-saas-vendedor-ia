/** Export bounded text-only portions of the exact T13 checkout to private CI artifacts.
 * This is an inspection aid, NOT a security approval or a source of secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const OUT='t13-gemini-audit';
const MAX_CHARS=80000;
const repo='faabio3131/ai-sales-saas-vendedor-ia';
const sha=process.env.T13_CHECKOUT_SHA||'';
const prHead=process.env.T13_PR_HEAD_SHA||'';
if(!/^[a-f0-9]{40}$/.test(sha))throw Error('T13_CHECKOUT_SHA_REQUIRED');
if(prHead&&sha!==prHead)throw Error('T13_SOURCE_NOT_EXACT_PR_HEAD');
const groups=[
 ['01_AI_GOVERNANCA',/^src\/(?:ai|governance)\//],
 ['02_PAGAMENTOS',/^src\/(?:payments|orderPayments)\//],
 ['03_FISCAL_AGENDAMENTO_VAREJO',/^src\/(?:fiscal|scheduling|retail)\//],
 ['04_RESTANTE_SRC',/^src\//],
 ['05_TESTES_T13',/^tests\/(?:t13|payment|fiscalHandoff|t07Governance|t04OrderPayments)/],
 ['06_SCRIPTS_SEGURANCA_CI_DEPLOY',/^(?:scripts\/|deploy\/|cognitive_service\/|\.github\/workflows\/|\.semgrep\/|docs\/ADR-010_T13_EVOLUTION_PRIMARY_CHANNEL\.md$|docs\/CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA\.md$|server\.ts$|Dockerfile$|firebase\.json$|package\.json$)/]
];
function discover(dir,prefix){
 if(!fs.existsSync(dir))return[];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
  if(item.isSymbolicLink())return[];
  const rel=path.posix.join(prefix,item.name);
  if(item.isDirectory())return discover(path.join(dir,item.name),rel);
  return item.isFile()?[rel]:[];
 });
}
function allowed(p){
 if(p.startsWith('src/'))return /\.(?:ts|tsx|css)$/.test(p);
 if(p.startsWith('tests/'))return /^tests\/(?:t13|payment|fiscalHandoff|t07Governance|t04OrderPayments).*\.test\.ts$/.test(p);
 if(p.startsWith('scripts/'))return /^scripts\/(?:t13|paymentReconciliationWorker|orderPaymentWorkers|fulfillmentWorker|evolutionAttendanceWorker)/.test(p)&&/\.(?:mjs|js|ts|py|sh)$/.test(p);
 if(p.startsWith('cognitive_service/'))return /\.py$/.test(p)||p==='cognitive_service/Dockerfile';
 if(p.startsWith('deploy/'))return /\.(?:yml|yaml|rules|json|sh|conf)$/.test(p);
 if(p.startsWith('.github/workflows/'))return /\.ya?ml$/.test(p);
 if(p.startsWith('.semgrep/'))return /\.ya?ml$/.test(p);
 return ['Dockerfile','firebase.json','package.json','server.ts','docs/ADR-010_T13_EVOLUTION_PRIMARY_CHANNEL.md','docs/CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA.md'].includes(p);
}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}
const paths=['src','tests','scripts','deploy','cognitive_service','.github/workflows','.semgrep']
 .flatMap(x=>discover(x,x)).concat(['Dockerfile','firebase.json','package.json','server.ts','docs/ADR-010_T13_EVOLUTION_PRIMARY_CHANNEL.md','docs/CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA.md'].filter(fs.existsSync))
 .filter(allowed).sort();
for(const required of ['server.ts','deploy/t13-evolution-gateway.conf','docs/ADR-010_T13_EVOLUTION_PRIMARY_CHANNEL.md','scripts/evolutionAttendanceWorker.ts']){
 if(fs.existsSync(required)&&!paths.includes(required))throw Error('T13_REQUIRED_SOURCE_OMITTED:'+required);
}
if(paths.length<80||new Set(paths).size!==paths.length)
 throw Error('T13_INCOMPLETE_OR_DUPLICATE_AUDIT_FILES');
fs.mkdirSync(OUT,{recursive:true});
const claimed=new Set();const files=[];const chunks=[];
for(const [name,pattern] of groups){
 const matching=paths.filter(p=>!claimed.has(p)&&pattern.test(p));
 if(!matching.length)throw Error('T13_MISSING_AUDIT_GROUP:'+name);
 let buffer='';let part=0;let count=0;
 function flush(){
  if(!count)return;
  part++;
  const fileStem=name+'_PARTE_'+String(part).padStart(2,'0');
  const contents='# ATENDEVENDEIA T13 '+name+' — '+part+'\n\n'+
   'Commit de checkout: '+sha+'\nStatus: CODIGO PARA AUDITORIA, NAO CERTIFICADO\n\n'+buffer;
  for(const ext of ['md','txt']){
   const file=fileStem+'.'+ext;
   fs.writeFileSync(path.join(OUT,file),contents,'utf8');
   chunks.push({file,sha256:digest(Buffer.from(contents)),bytes:Buffer.byteLength(contents),files:count});
  }
  buffer='';count=0;
 }
 for(const p of matching){
  const bytes=fs.readFileSync(p);
  if(bytes.includes(0))throw Error('BINARY_SOURCE_NOT_EXPORTABLE:'+p);
  const numbered=bytes.toString('utf8').replace(/\r\n/g,'\n').split('\n')
    .map((line,i)=>String(i+1).padStart(4,'0')+' | '+line).join('\n');
  const section='## '+p+'\nSHA256: '+digest(bytes)+'\n~~~text\n'+numbered+'\n~~~\n\n';
  if(buffer.length+section.length>MAX_CHARS&&count)flush();
  buffer+=section;count++;claimed.add(p);
  files.push({path:p,sha256:digest(bytes),bytes:bytes.length,group:name});
 }
 flush();
}
if(claimed.size!==paths.length)throw Error('T13_SOURCE_NOT_FULLY_EXPORTED');
const manifest={
 schema:'atendevende.t13.independent-review-export/v1',
 repository:repo,source_sha:sha,pr_head_sha:prHead||null,
 candidate_only:true,independent_review_completed:false,
 file_count:files.length,files,chunks
};
fs.writeFileSync(path.join(OUT,'MANIFEST_SHA256.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'LEIA_PRIMEIRO.md'),
 '# Pacotes de codigo AtendeVendeIA T13 para Gemini\n\n'+
 'Repository: '+repo+'\nExact SHA: '+sha+'\n\n'+
 'Leia TODOS os arquivos de cada grupo, nao apenas o indice. Cada trecho possui caminhos e numeros de linha. '+
 'O MANIFEST_SHA256.json documenta integridade dos arquivos e das partes. '+
 'Nao use exports da branch main para certificar uma PR candidata. '+
 'Nao ha segredo real intencionalmente incluído; arquivos .env e credenciais nao sao selecionados.\n');
console.log(JSON.stringify({status:'T13_SOURCE_EXPORT_NOT_A_CERTIFICATION',source_sha:sha,files:files.length,chunks:chunks.length}));
