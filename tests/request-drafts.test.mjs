import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {requestDrafts,exportRequestDraft} from '../server/request-drafts.mjs';
import {PREPARED_EXAMPLE_ID} from '../server/prepared-example.mjs';

// Recorded fictional demo reused only as a known transport/state regression.
// These tests do not run a model or count as new evaluation evidence.
let directory,server,base,template;
const cases={};
async function request(route,body,options={}){
  assert.ok(!route.includes('/analyze'),'Request draft tests never request inference');
  const response=await fetch(base+route,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),...options});
  const value=response.headers.get('content-type')?.includes('json')?await response.json():await response.text();
  return {status:response.status,value,response};
}
const current=async name=>(await request(`/cases/${cases[name]}`)).value;
const route=c=>`/cases/${c.id}/request-drafts`;
const input=(c,extra={})=>({expectedVersion:c.version,revisionId:c.currentRevisionId,actionId:'action-004',recipient:'Payroll (verify contact)',subject:'Reconciliation records',body:'Please explain the remaining wage calculation.\nDo not resend the supplied weekly split.',...extra});
const exportRoute=(c,draft)=>route(c)+'/export?'+new URLSearchParams({draftId:draft.id,draftVersion:draft.version});
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'wageproof-requests-'));
  template=JSON.parse(await readFile('examples/prepared-walkthrough/case.json','utf8'));
  for(const name of ['workflow','new-source','correction','conflict','invalid','limit','active']){
    const c=structuredClone(template);c.id='request-test-'+name;c.title='Synthetic request state '+name;
    c.readOnly=false;c.activeJobId=name==='active'?'test-running-job':null;c.lastJobId=null;delete c.requestDrafts;
    const d=path.join(directory,'data','cases',c.id);await mkdir(d,{recursive:true});
    await writeFile(path.join(d,'case.json'),JSON.stringify(c));cases[name]=c.id;
  }
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  base=`http://127.0.0.1:${port}/api`;
  server=spawn(process.execPath,['server/index.mjs'],{cwd:path.resolve('.'),env:{...process.env,PORT:String(port),WAGEPROOF_DATA_DIR:path.join(directory,'data')},stdio:['ignore','pipe','pipe']});
  let errors='';server.stderr.on('data',b=>errors+=b.toString());
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Test server timeout '+errors)),10000);server.stdout.on('data',b=>{if(b.toString().includes('WageProof local server')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Test server exited '+code+': '+errors));});});
});
after(async()=>{
  if(server?.exitCode===null&&server?.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>server.kill('SIGKILL'),3000);server.once('exit',()=>{clearTimeout(timer);resolve();});server.kill('SIGTERM');});
  if(directory)await rm(directory,{recursive:true,force:true});
});

