/** T13 cumulative source coverage gate. Fails closed on missing data and regressions. */
import fs from 'node:fs';

function parseArgs(args){
 if(args.length===0)return {mode:'source',path:'coverage/coverage-summary.json'};
 const isPath=v=>typeof v==='string'&&v.trim().length>0&&!v.startsWith('-');
 if(args.length===1&&args[0]==='--self-test')return {mode:'self-test'};
 if(args.length===2&&args[0]==='--evolution-emulator'&&isPath(args[1]))return {mode:'emulator',path:args[1]};
 if(args.length===1&&isPath(args[0]))return {mode:'source',path:args[0]};
 throw Error('COVERAGE_GATE_ARGUMENTS_INVALID');
}
const invocation=parseArgs(process.argv.slice(2));
// Calibrated against actual certified baseline CI #45017274525, retaining
// ~4-5 percentage-point regression headroom per metric.
const thresholds = Object.freeze({lines:55, statements:50, branches:50, functions:43});
// Independently observed T13 baseline (Claude Code reauditoria 22/11/2026).
// These floors prevent high-risk paths from disappearing under healthy global
// averages. Raise them with new tests; do NOT lower them to pass a red CI.
// Raised using measured HEAD a236ffa / CI #45220334435 coverage,
// with regression headroom. These are guardrails, not a final adequacy target.
// Current observed branches: PSP 81.04, MP 86.66, recovery 15,
// legacy reconciler 29.62, outbox 7.14, order reconciliation 15.62,
// governance 82.8. Additional fault-path tests must increase weak modules.
const criticalBranchFloors=Object.freeze({
 'src/payments/providerWebhooks.ts':77,
 'src/payments/webhook.ts':80,
 'src/payments/webhookRecovery.ts':13,
 'src/payments/reconciliation.ts':25,
 'src/orderPayments/outbox.ts':6,
 'src/orderPayments/reconciliation.ts':13,
 'src/governance/service.ts':75,
 // Post-merge CI 45745309396: 91.83, 86.84, 83.80, 43.45, 12.32, 23.63.
 // The UI floors cover SSR/instrumented source only; Chromium is a separate gate.
 'src/channels/evolutionAttendance.ts':88,
 'src/channels/evolutionAttendanceRuntime.ts':82,
 'src/channels/evolutionClient.ts':79,
 'src/channels/evolutionPairing.ts':39,
 'src/ui/EvolutionConnectionCard.tsx':8,
 'src/ui/ProviderConnectionPanel.tsx':19,
});
// Minimum nonzero executed lines, distinct from adequacy of branch coverage.
const requiredEvolutionFiles=['src/channels/evolutionAttendanceRuntime.ts','src/channels/evolutionClient.ts',
 'src/channels/evolutionPairing.ts','src/channels/evolutionAttendance.ts',
 'src/ui/EvolutionConnectionCard.tsx','src/ui/ProviderConnectionPanel.tsx'];
