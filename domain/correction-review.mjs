import { stable } from './revision.mjs';
import { reconcile } from './reconcile.mjs';
import { formatMoneyRange } from './supplement.mjs';

const project=(value,excluded)=>Object.fromEntries(Object.entries(value).filter(([key])=>!excluded.includes(key)));
const changedIds=(before,after,excluded)=>{
  const old=new Map(before.map(x=>[x.id,x])),next=new Map(after.map(x=>[x.id,x]));
  return new Set([...new Set([...old.keys(),...next.keys()])].filter(id=>!old.has(id)||!next.has(id)||stable(project(old.get(id),excluded),false)!==stable(project(next.get(id),excluded),false)));
};
const intersects=(ids,set)=>(ids??[]).some(id=>set.has(id));

// A typed edit must not leave an earlier model interpretation masquerading as
// a newly checked explanation. Reopen dependent prose conservatively; explicit
// simultaneous human edits remain attributed through the correction source.
export function prepareConsequentialCorrection(previous, proposed) {
  const payments=changedIds(previous.payments,proposed.payments,['label','creditReason','citations']);
  const periods=changedIds(previous.periods,proposed.periods,['label','notes','citations']);
  const scopeChanged=stable(previous.scope,false)!==stable(proposed.scope,false);
  const personChanged=['workerName','employerName'].some(key=>previous.caseContext[key]!==proposed.caseContext[key]);
  const routingChanged=['claimStatus','claimNumber','recipient'].some(key=>previous.caseContext[key]!==proposed.caseContext[key]);
  const accountingChanged=Boolean(payments.size||periods.size||scopeChanged||personChanged);
  if(!accountingChanged&&!routingChanged)return {analysis:proposed,notice:null};
  // A payment premise affects the periods it covers, and a work-account edit
  // affects the payment explanations linked to that work. Their prose may carry
  // old amounts even when their own typed fields were not directly edited.
  if(scopeChanged||personChanged)for(const period of [...previous.periods,...proposed.periods])periods.add(period.id);
  for(const payment of [...previous.payments,...proposed.payments])if(intersects(payment.periodIds,periods))payments.add(payment.id);
  for(const payment of [...previous.payments,...proposed.payments])if(payments.has(payment.id))for(const id of payment.periodIds)periods.add(id);
  const analysis=structuredClone(proposed);
  const routingIssues=new Set([...previous.actions,...proposed.actions].filter(action=>action.route==='deputy_update').flatMap(action=>action.dependsOnIssueIds));
  const related=(item)=>scopeChanged||personChanged||intersects(item.paymentIds,payments)||intersects(item.periodIds,periods)||(!(item.paymentIds?.length)&&!(item.periodIds?.length))||(routingChanged&&routingIssues.has(item.id));
  if(routingChanged&&analysis.caseContext.claimStatus!=='pending'&&analysis.caseContext.claimStatus!==previous.caseContext.claimStatus){
    if(analysis.caseContext.recipient===previous.caseContext.recipient)analysis.caseContext.recipient=null;
    if(analysis.caseContext.claimNumber===previous.caseContext.claimNumber)analysis.caseContext.claimNumber=null;
  }
  const explanation='The account was corrected in this version. The earlier interpretation must be checked against the corrected account and original records; it is not carried forward as a new finding.';
  const affectedIssues=new Set();
  let reopenedClaims=0,reopenedIssues=0,reopenedActions=0;
  for(const claim of analysis.responseClaims){
    const old=previous.responseClaims.find(x=>x.id===claim.id);
    if(old&&related(claim)&&claim.coverage===old.coverage&&claim.status===old.status){claim.status='unassessed';claim.coverage=explanation;reopenedClaims++;}
  }
  for(const issue of analysis.issues){
    const old=previous.issues.find(x=>x.id===issue.id);
    if(old&&related(issue))affectedIssues.add(issue.id);
    if(old&&related(issue)&&issue.detail===old.detail&&issue.status===old.status){
      issue.status='unassessed';issue.detail=explanation;
      if(issue.title===old.title)issue.title='Earlier question requires reassessment';
      reopenedIssues++;
    }
  }
  for(const action of analysis.actions){
    const old=previous.actions.find(x=>x.id===action.id);
    if(!old||action.detail!==old.detail||action.status!==old.status)continue;
    if(scopeChanged||personChanged||(accountingChanged&&!action.dependsOnIssueIds.length)||intersects(action.dependsOnIssueIds,affectedIssues)||action.route==='deputy_update'){
      action.status='open';action.route='review_available';
      if(action.title===old.title)action.title='Review the corrected basis for this earlier request';
      action.detail='Check the cited records for this earlier request against the corrected account and claim context. Its previous wording remains in revision history and is not included as a current outward request.';
      action.establishes='Whether this specific evidence request is still needed and how its wording must change.';
      reopenedActions++;
    }
  }
  for(const payment of analysis.payments){
    const old=previous.payments.find(x=>x.id===payment.id);
    if(payments.has(payment.id)&&old&&payment.creditReason===old.creditReason)payment.creditReason='The person reviewing this case corrected the payment account. The calculation uses the revised typed receipt, identity, additionality and coverage premises; inspect the attributed correction and retained original evidence.';
  }
  for(const period of analysis.periods){
    const old=previous.periods.find(x=>x.id===period.id);
    if(periods.has(period.id)&&old&&period.notes===old.notes)period.notes='Work or payment premises affecting this period were corrected. The calculation uses the updated typed account; the attributed correction and earlier sources preserve its basis.';
  }
  if(accountingChanged&&stable(analysis.scope.assumptions)===stable(previous.scope.assumptions))analysis.scope.assumptions=['The calculation uses the corrected typed account and the supplied scope fields. Check original scope evidence before relying on the result; earlier prose assumptions are preserved in history.'];
  if(analysis.caseContext.purpose===previous.caseContext.purpose)analysis.caseContext.purpose='Prepare a factual update using the corrected account and identify any interpretation or request that still needs reassessment.';
  const calculation=reconcile(analysis),total=calculation.totals,subtotal=calculation.knownSubtotal;
  const amount=total.calculable?`The revised wage difference is ${formatMoneyRange(total.differenceMinCents,total.differenceMaxCents)} under the retained premises.`:subtotal?.calculable?`The known subtotal is ${formatMoneyRange(subtotal.differenceMinCents,subtotal.differenceMaxCents)}; the complete balance remains unassessed.`:'The corrected payment facts can support an update; a complete wage balance is not established.';
  if(analysis.summary===previous.summary)analysis.summary=`The person reviewing this case corrected the account. ${amount} Earlier dependent explanations and requests need reassessment against the original records.`;
  analysis.changeNarrative=`A person corrected the typed account. ${reopenedClaims} response assessment(s), ${reopenedIssues} question(s) and ${reopenedActions} earlier request(s) were reopened where their wording was unchanged. Earlier wording is retained in history; no request was sent or resolved by this correction.`;
  return {analysis,notice:{code:'DEPENDENT_INTERPRETATIONS_REOPENED',message:'Your correction changed the account. Related earlier explanations and requests have been reopened for checking. You can prepare a factual update now, or analyze the records again to reassess them.',paymentIds:[...payments],periodIds:[...periods],routingChanged,reopenedClaims,reopenedIssues,reopenedActions}};
}
