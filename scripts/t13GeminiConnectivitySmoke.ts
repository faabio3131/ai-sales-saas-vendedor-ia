import {runGeminiOperationalSmoke} from '../src/operations/geminiOperationalSmoke';

async function main(){
 if(process.argv.length!==2)throw Error('GEMINI_SMOKE_ARGUMENTS_INVALID');
 const report=await runGeminiOperationalSmoke('t13-operational-smoke');
 console.log(JSON.stringify({event:'T13_GEMINI_REAL_SMOKE_PASS',...report}));
}
main().catch(()=>{console.error('T13_GEMINI_REAL_SMOKE_FAIL');process.exitCode=1;});
