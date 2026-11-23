/** T13 release seal gate. It will NEVER approve a SHA by user input alone.
 * Fails closed without independently recorded GitHub PR review, protected
 * environment, merged exact SHA, and post-merge main CI SUCCESS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyDirectorAuditPackage,policyEvidenceText,verifiedChangedFiles,directorAuditSelfTest,
 T13_BASE_MERGE} from './t13DirectorAuditPolicy.mjs';
const apiRoot='https://api.github.com/';
function requireReady({sha,expected,ref,pr,reviews,runs,environment,environmentName='t13-release-signing',directorApproval}){
 assert.match(sha,/^[a-f0-9]{40}$/);
 assert.equal(sha,expected,'RELEASE_SHA_NOT_EXACT');
 assert.equal(ref,'refs/heads/main','RELEASE_ONLY_FROM_MAIN');
 assert.equal(pr.merged,true,'RELEASE_PR_NOT_MERGED');
 assert.equal(pr.base?.ref,'main','RELEASE_PR_TARGET_NOT_MAIN');
 assert.equal(pr.merge_commit_sha,sha,'RELEASE_MERGE_SHA_MISMATCH');
 const effective=new Map();
 for(const r of reviews){
  if(!r.user?.login||!r.submitted_at)continue;
  const prior=effective.get(r.user.login);
  if(!prior||Date.parse(r.submitted_at)>=Date.parse(prior.submitted_at))
   effective.set(r.user.login,r);
 }
 const reviewed=[...effective.values()].some(r=>r.state==='APPROVED'&&
   r.user.login!==pr.user?.login&&r.commit_id===pr.head?.sha);
 const protectedEnv=Array.isArray(environment?.protection_rules)&&
  environment.protection_rules.some(rule=>rule.type==='required_reviewers'&&
   Array.isArray(rule.reviewers)&&rule.reviewers.length>0);
 if(environment?.name!==environmentName)
  throw Error('RELEASE_EXPECTED_ENVIRONMENT_MISSING');
 // The only alternative to a GitHub third-party APPROVED is an authenticated
 // owner signoff bound to the external Gemini report AND unchanged audited src.
 // It is restricted to IMAGE SIGNING, never production deployment.
 if(!(reviewed&&protectedEnv)&&
    !(environmentName==='t13-release-signing'&&
      directorApproval?.status==='DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY'&&
      directorApproval.deploymentAuthorized===false))
  throw Error('RELEASE_INDEPENDENT_REVIEW_OR_DIRECTOR_ATTESTATION_REQUIRED');
 if(!Array.isArray(runs.workflow_runs)||!runs.workflow_runs.some(run=>
   run.head_sha===sha&&run.event==='push'&&run.status==='completed'&&
   run.conclusion==='success'&&run.name==='Project Validation'))
  throw Error('RELEASE_POST_MERGE_CI_NOT_CERTIFIED');

 return true;
}
function discoverMergedPull(associated,sha) {
 if(!Array.isArray(associated))throw Error('RELEASE_COMMIT_ASSOCIATED_PRS_INVALID');
 const matches=associated.filter(p=>
  Number.isSafeInteger(p?.number)&&p.number>0&&
  p?.merge_commit_sha===sha&&p?.base?.ref==='main'&&
  typeof p.merged_at==='string'&&Number.isFinite(Date.parse(p.merged_at)));
 if(matches.length!==1)throw Error('RELEASE_MERGED_PULL_ASSOCIATION_NOT_UNIQUE');
 return matches[0].number;
}
if(process.argv.includes('--self-test')){
 const sha='a'.repeat(40);
 const pr={merged:true,base:{ref:'main'},merge_commit_sha:sha,
  head:{sha:'b'.repeat(40)},user:{login:'author'}};
 const reviews=[{user:{login:'reviewer'},state:'APPROVED',commit_id:pr.head.sha,
  submitted_at:'2026-11-22T10:00:00Z'}];
 const runs={workflow_runs:[{head_sha:sha,event:'push',status:'completed',
  conclusion:'success',name:'Project Validation'}]};
 const environment={name:'t13-release-signing',protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',id:123}]}]};
 const input={sha,expected:sha,ref:'refs/heads/main',pr,reviews,runs,environment};
 assert.equal(requireReady(input),true);
 directorAuditSelfTest();
 const ownerMode={status:'DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY',deploymentAuthorized:false};
 assert.equal(requireReady({...input,reviews:[],environment:{name:'t13-release-signing',
  protection_rules:[]},directorApproval:ownerMode}),true);
 assert.throws(()=>requireReady({...input,reviews:[],environmentName:'t13-production-approval',
  environment:{name:'t13-production-approval',protection_rules:[]},
  directorApproval:ownerMode}));
 const associated=[{...pr,number:37,merged_at:'2026-11-22T11:00:00Z'}];
 assert.equal(discoverMergedPull(associated,sha),37);
 assert.throws(()=>discoverMergedPull(associated,'c'.repeat(40)));
 assert.throws(()=>discoverMergedPull([...associated,...associated],sha));
 assert.throws(()=>discoverMergedPull([{...associated[0],merged_at:null}],sha));
 assert.throws(()=>discoverMergedPull([{...associated[0],base:{ref:'dev'}}],sha));
 assert.throws(()=>requireReady({...input,pr:{...pr,merge_commit_sha:'c'.repeat(40)}}));
 assert.throws(()=>requireReady({...input,reviews:[]}));
 assert.throws(()=>requireReady({...input,environment:{name:'t13-release-signing',protection_rules:[]}}));
 assert.throws(()=>requireReady({...input,runs:{workflow_runs:[]}}));
 console.log('t13_release_guard_self_test_passed');
 process.exit(0);
}
if(!process.argv.includes('--verify'))throw Error('RELEASE_GUARD_MODE_REQUIRED');
const sha=process.env.GITHUB_SHA;
const expected=process.env.T13_EXPECTED_SHA;
const ref=process.env.GITHUB_REF;
const repo=process.env.GITHUB_REPOSITORY;
const token=process.env.GITHUB_TOKEN;
if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo??'')||
 !token||token.length<10)throw Error('RELEASE_GITHUB_IDENTITY_REQUIRED');
async function github(endpoint){
 const response=await fetch(apiRoot+endpoint,{
  headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28'},
  signal:AbortSignal.timeout(15000),
 });
 if(!response.ok)throw Error('RELEASE_GITHUB_APPROVAL_CHECK_FAILED:'+response.status);
 return response.json();
}
const targetEnvironment=process.env.T13_REVIEW_ENVIRONMENT??'t13-release-signing';
if(!['t13-release-signing','t13-production-approval'].includes(targetEnvironment))
 throw Error('RELEASE_ENVIRONMENT_NOT_ALLOWLISTED');
// GitHub's commit-to-PR association is only a discovery hint.
// The final selected PR must be merged, target main, match this merge SHA,
// and carry a non-author approval of its exact final source head.
const associated=await github('repos/'+repo+'/commits/'+sha+'/pulls?per_page=100');
const pullNumber=discoverMergedPull(associated,sha);
const [pr,reviews,runs,environment]=await Promise.all([
 github('repos/'+repo+'/pulls/'+pullNumber),
 github('repos/'+repo+'/pulls/'+pullNumber+'/reviews?per_page=100'),
 github('repos/'+repo+'/actions/workflows/blk010-validation.yml/runs?head_sha='+sha+'&event=push&per_page=100'),
 github('repos/'+repo+'/environments/'+targetEnvironment),
]);
assert.equal(pr.number,pullNumber,'RELEASE_ASSOCIATED_PR_ID_MISMATCH');
const independentGitHubReview=reviews.some(r=>r.state==='APPROVED'&&
 r.user?.login!==pr.user?.login&&r.commit_id===pr.head?.sha);
const requiredReviewers=Array.isArray(environment.protection_rules)&&
 environment.protection_rules.some(rule=>rule.type==='required_reviewers'&&
  Array.isArray(rule.reviewers)&&rule.reviewers.length>0);
let directorApproval;
if(!(independentGitHubReview&&requiredReviewers)&&
   targetEnvironment==='t13-release-signing'){
 // Do not accept chat text or an untrusted workflow input as approval.
 // The signed-in director must author an UNEDITED GitHub comment on PR #29,
 // authorizing exact policy HEAD and SHA256 of the owner-transcribed evidence.
 const [sourcePr,sourceCiRuns,comments,compare]=await Promise.all([
  github('repos/'+repo+'/pulls/29'),
  github('repos/'+repo+'/actions/workflows/blk010-validation.yml/runs?head_sha='+T13_BASE_MERGE+'&event=push&per_page=100'),
  github('repos/'+repo+'/issues/29/comments?per_page=100'),
  github('repos/'+repo+'/compare/'+T13_BASE_MERGE+'...'+sha),
 ]);
 directorApproval=verifyDirectorAuditPackage({
  repository:repo,actor:process.env.GITHUB_ACTOR,
  eventName:process.env.GITHUB_EVENT_NAME,
  environmentName:targetEnvironment,environment,currentPr:pr,sourcePr,
  sourceCiRuns,comments,evidenceText:policyEvidenceText(),
  changedFiles:verifiedChangedFiles(compare,sha),
 });
}
requireReady({sha,expected,ref,pr,reviews,runs,environment,
 environmentName:targetEnvironment,directorApproval});
const mode=directorApproval?'DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY':'GITHUB_INDEPENDENT_REVIEW';
if(process.env.GITHUB_OUTPUT){
 const lines=['approval_mode='+mode,'director_comment_id='+
  (directorApproval?.directorCommentId??''),'audit_sha256='+
  (directorApproval?.auditEvidenceSha256??'')];
 fs.appendFileSync(process.env.GITHUB_OUTPUT,lines.join('\n')+'\n');
}
console.log(JSON.stringify({status:'RELEASE_SEAL_APPROVED',sha,pullNumber,
 approvalMode:mode,ownerAttestedGemini:!!directorApproval,
 directorCommentId:directorApproval?.directorCommentId??null,
 signedReleaseOnly:true,productionDeploymentAuthorized:false,
 postMergeCi:true,environmentConfirmed:true}));
