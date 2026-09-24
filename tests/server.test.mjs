import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';

// Isolated transport/state tests. This fake process exercises failure/replay;
// it is never used by the application or counted as model evaluation.
let dir,child,base,port;
const emptyAnalysis={schemaVersion:'1.0',summary:'Test proposal with no factual reconstruction.',caseContext:{workerName:null,employerName:null,claimNumber:null,claimStatus:'unknown',purpose:'Factual update',recipient:null,asOf:null,attribution:'Test-only state exercise',citations:[]},scope:{jurisdiction:'unknown',rule:'unassessed',basisStatus:'unknown',assumptions:[],workweek:null,workday:null,exclusions:[],citations:[]},periods:[],payments:[],issues:[],responseClaims:[],actions:[],unassessedCategories:['All legal categories'],changeNarrative:'Test-only state exercise'};
async function request(p,b,extra={}){const r=await fetch(base+p,{...(b!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}),...extra});const value=await r.json();return {status:r.status,value};}
const create=async()=>{const r=await request('/cases',{title:'Isolated API test'});assert.equal(r.status,201);return r.value;};
async function upload(c,entries){const form=new FormData();form.append('expectedVersion',String(c.version));for(const [name,text] of entries)form.append('files',new Blob([text]),name);return request('/cases/'+c.id+'/sources',undefined,{method:'POST',body:form});}
async function poll(jobId){for(let i=0;i<80;i++){const {value}=await request('/jobs/'+jobId);if(!['queued','running'].includes(value.job.status))return value.job;await new Promise(r=>setTimeout(r,100));}throw new Error('Test job did not end');}
async function startServer(){
  child=spawn(process.execPath,['server/index.mjs'],{cwd:path.resolve('.'),env:{...process.env,PORT:String(port),WAGEPROOF_DATA_DIR:path.join(dir,'data'),PATH:path.join(dir,'bin')+path.delimiter+process.env.PATH},stdio:['ignore','pipe','pipe']});
  let err='';child.stderr.on('data',b=>err+=b.toString());await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Server startup timeout '+err)),10000);child.stdout.on('data',b=>{if(b.toString().includes('WageProof local server')){clearTimeout(t);resolve();}});child.on('exit',code=>{clearTimeout(t);reject(new Error('Server exited '+code+' '+err));});});
}
before(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),'wageproof-api-'));await mkdir(path.join(dir,'bin'));
  const fake=`#!/usr/bin/env node\nimport fs from 'node:fs';\nif(process.argv.includes('--version')){console.log('test-only');process.exit(0);}\nprocess.stdin.resume();\nsetTimeout(()=>{const p=process.argv[process.argv.indexOf('--output-last-message')+1];fs.writeFileSync(p,${JSON.stringify(JSON.stringify(emptyAnalysis))});console.log('{}');},900);\n`;
  await writeFile(path.join(dir,'bin','codex'),fake,{mode:0o700});await writeFile(path.join(dir,'bin','package.json'),' {"type":"module"}');
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;await startServer();
});
after(async()=>{child?.kill('SIGTERM');if(child)await new Promise(r=>{child.on('exit',r);setTimeout(r,1000).unref();});await rm(dir,{recursive:true,force:true});});
test('file import is byte-idempotent and failed batches preserve the prior case',async()=>{
  let c=await create();let r=await upload(c,[['record.txt','Worker account: the payment allocation is unknown.']]);assert.equal(r.status,200);c=r.value;assert.equal(c.sources.length,1);
  r=await upload(c,[['same-record.txt','Worker account: the payment allocation is unknown.']]);assert.equal(r.value.version,c.version);assert.equal(r.value.sources.length,1);
  r=await upload(c,[['new.txt','This must roll back.'],['unsafe.exe','not allowed']]);assert.equal(r.status,400);const saved=(await request('/cases/'+c.id)).value;assert.equal(saved.sources.length,1);assert.equal(saved.version,c.version);
  const original=await fetch(base+'/cases/'+c.id+'/sources/'+c.sources[0].id+'/file');assert.equal(await original.text(),'Worker account: the payment allocation is unknown.');
});
test('stale writes, foreign origins and traversal-like identifiers are rejected',async()=>{
  let c=await create();const old=c.version;c=(await request('/cases/'+c.id+'/notes',{title:'Account',text:'Known note',expectedVersion:c.version})).value;
  assert.equal((await request('/cases/'+c.id+'/notes',{text:'Stale overwrite',expectedVersion:old})).status,409);
  assert.equal((await request('/cases',{title:'Unwanted'}, {method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'})).status,403);
  assert.equal((await request('/cases/not%20a%20uuid')).status,400);
});
test('a late model result cannot replace an account with newly added sources',async()=>{
  let c=await create();c=(await upload(c,[['account.txt','A source for the isolated state test.']])).value;
  const started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});assert.equal(started.status,202);const j=started.value.job;
  c=(await request('/cases/'+c.id)).value;c=(await request('/cases/'+c.id+'/notes',{text:'A later correction must survive.',expectedVersion:c.version})).value;
  const done=await poll(j.id);assert.equal(done.status,'failed');assert.equal(done.error.code,'STALE_ANALYSIS');c=(await request('/cases/'+c.id)).value;assert.equal(c.sources.length,2);assert.equal(c.currentRevisionId,null);assert.equal(c.activeJobId,null);
});
test('exact version review becomes stale after additional evidence and cannot be revived',async()=>{
  let c=await create();c=(await upload(c,[['account.txt','A factual update can retain unknowns.']])).value;
  const start=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});assert.equal((await poll(start.value.job.id)).status,'completed');c=(await request('/cases/'+c.id)).value;assert.ok(c.currentRevisionId);
  const revision=c.currentRevisionId;c=(await request('/cases/'+c.id+'/review',{revisionId:revision,expectedVersion:c.version,note:'Automated state test, not human validation.'})).value;assert.equal(c.reviewedRevisionId,revision);
  c=(await request('/cases/'+c.id+'/notes',{text:'New supporting record.',expectedVersion:c.version})).value;
  assert.equal((await request('/cases')).value.cases.find(row=>row.id===c.id).status,'needs-analysis');
  const refused=await request('/cases/'+c.id+'/review',{revisionId:revision,expectedVersion:c.version});assert.equal(refused.status,409);assert.equal(refused.value.error.code,'SOURCES_CHANGED');
  const staleEdit=structuredClone(c.revisions[0].analysis);staleEdit.summary='A summary edit must not adopt unprocessed sources.';const correction=await request('/cases/'+c.id+'/revisions',{analysis:staleEdit,reason:'Minor wording',expectedVersion:c.version});assert.equal(correction.status,409);assert.equal(correction.value.error.code,'SOURCES_CHANGED');assert.equal((await request('/cases/'+c.id)).value.revisions.length,1);
  const exported=await(await fetch(base+'/cases/'+c.id+'/export')).text();assert.match(exported,/later case material requires fresh review/i);assert.match(exported,/New source material exists after this version/i);
});

