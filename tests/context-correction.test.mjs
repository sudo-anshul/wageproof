import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {renderSupplement,validateAnalysis} from '../domain/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
let directory,server,base,invocations;
const fixtures={};
const intake={worker:'Earlier Worker',employer:'Earlier Employer',stage:'pending-claim',claimNumber:'EARLIER100',recipient:'Deputy Earlier'};
const makeAnalysis=citation=>({schemaVersion:'1.0',summary:'Synthetic context regression only.',caseContext:{workerName:'Earlier Worker',employerName:'Earlier Employer',claimNumber:'EARLIER100',claimStatus:'pending',purpose:'Prepare a factual update',recipient:'Deputy Earlier',asOf:null,attribution:'Synthetic directly seeded fixture; not model or practitioner output.',citations:citation?[citation]:[]},scope:{jurisdiction:'unknown',rule:'unassessed',basisStatus:'unknown',assumptions:[],workweek:null,workday:null,exclusions:[],citations:[]},periods:[],payments:[],issues:[],responseClaims:[],actions:[],unassessedCategories:['All legal categories'],changeNarrative:'Synthetic initial account.'});
const header=(text,label)=>text.match(new RegExp('^\\*\\*'+label+':\\*\\* (.+)$','m'))?.[1]?.trim()??null;
const htmlHeader=(text,label)=>text.match(new RegExp('<strong>'+label+':</strong> ([^<]+)'))?.[1]?.trim()??null;
function zipFiles(bytes){const files=new Map();let position=0;while(bytes.readUInt32LE(position)===0x04034b50){assert.equal(bytes.readUInt16LE(position+8),0);const size=bytes.readUInt32LE(position+18),nameSize=bytes.readUInt16LE(position+26),extra=bytes.readUInt16LE(position+28),start=position+30+nameSize+extra;files.set(bytes.subarray(position+30,position+30+nameSize).toString(),bytes.subarray(start,start+size));position=start+size;}return files;}
async function request(route,value){
  assert.ok(!route.includes('/analyze'),'Context tests never request inference');
  const response=await fetch(base+route,value===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  return {status:response.status,value:await response.json()};
}
async function correct(c,changes){
  const previous=c.revisions.find(r=>r.id===c.currentRevisionId),analysis=structuredClone(previous.analysis);
  Object.assign(analysis.caseContext,changes);
  const result=await request(`/cases/${c.id}/revisions`,{expectedVersion:c.version,analysis,reason:'Synthetic correction: the earlier identity or routing information is no longer established.'});
  assert.equal(result.status,200);const next=result.value,revision=next.revisions.find(r=>r.id===next.currentRevisionId);
  assert.equal(revision.review,null);assert.deepEqual(next.revisions.slice(0,-1),c.revisions);
  assert.equal(next.reviewedRevisionId,c.reviewedRevisionId);assert.deepEqual(next.context,c.context);
  assert.equal(next.sources.length,c.sources.length+1);assert.equal(next.sources.at(-1).kind,'correction');
  assert.equal(validateAnalysis(revision.analysis,next.sources).valid,true);
  return {caseRecord:next,revision};
}
async function exportsFor(c,revision){
  const get=async(format,asset)=>{
    const response=await fetch(base+`/cases/${c.id}/export?`+new URLSearchParams({format,revision:revision.id,...(asset?{asset}:{})}));
    assert.equal(response.status,200);return response;
  };
  const markdown=await(await get('md')).text(),html=await(await get('html')).text();
  const preview=await(await get('preview')).text(),previewDetail=await(await get('preview','supplement.html')).text();
  const files=zipFiles(Buffer.from(await(await get('zip')).arrayBuffer()));
  const manifest=JSON.parse(files.get('manifest.json'));assert.equal(manifest.revision.id,revision.id);
  return {markdown,html,preview,previewDetail,files,manifest};
}
function assertContext(exports,expected){
  for(const [field,value] of Object.entries(expected)){
    assert.equal(header(exports.markdown,field),value,`standalone md ${field}`);
    assert.equal(htmlHeader(exports.html,field),value,`standalone html ${field}`);
    assert.equal(header(exports.files.get('supplement.md').toString(),field),value,`portable md ${field}`);
    assert.equal(htmlHeader(exports.files.get('supplement.html').toString(),field),value,`portable html ${field}`);
    assert.equal(htmlHeader(exports.previewDetail,field),value,`portable preview detail ${field}`);
  }
}
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'wageproof-context-'));
  process.env.WAGEPROOF_DATA_DIR=path.join(directory,'data');
  // Direct test fixtures are installed before the server owns its isolated data
  // directory. They are schema-valid user-origin snapshots, never fake model runs.
  const [{createCase,saveCase,sourceDigest,now},{addFiles},{makeRevision}]=await Promise.all([import('../server/store.mjs'),import('../server/extract.mjs'),import('../server/jobs.mjs')]);
  for(const name of ['clear','unknown','not-filed','parties','history']){
    let c=await createCase({title:'Synthetic '+name,...intake});
    const text='Synthetic initial details: Earlier Worker, Earlier Employer, claim EARLIER100, pending, Deputy Earlier.';
    c=await addFiles(c,[{name:'synthetic-intake.txt',buffer:Buffer.from(text)}],'worker-account');
    const analysis=makeAnalysis({sourceId:c.sources[0].id,lineStart:1,lineEnd:1,quote:text});assert.equal(validateAnalysis(analysis,c.sources).valid,true);
    const revision=makeRevision(c,analysis,{origin:'user',reason:'Directly seeded synthetic verification fixture'});
    revision.review={status:'reviewed',at:now(),note:'Synthetic review-status fixture, not practitioner review.'};
    c.revisions.push(revision);c.currentRevisionId=revision.id;c.reviewedRevisionId=revision.id;c.reviewedSourceDigest=sourceDigest(c);
    await saveCase(c);fixtures[name]=structuredClone(c);
  }
  const bin=path.join(directory,'bin');await mkdir(bin);await mkdir(path.join(directory,'empty-config'));
  invocations=path.join(directory,'codex-invocations.jsonl');
  await writeFile(path.join(bin,'codex'),`#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(invocations)},JSON.stringify(process.argv.slice(2))+'\\n');process.exit(process.argv.slice(2).join(' ')==='--version'?1:77);\n`,{mode:0o700});
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base=`http://127.0.0.1:${port}/api`;
  server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:String(port),PATH:bin+path.delimiter+process.env.PATH,CODEX_HOME:path.join(directory,'empty-config')},stdio:['ignore','pipe','pipe']});
  let errors='';server.stderr.on('data',bytes=>errors+=bytes.toString());
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Isolated context server timeout: '+errors)),10000);server.stdout.on('data',bytes=>{if(bytes.toString().includes('WageProof local server')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Isolated context server exited '+code+': '+errors));});});
  const health=(await request('/health')).value;assert.equal(health.provider.available,false);assert.equal(health.build.pid,server.pid);
});
after(async()=>{
  if(server&&server.exitCode===null&&server.signalCode===null)await new Promise((resolve,reject)=>{
    const force=setTimeout(()=>server.kill('SIGKILL'),2000),bound=setTimeout(()=>reject(new Error('Owned context test server did not stop')),5000);
    server.once('exit',()=>{clearTimeout(force);clearTimeout(bound);resolve();});server.kill('SIGTERM');
  });
  if(directory)await rm(directory,{recursive:true,force:true});
});