test('old case gets current focused seed without reopening answered or internal actions',async()=>{
  const c=await current('workflow'),response=await request(route(c)),list=response.value;
  assert.equal(response.status,200);assert.equal(list.caseVersion,c.version);assert.equal(list.canPrepare,true);assert.equal(list.readOnly,false);assert.deepEqual(list.drafts,[]);
  assert.deepEqual(list.actions.map(a=>a.id),['action-004']);
  const action=list.actions[0];assert.equal(action.type,'payroll_record_request');assert.equal(action.seed.recipient,'');
  assert.match(action.seed.body,/\$800/);assert.match(action.seed.body,/\$25 and \$35/);assert.match(action.seed.body,/need not be requested again/);
  assert.ok(action.seed.body.includes(action.detail));assert.equal(action.basis.revisionId,c.currentRevisionId);
  assert.deepEqual(action.basis.citations,c.revisions.at(-1).analysis.actions.at(-1).citations);
  const historical=(await request(route(c)+'?revision='+c.revisions[0].id)).value;assert.equal(historical.canPrepare,false);assert.match(historical.reason,/earlier revision/);
});
test('save, edit and reload preserve accounting, sources, review and earlier revisions; export exactly saved text',async()=>{
  const before=await current('workflow');let result=await request(route(before),input(before));assert.equal(result.status,200);
  let {case:c,draft}=result.value;assert.equal(c.version,before.version+1);assert.equal(draft.version,1);assert.equal(draft.current,true);
  for(const key of ['sources','revisions','currentRevisionId','reviewedRevisionId','reviewedSourceDigest','context'])assert.deepEqual(c[key],before[key],key+' preserved');
  assert.equal(c.activity.at(-1).type,'request-draft-saved');assert.match(c.activity.at(-1).message,/Unsent/);
  const first=structuredClone(draft),editedBody='User-edited wording: <script>alert(1)</script> & $80.\nLiteral, unsent text.';
  result=await request(route(c),input(c,{draftId:draft.id,recipient:'',body:editedBody}));assert.equal(result.status,200);({case:c,draft}=result.value);
  assert.equal(draft.id,first.id);assert.equal(draft.version,2);assert.equal(draft.createdAt,first.createdAt);assert.deepEqual(draft.basis,first.basis);
  const reload=(await request(route(c))).value;assert.equal(reload.drafts.length,1);assert.equal(reload.drafts[0].body,editedBody);
  const jsonExport=await request(exportRoute(c,draft));assert.equal(jsonExport.status,200);assert.match(jsonExport.value.text,/UNSENT REQUEST DRAFT/);assert.ok(jsonExport.value.text.includes(editedBody));
  assert.match(jsonExport.value.text,/To: Not confirmed/);assert.match(jsonExport.value.text,/Editable request wording is not independently verified/);assert.match(jsonExport.value.text,/Source excerpts/);
  const file=await request(exportRoute(c,draft)+'&format=txt');assert.equal(file.value,jsonExport.value.text);assert.match(file.response.headers.get('content-type'),/^text\/plain/);assert.equal(file.response.headers.get('x-content-type-options'),'nosniff');
  const changed=await request(exportRoute(c,first));assert.equal(changed.status,409);assert.equal(changed.value.error.code,'REQUEST_DRAFT_CHANGED');
  const again=await current('workflow');assert.equal(again.version,c.version);assert.deepEqual(again.requestDrafts,c.requestDrafts);
});
test('new source makes saved requests read-only and rejects save/export without mutating old draft',async()=>{
  let c=await current('new-source');let saved=await request(route(c),input(c));const draft=saved.value.draft;c=saved.value.case;
  c=(await request(`/cases/${c.id}/notes`,{expectedVersion:c.version,title:'New evidence',text:'Fictional later record requires reconciliation.'})).value;
  const list=(await request(route(c))).value;assert.equal(list.canPrepare,false);assert.equal(list.drafts[0].current,false);assert.match(list.drafts[0].reason,/New sources/);
  const update=await request(route(c),input(c,{draftId:draft.id,body:'Do not save stale'}));assert.equal(update.status,409);assert.equal(update.value.error.code,'SOURCES_CHANGED');
  assert.equal((await request(exportRoute(c,draft))).status,409);assert.equal((await current('new-source')).requestDrafts[0].body,draft.body);
});
test('revision correction retains old draft for inspection and permits a separate new draft',async()=>{
  let c=await current('correction'),saved=await request(route(c),input(c));const old=saved.value.draft;c=saved.value.case;
  const analysis=structuredClone(c.revisions.at(-1).analysis);analysis.summary+=' User adds an explicit uncertainty.';
  const result=await request(`/cases/${c.id}/revisions`,{expectedVersion:c.version,analysis,reason:'Synthetic user correction for draft revision regression.'});assert.equal(result.status,200);c=result.value;
  const list=(await request(route(c))).value;assert.equal(list.drafts[0].current,false);assert.match(list.drafts[0].reason,/earlier revision/);
  assert.equal((await request(exportRoute(c,old))).status,409);
  const stale=await request(route(c),input(c,{draftId:old.id}));assert.equal(stale.status,409);assert.equal(stale.value.error.code,'REQUEST_DRAFT_STALE');
  saved=await request(route(c),input(c));assert.equal(saved.status,200);assert.notEqual(saved.value.draft.id,old.id);assert.equal(saved.value.case.requestDrafts.length,2);
  assert.deepEqual(saved.value.case.requestDrafts[0],c.requestDrafts[0]);
});
test('concurrent writers cannot silently overwrite each other',async()=>{
  let c=await current('conflict');const saved=await request(route(c),input(c));c=saved.value.case;const draft=saved.value.draft;
  const results=await Promise.all(['first edit','second edit'].map(body=>request(route(c),input(c,{draftId:draft.id,body}))));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const success=results.find(r=>r.status===200),failure=results.find(r=>r.status===409);
  assert.equal(failure.value.error.code,'STALE_VERSION');assert.equal((await current('conflict')).requestDrafts[0].body,success.value.draft.body);
});
test('reject malformed fields, ineligible actions, missing version and cross-origin writes atomically',async()=>{
  const c=await current('invalid');
  for(const extra of [{recipient:'x\ny'},{recipient:null},{subject:''},{subject:'a'.repeat(241)},{body:'x\0y'},{body:'a'.repeat(12001)},{body:42},{revisionId:null},{recipient:'x\u0085y'},{subject:'x\u2028y'},{recipient:'x\u2029y'},{body:'x\u009by'}]){
    const result=await request(route(c),input(c,extra));assert.equal(result.status,422,JSON.stringify(extra).slice(0,70));
  }
  for(const actionId of ['action-001','action-002','action-003','not-there'])assert.equal((await request(route(c),input(c,{actionId}))).value.error.code,'REQUEST_NOT_ELIGIBLE');
  assert.equal((await request(route(c),input(c,{expectedVersion:null}))).status,409);
  assert.equal((await request(route(c),input(c),{headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await current('invalid')).version,c.version);assert.equal((await request(route(c))).value.drafts.length,0);
  const unicode=await request(route(c),input(c,{recipient:'पेरोल — José',subject:'कृपया रिकॉर्ड — résumé',body:'नमस्ते\nPlease supply the records.\tThank you.'}));assert.equal(unicode.status,200);assert.equal(unicode.value.draft.recipient,'पेरोल — José');
});
test('draft limit is explicit, while current draft edits remain usable',async()=>{
  let c=await current('limit'),first;
  for(let n=0;n<50;n++){const result=await request(route(c),input(c,{subject:'Draft '+n}));assert.equal(result.status,200);c=result.value.case;first??=result.value.draft;}
  const refusal=await request(route(c),input(c));assert.equal(refusal.status,409);assert.equal(refusal.value.error.code,'REQUEST_DRAFT_LIMIT');
  const edit=await request(route(c),input(c,{draftId:first.id,subject:'Edited at capacity'}));assert.equal(edit.status,200);assert.equal(edit.value.case.requestDrafts.length,50);
});
test('active analysis blocks draft preparation without cancelling or changing work',async()=>{
  const c=await current('active'),list=(await request(route(c))).value;assert.equal(list.canPrepare,false);assert.match(list.reason,/running analysis/);
  const save=await request(route(c),input(c));assert.equal(save.status,409);assert.equal(save.value.error.code,'ANALYSIS_ACTIVE');assert.equal((await current('active')).activeJobId,c.activeJobId);
});
test('closed or changed action basis and active analysis invalidate drafts even in same revision',()=>{
  const c=structuredClone(template),list=requestDrafts(c),a=list.actions[0],draft={id:'unit-only',version:1,actionId:a.id,revisionId:c.currentRevisionId,sourceDigest:a.basis.sourceDigest,actionFingerprint:a.basis.actionFingerprint,basis:a.basis,...a.seed,createdAt:'2026-09-24T00:00:00Z',updatedAt:'2026-09-24T00:00:00Z'};
  c.revisions.at(-1).analysis.caseContext.workerName=null;assert.doesNotMatch(requestDrafts(c).actions[0].seed.body,/Thank you,\nElena/);
  c.requestDrafts=[draft];assert.equal(requestDrafts(c).drafts[0].current,true);
  c.revisions.at(-1).analysis.actions.at(-1).detail+=' Changed.';assert.equal(requestDrafts(c).drafts[0].current,false);assert.throws(()=>exportRequestDraft(c,{draftId:draft.id,draftVersion:1}),{code:'REQUEST_DRAFT_STALE'});
  c.revisions.at(-1).analysis.actions.at(-1).status='answered';assert.equal(requestDrafts(c).actions.length,0);assert.match(requestDrafts(c).drafts[0].reason,/no longer open/);
  c.activeJobId='unit-job';assert.match(requestDrafts(c).drafts[0].reason,/running analysis/);
});
test('prepared preview is clearly fictional, GET-only and exact; historical preview rejects',async()=>{
  const c=(await request('/cases/'+PREPARED_EXAMPLE_ID)).value;
  assert.ok(c.id,'prepared case must exist');
  const list=(await request(route(c))).value;assert.equal(list.readOnly,true);assert.equal(list.canPrepare,true);
  const q=new URLSearchParams({actionId:'action-004',revision:c.currentRevisionId});const preview=await request(route(c)+'/export?'+q);assert.equal(preview.status,200);assert.match(preview.value.text,/FICTIONAL PREVIEW/);assert.match(preview.value.text,/no request has been saved or sent/);
  const file=await request(route(c)+'/export?'+q+'&format=txt');assert.equal(file.value,preview.value.text);
  const mutation=await request(route(c),input(c));assert.equal(mutation.status,403);assert.equal(mutation.value.error.code,'PREPARED_EXAMPLE_READ_ONLY');
  q.set('revision',c.revisions[0].id);assert.equal((await request(route(c)+'/export?'+q)).status,409);
  assert.equal((await request(route(c))).value.drafts.length,0);
});