test('typed corrections atomically add attributed provenance and preserve earlier revisions',async()=>{
  let c=await create();c=(await upload(c,[['account.txt','Original retained source.']])).value;
  const start=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});assert.equal((await poll(start.value.job.id)).status,'completed');c=(await request('/cases/'+c.id)).value;
  const original=c.revisions[0],edited=structuredClone(original.analysis);edited.summary='I need to correct the factual purpose of this update.';
  const invalid=structuredClone(edited);invalid.schemaVersion='wrong';
  assert.equal((await request('/cases/'+c.id+'/revisions',{analysis:invalid,reason:'Test correction',expectedVersion:c.version})).status,422);
  assert.equal((await request('/cases/'+c.id)).value.sources.length,1);
  const saved=await request('/cases/'+c.id+'/revisions',{analysis:edited,reason:'My account was transcribed incorrectly.',expectedVersion:c.version});assert.equal(saved.status,200);c=saved.value;
  assert.equal(c.sources.length,2);assert.deepEqual(c.revisions[0],original);assert.equal(c.revisions[1].review,null);assert.doesNotMatch(c.revisions[1].supplement,/This is a historical version/);
  const note=c.sources[1],citation=c.revisions[1].analysis.caseContext.citations[0];assert.equal(note.kind,'correction');assert.equal(citation.sourceId,note.id);assert.match(note.text,/My account was transcribed incorrectly/);assert.match(note.text,/summary:/);
  assert.equal(await(await fetch(base+'/cases/'+c.id+'/sources/'+note.id+'/file')).text(),note.text);
  const htmlResponse=await fetch(base+'/cases/'+c.id+'/export?format=html');const html=await htmlResponse.text();assert.equal(htmlResponse.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(html,/href="#source-R1"/);assert.match(html,/<h3 id="source-R1">/);assert.match(html,/blockquote p\{white-space:pre-line\}/);assert.doesNotMatch(html,/\[\^R1\]/);
  const noChange=await request('/cases/'+c.id+'/revisions',{analysis:c.revisions[1].analysis,reason:'No change',expectedVersion:c.version});assert.equal(noChange.value.version,c.version);assert.equal(noChange.value.sources.length,2);
  const citationOnly=structuredClone(c.revisions[1].analysis);citationOnly.caseContext.citations=[];
  const rejected=await request('/cases/'+c.id+'/revisions',{analysis:citationOnly,reason:'Cannot erase provenance',expectedVersion:c.version});assert.equal(rejected.status,422);assert.equal(rejected.value.error.code,'CORRECTION_PROVENANCE_ONLY');
});

