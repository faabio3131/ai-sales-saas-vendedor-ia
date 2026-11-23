/** Supply-chain policy guard for GitHub Actions source. */
import fs from 'node:fs';
import path from 'node:path';
const dir='.github/workflows';
const yaml=fs.readdirSync(dir).filter(p=>/\.ya?ml$/.test(p));
if(!yaml.includes('blk010-validation.yml')||!yaml.includes('t13-certified-release.yml')||!yaml.includes('t13-controlled-deploy.yml'))
 throw Error('T13_REQUIRED_WORKFLOWS_MISSING');
for(const name of yaml){
 const source=fs.readFileSync(path.join(dir,name),'utf8');
 const refs=[...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map(x=>x[1]);
 for(const ref of refs){
  if(!/^[-\w.]+\/[-\w.]+@[a-f0-9]{40}$/.test(ref))
   throw Error('UNPINNED_WORKFLOW_ACTION:'+name+':'+ref);
 }
 if(/(^|\n)\s*pull_request_target\s*:/m.test(source))
  throw Error('UNTRUSTED_PRIVILEGED_PR_TRIGGER:'+name);
 if(/(^|\n)\s*workflow_run\s*:/m.test(source))
  throw Error('UNTRUSTED_WORKFLOW_RUN_TRIGGER:'+name);
 if(/\$\{\{\s*(?:github\.event\.pull_request\.(?:title|body)|github\.event\.issue\.title)\s*\}\}/.test(source))
  throw Error('UNTRUSTED_ACTIONS_EXPRESSION:'+name);
}
const validation=fs.readFileSync(path.join(dir,'blk010-validation.yml'),'utf8');
if(!validation.includes('node scripts/t13FirestoreEmulatorIntegrity.mjs /tmp/firestore-emulator.jar')||
 !validation.includes('node scripts/t13FirestoreEmulatorIntegrity.mjs --self-test'))
 throw Error('FIRESTORE_EMULATOR_DIGEST_GATE_MISSING');
const release=fs.readFileSync(path.join(dir,'t13-certified-release.yml'),'utf8');
if(!release.includes('workflow_dispatch:')||
 !release.includes('environment: t13-release-signing')||
 !release.includes('id-token: write')||
 !release.includes('attestations: write')||
 !release.includes('t13ReleaseGate.mjs --verify')||
 !release.includes('t13FirestoreRulesGate.mjs --verify-active'))
 throw Error('T13_RELEASE_SECURITY_GATES_MISSING');
const deployment=fs.readFileSync(path.join(dir,'t13-controlled-deploy.yml'),'utf8');
if(!deployment.includes('environment: t13-production-approval')||
 !deployment.includes('t13ReleaseGate.mjs --verify')||
 !deployment.includes('cosign verify')||
 !deployment.includes('gh attestation verify')||
 !deployment.includes('deploy/t13-controlled-deploy.sh'))
 throw Error('T13_CONTROLLED_DEPLOY_GATES_MISSING');
console.log('t13_workflow_supply_chain_gate_passed:'+yaml.length);
