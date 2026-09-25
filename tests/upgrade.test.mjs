import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {makeRevision} from '../server/jobs.mjs';
import {compareAnalyses,withRevisionComparisons,validateAnalysis,reconcile,renderSupplement} from '../domain/index.mjs';
import {prepareConsequentialCorrection} from '../domain/correction-review.mjs';

// Hand-specified regression mechanisms, never held-out or model evidence.
const source={id:'declared',name:'Unit declarations.txt',sha256:'a'.repeat(64),kind:'evidence',text:'Adopted gross earned is 100 dollars; original gross paid is zero.\nOne distinct additional 20 dollar gross correction was received for this week.\nThe supporting reconciliation remains missing.'};
const cite=line=>({sourceId:source.id,lineStart:line,lineEnd:line,quote:source.text.split('\n')[line-1]});
const base=()=>({schemaVersion:'1.0',summary:'The earlier account describes a 100 dollar difference.',caseContext:{workerName:null,employerName:null,claimNumber:null,claimStatus:'unknown',purpose:'Factual update',recipient:null,asOf:null,attribution:'Unit declarations',citations:[]},scope:{jurisdiction:'unknown',rule:'unassessed',basisStatus:'unknown',assumptions:[],workweek:null,workday:null,exclusions:[],citations:[]},periods:[{id:'week',label:'Declared week',startDate:null,endDate:null,rateCents:null,originalGrossPaidCents:0,calculationBasis:'reviewed_earned',reviewedGrossEarnedCents:10000,days:[],alternatives:[],notes:'Adopted account',citations:[cite(1)]}],payments:[],issues:[],responseClaims:[],actions:[],unassessedCategories:['Legal entitlement and payment timing'],changeNarrative:'Initial declared account'});
const payment=()=>({id:'correction',label:'Pay correction',eventReference:'UNIT-20',grossCents:2000,netCents:1600,receivedNetCents:1600,paymentDate:null,receiptStatus:'documented',identityStatus:'supported',additionality:'supported',creditStatus:'proposed_credit',creditReason:'Supported unit premises',allocationStatus:'known',allocationScope:'exclusive_supported',periodIds:['week'],allocations:[{periodId:'week',grossCents:2000}],citations:[cite(2)]});
const issue=()=>({id:'reconciliation',title:'Supporting reconciliation missing',status:'open',detail:'The employer explanation does not reconcile the account.',materiality:'support',periodIds:['week'],paymentIds:['correction'],citations:[cite(3)]});
const action=()=>({id:'request',title:'Obtain allocation and supporting reconciliation',detail:'Request both parts.',status:'open',route:'payroll_record_request',priority:'high',custodian:'Payroll',dateRange:null,establishes:'The allocation and reconciliation',dependsOnIssueIds:['reconciliation'],citations:[cite(3)]});

test('multiple unreviewed drafts retain consequential changes since the named reviewed account',()=>{
  const c={id:'test',sources:[source],revisions:[],currentRevisionId:null,reviewedRevisionId:null};
  const first=makeRevision(c,base());first.review={status:'reviewed',at:'2026-01-01T00:00:00Z'};
  c.revisions.push(first);c.currentRevisionId=first.id;c.reviewedRevisionId=first.id;
  const changed=base();changed.payments=[payment()];
  const second=makeRevision(c,changed);c.revisions.push(second);c.currentRevisionId=second.id;
  const wording=structuredClone(changed);wording.summary='The explanation now uses different words.';
  const third=makeRevision(c,wording);
  assert.equal(third.sinceReviewed.baselineRevisionId,first.id);
  assert.equal(third.sincePrevious.baselineRevisionId,second.id);
  assert.equal(third.sincePrevious.changes.some(x=>x.entityType==='schedule'),false);
  const balance=third.sinceReviewed.changes.find(x=>x.entityType==='schedule'&&x.id==='total');
  assert.deepEqual([balance.before,balance.after],['$100.00','$80.00']);
  assert.equal(third.review,null);
  const reverted=makeRevision({...c,currentRevisionId:third.id,revisions:[...c.revisions,third]},base());
  assert.equal(reverted.sinceReviewed.changes.some(x=>x.entityType==='schedule'),false);
});

test('same-total allocation displays changed weekly differences and support-only evidence remains reviewable',()=>{
  const before=base();before.periods.push({...structuredClone(before.periods[0]),id:'week-b',label:'Second week',reviewedGrossEarnedCents:4000});before.payments=[{...payment(),allocationStatus:'unknown',periodIds:['week','week-b'],allocations:[]}];
  const after=structuredClone(before);after.payments[0].allocationStatus='known';after.payments[0].allocations=[{periodId:'week',grossCents:500},{periodId:'week-b',grossCents:1500}];
  const comparison=compareAnalyses(before,after);
  assert.equal(comparison.amountUnchanged,true);
  assert.deepEqual(comparison.changes.filter(x=>x.entityType==='period_amount').map(x=>x.after),['$95.00','$25.00']);
  assert.ok(comparison.changes.find(x=>x.entityType==='payments').citations.length);
  const supported=structuredClone(after);supported.payments[0].citations.push(cite(1));
  assert.equal(compareAnalyses(after,supported).changes.some(x=>x.type==='support_changed'),true);
  const replaced=structuredClone(after);replaced.payments[0].id='new-id';
  const types=compareAnalyses(after,replaced).changes.filter(x=>x.entityType==='payments').map(x=>x.type);
  assert.deepEqual(types,['added','removed']);
});

