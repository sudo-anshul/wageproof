import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,cp,readFile,writeFile,readdir,rm,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadPreparedExample,PREPARED_EXAMPLE_ID,labelPreparedExport,preparedExportProvenance} from '../server/prepared-example.mjs';
import {sourceDigest} from '../server/store.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=path.join(root,'examples/prepared-walkthrough');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const unavailable=e=>e.code==='PREPARED_EXAMPLE_UNAVAILABLE'&&e.status===503;
let directory,child,base,app,serverFixture,codexLog,data;

async function fixtureCopy(t){
  const dir=await mkdtemp(path.join(directory,'fixture-'));await cp(fixture,dir,{recursive:true});
  t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
async function mutateManifest(dir,change){
  const file=path.join(dir,'manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));
  change(manifest);await writeFile(file,JSON.stringify(manifest));
}
async function mutateCase(dir,change){
  const file=path.join(dir,'case.json'),value=JSON.parse(await readFile(file,'utf8'));
  change(value);const bytes=Buffer.from(JSON.stringify(value));await writeFile(file,bytes);
  await mutateManifest(dir,manifest=>{manifest.caseFile.bytes=bytes.length;manifest.caseFile.sha256=digest(bytes);});
}
async function treeSnapshot(dir){
  const rows=[];
  const walk=async(folder,prefix='')=>{
    for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const name=prefix+entry.name;
      if(entry.isDirectory()){rows.push([name+'/']);await walk(path.join(folder,entry.name),name+'/');}
      else rows.push([name,digest(await readFile(path.join(folder,entry.name)))]);
    }
  };await walk(dir);return rows;
}
async function request(route,options){const response=await fetch(base+route,options);return {status:response.status,value:await response.json(),headers:response.headers};}
function zipEntries(bytes){
  const entries=new Map();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    assert.equal(bytes.readUInt16LE(offset+8),0,'ZIP members use stored bytes');
    const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString(),start=offset+30+nameLength+extraLength;
    entries.set(name,bytes.subarray(start,start+size));offset=start+size;
  }return entries;
}
async function stopServer(){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    const force=setTimeout(()=>child.kill('SIGKILL'),2000);
    const bound=setTimeout(()=>{clearTimeout(force);reject(new Error('Owned isolated server did not stop.'));},5000);
    child.once('exit',()=>{clearTimeout(force);clearTimeout(bound);resolve();});child.kill('SIGTERM');
  });
}
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'wageproof-prepared-'));
  app=path.join(directory,'app');await mkdir(app);
  for(const name of ['server','domain','examples'])await cp(path.join(root,name),path.join(app,name),{recursive:true});
  await mkdir(path.join(app,'scripts'));await cp(path.join(root,'scripts/store-lock.py'),path.join(app,'scripts/store-lock.py'));
  await cp(path.join(root,'package.json'),path.join(app,'package.json'));
  await symlink(path.join(root,'node_modules'),path.join(app,'node_modules'),'dir');
  await mkdir(path.join(directory,'bin'));await mkdir(path.join(directory,'empty-codex-config'));
  codexLog=path.join(directory,'codex-invocations.jsonl');data=path.join(directory,'data');
  // A trap only: no fabricated model response. Any attempted inference is logged
  // and immediately refused. No application or evaluation uses this process.
  const trap=`#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(codexLog)},JSON.stringify(process.argv.slice(2))+'\\n');process.exit(process.argv.slice(2).join(' ')==='--version'?1:77);\n`;
  await writeFile(path.join(directory,'bin','codex'),trap,{mode:0o700});
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base=`http://127.0.0.1:${port}/api`;
  serverFixture=path.join(app,'examples/prepared-walkthrough');
  child=spawn(process.execPath,['server/index.mjs'],{cwd:app,env:{...process.env,PORT:String(port),WAGEPROOF_DATA_DIR:data,CODEX_HOME:path.join(directory,'empty-codex-config'),PATH:path.join(directory,'bin')+path.delimiter+process.env.PATH},stdio:['ignore','pipe','pipe']});
  let diagnostic='';child.stderr.on('data',bytes=>diagnostic+=bytes.toString());
  await new Promise((resolve,reject)=>{
    const bound=setTimeout(()=>reject(new Error('Prepared API startup timed out: '+diagnostic)),10000);
    child.stdout.on('data',bytes=>{if(bytes.toString().includes('WageProof local server')){clearTimeout(bound);resolve();}});
    child.once('exit',code=>{clearTimeout(bound);reject(new Error('Prepared API exited '+code+': '+diagnostic));});
  });
});
after(async()=>{await stopServer();if(directory)await rm(directory,{recursive:true,force:true});});