test('clearing recipient and claim number persists unknowns across every export format and review',async()=>{
  const {caseRecord:c,revision}=await correct(fixtures.clear,{recipient:null,claimNumber:null});
  assert.equal(revision.analysis.caseContext.recipient,null);assert.equal(revision.analysis.caseContext.claimNumber,null);
  assert.match(c.sources.at(-1).text,/caseContext\.recipient:.*unknown \(null\)/);
  const expected={'Recipient':'Assigned deputy/contact not supplied; verify against existing correspondence','Claim number':'Not supplied'};
  const outputs=await exportsFor(c,revision);assertContext(outputs,expected);
  assert.equal(header(revision.supplement,'Recipient'),expected.Recipient);
  assert.match(outputs.files.get('update.md').toString(),/\*\*Recipient:\*\* Not supplied/);
  assert.match(outputs.preview,/<strong>Recipient:<\/strong> Not supplied/);
  const reviewed=await request(`/cases/${c.id}/review`,{expectedVersion:c.version,revisionId:revision.id,note:'Synthetic test review only.'});assert.equal(reviewed.status,200);
  const reviewedRevision=reviewed.value.revisions.at(-1);assert.ok(reviewedRevision.review.at);assert.deepEqual(reviewed.value.revisions[0],fixtures.clear.revisions[0]);
  assertContext(await exportsFor(reviewed.value,reviewedRevision),expected);
});

