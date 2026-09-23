import {createHash} from 'node:crypto';
import {error,id,now,saveCase,sourceDigest,touch} from './store.mjs';

const requestRoutes=new Set(['ordinary_request','payroll_record_request']);
const openStatuses=new Set(['open','partly_answered']);
const maxDrafts=50;
const eligible=action=>action&&requestRoutes.has(action.route)&&openStatuses.has(action.status);
const fingerprint=action=>createHash('sha256').update(JSON.stringify(action)).digest('hex');
const selected=(c,revisionId)=>c.revisions.find(r=>r.id===(revisionId||c.currentRevisionId));
function currentProblem(c,r){
  if(!r)return ['NO_REVISION','Create an analysis before preparing an evidence request.'];
  if(c.activeJobId)return ['ANALYSIS_ACTIVE','Wait for or cancel the running analysis before preparing this request.'];
  if(r.id!==c.currentRevisionId)return ['REQUEST_NOT_CURRENT','This is an earlier revision. Start a draft from the current open request.'];
  if(r.sourceDigest!==sourceDigest(c))return ['SOURCES_CHANGED','New sources need analysis before this request can be prepared or exported.'];
  return null;
}
function assertCurrent(c,r){const problem=currentProblem(c,r);if(problem)throw error(...problem,409);}
function basisFor(r,action){
  return {revisionId:r.id,revisionNumber:r.number,sourceDigest:r.sourceDigest,actionId:action.id,actionFingerprint:fingerprint(action),title:action.title,detail:action.detail,dateRange:action.dateRange,citations:structuredClone(action.citations||[])};
}
function seedFor(r,action){
  const sections=['Please provide the information and supporting records described below.',`Scope of this request\n${action.detail}`];
  if(action.dateRange)sections.push(`Period covered\n${action.dateRange}`);
  if(r.analysis.caseContext?.workerName)sections.push(`Thank you,\n${r.analysis.caseContext.workerName}`);
  return {recipient:'',subject:action.title,body:sections.join('\n\n')};
}
function draftProblem(c,draft){
  const r=selected(c,draft.revisionId),problem=currentProblem(c,r);
  if(problem)return problem[1];
  const action=r.analysis.actions.find(a=>a.id===draft.actionId);
  if(!eligible(action))return 'This request is no longer open. Keep this draft for reference; it cannot be exported as current.';
  if(draft.sourceDigest!==r.sourceDigest||draft.actionFingerprint!==fingerprint(action))return 'The source or request basis changed. Start a new draft from the current request.';
  return null;
}
const describeDraft=(c,draft)=>{const reason=draftProblem(c,draft);return {...draft,current:!reason,reason};};

