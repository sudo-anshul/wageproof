import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {annotateUserCorrection,validateAnalysis} from '../domain/index.mjs';
import {id,now,error,caseDir,touch,saveCase,sourceDigest} from './store.mjs';
import {limits} from './extract.mjs';
import {makeRevision} from './jobs.mjs';
import {analysisShapeErrors} from '../domain/validation.mjs';
import {prepareConsequentialCorrection} from '../domain/correction-review.mjs';

// The caller holds the case lock. A correction source and its revision become
// visible in one case-file replacement, after all validation has succeeded.
export async function saveCorrection(c,{analysis,reason}){
  const previous=c.revisions.find(r=>r.id===c.currentRevisionId);
  if(!previous)throw error('NO_REVISION','Analyze the source records before correcting the proposed account.',409);
  if(previous.sourceDigest!==sourceDigest(c))throw error('SOURCES_CHANGED','New records have not been analyzed. Analyze the latest source set before correcting this proposal.',409);
  if(typeof reason!=='string'||!reason.trim())throw error('CORRECTION_REASON','Explain the correction so its basis stays with the case.');
  if(reason.length>1200)throw error('CORRECTION_REASON','Use a correction reason of at most 1,200 characters.');
  const shapeErrors=analysisShapeErrors(analysis);
  if(shapeErrors.length)throw error('INVALID_CORRECTION','The corrected account does not match the supported format.',422,shapeErrors);
  const prepared=prepareConsequentialCorrection(previous.analysis,analysis);
  const sourceId=id();let annotated;
  try{annotated=annotateUserCorrection(previous.analysis,prepared.analysis,{sourceId,reason,actor:'Person reviewing this case'});}
  catch(e){throw error(e.code||'INVALID_CORRECTION',e.message,422);}
  if(!annotated.changed)return c;
  const text=annotated.text.trim(),buffer=Buffer.from(text);
  if(c.sources.reduce((sum,s)=>sum+s.text.length,0)+text.length>limits.caseCharacters)throw error('CASE_LIMIT','This correction would exceed the case text limit.');
  const source={id:sourceId,name:`Correction to revision ${previous.number}.txt`,kind:'correction',sha256:createHash('sha256').update(buffer).digest('hex'),size:buffer.length,createdAt:now(),mime:'text/plain',text,lineCount:text.split('\n').length,extraction:{method:'attributed-user-correction',warnings:[]}};
  const next={...c,sources:[...c.sources,source],revisions:[...c.revisions],activity:[...c.activity]};
  const checked=validateAnalysis(annotated.analysis,next.sources);
  if(!checked.valid)throw error('VALIDATION_FAILED','The corrected account needs attention before it can be saved.',422,checked.errors);
  const revision=makeRevision(next,checked.analysis,{reason:reason.trim(),validation:{warnings:checked.warnings},correctionNotice:prepared.notice});
  next.revisions.push(revision);next.currentRevisionId=revision.id;
  touch(next,'account-corrected',`Revision ${revision.number} saved with an attributed correction source. Review applies to this new version.`);
  const dir=path.join(caseDir(c.id),'sources'),target=path.join(dir,sourceId);
  await mkdir(dir,{recursive:true,mode:0o700});await writeFile(target,buffer,{mode:0o600,flag:'wx'});
  try{await saveCase(next);}catch(e){await unlink(target).catch(()=>{});throw e;}
  return next;
}