test('the fixed example retains original history and derives its reviewed comparisons',async()=>{
  const loaded=await loadPreparedExample(),raw=JSON.parse(await readFile(path.join(fixture,'case.json'),'utf8'));
  const {caseRecord:c,metadata}=loaded;
  assert.equal(c.id,PREPARED_EXAMPLE_ID);assert.equal(c.readOnly,true);assert.equal(metadata.available,true);
  assert.equal(c.preparedExample.recordedAt,'2026-09-24T01:25:49.962Z');assert.equal(c.preparedExample.sourceRelease,'upgrade-candidate-4');
  assert.match(c.preparedExample.reviewMeaning,/technical review.*not worker or practitioner approval/i);
  assert.equal(c.createdAt,raw.createdAt);assert.equal(c.updatedAt,raw.updatedAt);assert.equal(c.version,raw.version);
  assert.deepEqual(c.sources,raw.sources);assert.equal(c.revisions.length,3);
  for(const [index,r] of c.revisions.entries()){
    for(const key of Object.keys(raw.revisions[index]))assert.deepEqual(r[key],raw.revisions[index][key]);
    assert.equal(r.sinceReviewed.baselineRevisionId,index?c.revisions[index-1].id:null);
    assert.equal(r.sincePrevious.baselineRevisionId,index?c.revisions[index-1].id:null);
  }
  assert.deepEqual(c.revisions.map(r=>r.calculation.totals.differenceMinCents),[14000,8000,8000]);
  assert.deepEqual(c.revisions[2].calculation.periods.map(p=>p.differenceMinCents),[5500,2500]);
  assert.equal(c.activeJobId,null);assert.equal(c.lastJobId,null);assert.deepEqual(c.activity,[]);
  assert.throws(()=>{c.revisions[0].analysis.summary='changed';},TypeError);
  const original=await loaded.readOriginal(c.sources[0]);original[0]^=1;
  assert.equal(digest(await loaded.readOriginal(c.sources[0])),c.sources[0].sha256);
  await assert.rejects(loaded.readOriginal({id:'outside'}),e=>e.status===404);
});

