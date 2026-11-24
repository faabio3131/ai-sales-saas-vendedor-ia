/** Fresh external review of the exact candidate, owner-attested, never a
 * cryptographic Gemini identity. Separate human environment approval remains mandatory.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const REPO='faabio3131/ai-sales-saas-vendedor-ia';
const OWNER='faabio3131';
const OWNER_ID=134972286;
const SHA=/^[a-f0-9]{40}$/;
const ID=/^[1-9][0-9]{0,15}$/;
export const FRESH_AUDIT_MARKER='T13-DIRECTOR-TRANSCRIBED-GEMINI-AUDIT/V2';
const SIGNOFF='T13-DIRECTOR-SIGNED-RELEASE-ATTESTATION/V2';
function fail(code){throw Error(code);}
function owner(u){return u?.login===OWNER&&u?.id===OWNER_ID;}
function timestamp(x){return typeof x==='string'&&Number.isFinite(Date.parse(x));}
function authentic(c){
 return owner(c?.user)&&c.author_association==='OWNER'&&
  Number.isSafeInteger(c.id)&&c.id>0&&timestamp(c.created_at)&&c.updated_at===c.created_at;
}
function digest(body){return createHash('sha256').update(body,'utf8').digest('hex');}
export function freshSignoffBody(report,hash){
 return [SIGNOFF,'repository='+REPO,'pull-request='+report.pullRequest,
  'audited-head='+report.auditedHead,'audited-base='+report.auditedBase,
  'candidate-ci-run='+report.candidateCiRunId,'candidate-ci-attempt='+report.candidateCiAttempt,
  'evidence-sha256='+hash,'decision=AUTHORIZE_SIGNED_OCI_RELEASE_ONLY',
  'production-deploy=NOT_AUTHORIZED','commercial-go-live=NOT_AUTHORIZED'].join('\n');
}
export function verifyFreshDirectorAudit(input){
 const {repository,actor,eventName,environmentName,environment,currentPr:p,freshAudit:a}=input;
 if(repository!==REPO||actor!==OWNER||eventName!=='workflow_dispatch'||
  !['t13-release-signing','t13-production-approval'].includes(environmentName)||
  environment?.name!==environmentName||
  !Number.isSafeInteger(environment?.id)||environment.id<=0||
  !environment.protection_rules?.some(r=>r.type==='required_reviewers'&&
    r.reviewers?.some(x=>x.type==='User'&&owner(x.reviewer))))
  fail('T13_FRESH_DIRECTOR_PROTECTED_ENV_REQUIRED');
 if(!p?.merged||!owner(p.user)||!Number.isSafeInteger(p.number)||p.number<=0||
  p.base?.ref!=='main'||p.base?.repo?.full_name!==REPO||p.head?.repo?.full_name!==REPO||
  !SHA.test(p.head?.sha??'')||!SHA.test(p.merge_commit_sha??'')||!timestamp(p.merged_at))
  fail('T13_FRESH_PR_IDENTITY_INVALID');
 const {comments,files,candidateRuns,headCommit,mergeCommit}=a??{};
 if(!Array.isArray(comments)||comments.length>=100||comments.length!==p.comments||
  !Array.isArray(files)||files.length<1||files.length>=100||files.length!==p.changed_files||
  files.some(x=>typeof x.filename!=='string'||!x.filename||x.filename.length>400)||
  new Set(files.map(x=>x.filename)).size!==files.length)
  fail('T13_FRESH_AUDIT_SCOPE_UNVERIFIABLE');
 if(headCommit?.sha!==p.head.sha||mergeCommit?.sha!==p.merge_commit_sha||
  !SHA.test(headCommit?.tree?.sha??'')||headCommit.tree.sha!==mergeCommit?.tree?.sha||
  !SHA.test(mergeCommit?.parents?.[0]?.sha??''))
  fail('T13_FRESH_MERGED_TREE_MISMATCH');
 const reports=comments.filter(c=>c?.body?.startsWith(FRESH_AUDIT_MARKER+'\n'));
 if(reports.length!==1||!authentic(reports[0])||
  reports[0].body.length>40000||Date.parse(reports[0].created_at)>Date.parse(p.merged_at))
  fail('T13_FRESH_AUDIT_REPORT_MISSING_OR_AMBIGUOUS');
 let r;
 try{r=JSON.parse(reports[0].body.slice(FRESH_AUDIT_MARKER.length+1));}catch{fail('T13_FRESH_REPORT_INVALID_JSON');}
 if(!r||r.repository!==REPO||r.pullRequest!==p.number||
  r.auditedHead!==p.head.sha||r.auditedBase!==mergeCommit.parents[0].sha||
  typeof r.candidateCiRunId!=='string'||!ID.test(r.candidateCiRunId)||
  !Number.isSafeInteger(r.candidateCiAttempt)||r.candidateCiAttempt<1||
  r.auditor!=='Gemini'||r.verdict!=='APPROVED_FOR_MERGE'||
  r.findings?.critical!==0||r.findings?.high!==0||r.findings?.medium!==0||
  r.productionDeploymentAuthorized!==false||r.commercialActivationAuthorized!==false||
  typeof r.report!=='string'||r.report.trim().length<300||r.report.length>30000||
  !Array.isArray(r.auditedFiles)||r.auditedFiles.some(x=>typeof x!=='string')||
  JSON.stringify([...r.auditedFiles].sort())!==JSON.stringify(files.map(x=>x.filename).sort()))
  fail('T13_FRESH_REPORT_SCOPE_OR_VERDICT_MISMATCH');
 if(!Array.isArray(candidateRuns?.workflow_runs)||
  candidateRuns.total_count!==candidateRuns.workflow_runs.length||candidateRuns.total_count>=100)
  fail('T13_FRESH_CANDIDATE_CI_LIST_UNVERIFIABLE');
 const ci=candidateRuns.workflow_runs.filter(x=>String(x.id)===r.candidateCiRunId);
 if(ci.length!==1||ci[0].run_attempt!==r.candidateCiAttempt||
  ci[0].head_sha!==p.head.sha||ci[0].event!=='pull_request'||
  ci[0].name!=='Project Validation'||ci[0].path!=='.github/workflows/blk010-validation.yml'||
  ci[0].status!=='completed'||ci[0].conclusion!=='success'||
  ci[0].repository?.full_name!==REPO||ci[0].head_repository?.full_name!==REPO||
  !timestamp(ci[0].updated_at)||Date.parse(ci[0].updated_at)>Date.parse(reports[0].created_at))
  fail('T13_FRESH_EXACT_CANDIDATE_CI_REQUIRED');
 const hash=digest(reports[0].body);
 const signoffs=comments.filter(c=>c?.body?.startsWith(SIGNOFF+'\n'));
 if(signoffs.length!==1||!authentic(signoffs[0])||
  signoffs[0].body!==freshSignoffBody(r,hash)||
  Date.parse(signoffs[0].created_at)<Date.parse(reports[0].created_at))
  fail('T13_FRESH_DIRECTOR_SIGNOFF_INVALID');
 return Object.freeze({
  status:'DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY',
  directorCommentId:signoffs[0].id,
  auditorProof:'OWNER_ATTESTED_EXTERNAL_GEMINI_REPORT_NOT_CRYPTOGRAPHICALLY_SIGNED',
  auditKind:'FRESH_EXACT_PR_V2',auditEvidenceSha256:hash,
  auditedHeadSha:p.head.sha,auditBaseSha:r.auditedBase,governanceHeadSha:p.head.sha,
  deploymentAuthorized:false,commercialGoLiveApproved:false,
 });
}
export function freshDirectorAuditSelfTest(){
 const u={login:OWNER,id:OWNER_ID},repo={full_name:REPO};
 const head='a'.repeat(40),base='b'.repeat(40),merge='c'.repeat(40),tree='d'.repeat(40);
 const p={number:36,user:u,merged:true,merged_at:'2026-11-24T15:00:00Z',comments:2,changed_files:1,
  head:{sha:head,repo},base:{ref:'main',repo},merge_commit_sha:merge};
 const report={repository:REPO,pullRequest:36,auditedHead:head,auditedBase:base,candidateCiRunId:'1234',
  candidateCiAttempt:1,auditor:'Gemini',verdict:'APPROVED_FOR_MERGE',findings:{critical:0,high:0,medium:0},
  productionDeploymentAuthorized:false,commercialActivationAuthorized:false,auditedFiles:['deploy/test.sh'],
  report:'Fixture independent audit report. '.repeat(15)};
 const mk=(r,override={})=>{
  const body=FRESH_AUDIT_MARKER+'\n'+JSON.stringify(r);
  const c={id:101,user:u,author_association:'OWNER',created_at:'2026-11-24T14:00:00Z',updated_at:'2026-11-24T14:00:00Z'};
  return [{...c,body,...override},{...c,id:102,body:freshSignoffBody(r,digest(body))}];
 };
 const env={id:42,name:'t13-release-signing',protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:u}]}]};
 const ci={id:1234,run_attempt:1,head_sha:head,event:'pull_request',name:'Project Validation',
  path:'.github/workflows/blk010-validation.yml',status:'completed',conclusion:'success',
  repository:repo,head_repository:repo,updated_at:'2026-11-24T13:30:00Z'};
 const a={comments:mk(report),files:[{filename:'deploy/test.sh'}],
  candidateRuns:{total_count:1,workflow_runs:[ci]},headCommit:{sha:head,tree:{sha:tree}},
  mergeCommit:{sha:merge,tree:{sha:tree},parents:[{sha:base}]}};
 const input={repository:REPO,actor:OWNER,eventName:'workflow_dispatch',environmentName:env.name,
  environment:env,currentPr:p,freshAudit:a};
 assert.equal(verifyFreshDirectorAudit(input).auditKind,'FRESH_EXACT_PR_V2');
 assert.equal(verifyFreshDirectorAudit(input).deploymentAuthorized,false);
 for(const patch of [
  {comments:mk({...report,auditedHead:'e'.repeat(40)})},
  {comments:mk({...report,auditedBase:'e'.repeat(40)})},
  {comments:mk({...report,auditedFiles:['other']})},
  {comments:mk({...report,findings:{critical:0,high:1,medium:0}})},
  {comments:mk({...report,productionDeploymentAuthorized:true})},
  {comments:mk(report,{user:{login:OWNER,id:999}})},
  {comments:mk(report,{updated_at:'2026-11-24T14:01:00Z'})},
  {comments:mk(report,{created_at:'2026-11-24T16:00:00Z',updated_at:'2026-11-24T16:00:00Z'})},
  {comments:[a.comments[0],{...a.comments[1],body:'wrong'}]},
  {candidateRuns:{total_count:1,workflow_runs:[{...ci,conclusion:'failure'}]}},
  {candidateRuns:{total_count:1,workflow_runs:[{...ci,run_attempt:2}]}},
  {mergeCommit:{...a.mergeCommit,tree:{sha:'e'.repeat(40)}}},
  {files:[]},
 ])assert.throws(()=>verifyFreshDirectorAudit({...input,freshAudit:{...a,...patch}}));
 assert.throws(()=>verifyFreshDirectorAudit({...input,environment:{...env,protection_rules:[]}}));
 assert.throws(()=>verifyFreshDirectorAudit({...input,actor:'other'}));
 console.info('t13_fresh_exact_external_review_self_test_passed');
}
