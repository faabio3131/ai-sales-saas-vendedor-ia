/** T13 deterministic AST gate for selected critical unsafe constructs.
 * Complements dependency audit and independent review; not a full SAST solution.
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
  else if(d.isFile()&&/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(d.name))names.push(full);
 }
 return names;
}
function scanSource(filename,contents){
 const source=ts.createSourceFile(filename,contents,ts.ScriptTarget.Latest,true,
  filename.endsWith('tsx')?ts.ScriptKind.TSX:
  /\.(?:ts|mts|cts)$/.test(filename)?ts.ScriptKind.TS:ts.ScriptKind.JS);
 const findings=[];
 const unsafe=new Set(['exec','execSync']);
 const imported=new Set();
 const namespaces=new Set(['child_process']);
 const flag=(node,reason)=>{
  const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
  findings.push({filename:path.relative(ROOT,filename),line,reason});
 };
 const isModule=s=>ts.isStringLiteral(s)&&/^(?:node:)?child_process$/.test(s.text);
 const memberName=node=>ts.isPropertyAccessExpression(node)?node.name.text:
  ts.isElementAccessExpression(node)&&ts.isStringLiteral(node.argumentExpression)?node.argumentExpression.text:null;
 const memberObject=node=>ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)?node.expression:null;
 const moduleCall=node=>{
  if(ts.isAwaitExpression(node))return moduleCall(node.expression);
  return ts.isCallExpression(node)&&node.arguments.length===1&&
   isModule(node.arguments[0])&&
   ((ts.isIdentifier(node.expression)&&node.expression.text==='require')||
    node.expression.kind===ts.SyntaxKind.ImportKeyword);
 };
 // Resolve bindings before scanning calls: simple name matching misses
 // import {exec as run} and const {execSync: run}=require('child_process').
 function bindings(node){
  if(ts.isImportDeclaration(node)&&isModule(node.moduleSpecifier)){
   const clause=node.importClause;
   if(clause?.name)namespaces.add(clause.name.text);
   if(clause?.namedBindings){
    if(ts.isNamespaceImport(clause.namedBindings))
     namespaces.add(clause.namedBindings.name.text);
    else for(const spec of clause.namedBindings.elements){
     if(unsafe.has((spec.propertyName??spec.name).text))imported.add(spec.name.text);
    }
   }
  }
  if(ts.isVariableDeclaration(node)&&node.initializer&&moduleCall(node.initializer)){
   if(ts.isIdentifier(node.name))namespaces.add(node.name.text);
   else if(ts.isObjectBindingPattern(node.name)){
    for(const element of node.name.elements){
     const importedName=element.propertyName?.getText(source)??element.name.getText(source);
     if(unsafe.has(importedName)&&ts.isIdentifier(element.name))imported.add(element.name.text);
    }
   }
  }
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){
   const init=node.initializer;
   const target=memberObject(init),name=memberName(init);
   if(target&&unsafe.has(name)&&
     ((ts.isIdentifier(target)&&namespaces.has(target.text))||moduleCall(target)))
      imported.add(node.name.text);
   if(ts.isIdentifier(init)&&namespaces.has(init.text))namespaces.add(node.name.text);
   if(ts.isIdentifier(init)&&imported.has(init.text))imported.add(node.name.text);
  }
  ts.forEachChild(node,bindings);
 }
 // Iterate to resolve bindings declared after their use or chained aliases.
 for(let i=0;i<4;i++)bindings(source);
 function walk(node){
  if(ts.isCallExpression(node)){
   const fn=node.expression;
   if(ts.isIdentifier(fn)&&(['eval','Function'].includes(fn.text)||imported.has(fn.text)))
    flag(node,imported.has(fn.text)?'UNSAFE_PROCESS_EXECUTION':'DYNAMIC_CODE_EXECUTION');
   const target=memberObject(fn),name=memberName(fn);
   if(target&&
     ((unsafe.has(name)&&
       ((ts.isIdentifier(target)&&namespaces.has(target.text))||
        moduleCall(target)))||
      (target.getText(source)==='process'&&name==='setuid')))
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
 const cases=[
  ['test.ts','eval("untrusted"); const a={rejectUnauthorized:false};',2],
  ['named.ts',"import {exec as run} from 'node:child_process'; run('echo unsafe')",1],
  ['namespace.ts',"import * as cp from 'child_process'; cp.execSync('echo unsafe')",1],
  ['require.js',"const {execSync: launch}=require('node:child_process'); launch('echo unsafe')",1],
  ['direct.mjs',"require('child_process').exec('echo unsafe')",1],
  ['property.js',"const run = require('child_process').exec; run('echo unsafe')",1],
  ['computed.ts',"import * as cp from 'child_process'; cp['execSync']('echo unsafe')",1],
  ['chained.js',"const cp=require('child_process'); const fn=cp.exec; fn('echo unsafe')",1],
  ['aliased.ts',"const cp=require('node:child_process'); const alias=cp; const fn=alias['exec']; fn('echo unsafe')",1],
  ['safe.ts',"import {randomBytes} from 'node:crypto'; randomBytes(32);",0],
 ];
 for(const [file,code,count] of cases){
  const findings=scanSource(file,code);
  if(findings.length!==count)throw Error('Static gate regression: '+file+
   ' expected '+count+' got '+JSON.stringify(findings));
 }
 process.stdout.write('t13_static_scan_self_test_passed\n');
 process.exit(0);
}
let problems=[];
for(const file of [...files(path.join(ROOT,'src')),...files(path.join(ROOT,'scripts')),
 ...files(path.join(ROOT,'deploy')),path.join(ROOT,'server.ts')]){
 problems.push(...scanSource(file,fs.readFileSync(file,'utf8')));
}
for(const finding of problems)process.stderr.write(JSON.stringify(finding)+'\n');
if(problems.length)process.exit(1);
process.stdout.write('t13_static_security_gate_passed\n');
