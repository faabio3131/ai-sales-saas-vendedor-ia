import fs from 'node:fs';
import {createHash} from 'node:crypto';
const ref=process.env.IMAGE_REF;
const digest=process.env.IMAGE_DIGEST;
if(!ref||!digest||!/^[a-f0-9]{64}$/.test(digest.slice(7))||
 !ref.endsWith('@'+digest)||!digest.startsWith('sha256:'))
 throw Error('T13_SEALED_RELEASE_DIGEST_INVALID');
const mode=process.env.T13_APPROVAL_MODE;
if(!['GITHUB_INDEPENDENT_REVIEW','DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY'].includes(mode))
 throw Error('T13_SEALED_APPROVAL_MODE_MISSING');
const ownerMode=mode==='DIRECTOR_ATTESTED_GEMINI_SEAL_ONLY';
const ownerComment=process.env.T13_DIRECTOR_COMMENT_ID??'';
const auditDigest=process.env.T13_GEMINI_EVIDENCE_SHA256??'';
if(ownerMode&&(!/^[1-9][0-9]*$/.test(ownerComment)||!/^[0-9a-f]{64}$/.test(auditDigest)))
 throw Error('T13_DIRECTOR_AUDIT_PROVENANCE_MISSING');
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
 approvalMode:mode,
 ...(ownerMode?{auditedT13Head:'a0e335dba1884fb398aea13c8435cd28f98436a9',
  originalCertifiedMainSha:'dbe52a89c3214d7f40b1f66924bcbb1a90e017eb',
  directorGitHubCommentId:ownerComment,
  geminiOwnerTranscribedEvidenceSha256:auditDigest,
  independentGitHubReviewerApproved:false,
  auditAuthenticity:'OWNER_ATTESTED_NOT_GEMINI_CRYPTO_SIGNATURE',
 }:{}),
 releaseScope:'SIGNED_AND_PUBLISHED_NOT_DEPLOYED',
 deployed:false,
 commercialGoLiveApproved:false,
 generatedAt:new Date().toISOString(),
};
fs.writeFileSync('t13-sealed-release.json',JSON.stringify(manifest,null,2)+'\n');
console.info(JSON.stringify({event:'t13_oci_release_sealed',digest,sha:manifest.commitSha}));
