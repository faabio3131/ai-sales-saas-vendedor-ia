import fs from 'node:fs';
import {createHash} from 'node:crypto';
const ref=process.env.IMAGE_REF;
const digest=process.env.IMAGE_DIGEST;
if(!ref||!digest||!/^[a-f0-9]{64}$/.test(digest.slice(7))||
 !ref.endsWith('@'+digest)||!digest.startsWith('sha256:'))
 throw Error('T13_SEALED_RELEASE_DIGEST_INVALID');
const sbom=fs.readFileSync('t13-sbom.cdx.json');
const manifest={
 schema:'atendevende.t13.sealed-oci/v1',
 commitSha:process.env.GITHUB_SHA,
 runId:process.env.GITHUB_RUN_ID,
 imageRef:ref,
 digest,
 sbomSha256:createHash('sha256').update(sbom).digest('hex'),
 provenanceVerified:true,
 cosignVerified:true,
 exactMainHeadApproved:true,
 releaseScope:'SIGNED_AND_PUBLISHED_NOT_DEPLOYED',
 deployed:false,
 commercialGoLiveApproved:false,
 generatedAt:new Date().toISOString(),
};
fs.writeFileSync('t13-sealed-release.json',JSON.stringify(manifest,null,2)+'\n');
console.info(JSON.stringify({event:'t13_oci_release_sealed',digest,sha:manifest.commitSha}));