test('legacy comparison projection cannot rewrite originals or use a future review',()=>{
  const first={id:'r1',number:1,createdAt:'2026-01-01T00:00:00Z',analysis:base(),review:{status:'reviewed',at:'2026-01-03T00:00:00Z'}};
  const second={id:'r2',number:2,createdAt:'2026-01-02T00:00:00Z',analysis:base(),review:null};
  const c={sources:[source],revisions:[first,second]};const original=JSON.stringify(c);
  assert.equal(withRevisionComparisons(c).revisions[1].sinceReviewed.baselineRevisionId,null);
  assert.equal(JSON.stringify(c),original);
});

test('two unassessed totals never become an unchanged established amount',()=>{
  const before=base();before.periods=[];
  const after=structuredClone(before);after.summary='A different factual explanation with no wage account.';
  const comparison=compareAnalyses(before,after);
  assert.equal(comparison.amountUnchanged,false);
  assert.doesNotMatch(comparison.summary,/amount is unchanged/);
  assert.equal(comparison.changes.some(change=>change.id==='total'),false);
});

test('compound requests preserve unanswered work when superseded or partly answered',()=>{
  const a=base();a.payments=[payment()];a.issues=[issue()];a.actions=[{...action(),status:'answered'}];
  assert.equal(validateAnalysis(a,[source]).valid,false);
  a.actions[0].status='partly_answered';assert.equal(validateAnalysis(a,[source]).valid,true);
  a.actions[0].status='superseded';assert.equal(validateAnalysis(a,[source]).valid,false);
  a.actions.push({...action(),id:'remaining',title:'Obtain supporting reconciliation'});
  assert.equal(validateAnalysis(a,[source]).valid,true);
  const md=renderSupplement({revision:{analysis:a}});
  assert.match(md,/Obtain supporting reconciliation/);
  assert.match(md,/superseded/);
  a.actions[0].citations=[];assert.equal(validateAnalysis(a,[source]).valid,false);
});

test('keeping a payment uncertain recomputes money and does not carry stale dependent prose outward',()=>{
  const before=base();before.payments=[payment()];before.issues=[{...issue(),title:'The old $80 balance is unexplained'}];before.actions=[{...action(),title:'Ask payroll about the old $80 balance',detail:'Ask about the old $80 balance.'}];
  before.responseClaims=[{id:'position',statement:'Employer says the correction is complete.',author:'Payroll',status:'unsupported',coverage:'The old remaining balance is $80.',periodIds:['week'],paymentIds:['correction'],issueIds:['reconciliation'],citations:[cite(3)]}];
  before.summary='The old remaining balance is $80.';
  const proposed=structuredClone(before);proposed.payments[0].allocationScope='unknown';proposed.payments[0].creditStatus='unresolved';
  const result=prepareConsequentialCorrection(before,proposed);
  assert.equal(reconcile(result.analysis).totals.creditedGrossCents,0);
  assert.equal(result.analysis.responseClaims[0].status,'unassessed');
  assert.equal(result.analysis.issues[0].status,'unassessed');
  assert.equal(result.analysis.actions[0].route,'review_available');
  assert.equal(result.notice.reopenedActions,1);
  const md=renderSupplement({revision:{analysis:result.analysis}});
  assert.doesNotMatch(md,/old remaining balance is \$80|old \$80 balance/);
  assert.equal(before.responseClaims[0].coverage,'The old remaining balance is $80.');
});

test('explicit simultaneous human interpretation corrections survive and superficial wording does not reopen facts',()=>{
  const before=base();before.payments=[payment()];
  const wording=structuredClone(before);wording.summary='A clearer first sentence.';
  assert.equal(prepareConsequentialCorrection(before,wording).notice,null);
  const corrected=structuredClone(before);corrected.payments[0].grossCents=2500;corrected.payments[0].allocations[0].grossCents=2500;corrected.summary='My explicit corrected explanation.';
  assert.equal(prepareConsequentialCorrection(before,corrected).analysis.summary,'My explicit corrected explanation.');
});

