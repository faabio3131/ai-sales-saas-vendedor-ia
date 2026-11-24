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
const auditKind=process.env.T13_AUDIT_KIND??'';
const auditHead=process.env.T13_AUDIT_HEAD??'';
const auditBase=process.env.T13_AUDIT_BASE??'';
if(ownerMode&&(!['HISTORICAL_RESTRICTED_V1','FRESH_EXACT_PR_V2'].includes(auditKind)||
 !/^[a-f0-9]{40}$/.test(auditHead)||!/^[a-f0-9]{40}$/.test(auditBase)))
 throw Error('T13_SEALED_AUDIT_SCOPE_MISSING');
if(ownerMode&&(!/^[1-9][0-9]*$/.test(ownerComment)||!/^[0-9a-f]{64}$/.test(auditDigest)))
 throw Error('T13_DIRECTOR_AUDIT_PROVENANCE_MISSING');
const attestation=JSON.parse(fs.readFileSync('t13-verified-oci-attestations.json','utf8'));
if(attestation.status!=='T13_OCI_COSIGN_ATTESTATIONS_VERIFIED'||
 attestation.imageRef!==ref||
 attestation.commit!==process.env.GITHUB_SHA||
 attestation.deploymentAuthorized!==false||
 attestation.provenancePredicateType!=='https://slsa.dev/provenance/v1'||
 attestation.sbomPredicateType!=='https://cyclonedx.org/bom')
 throw Error('T13_SIGNED_OCI_ATTESTATION_VERIFICATION_REQUIRED');
const provenance=fs.readFileSync('t13-slsa-provenance.json');
const sbom=fs.readFileSync('t13-sbom.cdx.json');
if(attestation.provenanceSha256!==createHash('sha256').update(provenance).digest('hex')||
 attestation.sbomSha256!==createHash('sha256').update(sbom).digest('hex'))
 throw Error('T13_SIGNED_OCI_PREDICATE_HASH_MISMATCH');
const manifest={
 schema:'atendevende.t13.sealed-oci/v1',
 commitSha:process.env.GITHUB_SHA,
 runId:process.env.GITHUB_RUN_ID,
 imageRef:ref,
 digest,
 sbomSha256:createHash('sha256').update(sbom).digest('hex'),
 provenanceVerified:true,
 cosignVerified:true,
 attestationBackend:'SIGSTORE_COSIGN_REGISTRY_OCI',
 provenancePredicateType:'https://slsa.dev/provenance/v1',
 sbomPredicateType:'https://cyclonedx.org/bom',
 provenanceSha256:attestation.provenanceSha256,
 attestationContentVerified:true,
 githubArtifactAttestationsUsed:false,
 slsaClaim:'SELF_REPORTED_BUILD_PROVENANCE_V1_NOT_SLSA_L3',
 exactMainHeadApproved:true,
 approvalMode:mode,
 ...(ownerMode?{auditKind,auditedT13Head:auditHead,auditBaseSha:auditBase,
  ...(auditKind==='HISTORICAL_RESTRICTED_V1'?{originalCertifiedMainSha:auditBase}:{}),
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
