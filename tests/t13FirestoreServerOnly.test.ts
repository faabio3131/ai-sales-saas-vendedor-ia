import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
describe('T13 server-only Firestore candidate rules',()=>{
 it('denies client access to all current and future collections by default',()=>{
  const rules=readFileSync('deploy/t13-server-only.firestore.rules','utf8');
  expect(rules).toContain('match /{document=**}');
  expect(rules).toMatch(/allow\s+read,\s*write:\s*if\s+false/);
  expect(rules).not.toMatch(/allow\s+(?:read|write|create|update|delete):\s*if\s+true/);
 });
});
