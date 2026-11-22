/** T13 deterministic AST gate for selected critical unsafe constructs.
 * Complements dependency audit and independent security review; not a substitute
 * for CodeQL/Semgrep or penetration testing.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT=process.cwd();
const SKIP=new Set(['node_modules','dist','coverage','.git']);
function files(dir){
 const names=[];
 if(!fs.existsSync(dir))return names;
 for(const d of fs.readdirSync(dir,{withFileTypes:true})){
  if(SKIP.has(d.name))continue;
  const full=path.join(dir,d.name);
  if(d.isDirectory())names.push(...files(full));
  else if(d.isFile()&&/\.(?:ts|tsx|js|jsx)$/.test(d.name))names.push(full);
 }
 return names;
}
function scanSource(filename,contents){
 const source=ts.createSourceFile(filename,contents,ts.ScriptTarget.Latest,true,
  filename.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const findings=[];
 const flag=(node,reason)=>{
  const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
  findings.push({filename:path.relative(ROOT,filename),line,reason});
 };
 function walk(node){
  if(ts.isCallExpression(node)){
   const fn=node.expression;
   if(ts.isIdentifier(fn)&&['eval','Function'].includes(fn.text))
    flag(node,'DYNAMIC_CODE_EXECUTION');
   if(ts.isPropertyAccessExpression(fn)&&
     ((fn.expression.getText(source)==='child_process'&&['exec','execSync'].includes(fn.name.text))||
      (fn.expression.getText(source)==='process'&&fn.name.text==='setuid')))
    flag(node,'UNSAFE_PROCESS_EXECUTION');
  }
  if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Function')
   flag(node,'DYNAMIC_FUNCTION_CONSTRUCTOR');
  if(ts.isPropertyAssignment(node)&&node.name.getText(source).replace(/['"]/g,'')==='rejectUnauthorized'&&
    node.initializer.kind===ts.SyntaxKind.FalseKeyword)
   flag(node,'TLS_CERTIFICATE_VALIDATION_DISABLED');
  ts.forEachChild(node,walk);
 }
 walk(source);
 return findings;
}
if(process.argv.includes('--self-test')){
 const invalid=scanSource('test.ts',`eval("untrusted"); const a={rejectUnauthorized:false};`);
 if(invalid.length!==2)throw Error('Static gate regression.');
 process.stdout.write('t13_static_scan_self_test_passed\n');
 process.exit(0);
}
let problems=[];
for(const file of [...files(path.join(ROOT,'src')),...files(path.join(ROOT,'scripts')),...files(path.join(ROOT,'server.ts'))]){
 if(path.basename(file)==='t13SecurityScan.mjs')continue;
 problems.push(...scanSource(file,fs.readFileSync(file,'utf8')));
}
for(const finding of problems)process.stderr.write(JSON.stringify(finding)+'\n');
if(problems.length)process.exit(1);
process.stdout.write('t13_static_security_gate_passed\n');
