/** T13 owner-operated governance. Historical Gemini audit is OWNER-ATTESTED,
 * not a GitHub reviewer or cryptographic Gemini signature. Production requires
 * separate, exact native environment approval; a seal never authorizes deploy.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyFreshDirectorAudit,freshDirectorAuditSelfTest} from './t13FreshDirectorAudit.mjs';

export const T13_BASE_MERGE='dbe52a89c3214d7f40b1f66924bcbb1a90e017eb';
export const T13_AUDITED_HEAD='a0e335dba1884fb398aea13c8435cd28f98436a9';
export const T13_REPO='faabio3131/ai-sales-saas-vendedor-ia';
export const T13_OWNER='faabio3131';
export const EVIDENCE_PATH='certification/t13-gemini-owner-transcribed-audit.json';
const GROUPS=[
 '01_AI_GOVERNANCA','02_PAGAMENTOS','03_FISCAL_AGENDAMENTO_VAREJO',
 '04_RESTANTE_SRC_PARTES_01_A_11','05_TESTES_T13_PARTES_01_A_03',
 '06_SCRIPTS_SEGURANCA_CI_DEPLOY_PARTES_01_A_02',
];
const POLICY_ONLY_FILES=new Set([
 EVIDENCE_PATH,
 'scripts/t13DirectorAuditPolicy.mjs',
 'scripts/t13ReleaseGate.mjs',
 'scripts/t13WorkflowGate.mjs',
 'scripts/t13SealedReleaseManifest.mjs',
 'scripts/t13RegistryAttestationGate.mjs',
 '.github/workflows/t13-certified-release.yml',
 '.github/workflows/t13-controlled-deploy.yml',
 '.github/workflows/blk010-validation.yml',
 'certification/T13_DIRECTOR_GEMINI_RELEASE_POLICY.md',
]);
function fail(code){throw Error(code);}
export const evidenceSha256=(text)=>createHash('sha256').update(text,'utf8').digest('hex');
export function directorSignoffBody({policyHead,evidenceDigest}){
 assert.match(policyHead,/^[a-f0-9]{40}$/);
 assert.match(evidenceDigest,/^[a-f0-9]{64}$/);
 return [
  'T13-DIRECTOR-SIGNED-RELEASE-ATTESTATION/V1',
  'repository='+T13_REPO,
  'independent-audit=Gemini-reported-by-project-director',
  'audited-head='+T13_AUDITED_HEAD,
  'audited-main-merge='+T13_BASE_MERGE,
  'governance-pr-head='+policyHead,
  'evidence-sha256='+evidenceDigest,
  'decision=AUTHORIZE_SIGNED_OCI_RELEASE_ONLY',
  'production-deploy=NOT_AUTHORIZED',
  'commercial-go-live=NOT_AUTHORIZED',
 ].join('\n');
}
function verifyDirectorAuditEvidence({
 repository,actor,eventName,
 currentPr,sourcePr,sourceCiRuns,comments,evidenceText,changedFiles,
}){
 if(repository!==T13_REPO||actor!==T13_OWNER||eventName!=='workflow_dispatch')
  fail('T13_DIRECTOR_AUTHENTICATED_DISPATCH_REQUIRED');
 if(!currentPr?.merged||currentPr?.base?.ref!=='main'||
    currentPr?.user?.login!==T13_OWNER||typeof currentPr.head?.sha!=='string')
  fail('T13_GOVERNANCE_MERGE_NOT_VERIFIED');
 if(!sourcePr?.merged||sourcePr?.number!==29||
    sourcePr?.base?.ref!=='main'||sourcePr?.user?.login!==T13_OWNER||
    sourcePr?.head?.sha!==T13_AUDITED_HEAD||
    sourcePr?.merge_commit_sha!==T13_BASE_MERGE||
    !sourcePr?.merged_at)
  fail('T13_ORIGINAL_AUDITED_MERGE_NOT_VERIFIED');
 if(!Array.isArray(sourceCiRuns?.workflow_runs)||!sourceCiRuns.workflow_runs.some(x=>
    x.head_sha===T13_BASE_MERGE&&x.event==='push'&&x.status==='completed'&&
    x.conclusion==='success'&&x.name==='Project Validation'))
  fail('T13_ORIGINAL_POSTMERGE_CI_NOT_CERTIFIED');
 if(typeof evidenceText!=='string'||evidenceText.length<800||evidenceText.length>20000)
  fail('T13_GEMINI_EVIDENCE_MISSING');
 let evidence;
 try{evidence=JSON.parse(evidenceText);}catch{fail('T13_GEMINI_EVIDENCE_INVALID');}
 if(evidence.schema!=='atendevende.t13.external-audit-owner-transcript/v1'||
    evidence.repository!==T13_REPO||evidence.auditedPullRequest!==29||
    evidence.auditedSourceHeadSha!==T13_AUDITED_HEAD||
    evidence.auditedMainMergeSha!==T13_BASE_MERGE||
    evidence.directorOwnerLogin!==T13_OWNER||
    evidence.status!=='EXTERNAL_REPORT_OWNER_ATTESTED'||
    evidence.verdict!=='APPROVED_FOR_MERGE_WITH_NON_BLOCKING_LOW_RISK_RESERVATIONS'||
    evidence.productionDeploymentAuthorized!==false||
    evidence.commercialActivationAuthorized!==false||
    evidence.declaredFindings?.critical!==0||
    evidence.declaredFindings?.high!==0||
    evidence.declaredFindings?.medium!==0||
    JSON.stringify(evidence.auditedGroups)!==JSON.stringify(GROUPS))
  fail('T13_EXTERNAL_AUDIT_DECLARATION_MISMATCH');
 if(!Array.isArray(changedFiles)||changedFiles.length===0||
    !changedFiles.includes('scripts/t13ReleaseGate.mjs')||
    changedFiles.some(path=>!POLICY_ONLY_FILES.has(path)))
  fail('T13_UNAUDITED_APPLICATION_CODE_DIFF');
 // No future policy-only change is approved implicitly: the current PR HEAD
 // must match the director's attestation exactly.
 const digest=evidenceSha256(evidenceText);
 const expectedBody=directorSignoffBody({policyHead:currentPr.head.sha,evidenceDigest:digest});
 if(!Array.isArray(comments)||comments.length>=100)fail('T13_DIRECTOR_COMMENTS_UNVERIFIABLE');
 const matches=comments.filter(c=>
  c?.user?.login===T13_OWNER&&c?.author_association==='OWNER'&&
  c?.body?.trim()===expectedBody&&c.created_at===c.updated_at&&
  typeof c.created_at==='string'&&Number.isFinite(Date.parse(c.created_at))&&
  Number.isSafeInteger(c.id)&&c.id>0);
 if(matches.length!==1)fail('T13_DIRECTOR_GITHUB_SIGNOFF_MISSING_OR_AMBIGUOUS');
 return Object.freeze({
  status:'DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY',
  directorCommentId:matches[0].id,
  auditorProof:'OWNER_ATTESTED_EXTERNAL_GEMINI_REPORT_NOT_CRYPTOGRAPHICALLY_SIGNED',
  auditEvidenceSha256:digest,
  auditedHeadSha:T13_AUDITED_HEAD,
  originalMergeSha:T13_BASE_MERGE,
  governanceHeadSha:currentPr.head.sha,
  deploymentAuthorized:false,
 });
}
export function verifyDirectorAuditPackage(input){
 if(input.environmentName!=='t13-release-signing'||input.environment?.name!==input.environmentName)
  fail('T13_DIRECTOR_SEAL_ENVIRONMENT_REQUIRED');
 return input.freshAudit?verifyFreshDirectorAudit(input):verifyDirectorAuditEvidence(input);
}
const PRODUCTION_ENV='t13-production-approval';
const OWNER_ID=134972286;
function exact(value,re){
 if(typeof value!=='string'||!re.test(value))fail('T13_PRODUCTION_IDENTITY_INVALID');
 return value;
}
export function verifyProductionSealRun({sealRun,sha,sealRunId,sealRunAttempt,artifacts}){
 exact(sha,/^[a-f0-9]{40}$/);
 exact(sealRunId,/^[1-9][0-9]{0,15}$/);
 exact(sealRunAttempt,/^[1-9][0-9]{0,5}$/);
 if(!sealRun||String(sealRun.id)!==sealRunId||
    String(sealRun.run_attempt)!==sealRunAttempt||
    sealRun.head_sha!==sha||sealRun.head_branch!=='main'||
    sealRun.event!=='workflow_dispatch'||sealRun.status!=='completed'||
    sealRun.conclusion!=='success'||
    sealRun.path!=='.github/workflows/t13-certified-release.yml'||
    sealRun.repository?.full_name!==T13_REPO||
    sealRun.head_repository?.full_name!==T13_REPO)
  fail('T13_PRODUCTION_SUCCESSFUL_EXACT_SEAL_REQUIRED');
 if(!Array.isArray(artifacts?.artifacts)||artifacts.total_count!==artifacts.artifacts.length)
  fail('T13_PRODUCTION_SEAL_ARTIFACT_LIST_UNVERIFIABLE');
 const evidence=artifacts.artifacts.filter(a=>a.name==='t13-oci-sealed-release'&&
  a.expired===false&&a.size_in_bytes>0&&
  a.workflow_run?.head_sha===sha&&String(a.workflow_run?.id)===sealRunId&&
  /^sha256:[a-f0-9]{64}$/.test(a.digest??''));
 if(evidence.length!==1)fail('T13_PRODUCTION_SEAL_ARTIFACT_REQUIRED');
 return true;
}
export function productionApprovalBody({sha,digest,sealRunId,sealRunAttempt,policyHead,evidenceDigest,auditKind}){
 exact(sha,/^[a-f0-9]{40}$/);exact(digest,/^sha256:[a-f0-9]{64}$/);
 exact(sealRunId,/^[1-9][0-9]{0,15}$/);exact(sealRunAttempt,/^[1-9][0-9]{0,5}$/);
 exact(policyHead,/^[a-f0-9]{40}$/);exact(evidenceDigest,/^[a-f0-9]{64}$/);
 return [auditKind==='FRESH_EXACT_PR_V2'?'T13-DIRECTOR-PRODUCTION-APPROVAL/V2':'T13-DIRECTOR-PRODUCTION-APPROVAL/V1','repository='+T13_REPO,
  'commit='+sha,'image-digest='+digest,'seal-run='+sealRunId,
  'seal-attempt='+sealRunAttempt,'governance-pr-head='+policyHead,
  'audit-evidence-sha256='+evidenceDigest,
  auditKind==='FRESH_EXACT_PR_V2'?'policy-review=GEMINI_REVIEWED_EXACT_PR_HEAD':'policy-review=GEMINI_REVIEWED_EXACT_GOVERNANCE_HEAD',
  'decision=AUTHORIZE_CONTROLLED_PRODUCTION_DEPLOY',
  'commercial-go-live=NOT_AUTHORIZED'].join('\n');
}
export function verifyDirectorProductionApproval(input){
 const {environmentName,environment,sha,digest,sealRunId,sealRunAttempt,
  sealRun,artifacts,run,runId,runAttempt,approvals,currentPr}=input;
 const historical=input.freshAudit?verifyFreshDirectorAudit(input):verifyDirectorAuditEvidence(input);
 verifyProductionSealRun({sealRun,sha,sealRunId,sealRunAttempt,artifacts});
 if(environmentName!==PRODUCTION_ENV||environment?.name!==PRODUCTION_ENV||
    !Number.isSafeInteger(environment.id)||environment.id<=0||
    !Array.isArray(environment.protection_rules)||
    !environment.protection_rules.some(rule=>rule.type==='required_reviewers'&&
     Array.isArray(rule.reviewers)&&rule.reviewers.some(r=>r.type==='User'&&
      r.reviewer?.login===T13_OWNER&&r.reviewer?.id===OWNER_ID)))
  fail('T13_PRODUCTION_OWNER_PROTECTED_ENVIRONMENT_REQUIRED');
 exact(runId,/^[1-9][0-9]{0,15}$/);
 // Review history is run-scoped, not attempt-scoped. A retry must be a fresh dispatch.
 if(runAttempt!=='1'||String(run?.id)!==runId||run?.run_attempt!==1||
    run?.head_sha!==sha||run?.head_branch!=='main'||run?.event!=='workflow_dispatch'||
    run?.path!=='.github/workflows/t13-controlled-deploy.yml'||
    run?.repository?.full_name!==T13_REPO||run?.head_repository?.full_name!==T13_REPO||
    run?.actor?.login!==T13_OWNER||run?.actor?.id!==OWNER_ID||
    currentPr.merge_commit_sha!==sha||
    sealRun.actor?.login!==T13_OWNER||sealRun.actor?.id!==OWNER_ID)
  fail('T13_PRODUCTION_FRESH_OWNER_RUN_REQUIRED');
 const expected=productionApprovalBody({sha,digest,sealRunId,sealRunAttempt,
  policyHead:currentPr.head.sha,evidenceDigest:historical.auditEvidenceSha256,auditKind:historical.auditKind});
 if(!Array.isArray(approvals)||approvals.length>100)
  fail('T13_PRODUCTION_REVIEW_HISTORY_UNVERIFIABLE');
 const relevant=approvals.filter(a=>Array.isArray(a.environments)&&
  a.environments.some(e=>e.id===environment.id&&e.name===PRODUCTION_ENV));
 if(relevant.length!==1||relevant[0].state!=='approved'||
    relevant[0].user?.login!==T13_OWNER||relevant[0].user?.id!==OWNER_ID||
    relevant[0].comment?.trim()!==expected)
  fail('T13_PRODUCTION_EXACT_NATIVE_APPROVAL_REQUIRED');
 return Object.freeze({...historical,status:'DIRECTOR_ATTESTED_GEMINI_PRODUCTION_APPROVED',
  deploymentAuthorized:true,productionApprovalRunId:runId,sealRunId,sealRunAttempt,
  imageDigest:digest,commercialGoLiveApproved:false});
}
/** GitHub-sourced comparison, fail-closed if history or complete file list cannot
 * be independently verified. No shell commands or code execution modules.
 */
