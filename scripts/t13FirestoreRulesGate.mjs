/** SEC-001: fail-closed comparison of the candidate rules and actual Firebase release.
 * Offline CI only validates this repository's candidate. --verify-active
 * REQUIRES an authorized scoped token to fetch active Firebase Rules remotely.
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const file='deploy/t13-server-only.firestore.rules';
function digest(value){return createHash('sha256').update(value).digest('hex');}
function candidateValid(content){
 const allow=[...content.matchAll(/\ballow\s+[^;]+;/g)].map(m=>m[0].replace(/\s+/g,' '));
 return /^rules_version\s*=\s*'2';/.test(content.trim())&&
  content.includes('service cloud.firestore')&&
  /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/m.test(content)&&
  allow.length===1&&/^allow read,\s*write: if false;$/.test(allow[0]);
}
const config=JSON.parse(fs.readFileSync('firebase.json','utf8'));
if(config.firestore?.rules!==file)throw Error('FIREBASE_CONFIG_RULES_SOURCE_MISMATCH');
const source=fs.readFileSync(file,'utf8');
if(!candidateValid(source))throw Error('FIRESTORE_SERVER_ONLY_RULES_INVALID');
if(process.argv.includes('--self-test')){
 if(candidateValid(source.replace('if false','if true')))throw Error('FAIL_OPEN_RULES_ACCEPTED');
 if(candidateValid(source.replace('match /{document=**}','match /payments/{id}')))
  throw Error('INCOMPLETE_COLLECTION_RULES_ACCEPTED');
 console.log('t13_firestore_rules_candidate_self_test_passed');
 process.exit(0);
}
if(!process.argv.includes('--verify-active')){
 console.log(JSON.stringify({status:'CANDIDATE_ONLY_NOT_DEPLOYED',candidateSha256:digest(source)}));
 process.exit(0);
}
const project=process.env.FIREBASE_RULES_PROJECT_ID??'';
const token=process.env.FIREBASE_RULES_ACCESS_TOKEN??'';
if(!/^[a-z][a-z0-9-]{3,62}$/.test(project)||token.length<20)
 throw Error('FIRESTORE_ACTIVE_RULES_IDENTITY_REQUIRED');
const root='https://firebaserules.googleapis.com/v1/';
async function read(path){
 const result=await fetch(root+path,{
  headers:{Authorization:'Bearer '+token,Accept:'application/json','x-goog-user-project':project},
  signal:AbortSignal.timeout(12000),
 });
 if(!result.ok)throw Error('FIRESTORE_RULES_API_UNAVAILABLE:'+result.status);
 return result.json();
}
const release=await read('projects/'+project+'/releases/cloud.firestore');
const name=release.rulesetName;
if(typeof name!=='string'||!name.startsWith('projects/'+project+'/rulesets/'))
 throw Error('FIRESTORE_ACTIVE_RULESET_NOT_TRUSTED');
const ruleset=await read(name);
const active=ruleset?.source?.files;
if(!Array.isArray(active)||active.length!==1||typeof active[0].content!=='string')
 throw Error('FIRESTORE_ACTIVE_RULESET_SOURCE_UNVERIFIABLE');
const activeSource=active[0].content.replace(/\r\n/g,'\n').trim();
const intended=source.replace(/\r\n/g,'\n').trim();
if(activeSource!==intended)throw Error('FIRESTORE_ACTIVE_RULES_MISMATCH');
console.log(JSON.stringify({status:'ACTIVE_RULES_VERIFIED',project,
 release:release.name,ruleset:name,sha256:digest(intended)}));
