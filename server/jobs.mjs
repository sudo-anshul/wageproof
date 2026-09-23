import {createHash} from 'node:crypto';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {analysisSchema,buildAnalysisPrompt,validateAnalysis,reconcile,revisionComparison,renderSupplement} from '../domain/index.mjs';
import {runModel} from './model.mjs';
import {id,now,error,sourceDigest,withCase,expectVersion,touch,saveCase,readCase,saveJob,readJob,jobDir} from './store.mjs';

let queue=Promise.resolve(),closing=false;
const controllers=new Map();
export async function stopAnalysisWorker(){closing=true;for(const controller of controllers.values())controller.abort();await queue.catch(()=>{});}

export function makeRevision(c,analysis,{origin='user',reason='Account corrected',model=null,validation={warnings:[]},createdByJobId=null,correctionNotice=null}={}){
  const previous=c.revisions.find(r=>r.id===c.currentRevisionId);
  const reviewed=c.revisions.find(r=>r.id===c.reviewedRevisionId);
  const calculation=reconcile(analysis);
  const r={id:id(),number:c.revisions.length+1,createdAt:now(),reason,sourceDigest:sourceDigest(c),sourceIds:c.sources.map(s=>s.id),origin,analysis,calculation,reconciliation:calculation,supplement:'',validation,review:null,model};
  r.sincePrevious=revisionComparison(previous,r);
  r.sinceReviewed=revisionComparison(reviewed,r);
  r.changes=r.sincePrevious;
  if(createdByJobId)r.createdByJobId=createdByJobId;
  if(correctionNotice)r.correctionNotice=correctionNotice;
  r.supplement=renderSupplement({caseRecord:{...c,currentRevisionId:r.id},revision:r});
  return r;
}

export async function createAnalysisJob(caseId,expectedVersion){
  if(closing)throw error('SERVER_STOPPING','The local app is stopping. Restart it before analyzing again.',503);
  return withCase(caseId,async c=>{
    if(c.activeJobId){const active=await readJob(c.activeJobId);if(['queued','running'].includes(active.status))return active;}
    expectVersion(c,expectedVersion);
    if(!c.sources.length)throw error('NO_SOURCES','Add a record or a worker account before analysis.');
    const createdAt=now();
    const j={id:id(),caseId,status:'queued',stage:'queued',message:'Waiting for the local analysis worker…',createdAt,updatedAt:createdAt,sourceDigest:sourceDigest(c),baseRevisionId:c.currentRevisionId,error:null,revisionId:null,attempts:[],timings:{}};
    c.activeJobId=j.id;c.lastJobId=j.id;touch(c,'analysis-started','Analysis requested for the current source set.');j.caseVersion=c.version;
    await saveJob(j);await saveCase(c);
    queue=queue.catch(()=>{}).then(()=>execute(j.id));
    return j;
  });
}