test('cancelled analysis retains the last revision and permits a fresh attempt',async()=>{
  let c=await create();c=(await upload(c,[['record.txt','This record must survive cancellation.']])).value;
  let started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});await poll(started.value.job.id);c=(await request('/cases/'+c.id)).value;const prior=c.currentRevisionId;
  started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});const cancelled=await request('/jobs/'+started.value.job.id+'/cancel',{});assert.equal(cancelled.value.job.status,'cancelled');
  c=(await request('/cases/'+c.id)).value;assert.equal(c.currentRevisionId,prior);assert.equal(c.activeJobId,null);assert.equal(c.sources.length,1);
  started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});assert.equal((await poll(started.value.job.id)).status,'completed');
  c=(await request('/cases/'+c.id)).value;assert.equal(c.revisions.length,2);assert.equal(c.revisions[0].id,prior);
});

test('restart marks interrupted work recoverable and preserves reviewed revision',async()=>{
  let c=await create();c=(await upload(c,[['record.txt','Original evidence persists across restart.']])).value;
  let started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});await poll(started.value.job.id);c=(await request('/cases/'+c.id)).value;
  c=(await request('/cases/'+c.id+'/review',{expectedVersion:c.version,revisionId:c.currentRevisionId,note:'Test-only review'})).value;const reviewed=c.currentRevisionId;
  started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});const interrupted=started.value.job.id;
  const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await stopped;await startServer();
  const job=(await request('/jobs/'+interrupted)).value.job;assert.equal(job.status,'failed');assert.equal(job.error.code,'INTERRUPTED');
  c=(await request('/cases/'+c.id)).value;assert.equal(c.activeJobId,null);assert.equal(c.currentRevisionId,reviewed);assert.equal(c.reviewedRevisionId,reviewed);assert.equal(c.sources.length,1);assert.equal(c.lastJobId,interrupted);assert.equal(c.activity.at(-1).type,'analysis-interrupted');
  started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});assert.equal((await poll(started.value.job.id)).status,'completed');
});

test('duplicate servers cannot recover or mutate the active data folder',async()=>{
  let c=await create();c=(await upload(c,[['record.txt','A running case must survive duplicate launch.']])).value;
  const started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});
  const duplicate=spawn(process.execPath,['server/index.mjs'],{cwd:path.resolve('.'),env:{...process.env,PORT:'0',WAGEPROOF_DATA_DIR:path.join(dir,'data'),PATH:path.join(dir,'bin')+path.delimiter+process.env.PATH},stdio:['ignore','pipe','pipe']});
  let diagnostic='';duplicate.stderr.on('data',b=>diagnostic+=b.toString());
  const code=await new Promise(r=>duplicate.once('exit',r));assert.notEqual(code,0);assert.match(diagnostic,/already open in another server/);
  assert.equal((await poll(started.value.job.id)).status,'completed');c=(await request('/cases/'+c.id)).value;assert.equal(c.revisions.length,1);assert.equal(c.activeJobId,null);
});