export function requestDrafts(c,revisionId){
  const r=selected(c,revisionId);
  if(revisionId&&!r)throw error('NOT_FOUND','Revision not found.',404);
  const problem=currentProblem(c,r);
  return {
    caseVersion:c.version,revision:r?{id:r.id,number:r.number}:null,currentRevisionId:c.currentRevisionId,
    readOnly:!!c.readOnly,canPrepare:!problem,reason:problem?.[1]||null,
    actions:(r?.analysis.actions||[]).filter(eligible).map(action=>({...action,type:action.route,basis:basisFor(r,action),seed:seedFor(r,action)})),
    drafts:(c.requestDrafts||[]).map(draft=>describeDraft(c,draft)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
  };
}
function field(value,name,max,multiline=false,optional=false){
  if(typeof value!=='string'||value.length>max||(!optional&&!value.trim())||
    (multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/:/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/).test(value)){
    throw error('REQUEST_DRAFT_INVALID',`${name} must be ${optional?'':'nonempty '}plain text, ${multiline?'':'on one line, '}up to ${max.toLocaleString('en-US')} characters.`,422);
  }
  return value;
}
export async function saveRequestDraft(c,input){
  if(c.readOnly)throw error('PREPARED_EXAMPLE_READ_ONLY','The fictional example is a read-only preview.',403);
  const r=selected(c,input.revisionId);assertCurrent(c,r);
  if(!input.revisionId)throw error('REQUEST_DRAFT_INVALID','Choose the revision this request is based on.',422);
  const action=r.analysis.actions.find(a=>a.id===input.actionId);
  if(!eligible(action))throw error('REQUEST_NOT_ELIGIBLE','Prepare a request only from an open or partly answered records request.',409);
  const drafts=c.requestDrafts||[];
  let previous;
  if(input.draftId!==undefined){
    previous=drafts.find(d=>d.id===input.draftId);
    if(!previous)throw error('NOT_FOUND','Saved request draft not found.',404);
    if(draftProblem(c,previous)||previous.revisionId!==r.id||previous.actionId!==action.id)throw error('REQUEST_DRAFT_STALE','This saved draft belongs to an earlier request basis. Start a new current draft.',409);
  }else if(drafts.length>=maxDrafts)throw error('REQUEST_DRAFT_LIMIT','This case has 50 saved request drafts. Edit a current draft instead of creating another.',409);
  const fields={recipient:field(input.recipient,'Recipient',300,false,true),subject:field(input.subject,'Subject',240),body:field(input.body,'Body',12000,true)};
  const at=now(),draft={id:previous?.id||id(),version:(previous?.version||0)+1,actionId:action.id,revisionId:r.id,sourceDigest:r.sourceDigest,actionFingerprint:fingerprint(action),basis:basisFor(r,action),...fields,createdAt:previous?.createdAt||at,updatedAt:at};
  c.requestDrafts=previous?drafts.map(d=>d.id===draft.id?draft:d):[...drafts,draft];
  touch(c,'request-draft-saved',`Unsent request draft ${previous?'updated':'prepared'} for revision ${r.number}: ${action.title}`);
  await saveCase(c);
  return describeDraft(c,draft);
}
function exportText(c,draft,preview){
  const basis=draft.basis;
  const sources=new Map(c.sources.map(s=>[s.id,s]));
  const citations=basis.citations.map((citation,index)=>{
    const name=sources.get(citation.sourceId)?.name||'Source not available';
    return `[${index+1}] ${name} — lines ${citation.lineStart}–${citation.lineEnd}\n${citation.quote}`;
  });
  return [
    preview?'FICTIONAL PREVIEW — UNSENT REQUEST DRAFT':'UNSENT REQUEST DRAFT',
    `To: ${draft.recipient.trim()||'Not confirmed — choose and verify the recipient before use'}`,
    `Subject: ${draft.subject}`,'',draft.body,'','---','Preparation record',
    `Based on revision ${basis.revisionNumber} (${basis.revisionId}).`,
    preview?'Prepared fictional example; no request has been saved or sent.':`Saved draft ${draft.id}, version ${draft.version}.`,
    'Editable request wording is not independently verified. Preparing this draft does not send it, answer the request, or mark the case reviewed.',
    '',`Why this request remains open\n${basis.detail}`,
    ...(basis.dateRange?[`Period covered: ${basis.dateRange}`]:[]),
    '',citations.length?'Source excerpts for the request basis':'No source excerpts attached to this request basis.',...citations
  ].join('\n')+'\n';
}
export function exportRequestDraft(c,query){
  let draft,preview=!!c.readOnly;
  if(preview){
    const r=selected(c,query.revision);assertCurrent(c,r);
    const action=r.analysis.actions.find(a=>a.id===query.actionId);
    if(!eligible(action))throw error('REQUEST_NOT_ELIGIBLE','Only a current open records request can be previewed.',409);
    draft={...seedFor(r,action),basis:basisFor(r,action)};
  }else{
    draft=(c.requestDrafts||[]).find(d=>d.id===query.draftId);
    if(!draft)throw error('NOT_FOUND','Saved request draft not found.',404);
    if(String(draft.version)!==String(query.draftVersion))throw error('REQUEST_DRAFT_CHANGED','This draft was updated. Reload its saved text before copying or downloading.',409);
    const reason=draftProblem(c,draft);
    if(reason)throw error('REQUEST_DRAFT_STALE',reason,409);
  }
  return {text:exportText(c,draft,preview),filename:`WageProof-${preview?'fictional-preview':c.id.slice(0,8)}-request-r${draft.basis.revisionNumber}.txt`,draftId:draft.id||null,draftVersion:draft.version||null};
}