async function execute(jobId){
  if(closing)return;
  let j=await readJob(jobId);if(j.status==='cancelled')return;
  const controller=new AbortController();controllers.set(jobId,controller);
  const started=Date.now();
  try{
    j.status='running';j.stage='reading';j.startedAt=now();j.timings.queueMs=started-Date.parse(j.createdAt);
    j.message='Reading records and building a proposed case revision…';await saveJob(j);
    const snapshot=await readCase(j.caseId);
    if(snapshot.version!==j.caseVersion||sourceDigest(snapshot)!==j.sourceDigest)throw error('STALE_ANALYSIS','The source set changed before analysis began. Run analysis on the latest records.',409);
    const previous=snapshot.revisions.find(r=>r.id===j.baseRevisionId)?.analysis||null;
    const context={...snapshot.context,workerName:snapshot.context.worker,employerName:snapshot.context.employer,claimStatus:snapshot.context.stage};
    let prompt=buildAnalysisPrompt({sources:snapshot.sources,previousAnalysis:previous,context}),result,checked;
    for(let attempt=0;attempt<2;attempt++){
      if(controller.signal.aborted)throw error('CANCELLED','Analysis cancelled.');
      const dir=path.join(jobDir(j.id),`attempt-${attempt+1}`);
      j.attempts[attempt]={number:attempt+1,startedAt:now(),status:'running'};
      await saveJob(j);
      const recordMetadata=async metadata=>{
        // Reload cancellation state so an attempt callback cannot revive a job.
        j=await readJob(jobId);
        j.attempts??=[];
        j.attempts[attempt]={...j.attempts[attempt],number:attempt+1,...metadata};
        await saveJob(j);
      };
      try{
        result=await runModel({prompt,schema:analysisSchema,jobDir:dir,signal:controller.signal,onMetadata:recordMetadata});
        if(j.attempts[attempt]?.status==='running')await recordMetadata({...result.metadata,status:'completed',completedAt:now()});
      }catch(e){
        if(e.modelMetadata)await recordMetadata(e.modelMetadata);
        else await recordMetadata({status:controller.signal.aborted?'cancelled':'failed',completedAt:now(),errorCode:e.code||'MODEL_FAILED'});
        throw e;
      }
      if(controller.signal.aborted)throw error('CANCELLED','Analysis cancelled.');
      j.stage='checking';j.message='Checking quoted sources, payment constraints and arithmetic…';await saveJob(j);
      const checkingStarted=Date.now();
      checked=validateAnalysis(result.analysis,snapshot.sources);
      j.timings.validationMs=(j.timings.validationMs||0)+Date.now()-checkingStarted;
      j.attempts[attempt].validation={valid:checked.valid,errorCount:checked.errors.length,warningCount:checked.warnings.length};
      if(!checked.valid)j.attempts[attempt].status='validation_failed';
      await saveJob(j);
      if(checked.valid)break;
      await writeFile(path.join(dir,'validation.json'),JSON.stringify(checked,null,2));
      if(attempt===1)throw error('ANALYSIS_VALIDATION','The proposed interpretation failed source or accounting checks. Your prior account is preserved. Retry or clarify the source text.',422,checked.errors);
      j.stage='repairing';j.message='Repairing an interpretation that did not match its source references…';await saveJob(j);
      prompt=buildAnalysisPrompt({sources:snapshot.sources,previousAnalysis:previous,context})+'\n\nYour prior attempted JSON failed validation. Produce a complete corrected response; do not discard supported facts just to avoid a check. Validation errors:\n'+JSON.stringify(checked.errors)+'\nPrior attempt:\n'+JSON.stringify(result.analysis);
    }
    if(controller.signal.aborted)throw error('CANCELLED','Analysis cancelled.');
    const commitStarted=Date.now();
    await withCase(j.caseId,async c=>{
      if(c.activeJobId!==j.id||c.version!==j.caseVersion||sourceDigest(c)!==j.sourceDigest||c.currentRevisionId!==j.baseRevisionId)throw error('STALE_ANALYSIS','The case changed while this analysis was running. The newer account was preserved; analyze the current source set.',409);
      const r=makeRevision(c,checked.analysis,{origin:'model',reason:previous?'New evidence reconciled':'Initial account reconstructed',createdByJobId:j.id,model:{...result.metadata,promptHash:createHash('sha256').update(prompt).digest('hex'),schemaHash:createHash('sha256').update(JSON.stringify(analysisSchema)).digest('hex')},validation:{warnings:checked.warnings}});
      c.revisions.push(r);c.currentRevisionId=r.id;c.activeJobId=null;
      const ctx=r.analysis.caseContext||{};if(!c.context.worker&&ctx.workerName)c.context.worker=ctx.workerName;if(!c.context.employer&&ctx.employerName)c.context.employer=ctx.employerName;
      if(c.title==='Untitled case')c.title=c.context.worker?`${c.context.worker} · pay review`:'Pay review';
      touch(c,'revision-created',`Revision ${r.number} proposed. Inspect the changes before marking it reviewed.`);
      await saveCase(c);
      j.revisionId=r.id;
    });
    j.status='completed';j.stage='ready';j.message='Your proposed update is ready to review.';
    j.timings.commitMs=Date.now()-commitStarted;
    j.completedAt=now();j.timings.totalMs=Date.now()-Date.parse(j.createdAt);j.timings.processingMs=Date.now()-started;
    await saveJob(j);
  }catch(e){
    j=await readJob(jobId);
    // A durable case commit is the receipt for success even if the following
    // job-file write failed. Startup uses the same receipt after a process crash.
    const current=await readCase(j.caseId).catch(()=>null);
    const committed=current?.revisions.find(r=>r.createdByJobId===j.id&&r.sourceDigest===j.sourceDigest);
    if(committed){
      j.status='completed';j.stage='ready';j.revisionId=committed.id;j.error=null;j.recoveredCommit=true;
      j.message='Your proposed update was saved. Job status recovered from the committed revision.';
    }else{
      const cancelled=controller.signal.aborted||e.code==='CANCELLED'||j.status==='cancelled';
      j.status=cancelled?'cancelled':'failed';j.stage=j.status;
      j.message=cancelled?'Analysis cancelled. Sources and previous revisions are preserved.':e.message;
      j.error=cancelled?null:{code:e.code||'ANALYSIS_FAILED',message:e.message,details:e.details};
      await withCase(j.caseId,async c=>{if(c.activeJobId===j.id){c.activeJobId=null;touch(c,'analysis-stopped',j.message);await saveCase(c);}}).catch(()=>{});
    }
    j.completedAt=now();j.timings??={};j.timings.totalMs=Date.now()-Date.parse(j.createdAt);j.timings.processingMs=Date.now()-started;
    await saveJob(j);
  }finally{controllers.delete(jobId);}
}

export async function cancelJob(jobId){
  const initial=await readJob(jobId);
  return withCase(initial.caseId,async c=>{
    const j=await readJob(jobId);
    const committed=c.revisions.find(r=>r.createdByJobId===j.id&&r.sourceDigest===j.sourceDigest);
    if(committed){
      j.status='completed';j.stage='ready';j.revisionId=committed.id;j.error=null;
      j.message='Your proposed update was already saved before cancellation reached it.';
      j.completedAt??=committed.createdAt;await saveJob(j);return j;
    }
    if(!['queued','running'].includes(j.status))return j;
    controllers.get(jobId)?.abort();
    j.status='cancelled';j.stage='cancelled';j.message='Analysis cancelled. Sources and previous revisions are preserved.';
    j.completedAt=now();j.timings??={};j.timings.totalMs=Date.now()-Date.parse(j.createdAt);
    if(c.activeJobId===j.id){c.activeJobId=null;touch(c,'analysis-cancelled',j.message);await saveCase(c);}
    await saveJob(j);return j;
  });
}
