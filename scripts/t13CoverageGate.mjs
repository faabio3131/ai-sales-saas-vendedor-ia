/** T13 cumulative source coverage gate. Fails closed on missing data and regressions. */
import fs from 'node:fs';

const source = process.argv[2] || 'coverage/coverage-summary.json';
// Calibrated against actual certified baseline CI #45017274525, retaining
// ~4-5 percentage-point regression headroom per metric.
const thresholds = Object.freeze({lines:55, statements:50, branches:50, functions:43});
// Independently observed T13 baseline (Claude Code reauditoria 22/11/2026).
// These floors prevent high-risk paths from disappearing under healthy global
// averages. Raise them with new tests; do NOT lower them to pass a red CI.
const criticalBranchFloors=Object.freeze({
 'src/payments/providerWebhooks.ts':75,
 'src/payments/webhook.ts':20,
 'src/payments/webhookRecovery.ts':10,
 'src/payments/reconciliation.ts':20,
 'src/orderPayments/outbox.ts':5,
 'src/orderPayments/reconciliation.ts':10,
 'src/governance/service.ts':10,
});
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
  if(failed.length)throw new Error('COVERAGE_GATE_FAILED:'+failed.join(','));
  return files.length;
}
if(process.argv.includes('--self-test')){
  const rows={total:{},'/repo/src/core.ts':null};
  for(const metric of Object.keys(thresholds))rows.total[metric]={pct:100,total:10,covered:10};
  for(let i=0;i<20;i++)rows['/repo/src/core'+i+'.ts']={};
  for(const file of Object.keys(criticalBranchFloors))
    rows['/repo/'+file]={branches:{pct:100,total:10,covered:10}};
  if(inspect(rows)<20)throw Error('Self test failed.');
  console.info('t13_coverage_gate_self_test_passed');
} else {
  const report=JSON.parse(fs.readFileSync(source,'utf8'));
  const count=inspect(report);
  console.info('t13_coverage_gate_success:source_files='+count);
}