export function verifiedChangedFiles(compare,sha){
 assert.match(sha,/^[a-f0-9]{40}$/);
 if(!compare||compare.status!=='ahead'||
    compare.base_commit?.sha!==T13_BASE_MERGE||
    compare.merge_base_commit?.sha!==T13_BASE_MERGE||
    !Number.isSafeInteger(compare.ahead_by)||compare.ahead_by<1||
    compare.ahead_by>20||!Array.isArray(compare.files)||
    compare.files.length<1||compare.files.length>=300||
    compare.files.some(x=>typeof x.filename!=='string'||
      x.filename.length<1||x.filename.length>400))
  fail('T13_COMPARE_HISTORY_OR_FILE_LIST_UNVERIFIABLE');
 return compare.files.map(f=>f.filename);
}

export function policyEvidenceText(){
 return fs.readFileSync(EVIDENCE_PATH,'utf8');
}
export function directorAuditSelfTest(){
 freshDirectorAuditSelfTest();
 const exampleText=policyEvidenceText();
 const sha='f'.repeat(40),digest=evidenceSha256(exampleText);
 const currentPr={merged:true,base:{ref:'main'},user:{login:T13_OWNER},
  head:{sha},merge_commit_sha:'d'.repeat(40)};
 const sourcePr={merged:true,number:29,base:{ref:'main'},
  user:{login:T13_OWNER},head:{sha:T13_AUDITED_HEAD},
  merge_commit_sha:T13_BASE_MERGE,merged_at:'2026-11-23T20:16:50Z'};
 const sourceCiRuns={workflow_runs:[{name:'Project Validation',head_sha:T13_BASE_MERGE,
  event:'push',status:'completed',conclusion:'success'}]};
 const comment={id:7100000000,user:{login:T13_OWNER},author_association:'OWNER',
  created_at:'2026-11-23T20:30:00Z',updated_at:'2026-11-23T20:30:00Z',
  body:directorSignoffBody({policyHead:sha,evidenceDigest:digest})};
 const input={repository:T13_REPO,actor:T13_OWNER,eventName:'workflow_dispatch',
  environmentName:'t13-release-signing',environment:{name:'t13-release-signing'},
  currentPr,sourcePr,sourceCiRuns,comments:[comment],
  evidenceText:exampleText,changedFiles:['scripts/t13ReleaseGate.mjs']};
 assert.equal(verifyDirectorAuditPackage(input).status,
  'DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY');
 const reject=(override)=>{
  assert.throws(()=>verifyDirectorAuditPackage({...input,...override}));
 };
 reject({actor:'other'});
 reject({eventName:'push'});
 reject({environmentName:'t13-production-approval'});
 reject({environment:{name:'unknown'}});
 reject({comments:[]});
 reject({comments:[{...comment,user:{login:'attacker'}}]});
 reject({comments:[{...comment,updated_at:'2026-11-23T21:00:00Z'}]});
 reject({comments:[{...comment,author_association:'NONE'}]});
 reject({comments:[{...comment,body:comment.body.replace('NOT_AUTHORIZED','AUTHORIZED')}]});
 reject({currentPr:{...currentPr,head:{sha:'a'.repeat(40)}}});
 reject({sourcePr:{...sourcePr,head:{sha:'c'.repeat(40)}}});
 reject({sourceCiRuns:{workflow_runs:[]}});
 reject({changedFiles:['src/payments/service.ts']});
 reject({changedFiles:['scripts/t13ReleaseGate.mjs','src/pilot/readiness.ts']});
 reject({evidenceText:exampleText.replace('"reviewerDeclared"', '"reviewerMODIFIED"')});
 assert.deepEqual(verifiedChangedFiles({status:'ahead',
  base_commit:{sha:T13_BASE_MERGE},merge_base_commit:{sha:T13_BASE_MERGE},
  ahead_by:2,files:[{filename:'scripts/t13ReleaseGate.mjs'}]},sha),
  ['scripts/t13ReleaseGate.mjs']);
 assert.throws(()=>verifiedChangedFiles({status:'diverged',
  base_commit:{sha:T13_BASE_MERGE},merge_base_commit:{sha:T13_BASE_MERGE},
  ahead_by:2,files:[{filename:'scripts/t13ReleaseGate.mjs'}]},sha));
 const revised=JSON.parse(exampleText);
 revised.declaredFindings.high=1;
 reject({evidenceText:JSON.stringify(revised)});
 // Production approval is native, exact, separate, and cannot be reused on rerun.
 const commit=currentPr.merge_commit_sha, imageDigest='sha256:'+'b'.repeat(64);
 const sealRunId='1234',sealRunAttempt='1',runId='5678';
 const owner={login:T13_OWNER,id:OWNER_ID},repo={full_name:T13_REPO};
 const protectedEnvironment={id:42,name:PRODUCTION_ENV,protection_rules:[
  {type:'required_reviewers',reviewers:[{type:'User',reviewer:owner}]}]};
 const sealRun={id:1234,run_attempt:1,head_sha:commit,head_branch:'main',
  event:'workflow_dispatch',status:'completed',conclusion:'success',
  path:'.github/workflows/t13-certified-release.yml',repository:repo,
  head_repository:repo,actor:owner};
 const artifacts={total_count:1,artifacts:[{name:'t13-oci-sealed-release',expired:false,
  size_in_bytes:100,digest:'sha256:'+'c'.repeat(64),
  workflow_run:{head_sha:commit,id:1234}}]};
 const run={...sealRun,id:5678,path:'.github/workflows/t13-controlled-deploy.yml',status:'in_progress',conclusion:null};
 const approval={state:'approved',user:owner,environments:[{id:42,name:PRODUCTION_ENV}],
  comment:productionApprovalBody({sha:commit,digest:imageDigest,sealRunId,sealRunAttempt,
   policyHead:sha,evidenceDigest:digest})};
 const prod={...input,environmentName:PRODUCTION_ENV,environment:protectedEnvironment,
  sha:commit,digest:imageDigest,sealRunId,sealRunAttempt,sealRun,artifacts,
  run,runId,runAttempt:'1',approvals:[approval]};
 assert.equal(verifyDirectorProductionApproval(prod).deploymentAuthorized,true);
 assert.equal(verifyDirectorProductionApproval(prod).commercialGoLiveApproved,false);
 for(const override of [
  {approvals:[]},{approvals:[{...approval,state:'rejected'}]},
  {approvals:[{...approval,comment:expectedBodyForTest()}]},
  {approvals:[{...approval,user:{login:T13_OWNER,id:999}}]},
  {approvals:[{...approval,environments:[{id:43,name:PRODUCTION_ENV}]}]},
  {approvals:[approval,{...approval,state:'rejected'}]},
  {environment:{...protectedEnvironment,protection_rules:[]}},
  {runAttempt:'2'},{run:{...run,head_sha:'e'.repeat(40)}},
  {digest:'sha256:'+'d'.repeat(64)},{sealRun:{...sealRun,conclusion:'failure'}},
  {sealRun:{...sealRun,path:'.github/workflows/blk010-validation.yml'}},
  {sealRun:{...sealRun,run_attempt:2}},
  {artifacts:{total_count:1,artifacts:[{...artifacts.artifacts[0],expired:true}]}},
  {changedFiles:['scripts/t13ReleaseGate.mjs','src/payments/service.ts']},
  {comments:[]},{actor:'other'},
 ])assert.throws(()=>verifyDirectorProductionApproval({...prod,...override}));
 function expectedBodyForTest(){return comment.body;}
 console.info('t13_director_production_native_approval_self_test_passed');
 console.info('t13_director_attested_gemini_policy_self_test_passed');
 console.info('t13_director_gemini_evidence_sha256:'+digest);
}
