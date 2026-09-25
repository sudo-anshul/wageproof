import { reconcile } from './reconcile.mjs';

export const formatMoney = (cents) => cents === null || cents === undefined ? 'Unassessed' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const formatMoneyRange = (min, max) => min === null || max === null || min === undefined || max === undefined ? 'Unassessed' : min === max ? formatMoney(min) : `${formatMoney(min)}–${formatMoney(max)}`;

const escape = (value) => String(value ?? '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])).replace(/([\\`*_[\]{}|])/g, '\\$1');
const inline = (value) => escape(value).replace(/[\r\n]+/g, ' ');
const present = (value, fallback = 'Not supplied') => value ? inline(value) : fallback;
const sentence = (value) => {
  const text = escape(value).trimEnd();
  return text && !/[.!?…]["”'’)]?$/.test(text) ? `${text}.` : text;
};

function currentScheduleSummary(calculation) {
  const total = calculation.totals;
  if (!total.calculable) {
    const subtotal = calculation.knownSubtotal;
    if (subtotal?.calculable) {
      const included = calculation.periods.filter((period) => subtotal.periodIds.includes(period.id)).map((period) => inline(period.label)).join('; ');
      const excluded = calculation.periods.filter((period) => subtotal.excludedPeriodIds.includes(period.id)).map((period) => inline(period.label)).join('; ');
      return `For periods with a supplied account, the scoped subtotal difference is **${formatMoneyRange(subtotal.differenceMinCents, subtotal.differenceMaxCents)}**, after gross credits of **${formatMoneyRange(subtotal.creditedGrossMinCents, subtotal.creditedGrossMaxCents)}** allocated or potentially allocated to those periods. Included: ${included}. The complete difference across all listed periods remains **unassessed**. Excluded from this subtotal: ${excluded}. Their recorded payment allocations are preserved below without inventing a wage balance.`;
    }
    return 'The supplied account does not establish a complete supported wage calculation. The payment facts and unresolved questions below can still support a factual update; no missing total is inferred.';
  }
  const statements = [
    `Using the stated work account and original gross payments, the current scoped difference is **${formatMoneyRange(total.differenceMinCents, total.differenceMaxCents)}** after **${formatMoney(total.creditedGrossCents)}** in additional gross corrections included in this schedule.`,
  ];
  if (calculation.allocationGroups.length) statements.push('The shared correction is counted once in the combined amount. Its split between the covered periods remains unresolved, so the individual period ranges are linked.');
  if (total.uncreditedPaymentCount) statements.push(`**This amount excludes ${total.uncreditedPaymentCount} reported payment event(s).** Their eligibility or coverage is unresolved or excluded for the reasons below. Do not read this figure as the balance after every reported correction.`);
  if (total.differenceMinCents === 0 && total.differenceMaxCents === 0) statements.push('A zero combined difference is limited to this schedule. Individual period balances and unassessed matters remain visible below.');
  return statements.join(' ');
}

export function renderSupplement({ caseRecord = {}, revision = {}, sourceLinkResolver } = {}) {
  const analysis = revision.analysis;
  if (!analysis) return '# Claim update and reconciliation supplement\n\nNo proposed analysis is available.\n';
  const calculation = revision.reconciliation ?? revision.calculation ?? reconcile(analysis);
  const context = analysis.caseContext ?? {};
  const sources = caseRecord.sources ?? [];
  const sourceMap = new Map(sources.map((source) => [source.id ?? source.sourceId, source]));
  const citationList = [];
  const cite = (citations = []) => citations.map((citation) => {
    const key = JSON.stringify(citation);
    let index = citationList.findIndex((entry) => entry.key === key);
    if (index < 0) { citationList.push({ key, citation }); index = citationList.length - 1; }
    return `[^R${index + 1}]`;
  }).join(' ');
  const reviewRecorded = revision.review?.status === 'reviewed' || (Boolean(revision.review?.at) && revision.review?.status === undefined);
  const hasNewSources = Array.isArray(revision.sourceIds) && sources.some((source) => !revision.sourceIds.includes(source.id ?? source.sourceId));
  const notCurrent = Boolean(caseRecord.currentRevisionId && revision.id && caseRecord.currentRevisionId !== revision.id);
  const reviewed = reviewRecorded && !hasNewSources && !notCurrent;
  const reviewStatus = reviewed ? 'Reviewed for this version' : reviewRecorded ? 'Previously reviewed version; later case material requires fresh review' : 'Draft for worker/advocate review';
  // An analysis is a complete revision snapshot. Explicit unknowns and missing
  // legacy fields must not recover withdrawn facts from newer/original intake.
  const claimStatus = context.claimStatus ?? 'unknown';
  const recipient = context.recipient;
  const lines = [
    '# Claim update and reconciliation supplement', '',
    `**${reviewStatus}**`, '',
    `**Worker:** ${present(context.workerName)}  `,
    `**Employer:** ${present(context.employerName)}  `,
    `**Claim number:** ${present(context.claimNumber)}  `,
    `**Claim status:** ${claimStatus === 'pending' ? 'Pending, as supplied' : claimStatus === 'not_filed' ? 'No filed claim reported' : 'Not established'}  `,
    `**Recipient:** ${present(recipient, claimStatus === 'pending' ? 'Assigned deputy/contact not supplied; verify against existing correspondence' : 'Not supplied; do not address to an invented deputy')}  `,
    `**Version:** ${present(revision.number ?? revision.id, 'Unnumbered proposal')} · prepared ${present(revision.createdAt)}  `,
    `**Purpose:** ${present(context.purpose, 'Factual reconciliation and case update')} ${cite(context.citations)}  `,
    `**Context attribution:** ${present(context.attribution, 'Not supplied')}`, '',
    'This locally prepared supplement does not replace a filed original, amend an official claim, accept a settlement or withdraw any claim. Exporting it does not send it. A scoped wage difference does not determine timeliness, legal entitlement or whole-case closure.', '',
    '## Current accounting position', '', currentScheduleSummary(calculation), '',
    '### Source interpretation', '', escape(analysis.summary), '',
    '## Payments and employer explanation', '',
  ];
  if (!analysis.payments.length) lines.push('No separate correction payment is represented in the supplied account. This is limited to the supplied material.', '');
  for (const payment of calculation.payments) {
    lines.push(`### ${inline(payment.label)}`, '',
      `Reference: ${present(payment.eventReference)}. Payment date: ${present(payment.paymentDate)}.`, '',
      `Gross: **${formatMoney(payment.grossCents)}**; stated net: **${formatMoney(payment.netCents)}**; supported/reported net receipt: **${formatMoney(payment.receivedNetCents)}**. Receipt status: ${inline(payment.receiptStatus.replaceAll('_', ' '))}. ${cite(payment.citations)}`, '',
      `${payment.credited ? 'Proposed credit in this schedule' : 'Not credited in this schedule'}: ${sentence(payment.creditReason)}`, '',
      `Identity: ${inline(payment.identityStatus)}. Additional to original pay: ${inline(payment.additionality)}. Exclusive period scope: ${inline(payment.allocationScope.replaceAll('_', ' '))}.`, '');
    if (payment.allocationStatus === 'known') lines.push(`Stated gross allocation: ${payment.allocations.map((item) => `${inline(analysis.periods.find((period) => period.id === item.periodId)?.label ?? item.periodId)} ${formatMoney(item.grossCents)}`).join('; ')}.`, '');
    else lines.push(`${payment.periodIds.length ? `Gross allocation remains unresolved across: ${payment.periodIds.map((id) => inline(analysis.periods.find((period) => period.id === id)?.label ?? id)).join('; ')}.` : 'Gross allocation remains unresolved; the covered periods are not established.'} No equal split or per-period withholding is assumed.`, '');
    if (!payment.credited) lines.push(`Reason retained unresolved/excluded: ${payment.exclusionReasons.map(escape).join(' ')}`, '');
  }
  for (const claim of analysis.responseClaims) lines.push(`- **Attributed position (paraphrase) — ${inline(claim.author)}:** ${inline(claim.statement)} — ${inline(claim.status.replaceAll('_', ' '))}. ${escape(claim.coverage)} ${cite(claim.citations)}`);
  lines.push('', '## Conditional gross schedule', '',
    'Amounts below apply only to the stated work account and supplied ordinary calculation scope. Gross corrections are credited once; supporting bank/reprint views are not additional payments.', '',
    '| Period | Gross earned | Original gross paid | Known allocated gross correction | Current scoped difference |',
    '|---|---:|---:|---:|---:|');
  for (const period of calculation.periods) {
    const original = analysis.periods.find((item) => item.id === period.id);
    lines.push(`| ${inline(period.label)} ${cite(original?.citations)} | ${formatMoneyRange(period.earnedMinCents, period.earnedMaxCents)} | ${formatMoney(period.originalGrossPaidCents)} | ${formatMoney(period.knownCreditCents)}${period.allocationGroupIds.length ? ' + shared unallocated credit below' : ''} | **${formatMoneyRange(period.differenceMinCents, period.differenceMaxCents)}** |`);
  }
  const total = calculation.totals;
  const subtotal = calculation.knownSubtotal;
  if (subtotal?.calculable && !subtotal.complete) lines.push(`| **Subtotal — periods with a supplied account only** | **${formatMoneyRange(subtotal.earnedMinCents, subtotal.earnedMaxCents)}** | **${formatMoney(subtotal.originalGrossPaidCents)}** | **${formatMoneyRange(subtotal.creditedGrossMinCents, subtotal.creditedGrossMaxCents)}** | **${formatMoneyRange(subtotal.differenceMinCents, subtotal.differenceMaxCents)}** |`);
  lines.push(`| **Combined — all listed periods** | **${formatMoneyRange(total.earnedMinCents, total.earnedMaxCents)}** | **${formatMoney(total.originalGrossPaidCents)}** | **${formatMoney(total.creditedGrossCents)} total credited** | **${formatMoneyRange(total.differenceMinCents, total.differenceMaxCents)}** |`, '');
  if (subtotal?.calculable && !subtotal.complete) lines.push('The subtotal includes only periods with known earned and original-paid accounts. Other period rows and their assigned corrections remain visible; their missing balances are not treated as zero.', '');
  for (const group of calculation.allocationGroups) lines.push(`**Shared allocation — ${inline(group.label)}:** ${formatMoney(group.totalGrossCents)} is credited once across ${group.periodIds.map((id) => inline(analysis.periods.find((period) => period.id === id)?.label ?? id)).join(' and ')}. ${escape(group.constraint)}${group.possibleCentAllocations !== null ? ` There are ${group.possibleCentAllocations.toLocaleString('en-US')} cent allocations under these premises.` : ''}`, '');
  if (calculation.allocationGroups.length) lines.push('**Do not add individual period bounds.** They share the same correction and cannot all reach their extremes together. The combined line accounts for that shared payment once.', '');
  lines.push('### Calculation basis', '',
    `Jurisdiction: ${inline(analysis.scope.jurisdiction)}. Rule: ${inline(analysis.scope.rule.replaceAll('_', ' '))}. Basis: ${inline(analysis.scope.basisStatus)}. Workweek: ${sentence(analysis.scope.workweek || 'Not supplied')} Workday: ${sentence(analysis.scope.workday || 'Not supplied')} ${cite(analysis.scope.citations)}`, '');
  for (const assumption of analysis.scope.assumptions) lines.push(`- ${escape(assumption)}`);
  for (const period of analysis.periods) {
    lines.push('', `**${inline(period.label)}:** ${escape(period.notes)} Rate: ${formatMoney(period.rateCents)}/hour. ${cite(period.citations)}`);
    const accounts = period.alternatives.length ? period.alternatives : [{ label: 'Current account', days: period.days }];
    for (const account of accounts) if (account.days.length) lines.push(`- ${inline(account.label)}: ${account.days.map((day) => `${inline(day.date || day.label)} ${day.minutes === null ? 'duration unknown' : `${day.minutes} minutes`}${cite(day.citations)}`).join('; ')}.`);
    const calculatedPeriod = calculation.periods.find((item) => item.id === period.id);
    for (const alternative of calculatedPeriod?.alternatives ?? []) if (alternative.calculated) lines.push(`- ${inline(alternative.label)} calculation: ${alternative.regularMinutes} regular minutes, ${alternative.overtimeMinutes} overtime minutes, ${alternative.doubletimeMinutes} double-time minutes → ${formatMoney(alternative.grossEarnedCents)} gross. ${escape(alternative.rounding)}`);
    if (period.calculationBasis === 'reviewed_earned') lines.push('- The supplied previously adopted gross amount is carried forward; this supplement does not independently reconstruct missing daily details.');
  }
  lines.push('', '## Unresolved matters and current actions', '');
  const activeIssues = analysis.issues.filter((issue) => ['open', 'unassessed'].includes(issue.status));
  for (const issue of activeIssues) lines.push(`- **${inline(issue.title)}** (${inline(issue.status)}): ${escape(issue.detail)} ${cite(issue.citations)}`);
  if (!activeIssues.length) lines.push('No open issue is represented within this scoped account. This does not establish that all potential claims have been assessed.');
  lines.push('');
  // Source-inspection tasks belong in the review interface. Do not treat a
  // version approval as completing them or forward generic review controls to
  // the recipient. Actual external requests have a distinct typed route.
  const outwardActions = analysis.actions.filter((action) => action.route !== 'review_available');
  const openActions = outwardActions.filter((action) => ['open', 'partly_answered'].includes(action.status));
  for (const action of openActions) lines.push(`- **${inline(action.title)}** — ${escape(action.detail)} Route: ${inline(action.route.replaceAll('_', ' '))}. Custodian: ${present(action.custodian)}. Dates: ${present(action.dateRange)}. This would establish: ${sentence(action.establishes)} ${cite(action.citations)}`);
  if (!openActions.length) lines.push('No open evidence action is represented in this version. Review the proposed account and routing before using it.');
  const retired = outwardActions.filter((action) => !['open', 'partly_answered'].includes(action.status));
  if (retired.length) { lines.push('', '**Answered or retired actions (history, not current requests):**', ''); for (const action of retired) lines.push(`- ${inline(action.title)} — ${inline(action.status)}. ${escape(action.detail)} ${cite(action.citations)}`); }
  lines.push('', '**Not assessed by this schedule:**', '');
  const categories = [...new Set([...analysis.unassessedCategories, ...analysis.scope.exclusions, 'Payment timeliness, legal remedies and whole-claim disposition'])];
  categories.forEach((category) => lines.push(`- ${escape(category)}`));
  if (calculation.warnings.length) { lines.push('', '### Accounting qualifications', ''); calculation.warnings.forEach((warning) => lines.push(`- ${escape(warning)}`)); }
  lines.push('', '## Review, originals and source index', '',
    `${reviewStatus}.${reviewRecorded ? ` Review recorded: ${present(revision.review.at)}. ${revision.review.note ? `Review note: ${escape(revision.review.note)}` : ''}` : ' The interpretations and calculation premises remain proposed.'}`,
    hasNewSources ? 'New source material exists after this version. This document does not incorporate those later sources.' : '',
    notCurrent ? 'This is a historical version, not the current case proposal.' : '', '',
    'Source anchors below refer to locally retained extracted text. Extraction and matching quotes do not establish authenticity or legal truth. Inspect the original where interpretation matters.', '');
  for (let index = 0; index < citationList.length; index++) {
    const { citation } = citationList[index];
    const source = sourceMap.get(citation.sourceId);
    const name = source?.name ?? citation.sourceId;
    const location = `lines ${citation.lineStart}–${citation.lineEnd}`;
    const base = caseRecord.baseUrl?.replace(/\/$/, '') ?? '';
    const sourceLink = sourceLinkResolver ? sourceLinkResolver({sourceId:citation.sourceId,source,citation}) : caseRecord.id ? `${base}/api/cases/${encodeURIComponent(caseRecord.id)}/sources/${encodeURIComponent(citation.sourceId)}/file` : null;
    lines.push(`[^R${index + 1}]: ${sourceLink ? `[${inline(name)}](${sourceLink})` : inline(name)}, ${location}; source ${inline(citation.sourceId)}${source?.sha256 ? `; SHA-256 ${inline(source.sha256)}` : ''}.`, `    > ${escape(citation.quote).replace(/\n/g, '\n    > ')}`, '');
  }
  lines.push(claimStatus === 'pending'
    ? 'DLSE processing policies say a claimant who receives payment of all or part of a pending claim directly must notify the deputy. This supplement prepares a factual update; routing, sending, receipt and any official claim change remain separate. [Official DLSE policies](https://www.dir.ca.gov/dlse/policies.htm).'
    : 'If no claim is pending, retain this as an intake reconciliation and consult the [official filing/help information](https://www.dir.ca.gov/dlse/HowToFileWageClaim.htm). Do not describe it as an update to an established filed claim.', '');
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n');
}
