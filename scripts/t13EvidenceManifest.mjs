/** Inspectable candidate provenance, not a signed OCI release or deployment. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const required=['package-lock.json','t13-sbom.cdx.json','coverage/coverage-summary.json'];
const digests=Object.fromEntries(required.map(file=>{
  if(!fs.existsSync(file))throw new Error('EVIDENCE_FILE_MISSING:'+file);
  return [file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
}));
const raw=fs.readFileSync(process.env.GITHUB_EVENT_PATH||'/dev/null','utf8');
const event=raw ? JSON.parse(raw) : {};
const sourceHead=event.pull_request?.head?.sha||process.env.GITHUB_SHA;
if(!/^[0-9a-f]{40}$/.test(sourceHead||''))throw new Error('UNTRUSTED_SOURCE_REF');
const checkedOut=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const imageId=execFileSync('docker',['image','inspect','--format={{.Id}}','vendedor-ia-ci'],
 {encoding:'utf8'}).trim();
if(!/^sha256:[0-9a-f]{64}$/.test(imageId))throw new Error('LOCAL_IMAGE_UNVERIFIED');
const metadata={
 schema:'atendevende.t13.candidate-evidence/v1',
 candidateHeadSha:sourceHead,
 checkedOutRevision:checkedOut,
 localBuiltImageId:imageId,
 sha256:digests,
 releaseScope:'CI_CANDIDATE_ONLY',
 signedRelease:false,registryPublished:false,mergeApproved:false,
 deployed:false,commercialGoLiveApproved:false,
 generatedAt:new Date().toISOString()
};
fs.writeFileSync('t13-evidence-manifest.json',JSON.stringify(metadata,null,2)+'\n');
console.info(JSON.stringify({event:'t13_candidate_provenance_created',sourceHead,
 checkedOut,imageId,files:Object.keys(digests)}));