test('claim status unknown cannot recover the original pending intake status',async()=>{
  const {caseRecord:c,revision}=await correct(fixtures.unknown,{claimStatus:'unknown'});
  assert.equal(revision.analysis.caseContext.claimStatus,'unknown');assert.equal(revision.analysis.caseContext.recipient,null);assert.equal(revision.analysis.caseContext.claimNumber,null);
  const outputs=await exportsFor(c,revision);
  assertContext(outputs,{'Claim status':'Not established','Claim number':'Not supplied','Recipient':'Not supplied; do not address to an invented deputy'});
  assert.doesNotMatch(outputs.markdown,/DLSE processing policies say a claimant/);
  assert.match(outputs.preview,/status not established/);
});

test('no filed claim status respects automatically cleared earlier claim and recipient',async()=>{
  const {caseRecord:c,revision}=await correct(fixtures['not-filed'],{claimStatus:'not_filed'});
  assert.equal(revision.analysis.caseContext.claimNumber,null);assert.equal(revision.analysis.caseContext.recipient,null);
  assertContext(await exportsFor(c,revision),{'Claim status':'No filed claim reported','Claim number':'Not supplied','Recipient':'Not supplied; do not address to an invented deputy'});
});

test('withdrawing worker and employer names does not substitute the intake parties',async()=>{
  const {caseRecord:c,revision}=await correct(fixtures.parties,{workerName:null,employerName:null});
  assert.equal(revision.analysis.caseContext.workerName,null);assert.equal(revision.analysis.caseContext.employerName,null);
  assertContext(await exportsFor(c,revision),{'Worker':'Not supplied','Employer':'Not supplied'});
  const listed=await request('/cases');assert.equal(listed.status,200);
  const row=listed.value.cases.find(item=>item.id===c.id);assert.ok(row,'Corrected case remains listed');
  assert.equal(row.worker,'');assert.equal(row.employer,'');
  const saved=await request(`/cases/${c.id}`);assert.equal(saved.status,200);
  assert.equal(saved.value.context.worker,fixtures.parties.context.worker);
  assert.equal(saved.value.context.employer,fixtures.parties.context.employer);
});

test('historical revisions retain their own context after a later correction',async()=>{
  const cleared=await correct(fixtures.history,{recipient:null,claimNumber:null});
  const original=structuredClone(cleared.revision);
  const later=await correct(cleared.caseRecord,{recipient:'Newly Supplied Recipient',claimNumber:'NEW200'});
  assert.deepEqual(later.caseRecord.revisions[1],original);
  assertContext(await exportsFor(later.caseRecord,later.revision),{'Recipient':'Newly Supplied Recipient','Claim number':'NEW200'});
  const old=await exportsFor(later.caseRecord,original);
  assertContext(old,{'Recipient':'Assigned deputy/contact not supplied; verify against existing correspondence','Claim number':'Not supplied'});
  assert.equal(old.manifest.revision.review.historical,true);
  const initial=await exportsFor(later.caseRecord,later.caseRecord.revisions[0]);
  assertContext(initial,{'Recipient':'Deputy Earlier','Claim number':'EARLIER100'});
});

test('mutable intake cannot change a selected complete or partial legacy revision context',()=>{
  for(const context of [null,{}, {workerName:null,employerName:null,recipient:null,claimNumber:null,claimStatus:'unknown'}]){
    const analysis=makeAnalysis();analysis.caseContext=context;
    const revision={analysis,id:'synthetic-legacy',number:1,createdAt:'2026-09-24T00:00:00.000Z'};
    const first=renderSupplement({caseRecord:{context:intake},revision});
    const second=renderSupplement({caseRecord:{context:{worker:'Other Worker',employer:'Other Employer',recipient:'Other Recipient',claimNumber:'OTHER300',stage:'no-claim'}},revision});
    assert.equal(first,second);assert.equal(header(first,'Worker'),'Not supplied');assert.equal(header(first,'Claim status'),'Not established');
  }
});

test('no-analysis output does not turn intake details into a proposed revision',()=>{
  assert.equal(renderSupplement({caseRecord:{context:intake}}),'# Claim update and reconciliation supplement\n\nNo proposed analysis is available.\n');
});

test('context corrections created no model requests or jobs',async()=>{
  assert.deepEqual(await readdir(path.join(directory,'data/jobs')),[]);
  const calls=(await readFile(invocations,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.ok(calls.length>0);assert.ok(calls.every(args=>args.length===1&&args[0]==='--version'));
});
