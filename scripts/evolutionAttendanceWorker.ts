import {readFileSync,lstatSync} from 'node:fs';
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
 const env={...process.env};
 const file=env.EVOLUTION_GEMINI_SECRET_FILE;
 if(file){
  const st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size<20||st.size>1024)throw Error('EVOLUTION_AI_SECRET_FILE_INVALID');
  env.GEMINI_API_KEY=readFileSync(file,'utf8').trim();
 }
 const worker=createEvolutionAttendanceRuntime(env);
 const result=await worker.runOnce(10);
 console.info(JSON.stringify({event:'evolution_attendance_cycle_completed',...result}));
 if(result.failed||result.uncertain)process.exitCode=1;
}
main().catch(()=>{console.error('evolution_attendance_cycle_failed');process.exitCode=1;});