test('payment changes invalidate untouched period explanations and preserve explicit rewritten notes',()=>{
  const before=base();before.payments=[payment()];before.periods[0].notes='The earlier $20 correction leaves $80.';
  const changed=structuredClone(before);changed.payments[0].grossCents=2500;changed.payments[0].allocations[0].grossCents=2500;
  const result=prepareConsequentialCorrection(before,changed);
  assert.equal(reconcile(result.analysis).periods[0].differenceMinCents,7500);
  assert.doesNotMatch(result.analysis.periods[0].notes,/\$20|\$80/);
  assert.ok(result.notice.periodIds.includes('week'));
  changed.periods[0].notes='My corrected explanation for this period.';
  assert.equal(prepareConsequentialCorrection(before,changed).analysis.periods[0].notes,changed.periods[0].notes);
});

test('explicitly rewritten issue detail still invalidates unchanged dependent request prose',()=>{
  const before=base();before.payments=[payment()];before.issues=[issue()];before.actions=[action()];
  const changed=structuredClone(before);changed.payments[0].creditStatus='unresolved';changed.issues[0].detail='My new factual question after the receipt correction.';
  const result=prepareConsequentialCorrection(before,changed);
  assert.equal(result.analysis.issues[0].detail,changed.issues[0].detail);
  assert.equal(result.analysis.actions[0].route,'review_available');
  assert.equal(result.notice.reopenedActions,1);
});

test('claim-stage corrections reopen dependent routing without changing work inputs',()=>{
  const before=base();before.caseContext.claimStatus='pending';before.caseContext.claimNumber='OLD-1';before.caseContext.recipient='Assigned deputy';
  before.scope.assumptions=['Retained accounting scope.'];before.actions=[{...action(),route:'deputy_update',title:'Send the update to the assigned deputy',dependsOnIssueIds:[]}];
  const changed=structuredClone(before);changed.caseContext.claimStatus='not_filed';
  const result=prepareConsequentialCorrection(before,changed);
  assert.equal(result.notice.routingChanged,true);assert.equal(result.analysis.caseContext.recipient,null);assert.equal(result.analysis.caseContext.claimNumber,null);
  assert.equal(result.analysis.actions[0].route,'review_available');assert.deepEqual(result.analysis.periods,before.periods);assert.deepEqual(result.analysis.scope,before.scope);
  assert.doesNotMatch(renderSupplement({revision:{analysis:result.analysis}}),/Send the update to the assigned deputy/);
  changed.caseContext.recipient='Worker intake adviser';assert.equal(prepareConsequentialCorrection(before,changed).analysis.caseContext.recipient,'Worker intake adviser');
});

test('closed factual requests cannot silently strand unresolved dependencies',()=>{
  const a=base();a.payments=[payment()];a.issues=[issue()];a.actions=[{...action(),status:'closed',citations:[]}];
  assert.equal(validateAnalysis(a,[source]).valid,false);
  a.actions[0].citations=[cite(3)];assert.equal(validateAnalysis(a,[source]).valid,false);
  a.actions.push({...action(),id:'remaining',route:'seek_help',title:'Seek help obtaining the unresolved reconciliation'});
  assert.equal(validateAnalysis(a,[source]).valid,true);
  a.actions.push({...action(),id:'old-operation',status:'closed',route:'review_available',dependsOnIssueIds:[],citations:[]});
  assert.equal(validateAnalysis(a,[source]).valid,true);
});

test('startup resolves a durable revision receipt without losing a newer case, and exposes corrupt cases',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'wageproof-recovery-upgrade-'));
  try{
    const script=`import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import * as s from './server/store.mjs';
      const c=await s.createCase({title:'Recovery receipt'});const digest=s.sourceDigest(c);const job={id:'receipt-job',caseId:c.id,createdAt:'2026-01-01T00:00:00Z',status:'running',stage:'checking',sourceDigest:digest,attempts:[]};
      c.revisions=[{id:'committed',createdAt:'2026-01-01T00:00:01Z',createdByJobId:job.id,sourceDigest:digest},{id:'newer',createdAt:'2026-01-01T00:00:02Z',sourceDigest:digest}];c.currentRevisionId='newer';c.activeJobId=null;await s.saveCase(c);await s.saveJob(job);await s.recoverJobs();
      assert.equal((await s.readJob(job.id)).status,'completed');assert.equal((await s.readJob(job.id)).revisionId,'committed');assert.equal((await s.readCase(c.id)).currentRevisionId,'newer');await s.recoverJobs();assert.equal((await s.readCase(c.id)).revisions.length,2);
      await mkdir(path.join(s.DATA,'cases','corrupt'));await writeFile(path.join(s.DATA,'cases','corrupt','case.json'),'{invalid');assert.equal((await s.listCases()).find(x=>x.id==='corrupt').status,'needs-recovery');await assert.rejects(s.readCase('corrupt'),e=>e.code==='CASE_UNREADABLE');console.log('receipt and corruption recovery passed');`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,WAGEPROOF_DATA_DIR:directory},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/recovery passed/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