function zipEntries(buffer){
  const files=new Map();let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50){
    const size=buffer.readUInt32LE(offset+18),nameSize=buffer.readUInt16LE(offset+26),extraSize=buffer.readUInt16LE(offset+28);
    const name=buffer.subarray(offset+30,offset+30+nameSize).toString('utf8');
    const start=offset+30+nameSize+extraSize;files.set(name,buffer.subarray(start,start+size));offset=start+size;
  }
  return files;
}

test('portable API preserves exact revision and selection with working packet preview links',async()=>{
  let c=await create();c=(await upload(c,[['record.txt','The exact original bytes are retained.']])).value;
  const started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});const completed=await poll(started.value.job.id);
  assert.equal(completed.status,'completed');assert.equal(completed.attempts.length,1);
  assert.equal(completed.attempts[0].status,'completed');assert.equal(completed.attempts[0].validation.valid,true);
  assert.ok(completed.timings.totalMs>=completed.timings.processingMs);assert.ok(completed.attempts[0].durationMs>=0);
  c=(await request('/cases/'+c.id)).value;const revisionId=c.currentRevisionId,sourceId=c.sources[0].id;
  c=(await request('/cases/'+c.id+'/review',{expectedVersion:c.version,revisionId})).value;
  c=(await request('/cases/'+c.id+'/notes',{text:'Later material is outside the selected revision.',expectedVersion:c.version})).value;
  const parameters=new URLSearchParams({format:'zip',revision:revisionId,sources:sourceId});
  const response=await fetch(base+'/cases/'+c.id+'/export?'+parameters);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');
  const files=zipEntries(Buffer.from(await response.arrayBuffer()));const manifest=JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.revision.id,revisionId);assert.equal(manifest.revision.review.stale,true);
  assert.equal(manifest.selection.laterSourcesExcluded,1);assert.equal(manifest.sources.length,1);
  assert.equal(files.get(manifest.sources[0].originalPath).toString(),'The exact original bytes are retained.');
  assert.doesNotMatch(files.get('update.html').toString(),/Later material is outside|127\.0\.0\.1|\/api\/cases\//);
  parameters.set('format','preview');const previewResponse=await fetch(base+'/cases/'+c.id+'/export?'+parameters);
  const preview=await previewResponse.text();assert.equal(previewResponse.headers.get('x-frame-options'),'SAMEORIGIN');
  const evidenceHref=preview.match(/href="([^"]+asset=evidence.html[^"]*)"/)?.[1]?.replaceAll('&amp;','&');assert.ok(evidenceHref);
  const evidence=await(await fetch(new URL(evidenceHref,base))).text();assert.match(evidence,/record/);
  const originalHref=evidence.match(/href="([^"]+asset=originals%2F[^"]+)"/)?.[1]?.replaceAll('&amp;','&');assert.ok(originalHref);
  assert.equal(await(await fetch(new URL(originalHref,base))).text(),'The exact original bytes are retained.');
  parameters.set('sources','');parameters.set('format','zip');
  const emptyFiles=zipEntries(Buffer.from(await(await fetch(base+'/cases/'+c.id+'/export?'+parameters)).arrayBuffer()));
  assert.equal(JSON.parse(emptyFiles.get('manifest.json')).sources.length,0);
  parameters.set('sources',c.sources[1].id);assert.equal((await fetch(base+'/cases/'+c.id+'/export?'+parameters)).status,400);
  assert.equal((await request('/cases/'+c.id)).value.version,c.version);
});

test('cancellation after a durable case commit reports the saved revision',async()=>{
  let c=await create();c=(await upload(c,[['record.txt','Commit boundary test.']])).value;
  const started=await request('/cases/'+c.id+'/analyze',{expectedVersion:c.version});const completed=await poll(started.value.job.id);
  c=(await request('/cases/'+c.id)).value;const original=JSON.stringify(c);
  const filename=path.join(dir,'data','jobs',completed.id,'job.json');const interrupted=JSON.parse(await readFile(filename,'utf8'));
  interrupted.status='running';interrupted.stage='checking';interrupted.revisionId=null;await writeFile(filename,JSON.stringify(interrupted));
  const response=await request('/jobs/'+completed.id+'/cancel',{});
  assert.equal(response.value.job.status,'completed');assert.equal(response.value.job.revisionId,c.currentRevisionId);
  assert.equal(JSON.stringify((await request('/cases/'+c.id)).value),original);
});
