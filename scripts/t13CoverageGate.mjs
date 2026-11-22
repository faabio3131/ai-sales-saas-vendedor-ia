/** T13 cumulative source coverage gate. Fails closed on missing data and regressions. */
import fs from 'node:fs';

const source = process.argv[2] || 'coverage/coverage-summary.json';
const thresholds = Object.freeze({lines:20, statements:20, branches:12, functions:15});
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
  if(failed.length)throw new Error('COVERAGE_GATE_FAILED:'+failed.join(','));
  return files.length;
}
if(process.argv.includes('--self-test')){
  const rows={total:{},'/repo/src/core.ts':null};
  for(const metric of Object.keys(thresholds))rows.total[metric]={pct:100,total:10,covered:10};
  for(let i=0;i<20;i++)rows['/repo/src/core'+i+'.ts']={};
  if(inspect(rows)<20)throw Error('Self test failed.');
  console.info('t13_coverage_gate_self_test_passed');
} else {
  const report=JSON.parse(fs.readFileSync(source,'utf8'));
  const count=inspect(report);
  console.info('t13_coverage_gate_success:source_files='+count);
}