test('prepared inspection and all exports need no configured model, job or user-store write',async()=>{
  const before=await treeSnapshot(data);
  const health=await request('/health');assert.equal(health.value.provider.available,false);
  const metadata=await request('/prepared-example');assert.equal(metadata.status,200);assert.equal(metadata.value.available,true);
  assert.equal(metadata.headers.get('cache-control'),'no-store');
  const loaded=await request('/cases/prepared-example');assert.equal(loaded.status,200);const c=loaded.value;
  assert.deepEqual((await request('/cases')).value.cases,[]);
  for(const source of c.sources){
    const meta=await request(`/cases/prepared-example/sources/${source.id}`);assert.deepEqual(meta.value,source);
    const response=await fetch(base+`/cases/prepared-example/sources/${source.id}/file`);assert.equal(response.status,200);
    assert.equal(digest(Buffer.from(await response.arrayBuffer())),source.sha256);
  }
  assert.equal((await request('/cases/prepared-example/sources/unknown/file')).status,404);
  for(const revision of c.revisions){
    const query=new URLSearchParams({format:'zip',revision:revision.id});
    const response=await fetch(base+'/cases/prepared-example/export?'+query);assert.equal(response.status,200);
    const files=zipEntries(Buffer.from(await response.arrayBuffer())),manifest=JSON.parse(files.get('manifest.json'));
    assert.equal(manifest.revision.id,revision.id);assert.equal(manifest.caseId,PREPARED_EXAMPLE_ID);
    assert.equal(manifest.preparedExample.fictional,true);assert.equal(manifest.preparedExample.recordedModelOutputs,true);
    assert.equal(manifest.preparedExample.sourceRelease,c.preparedExample.sourceRelease);
    assert.equal(manifest.preparedExample.manifestSha256,c.preparedExample.manifestSha256);
    assert.deepEqual(manifest.preparedExample.review,revision.review);
    assert.deepEqual(manifest.sources.map(s=>s.id),revision.sourceIds);
    for(const source of manifest.sources){
      assert.equal(digest(files.get(source.originalPath)),c.sources.find(s=>s.id===source.id).sha256);
    }
    for(const member of ['update.html','update.md','supplement.html','supplement.md','evidence.html','evidence.md']){
      const contents=files.get(member).toString();assert.match(contents,/Prepared fictional example/);
      assert.match(contents,/No new analysis or review was performed/);assert.match(contents,/technical review.*not worker or practitioner approval/i);
      assert.ok(contents.includes(revision.review.at));assert.match(contents,/conditional.*not a finding of legal entitlement/);
    }
    assert.doesNotMatch(files.get('update.html').toString(),/\/api\/cases\/|127\.0\.0\.1/);
    query.set('format','preview');const preview=await fetch(base+'/cases/prepared-example/export?'+query);
    assert.equal(preview.status,200);assert.equal(preview.headers.get('x-frame-options'),'SAMEORIGIN');
    const html=await preview.text(),evidenceHref=html.match(/href="([^"]+asset=evidence.html[^"]*)"/)?.[1]?.replaceAll('&amp;','&');assert.ok(evidenceHref);
    const evidence=await(await fetch(new URL(evidenceHref,base))).text();
    const originalHref=evidence.match(/href="([^"]+asset=originals%2F[^"]+)"/)?.[1]?.replaceAll('&amp;','&');assert.ok(originalHref);
    assert.equal((await fetch(new URL(originalHref,base))).status,200);
    query.set('format','html');const printable=await fetch(base+'/cases/prepared-example/export?'+query);assert.equal(printable.status,200);
    const printableHtml=await printable.text();assert.match(printableHtml,/\/api\/cases\/prepared-example\/sources\//);
    assert.match(printableHtml,/Prepared fictional example/);assert.match(printableHtml,/technical review.*not worker or practitioner approval/i);
    query.set('format','md');const markdown=await fetch(base+'/cases/prepared-example/export?'+query);assert.equal(markdown.status,200);
    const markdownText=await markdown.text();assert.ok(markdownText.includes(revision.review.at));assert.match(markdownText,/Prepared fictional example/);
  }
  const old=c.revisions[0],later=c.sources.at(-1).id;
  const invalidSelection=await request('/cases/prepared-example/export?'+new URLSearchParams({format:'zip',revision:old.id,sources:later}));
  assert.equal(invalidSelection.status,400);
  assert.equal((await request('/cases/prepared-example/export?revision=unknown')).status,404);
  assert.deepEqual(await treeSnapshot(data),before);
  const invocations=(await readFile(codexLog,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.ok(invocations.length>0);assert.ok(invocations.every(args=>args.length===1&&args[0]==='--version'));
});

test('every non-GET prepared case route refuses before parsing, state or analysis',async()=>{
  const before=await treeSnapshot(data),calls=await readFile(codexLog,'utf8');
  const paths=['','/analyze','/review','/revisions','/sources','/notes','/example-phase','/export','/anything-new'];
  for(const suffix of paths)for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
    const result=await request('/cases/prepared-example'+suffix,{method,headers:{'Content-Type':'application/json'},body:'{invalid'});
    assert.equal(result.status,403,method+suffix);assert.equal(result.value.error.code,'PREPARED_EXAMPLE_READ_ONLY');
  }
  const encoded=await request('/cases/%70repared-example/analyze',{method:'POST'});
  assert.equal(encoded.status,403);assert.equal(encoded.value.error.code,'PREPARED_EXAMPLE_READ_ONLY');
  const head=await fetch(base+'/cases/prepared-example',{method:'HEAD'});assert.equal(head.status,403);
  assert.deepEqual(await treeSnapshot(data),before);assert.equal(await readFile(codexLog,'utf8'),calls);
});

test('the API reports a missing or corrupt bundled fixture as unavailable without a fallback',async()=>{
  const file=path.join(serverFixture,'manifest.json'),original=await readFile(file),before=await treeSnapshot(data);
  try{
    for(const corruption of ['missing','invalid']){
      if(corruption==='missing')await unlink(file);else await writeFile(file,'{}');
      for(const route of ['/prepared-example','/cases/prepared-example','/cases/prepared-example/export?format=zip']){
        const response=await request(route);assert.equal(response.status,503);assert.equal(response.value.error.code,'PREPARED_EXAMPLE_UNAVAILABLE');
      }
      assert.deepEqual((await request('/cases')).value.cases,[]);
    }
  }finally{await writeFile(file,original);}
  assert.equal((await request('/prepared-example')).status,200);assert.deepEqual(await treeSnapshot(data),before);
});

test('unsafe manifest members and symlinked originals are refused',async t=>{
  for(const member of ['../case.json','/etc/passwd','originals/../../case.json'])await t.test(member,async t=>{
    const dir=await fixtureCopy(t);await mutateManifest(dir,m=>{m.caseFile.path=member;});await assert.rejects(loadPreparedExample(dir),unavailable);
  });
  await t.test('unsafe original path',async t=>{
    const dir=await fixtureCopy(t);await mutateManifest(dir,m=>{m.originals[0].path='../case.json';});await assert.rejects(loadPreparedExample(dir),unavailable);
  });
  await t.test('symlinked original',async t=>{
    const dir=await fixtureCopy(t),manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
    const member=manifest.originals[0].path;await unlink(path.join(dir,member));await symlink(path.join(fixture,member),path.join(dir,member));
    await assert.rejects(loadPreparedExample(dir),unavailable);
  });
  await t.test('symlinked fixture directory',async t=>{
    const link=path.join(directory,'linked-fixture');await symlink(fixture,link);t.after(()=>unlink(link));await assert.rejects(loadPreparedExample(link),unavailable);
  });
});

test('tampered case bytes, original bytes and bound normalized text cannot render',async t=>{
  await t.test('case hash',async t=>{const dir=await fixtureCopy(t);await writeFile(path.join(dir,'case.json'),'{}');await assert.rejects(loadPreparedExample(dir),unavailable);});
  await t.test('original hash',async t=>{const dir=await fixtureCopy(t),m=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));await writeFile(path.join(dir,m.originals[0].path),'tampered');await assert.rejects(loadPreparedExample(dir),unavailable);});
  await t.test('normalized text',async t=>{const dir=await fixtureCopy(t);await mutateCase(dir,c=>{c.sources[0].text+=' invented text';});await assert.rejects(loadPreparedExample(dir),unavailable);});
});

