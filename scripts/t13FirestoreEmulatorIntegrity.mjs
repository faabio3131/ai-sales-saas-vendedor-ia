/** Pin the exact Firebase Firestore Emulator artifact bytes before java executes. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const EXPECTED_SHA256='9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d';
function sameDigest(bytes){
 const actual=createHash('sha256').update(bytes).digest('hex');
 return actual===EXPECTED_SHA256;
}
if(process.argv.includes('--self-test')){
 if(sameDigest(Buffer.from('untrusted-jar'))||
    sameDigest(Buffer.alloc(0))||
    sameDigest(Buffer.from(EXPECTED_SHA256)))throw Error('FIRESTORE_EMULATOR_HASH_SELF_TEST_FAILED');
 console.log('t13_firestore_emulator_integrity_negative_self_test_passed');
 process.exit(0);
}
if(process.argv.length!==3||process.argv[2]!=='/tmp/firestore-emulator.jar')
 throw Error('T13_EMULATOR_EXPECTED_PATH_REQUIRED');
const stat=fs.lstatSync(process.argv[2]);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1024*1024)
 throw Error('FIRESTORE_EMULATOR_ARTIFACT_INVALID');
if(!sameDigest(fs.readFileSync(process.argv[2])))
 throw Error('FIRESTORE_EMULATOR_SHA256_MISMATCH');
console.log('t13_firestore_emulator_sha256_verified:'+EXPECTED_SHA256);
