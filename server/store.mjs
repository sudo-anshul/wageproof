import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';

export const DATA=path.resolve(process.env.WAGEPROOF_DATA_DIR||'.data');
const locks=new Map();
export const id=()=>randomUUID();
export const now=()=>new Date().toISOString();
export function error(code,message,status=400,details){return Object.assign(new Error(message),{code,status,details});}
export function validId(value){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(value||''))throw error('INVALID_ID','Invalid record identifier.');return value;}
export async function initStore(){await mkdir(path.join(DATA,'cases'),{recursive:true,mode:0o700});await mkdir(path.join(DATA,'jobs'),{recursive:true,mode:0o700});}
export const caseDir=caseId=>path.join(DATA,'cases',validId(caseId));
export const jobDir=jobId=>path.join(DATA,'jobs',validId(jobId));
export async function atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+id()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,file);}
export async function readCase(caseId){try{return JSON.parse(await readFile(path.join(caseDir(caseId),'case.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw error('NOT_FOUND','Case not found.',404);if(e instanceof SyntaxError)throw error('CASE_UNREADABLE','This saved case could not be read. Its original files have been preserved; restore a known backup before continuing.',503);throw e;}}
export async function saveCase(c){await atomicJson(path.join(caseDir(c.id),'case.json'),c);return c;}
export function sourceDigest(c){return createHash('sha256').update(JSON.stringify(c.sources.map(s=>[s.id,s.sha256,s.kind]))).digest('hex');}
export async function withCase(caseId,fn){const previous=locks.get(caseId)||Promise.resolve();let unlock;const wait=new Promise(r=>unlock=r);const tail=previous.then(()=>wait);locks.set(caseId,tail);await previous;try{return await fn(await readCase(caseId));}finally{unlock();if(locks.get(caseId)===tail)locks.delete(caseId);}}
export function expectVersion(c,v){if(v===undefined||v===null||Number(v)!==c.version)throw error('STALE_VERSION','This case changed. Refresh it before applying this action.',409,{currentVersion:c.version});}
export function touch(c,type,message){c.version++;c.updatedAt=now();c.activity.push({id:id(),at:c.updatedAt,type,message});}
function short(value,max=160){return typeof value==='string'?value.trim().slice(0,max):'';}
export async function createCase(input={}){const c={id:id(),title:short(input.title)||'Untitled case',context:{worker:short(input.worker),employer:short(input.employer),stage:['pending-claim','no-claim'].includes(input.stage)?input.stage:'unknown',claimNumber:short(input.claimNumber),recipient:short(input.recipient)},version:1,createdAt:now(),updatedAt:now(),sources:[],revisions:[],currentRevisionId:null,reviewedRevisionId:null,reviewedSourceDigest:null,activeJobId:null,lastJobId:null,exampleId:null,importedPhases:[],activity:[]};await saveCase(c);return c;}
export async function listCases(){
  await initStore();const entries=await readdir(path.join(DATA,'cases'),{withFileTypes:true});
  const rows=await Promise.all(entries.filter(entry=>entry.isDirectory()).map(async entry=>{
    try{
      const c=await readCase(entry.name);
      const analysis=c.revisions.find(r=>r.id===c.currentRevisionId)?.analysis;
      return {id:c.id,title:c.title,worker:analysis?analysis.caseContext?.workerName??'':c.context.worker,employer:analysis?analysis.caseContext?.employerName??'':c.context.employer,updatedAt:c.updatedAt,version:c.version,exampleId:c.exampleId??null,sourceCount:c.sources.length,revisionCount:c.revisions.length,reviewed:!!c.currentRevisionId&&c.reviewedRevisionId===c.currentRevisionId&&c.reviewedSourceDigest===sourceDigest(c),status:c.activeJobId?'analyzing':c.currentRevisionId?(c.revisions.find(r=>r.id===c.currentRevisionId)?.sourceDigest!==sourceDigest(c)?'needs-analysis':'ready'):'collecting'};
    }catch(e){return {id:entry.name,title:'Saved case needs recovery',worker:'',employer:'',updatedAt:null,version:null,sourceCount:0,revisionCount:0,reviewed:false,status:'needs-recovery',unavailable:true,message:e.status?e.message:'The saved case cannot be read. Original files are preserved.'};}
  }));
  return rows.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
}
export async function saveJob(j){j.updatedAt=now();await atomicJson(path.join(jobDir(j.id),'job.json'),j);return j;}
export async function readJob(jobId){try{return JSON.parse(await readFile(path.join(jobDir(jobId),'job.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw error('NOT_FOUND','Analysis job not found.',404);throw e;}}
export async function recoverJobs(){
  await initStore();const jobs=await readdir(path.join(DATA,'jobs'));
  for(const name of jobs){
    let j;try{j=await readJob(name);}catch{continue;}
    if(!['queued','running'].includes(j.status))continue;
    const c=await readCase(j.caseId).catch(()=>null);
    const committed=c?.revisions.find(r=>r.createdByJobId===j.id&&r.sourceDigest===j.sourceDigest);
    if(committed){
      j.status='completed';j.stage='ready';j.revisionId=committed.id;j.error=null;j.recoveredCommit=true;
      j.message='Your proposed update was saved before interruption. Job status recovered from that revision.';
      j.completedAt=committed.createdAt;
    }else{
      j.status='failed';j.stage='interrupted';j.message='The application stopped during analysis. Sources and previous revisions are safe; run analysis again.';
      j.error={code:'INTERRUPTED',message:j.message};j.completedAt=now();
      for(const attempt of j.attempts??[])if(attempt.status==='running'){attempt.status='interrupted';attempt.completedAt=j.completedAt;}
    }
    j.timings??={};j.timings.totalMs=Math.max(0,Date.parse(j.completedAt)-Date.parse(j.createdAt));
    await saveJob(j);
    try{await withCase(j.caseId,async current=>{if(current.activeJobId===j.id){current.activeJobId=null;current.lastJobId=j.id;touch(current,committed?'analysis-recovered':'analysis-interrupted',j.message);await saveCase(current);}});}catch{}
  }
}