const emulatorBranchFloors=Object.freeze({
 // Independent emulator baseline: 75.98, 24.89, 19.38 (same certified CI).
 'src/channels/evolutionAttendanceStore.ts':72,
 'src/channels/evolutionPairing.ts':20,
 'src/channels/evolutionAttendance.ts':15,
});
function inspectEvolutionEmulator(report){
 const failed=[];
 const check=(metric,minimum,label)=>{
  if(!metric||!Number.isFinite(metric.pct)||!Number.isSafeInteger(metric.total)||metric.total<=0||
   !Number.isSafeInteger(metric.covered)||metric.covered<0||metric.covered>metric.total)
   throw Error('EVOLUTION_EMULATOR_COVERAGE_INVALID:'+label);
  console.info(JSON.stringify({evolutionEmulator:label,pct:metric.pct,minimum}));
  if(metric.pct<minimum)failed.push(label+':'+metric.pct+'<'+minimum);
 };
 check(report?.total?.lines,28,'total.lines');
 check(report?.total?.branches,26,'total.branches');
 const entries=Object.entries(report??{}).map(([name,row])=>[name.replaceAll('\\','/'),row]);
 for(const [file,minimum] of Object.entries(emulatorBranchFloors)){
  const match=entries.filter(([name])=>name.endsWith('/'+file));
  if(match.length!==1)throw Error('EVOLUTION_EMULATOR_COVERAGE_FILE_MISSING:'+file);
  check(match[0][1]?.branches,minimum,file+'.branches');
  if(file.endsWith('evolutionAttendanceStore.ts'))check(match[0][1]?.lines,84,file+'.lines');
 }
 if(failed.length)throw Error('EVOLUTION_EMULATOR_COVERAGE_GATE_FAILED:'+failed.join(','));
}
function inspect(report) {
  if (!report || !report.total || typeof report.total !== 'object')
    throw new Error('COVERAGE_SUMMARY_MISSING');
  const files = Object.keys(report).filter(k=>k!=='total' && /\bsrc\//.test(k.replaceAll('\\','/')));
  if(files.length<20)throw new Error('COVERAGE_SOURCE_FILES_MISSING:'+files.length);
  const failed=[];
  for(const [metric,required] of Object.entries(thresholds)){
    const item=report.total[metric],pct=item?.pct;
    if(!Number.isFinite(pct)||!Number.isSafeInteger(item.total)||item.total<=0||
       !Number.isSafeInteger(item.covered)||item.covered<0||item.covered>item.total)
      throw new Error('COVERAGE_METRIC_INVALID:'+metric);
    console.info(JSON.stringify({metric,pct,minimum:required,total:item.total,covered:item.covered}));
    if(pct<required)failed.push(metric+':'+pct+'<'+required);
  }
  const normalized=Object.entries(report)
    .filter(([name])=>name!=='total')
    .map(([name,record])=>[name.replaceAll('\\','/'),record]);
  for(const [filename,minimum] of Object.entries(criticalBranchFloors)){
    const matches=normalized.filter(([name])=>name.endsWith('/'+filename));
    if(matches.length!==1)throw new Error('CRITICAL_COVERAGE_FILE_MISSING:'+filename+':'+matches.length);
    const result=matches[0][1]?.branches;
    if(!result||!Number.isFinite(result.pct)||!Number.isSafeInteger(result.total)||
       result.total<=0||!Number.isSafeInteger(result.covered))
      throw new Error('CRITICAL_COVERAGE_INVALID:'+filename);
    console.info(JSON.stringify({criticalFile:filename,branchCoverage:result.pct,minimum}));
    if(result.pct<minimum)failed.push(filename+':'+result.pct+'<'+minimum);
  }
  for(const file of requiredEvolutionFiles){
    const matches=normalized.filter(([name])=>name.endsWith('/'+file));
    if(matches.length!==1||!Number.isSafeInteger(matches[0][1]?.lines?.covered)||matches[0][1].lines.covered<=0)
      failed.push(file+':no executed source lines');
  }
  if(failed.length)throw new Error('COVERAGE_GATE_FAILED:'+failed.join(','));
  return files.length;
}
if(invocation.mode==='self-test'){
  if(parseArgs([]).path!=='coverage/coverage-summary.json'||parseArgs(['custom.json']).path!=='custom.json'||
   parseArgs(['--evolution-emulator','emulator.json']).path!=='emulator.json'||parseArgs(['--self-test']).mode!=='self-test')
   throw Error('COVERAGE_GATE_ARGUMENTS_SELFTEST_FAILED');
  for(const args of [['--evolution-emulator'],['ignored','--evolution-emulator','emulator.json'],['--self-test','x'],['--evolution-emulator','--self-test'],['--unknown'],['a','b']]){
   let rejected=false;try{parseArgs(args);}catch(e){rejected=String(e).includes('COVERAGE_GATE_ARGUMENTS_INVALID');}
   if(!rejected)throw Error('COVERAGE_GATE_INVALID_ARGUMENTS_ACCEPTED');
  }
  const rows={total:{},'/repo/src/core.ts':null};
  for(const metric of Object.keys(thresholds))rows.total[metric]={pct:100,total:10,covered:10};
  for(let i=0;i<20;i++)rows['/repo/src/core'+i+'.ts']={};
  for(const file of Object.keys(criticalBranchFloors))
    rows['/repo/'+file]={branches:{pct:100,total:10,covered:10}};
  for(const file of requiredEvolutionFiles)rows['/repo/'+file]={...rows['/repo/'+file],lines:{pct:100,total:10,covered:10}};
  if(inspect(rows)<20)throw Error('Self test failed.');
  // Prove the guard detects a real file-level regression, even while global
  // coverage stays 100%, and never accepts a missing critical file.
  const below=structuredClone(rows);
  below['/repo/src/orderPayments/outbox.ts'].branches={pct:5.9,total:1000,covered:59};
  let caught=false;
  try{inspect(below);}catch(e){caught=String(e).includes('COVERAGE_GATE_FAILED');}
  if(!caught)throw Error('CRITICAL_BRANCH_REGRESSION_NOT_REJECTED');
  const missing=structuredClone(rows);
  delete missing['/repo/src/payments/webhookRecovery.ts'];
  caught=false;
  try{inspect(missing);}catch(e){caught=String(e).includes('CRITICAL_COVERAGE_FILE_MISSING');}
  if(!caught)throw Error('MISSING_FINANCIAL_COVERAGE_NOT_REJECTED');
  const emu={total:{lines:{pct:100,total:10,covered:10},branches:{pct:100,total:10,covered:10}}};
  for(const file of Object.keys(emulatorBranchFloors))emu['/repo/'+file]={lines:{pct:100,total:10,covered:10},branches:{pct:100,total:10,covered:10}};
  inspectEvolutionEmulator(emu);
  const emuBad=structuredClone(emu);
  emuBad['/repo/src/channels/evolutionAttendanceStore.ts'].branches={pct:71,total:100,covered:71};
  caught=false;
  try{inspectEvolutionEmulator(emuBad);}catch(e){caught=String(e).includes('EVOLUTION_EMULATOR_COVERAGE_GATE_FAILED');}
  if(!caught)throw Error('EVOLUTION_EMULATOR_REGRESSION_NOT_REJECTED');
  delete emuBad['/repo/src/channels/evolutionAttendanceStore.ts'];
  caught=false;
  try{inspectEvolutionEmulator(emuBad);}catch(e){caught=String(e).includes('EVOLUTION_EMULATOR_COVERAGE_FILE_MISSING');}
  if(!caught)throw Error('EVOLUTION_EMULATOR_MISSING_FILE_NOT_REJECTED');
  console.info('t13_coverage_gate_self_test_passed');
} else if(invocation.mode==='emulator'){
  inspectEvolutionEmulator(JSON.parse(fs.readFileSync(invocation.path,'utf8')));
  console.info('t13_evolution_emulator_coverage_gate_success');
} else {
  const report=JSON.parse(fs.readFileSync(invocation.path,'utf8'));
  const count=inspect(report);
  console.info('t13_coverage_gate_success:source_files='+count);
}