test('rebound bytes still require valid citations, historical snapshots and exact accounting',async t=>{
  const corruptions={
    'unsupported quotation':c=>{c.revisions[0].analysis.periods[0].citations[0].quote='This quotation never occurred.';},
    'citation to a later source':c=>{const source=c.sources.at(-1);c.revisions[0].analysis.periods[0].citations[0]={sourceId:source.id,lineStart:1,lineEnd:1,quote:source.text.split('\n')[0]};},
    'future source in old snapshot':c=>{const r=c.revisions[0];r.sourceIds.push(c.sources.at(-1).id);r.sourceDigest=sourceDigest({sources:c.sources.filter(s=>r.sourceIds.includes(s.id))});},
    'incorrect calculation':c=>{c.revisions[2].calculation.totals.differenceMinCents++;},
    'unsupported schema':c=>{c.revisions[0].analysis.schemaVersion='0.0';},
    'invalid current pointer':c=>{c.currentRevisionId=c.revisions[0].id;},
    'invented review date':c=>{c.revisions[0].review.at='2030-01-01T00:00:00.000Z';}
  };
  for(const [label,change] of Object.entries(corruptions))await t.test(label,async t=>{const dir=await fixtureCopy(t);await mutateCase(dir,change);await assert.rejects(loadPreparedExample(dir),unavailable);});
});

