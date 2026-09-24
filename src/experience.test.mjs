import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvSource, referencedSourceIds, focusedPaymentCorrection } from './experience.mjs';
import { reconcile } from '../domain/reconcile.mjs';

const account = () => ({
  scope: {}, unassessedCategories: [],
  periods: [{id:'a',label:'Week A',calculationBasis:'reviewed_earned',reviewedGrossEarnedCents:88000,originalGrossPaidCents:80000},{id:'b',label:'Week B',calculationBasis:'reviewed_earned',reviewedGrossEarnedCents:86000,originalGrossPaidCents:80000}],
  payments: [{id:'pay',label:'Correction',eventReference:'x',grossCents:6000,netCents:4800,receivedNetCents:4800,receiptStatus:'documented',identityStatus:'supported',additionality:'supported',creditStatus:'proposed_credit',creditReason:'Supplied correction',allocationScope:'exclusive_supported',periodIds:['a','b'],allocationStatus:'known',allocations:[{periodId:'a',grossCents:2500},{periodId:'b',grossCents:3500}]}]
});
test('CSV multiline/escaped cells retain physical source lines',()=>{
  const parsed=parseCsvSource('week,note,amount\r\nA,"one, two\nline ""quoted""",25.00\r\nB,clear,35.00\r\n');
  assert.equal(parsed.rows[0].cells[1],'one, two\nline "quoted"');
  assert.deepEqual(parsed.rows.map(r=>[r.lineStart,r.lineEnd]),[[2,3],[4,4]]);
  assert.equal(parseCsvSource('a,b\n"unclosed,b'),null);
  assert.equal(parseCsvSource('a,b\n1,2,3'),null);
});
test('uncertain allocation keeps one conserved correction and coupled ranges',()=>{
  const original=account();const revised=focusedPaymentCorrection(original,'pay','allocation','uncertain');
  assert.equal(original.payments[0].allocationStatus,'known');
  assert.deepEqual(revised.payments[0].allocations,[]);
  const result=reconcile(revised);assert.equal(result.totals.differenceMinCents,8000);assert.equal(result.allocationGroups.length,1);
  assert.equal(result.periods[0].differenceMinCents,2000);assert.equal(result.periods[1].differenceMaxCents,6000);
});
test('uncertain identity, additionality and coverage remove unsupported credit',()=>{
  for(const topic of ['identity','additionality','coverage']){
    const revised=focusedPaymentCorrection(account(),'pay',topic,'uncertain');
    assert.equal(revised.payments[0].creditStatus,'unresolved');
    assert.equal(reconcile(revised).totals.creditedGrossCents,0);
  }
});
test('receipt uncertainty clears claimed receipt without deleting evidence event',()=>{
  const revised=focusedPaymentCorrection(account(),'pay','receipt','uncertain');
  assert.equal(revised.payments.length,1);assert.equal(revised.payments[0].receivedNetCents,null);assert.equal(reconcile(revised).totals.uncreditedPaymentCount,1);
});
test('partial receipt makes the credit unresolved and matching receipt can restore a supported credit',()=>{
  const partial=focusedPaymentCorrection(account(),'pay','receipt','received',{received:'30'});
  assert.equal(partial.payments[0].receivedNetCents,3000);
  assert.equal(partial.payments[0].creditStatus,'unresolved');
  assert.equal(reconcile(partial).totals.creditedGrossCents,0);
  const matched=focusedPaymentCorrection(partial,'pay','receipt','received',{received:'48'});
  assert.equal(matched.payments[0].creditStatus,'proposed_credit');
  assert.equal(reconcile(matched).totals.creditedGrossCents,6000);
});
test('a stated allocation must conserve the gross amount; blank is not zero',()=>{
  assert.throws(()=>focusedPaymentCorrection(account(),'pay','allocation','known',{allocations:{a:'25',b:''}}),/Enter an amount/);
  assert.throws(()=>focusedPaymentCorrection(account(),'pay','allocation','known',{allocations:{a:'25',b:'25'}}),/add up/);
  const revised=focusedPaymentCorrection(account(),'pay','allocation','known',{allocations:{a:'0',b:'60'}});
  assert.equal(reconcile(revised).totals.creditedGrossCents,6000);
});
test('source selection finds nested citations once without treating unrelated IDs as sources',()=>{
  assert.deepEqual(referencedSourceIds({id:'ignored',citations:[{sourceId:'a',lineStart:1}],rows:[{citations:[{sourceId:'b',lineStart:4},{sourceId:'a',lineStart:2}]}]}),['a','b']);
});
test('an unscoped correction cannot acquire a supported scope or split without covered weeks',()=>{
  const original=account();original.payments[0].periodIds=[];original.payments[0].grossCents=0;
  assert.throws(()=>focusedPaymentCorrection(original,'pay','coverage','supported'),/covered weeks/);
  assert.throws(()=>focusedPaymentCorrection(original,'pay','allocation','known',{allocations:{}}),/covered weeks/);
});
