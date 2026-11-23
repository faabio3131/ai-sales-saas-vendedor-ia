/** Alternative T13 SEAL-only governance for owner-operated private repositories.
 * Historical Gemini audit is an OWNER-ATTESTED external report, not a fake
 * GitHub reviewer or cryptographic Gemini signature. No deploy is authorized.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

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
export function verifyDirectorAuditPackage({
 repository,actor,eventName,environmentName,environment,
 currentPr,sourcePr,sourceCiRuns,comments,evidenceText,changedFiles,
}){
 if(repository!==T13_REPO||actor!==T13_OWNER||eventName!=='workflow_dispatch')
  fail('T13_DIRECTOR_AUTHENTICATED_DISPATCH_REQUIRED');
 if(environmentName!=='t13-release-signing'||environment?.name!==environmentName)
  fail('T13_DIRECTOR_SEAL_ENVIRONMENT_REQUIRED');
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
export function verifiedChangedFiles(sha){
 assert.match(sha,/^[a-f0-9]{40}$/);
 try{
  execFileSync('git',['merge-base','--is-ancestor',T13_BASE_MERGE,sha],
   {stdio:'pipe',timeout:10000});
  const output=execFileSync('git',['diff','--name-only','--no-renames',
   T13_BASE_MERGE,sha],{encoding:'utf8',timeout:10000});
  return output.trim().split('\n').filter(Boolean);
 }catch{fail('T13_VERIFIED_HISTORY_OR_DIFF_UNAVAILABLE');}
}
export function policyEvidenceText(){
 return fs.readFileSync(EVIDENCE_PATH,'utf8');
}
export function directorAuditSelfTest(){
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
 const revised=JSON.parse(exampleText);
 revised.declaredFindings.high=1;
 reject({evidenceText:JSON.stringify(revised)});
 console.info('t13_director_attested_gemini_policy_self_test_passed');
 console.info('t13_director_gemini_evidence_sha256:'+digest);
}
