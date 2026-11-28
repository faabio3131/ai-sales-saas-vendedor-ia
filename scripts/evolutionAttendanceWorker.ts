import {geminiRuntimeSecret} from '../src/ai/geminiRuntimeSecret';
import {createEvolutionAttendanceRuntime} from '../src/channels/evolutionAttendanceRuntime';
import {recoverEvolutionOnly} from '../src/channels/evolutionAttendanceStore';
async function main(){
 const args=process.argv.slice(2);
 if(args.length){
  if(args.length!==2||args[0]!=='--recover-only')throw Error('EVOLUTION_WORKER_ARGUMENTS_INVALID');
  const recovered=await recoverEvolutionOnly(args[1]);
  console.info(JSON.stringify({event:'evolution_recovery_only_completed',recovered}));return;
 }
 if(process.env.EVOLUTION_ATTENDANCE_ENABLED!=='true'){
  console.info('evolution_attendance_disabled');return;
 }
 // Reject an invalid configured source before constructing the live runtime.
 // The router reads the same private mount without exporting its value.
 geminiRuntimeSecret(process.env);
 const worker=createEvolutionAttendanceRuntime(process.env);
 const result=await worker.runOnce(10);
 console.info(JSON.stringify({event:'evolution_attendance_cycle_completed',...result}));
 if(result.failed||result.uncertain)process.exitCode=1;
}
main().catch(()=>{console.error('evolution_attendance_cycle_failed');process.exitCode=1;});
