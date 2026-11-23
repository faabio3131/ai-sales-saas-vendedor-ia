/** OCI keyless Sigstore attestations for owner-operated private GitHub repositories.
 * Verified input MUST come from successful cosign verify-attestation with the
 * exact release workflow certificate identity and the GitHub OIDC issuer.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const PREDICATE_FILE='t13-slsa-provenance.json';
const SBOM_FILE='t13-sbom.cdx.json';
const VERIFIED_SLSA='t13-verified-slsa.jsonl';
const VERIFIED_SBOM='t13-verified-sbom.jsonl';
const SLSA_TYPE='https://slsa.dev/provenance/v1';
const SBOM_TYPE='https://cyclonedx.org/bom';
const workflowPath='.github/workflows/t13-certified-release.yml';
const sha256=b=>createHash('sha256').update(b).digest('hex');
function fail(code){throw Error(code);}
function exactly(value,re){if(typeof value!=='string'||!re.test(value))fail('T13_INVALID_ATTESTATION_RUNTIME_INPUT');return value;}
function identity(){
 const repository=exactly(process.env.GITHUB_REPOSITORY,/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
 const commit=exactly(process.env.GITHUB_SHA,/^[a-f0-9]{40}$/);
 const imageRef=exactly(process.env.IMAGE_REF,/^ghcr\.io\/[a-z0-9_.\/-]+@sha256:[a-f0-9]{64}$/);
 const digest=imageRef.split('@')[1].slice(7);
 if(imageRef.split('@')[0]!==('ghcr.io/'+repository.toLowerCase()))fail('T13_ATTESTATION_IMAGE_REPOSITORY_MISMATCH');
 return {repository,commit,imageRef,digest};
}
function provenance(env){
 const run=exactly(env.GITHUB_RUN_ID,/^[1-9][0-9]*$/);
 const attempt=exactly(env.GITHUB_RUN_ATTEMPT,/^[1-9][0-9]*$/);
 if(env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main')
  fail('T13_NON_MANUAL_MAIN_PROVENANCE');
 const {repository,commit}=identity();
 return {
  buildDefinition:{
   buildType:'https://actions.github.io/buildtypes/workflow/v1',
   externalParameters:{workflow:{
    ref:'refs/heads/main',repository:'https://github.com/'+repository,path:workflowPath}},
   internalParameters:{github:{event_name:'workflow_dispatch',
    repository_id:env.GITHUB_REPOSITORY_ID??'',runner_environment:'github-hosted'}},
   resolvedDependencies:[{uri:'git+https://github.com/'+repository+'@refs/heads/main',
    digest:{gitCommit:commit}}],
  },
  runDetails:{
   builder:{id:'https://github.com/'+repository+'/'+workflowPath+'@refs/heads/main'},
   metadata:{invocationId:'https://github.com/'+repository+'/actions/runs/'+run+'/attempts/'+attempt},
  },
 };
}
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 return value;
}
function same(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
function toEntries(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.length>16_000_000)fail('T13_EMPTY_OR_OVERSIZED_VERIFIED_ATTESTATION');
 const input=raw.trim();
 try{
  const parsed=JSON.parse(input);
  return Array.isArray(parsed)?parsed:[parsed];
 }catch{
  try{return input.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  catch{fail('T13_VERIFIED_ATTESTATION_JSON_INVALID');}
 }
}
function statement(item){
 if(item&&typeof item==='object'&&item.predicateType&&item.subject)return item;
 const payload=item?.payload??item?.dsseEnvelope?.payload??item?.envelope?.payload;
 if(typeof payload!=='string'||!/^[A-Za-z0-9+/=]+$/.test(payload))
  fail('T13_VERIFIED_DSSE_PAYLOAD_MISSING');
 let parsed;
 try{parsed=JSON.parse(Buffer.from(payload,'base64').toString('utf8'));}
 catch{fail('T13_VERIFIED_DSSE_PAYLOAD_INVALID');}
 return parsed;
}
function getStatements(raw,expectedType,{imageRef,digest}){
 const items=toEntries(raw);
 if(items.length===0||items.length>30)fail('T13_VERIFIED_ATTESTATION_COUNT_INVALID');
 const matching=[];
 for(const item of items){
  const s=statement(item);
  if(s.predicateType!==expectedType)continue;
  if(!['https://in-toto.io/Statement/v1','https://in-toto.io/Statement/v0.1'].includes(s._type))
   fail('T13_ATTESTATION_STATEMENT_TYPE_INVALID');
  if(!Array.isArray(s.subject)||!s.subject.some(sub=>
   (sub.name===imageRef.split('@')[0]||sub.name===imageRef)&&
   sub.digest?.sha256===digest))
   fail('T13_ATTESTATION_SUBJECT_MISMATCH');
  matching.push(s);
 }
 if(!matching.length)fail('T13_REQUIRED_SIGNED_ATTESTATION_MISSING:'+expectedType);
 return matching;
}
function verify({slsa,sbom,seal=false,expectedInvocation}){
 const id=identity();
 const claims=getStatements(slsa,SLSA_TYPE,id);
 const matched=claims.some(stmt=>{
  const predicate=stmt.predicate;
  if(!predicate||predicate.buildDefinition?.buildType!=='https://actions.github.io/buildtypes/workflow/v1')return false;
  if(predicate.buildDefinition.externalParameters?.workflow?.path!==workflowPath||
   predicate.buildDefinition.externalParameters.workflow.repository!=='https://github.com/'+id.repository||
   predicate.buildDefinition.externalParameters.workflow.ref!=='refs/heads/main')return false;
  if(!predicate.buildDefinition.resolvedDependencies?.some(d=>d.digest?.gitCommit===id.commit&&
    d.uri==='git+https://github.com/'+id.repository+'@refs/heads/main'))return false;
  if(predicate.runDetails?.builder?.id!==
    'https://github.com/'+id.repository+'/'+workflowPath+'@refs/heads/main')return false;
  if(expectedInvocation&&predicate.runDetails?.metadata?.invocationId!==expectedInvocation)return false;
  if(seal){
   const local=JSON.parse(fs.readFileSync(PREDICATE_FILE,'utf8'));
   return same(predicate,local);
  }
  return true;
 });
 if(!matched)fail('T13_VERIFIED_SLSA_SOURCE_OR_PREDICATE_MISMATCH');
 const sbomClaims=getStatements(sbom,SBOM_TYPE,id);
 const validSbom=sbomClaims.some(stmt=>{
  const p=stmt.predicate;
  return p?.bomFormat==='CycloneDX'&&typeof p.specVersion==='string'&&
   (!seal||same(p,JSON.parse(fs.readFileSync(SBOM_FILE,'utf8'))));
 });
 if(!validSbom)fail('T13_VERIFIED_CYCLONEDX_PREDICATE_MISMATCH');
 return {status:'T13_OCI_COSIGN_ATTESTATIONS_VERIFIED',
  imageRef:id.imageRef,commit:id.commit,
  provenancePredicateType:SLSA_TYPE,sbomPredicateType:SBOM_TYPE,
  ...(seal?{provenanceSha256:sha256(fs.readFileSync(PREDICATE_FILE)),
   sbomSha256:sha256(fs.readFileSync(SBOM_FILE))}:{}),
  deploymentAuthorized:false};
}
function selfTest(){
 const old={...process.env};
 Object.assign(process.env,{GITHUB_REPOSITORY:'faabio3131/ai-sales-saas-vendedor-ia',
  GITHUB_SHA:'a'.repeat(40),IMAGE_REF:'ghcr.io/faabio3131/ai-sales-saas-vendedor-ia@sha256:'+'b'.repeat(64),
  GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main'});
 const pred=provenance(process.env);
 const sbom={bomFormat:'CycloneDX',specVersion:'1.5',components:[]};
 function record(type,predicate){
  const statement={_type:'https://in-toto.io/Statement/v1',
   subject:[{name:'ghcr.io/faabio3131/ai-sales-saas-vendedor-ia',
    digest:{sha256:'b'.repeat(64)}}],predicateType:type,predicate};
  return JSON.stringify({payload:Buffer.from(JSON.stringify(statement)).toString('base64')});
 }
 const slsa=record(SLSA_TYPE,pred),bom=record(SBOM_TYPE,sbom);
 assert.equal(verify({slsa,sbom:bom}).status,'T13_OCI_COSIGN_ATTESTATIONS_VERIFIED');
 assert.equal(verify({slsa,sbom:bom,expectedInvocation:pred.runDetails.metadata.invocationId}).status,'T13_OCI_COSIGN_ATTESTATIONS_VERIFIED');
 assert.throws(()=>verify({slsa,sbom:bom,expectedInvocation:pred.runDetails.metadata.invocationId+'/different'}));
 const reject=obj=>assert.throws(()=>verify({slsa,sbom:bom,...obj}));
 reject({slsa:''});
 reject({slsa:record('https://other.test',pred)});
 reject({slsa:record(SLSA_TYPE,{...pred,runDetails:{builder:{id:'forged'}}})});
 reject({slsa:record(SLSA_TYPE,{...pred,buildDefinition:{
  ...pred.buildDefinition,resolvedDependencies:[{uri:'forged',digest:{gitCommit:'c'.repeat(40)}}]}})});
 reject({sbom:record(SBOM_TYPE,{bomFormat:'SPDX',specVersion:'1.5'})});
 reject({sbom:record(SBOM_TYPE,{...sbom,components:[],specVersion:3})});
 process.env.IMAGE_REF='ghcr.io/faabio3131/ai-sales-saas-vendedor-ia@sha256:'+'c'.repeat(64);
 reject({});
 process.env=old;
 console.log('t13_private_registry_attestation_self_test_passed');
}
if(process.argv.includes('--self-test'))selfTest();
else if(process.argv.includes('--prepare')){
 const obj=provenance(process.env);
 fs.writeFileSync(PREDICATE_FILE,JSON.stringify(obj,null,2)+'\n');
 console.log('t13_slsa_v1_predicate_prepared:'+obj.buildDefinition.resolvedDependencies[0].digest.gitCommit);
}else if(process.argv.includes('--verify-seal')||process.argv.includes('--verify-deploy')){
 const mode=process.argv.includes('--verify-seal')?'seal':'deploy';
 const expectedInvocation=mode==='deploy'?
  'https://github.com/'+identity().repository+'/actions/runs/'+
  exactly(process.env.T13_SEAL_RUN_ID,/^[1-9][0-9]{0,15}$/)+'/attempts/'+
  exactly(process.env.T13_SEAL_RUN_ATTEMPT,/^[1-9][0-9]{0,5}$/):undefined;
 const checked=verify({
  expectedInvocation,
  slsa:fs.readFileSync(VERIFIED_SLSA,'utf8'),
  sbom:fs.readFileSync(VERIFIED_SBOM,'utf8'),
  seal:mode==='seal',
 });
 fs.writeFileSync('t13-verified-oci-attestations.json',JSON.stringify(checked,null,2)+'\n');
 console.log(JSON.stringify(checked));
}else fail('T13_OCI_ATTESTATION_MODE_REQUIRED');