test('saved job metadata and cached comparisons never enter the public prepared case',async t=>{
  const dir=await fixtureCopy(t);
  await mutateCase(dir,c=>{
    c.activeJobId='active-model-job';c.lastJobId='last-model-job';c.provider={private:'discard'};c.activity=[{message:'discard'}];
    for(const r of c.revisions){r.model={provider:'discard'};r.createdByJobId='discard';r.supplement='untrusted cache';r.sinceReviewed={baselineRevisionId:'forged'};r.sincePrevious={baselineRevisionId:'forged'};}
  });
  const {caseRecord:c}=await loadPreparedExample(dir);assert.equal(c.activeJobId,null);assert.equal(c.lastJobId,null);assert.equal(c.provider,undefined);assert.deepEqual(c.activity,[]);
  for(const [index,r] of c.revisions.entries()){
    assert.equal(r.model,undefined);assert.equal(r.createdByJobId,undefined);assert.equal(r.supplement,undefined);
    assert.equal(r.sinceReviewed.baselineRevisionId,index?c.revisions[index-1].id:null);
    assert.equal(r.sincePrevious.baselineRevisionId,index?c.revisions[index-1].id:null);
  }
});

test('ordinary cases remain editable and list cards identify editable fictional examples',async()=>{
  const fresh=await request('/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Isolated fresh case'})});
  assert.equal(fresh.status,201);assert.equal(fresh.value.readOnly,undefined);
  const note=await request(`/cases/${fresh.value.id}/notes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Isolated note, no model call.',expectedVersion:fresh.value.version})});
  assert.equal(note.status,200);
  const example=await request('/examples/01-partial-allocation/start',{method:'POST'});assert.equal(example.status,201);
  const rows=(await request('/cases')).value.cases;assert.equal(rows.length,2);
  assert.equal(rows.find(c=>c.id===fresh.value.id).exampleId,null);
  assert.equal(rows.find(c=>c.id===example.value.id).exampleId,'01-partial-allocation');
  assert.ok(rows.every(c=>c.id!==PREPARED_EXAMPLE_ID));assert.deepEqual(await readdir(path.join(data,'jobs')),[]);
  const calls=(await readFile(codexLog,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.ok(calls.every(args=>args.length===1&&args[0]==='--version'));
});

test('prepared provenance wrappers leave ordinary export text exactly unchanged',()=>{
  const markdown='# Ordinary case\n\nExact **text**, spacing  and [source](originals/record.txt).\n';
  for(const c of [{id:'ordinary-case'},{id:'ordinary-case',readOnly:true,preparedExample:{label:'untrusted'}},{id:PREPARED_EXAMPLE_ID,readOnly:false}]){
    assert.equal(labelPreparedExport(markdown,c,{}),markdown);assert.equal(preparedExportProvenance(c,{}),null);
  }
});
