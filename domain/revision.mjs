import { reconcile } from './reconcile.mjs';

export function stable(value, includeCitations = true) {
  if (Array.isArray(value)) return `[${value.map(item => stable(item, includeCitations)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => includeCitations || key !== 'citations').sort().map(key => `${JSON.stringify(key)}:${stable(value[key], includeCitations)}`).join(',')}}`;
  return JSON.stringify(value);
}
const money = value => value == null ? 'Not established' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
const range = (min, max) => min == null || max == null ? 'Not established' : min === max ? money(min) : `${money(min)}–${money(max)}`;
const words = value => String(value ?? 'Not supplied').replaceAll('_', ' ');
const titles = {
  grossCents: 'Correction before deductions', netCents: 'Net on the pay record', receivedNetCents: 'Net received',
  originalGrossPaidCents: 'Original pay before deductions', reviewedGrossEarnedCents: 'Previously adopted earned amount', rateCents: 'Hourly rate',
  identityStatus: 'Whether these records describe one payment', additionality: 'Whether this is additional pay',
  creditStatus: 'Treatment in the calculation', creditReason: 'Basis for counting this payment', receiptStatus: 'Evidence of receipt',
  allocationStatus: 'Whether the split is established', allocationScope: 'Which weeks the correction covers', allocations: 'Correction split',
  periodIds: 'Covered weeks', paymentIds: 'Related payments', issueIds: 'Related questions', dependsOnIssueIds: 'Questions this action addresses',
  eventReference: 'Payment reference', paymentDate: 'Payment date', days: 'Worked time', alternatives: 'Alternative work accounts',
  calculationBasis: 'Basis of the work account', startDate: 'First day', endDate: 'Last day', notes: 'Work account explanation',
  title: 'Question or action', detail: 'Explanation', status: 'Current status', route: 'Next step', priority: 'Priority',
  custodian: 'Record holder', dateRange: 'Relevant dates', establishes: 'What the record would establish',
  statement: 'Attributed statement', author: 'Who said this', coverage: 'What the statement answers',
  jurisdiction: 'Jurisdiction', rule: 'Calculation scope', basisStatus: 'Basis for applying this scope',
  assumptions: 'Retained assumptions', workweek: 'Employer workweek', workday: 'Employer workday', exclusions: 'Outside the calculation',
  workerName: 'Worker', employerName: 'Employer', claimNumber: 'Claim number', claimStatus: 'Claim stage',
  purpose: 'Purpose of the update', recipient: 'Intended recipient', asOf: 'Source-reported date', attribution: 'Context attribution',
  materiality: 'Why this question matters', label: 'Account label',
};
const humanStatuses = {
  proposed_credit: 'Included under the stated premises', unresolved: 'Not counted while uncertain', excluded: 'Excluded from this calculation',
  exclusive_supported: 'Only the listed weeks, supported by the stated evidence', exclusive_asserted: 'Only the listed weeks, asserted but not established',
  supported: 'Supported as a proposed premise', asserted: 'Reported, not established', unknown: 'Not established', uncertain: 'Uncertain',
  documented: 'Receipt documented', worker_reported: 'Receipt reported by the worker', not_received: 'Not received', not_additional: 'Not additional pay',
  partly_answered: 'Partly answered; work remains', superseded: 'Replaced by a more current request', closed: 'Retired; see the stated reason',
};
function citationsOf(...values) {
  const found = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const citation of value.citations ?? []) found.set(stable(citation), citation);
    for (const [key, child] of Object.entries(value)) if (key !== 'citations') visit(child);
  }
  values.forEach(visit);
  return [...found.values()];
}
function fieldText(key, value, analysis) {
  if (value == null || value === '') return 'Not supplied';
  if (/Cents$/.test(key)) return money(value) + (key === 'rateCents' ? '/hour' : '');
  if (key === 'allocations') return value.length ? value.map(item => `${analysis.periods.find(p => p.id === item.periodId)?.label ?? 'Unmatched week'}: ${money(item.grossCents)}`).join('; ') : 'No split established';
  if (key === 'days') return value.length ? value.map(day => `${day.date || day.label}: ${day.minutes == null ? 'duration unknown' : `${Math.floor(day.minutes / 60)}h ${day.minutes % 60}m`}`).join('; ') : 'No daily account';
  if (key === 'alternatives') return value.length ? value.map(a => `${a.label}: ${fieldText('days', a.days, analysis)}`).join(' / ') : 'No alternative account';
  if (['periodIds','paymentIds','issueIds','dependsOnIssueIds'].includes(key)) {
    const collection = key === 'periodIds' ? analysis.periods : key === 'paymentIds' ? analysis.payments : analysis.issues;
    return value.length ? value.map(id => { const item = collection.find(x => x.id === id); return item?.label ?? item?.title ?? 'Unmatched record'; }).join('; ') : 'None linked';
  }
  if (Array.isArray(value)) return value.map(words).join('; ') || 'None listed';
  return humanStatuses[value] ?? words(value);
}
function entityText(item, collection, analysis) {
  if (!item) return null;
  if (collection === 'payments') return [money(item.grossCents) + ' before deductions', money(item.receivedNetCents) + ' net received', fieldText('creditStatus', item.creditStatus, analysis), fieldText('allocations', item.allocations, analysis)].join(' · ');
  if (collection === 'periods') return `${item.label} · originally paid ${money(item.originalGrossPaidCents)} · ${fieldText('calculationBasis', item.calculationBasis, analysis)}`;
  if (collection === 'responseClaims') return `${item.statement} · ${words(item.status)}`;
  return `${item.title} · ${humanStatuses[item.status] ?? words(item.status)}`;
}
const activeStatuses = new Set(['open', 'partly_answered', 'unassessed']);

export function compareAnalyses(previous, next) {
  previous = previous?.analysis ?? previous;
  next = next?.analysis ?? next;
  if (!next) return { summary: 'No proposed revision is available.', changes: [], requiresReview: false, amountUnchanged: false };
  if (!previous) return {
    summary: 'Review the first account. No earlier reviewed account is established.',
    changes: [{ type: 'added', entityType: 'analysis', id: 'initial', title: 'First proposed account', detail: `${next.periods.length} period(s), ${next.payments.length} proposed payment event(s), ${next.issues.filter(issue => activeStatuses.has(issue.status)).length} open question(s).`, before: null, after: 'A new source-derived account', citations: citationsOf(next), importance: 'consequential' }],
    requiresReview: true, amountUnchanged: false,
  };
  const changes = [];
  const before = reconcile(previous), after = reconcile(next);
  const totalRepresentationUnchanged = before.totals.calculable === after.totals.calculable && before.totals.differenceMinCents === after.totals.differenceMinCents && before.totals.differenceMaxCents === after.totals.differenceMaxCents;
  const amountUnchanged = before.totals.calculable && after.totals.calculable && totalRepresentationUnchanged;
  const push = change => changes.push({ before: null, after: null, citations: [], importance: 'consequential', ...change });
  if (!totalRepresentationUnchanged) push({ type: 'amount_changed', entityType: 'schedule', id: 'total', title: 'Combined wage difference',
    before: range(before.totals.differenceMinCents, before.totals.differenceMaxCents), after: range(after.totals.differenceMinCents, after.totals.differenceMaxCents),
    detail: 'The combined difference changes under the proposed premises. This is not the disposition of the whole claim.', citations: citationsOf(previous.periods, next.periods, previous.payments, next.payments) });
  const earlierPeriods = new Map(before.periods.map(p => [p.id, p]));
  for (const period of after.periods) {
    const earlier = earlierPeriods.get(period.id);
    if (earlier && (earlier.differenceMinCents !== period.differenceMinCents || earlier.differenceMaxCents !== period.differenceMaxCents)) push({
      type: 'amount_changed', entityType: 'period_amount', id: period.id, title: `${period.label}: remaining difference`,
      before: range(earlier.differenceMinCents, earlier.differenceMaxCents), after: range(period.differenceMinCents, period.differenceMaxCents),
      detail: 'This is the remaining difference for the week, not the correction allocated to it. Linked earlier ranges cannot be added.', citations: citationsOf(previous.periods.find(p => p.id === period.id), next.periods.find(p => p.id === period.id), next.payments.filter(p => p.periodIds.includes(period.id))),
    });
  }
  if (stable(before.knownSubtotal) !== stable(after.knownSubtotal) && (!before.totals.calculable || !after.totals.calculable)) push({
    type: 'amount_changed', entityType: 'schedule', id: 'subtotal', title: 'Known subtotal and its coverage',
    before: before.knownSubtotal?.calculable ? range(before.knownSubtotal.differenceMinCents, before.knownSubtotal.differenceMaxCents) : 'Not established',
    after: after.knownSubtotal?.calculable ? range(after.knownSubtotal.differenceMinCents, after.knownSubtotal.differenceMaxCents) : 'Not established',
    detail: 'Only periods with supplied accounts contribute. Other balances remain unknown.', citations: citationsOf(previous.periods, next.periods, next.payments),
  });
  for (const collection of ['periods', 'payments', 'issues', 'responseClaims', 'actions']) {
    const old = new Map(previous[collection].map(item => [item.id, item]));
    const current = new Map(next[collection].map(item => [item.id, item]));
    for (const [id, item] of current) {
      const earlier = old.get(id), title = item.title ?? item.label ?? item.statement ?? 'Changed record';
      if (!earlier) { push({ type: 'added', entityType: collection, id, title, detail: 'Newly represented. If it replaces an earlier record, inspect both; continuity is not assumed from similar wording.', after: entityText(item, collection, next), citations: citationsOf(item) }); continue; }
      if (stable(earlier) === stable(item)) continue;
      if (stable(earlier, false) === stable(item, false)) {
        push({ type: 'support_changed', entityType: collection, id, title, detail: 'Source support changed without changing the represented account. The new support still requires review.', before: 'Earlier supporting records', after: 'Updated supporting records', citations: citationsOf(earlier, item) });
        continue;
      }
      const fields = Object.keys(item).filter(key => key !== 'id' && key !== 'citations' && stable(item[key]) !== stable(earlier[key]));
      const fieldChanges = fields.map(key => ({ label: titles[key] ?? words(key), before: fieldText(key, earlier[key], previous), after: fieldText(key, item[key], next) }));
      const retired = ['resolved', 'answered', 'closed', 'superseded'].includes(item.status) && earlier.status !== item.status;
      push({ type: item.status === 'superseded' && earlier.status !== item.status ? 'superseded' : retired ? 'resolved' : 'changed', entityType: collection, id, title,
        before: fieldChanges.map(f => `${f.label}: ${f.before}`).join('\n'), after: fieldChanges.map(f => `${f.label}: ${f.after}`).join('\n'), fields: fieldChanges,
        detail: retired ? (item.status === 'superseded' ? 'The earlier request has been replaced. Check that any unanswered part remains in the current actions.' : 'The proposed status changed. Inspect its reason and evidence; retiring wording does not settle the whole claim.') : `Changed: ${fields.map(key => (titles[key] ?? words(key)).toLowerCase()).join(', ')}.`,
        citations: citationsOf(earlier, item), importance: fields.every(key => ['notes','detail','label','title'].includes(key)) ? 'context' : 'consequential' });
    }
    for (const [id, item] of old) if (!current.has(id)) push({ type: 'removed', entityType: collection, id, title: item.title ?? item.label ?? item.statement ?? 'Earlier record', detail: 'Removed from this proposal. Its earlier evidence remains available; do not assume a similarly worded new item is the same event.', before: entityText(item, collection, previous), citations: citationsOf(item) });
  }
  for (const key of ['scope', 'caseContext', 'unassessedCategories']) {
    if (stable(previous[key]) === stable(next[key])) continue;
    const title = key === 'scope' ? 'Calculation scope' : key === 'caseContext' ? 'Case context' : 'Categories outside this calculation';
    const fields = key === 'unassessedCategories' ? [] : Object.keys(next[key]).filter(field => field !== 'citations' && stable(previous[key][field]) !== stable(next[key][field])).map(field => ({ label: titles[field] ?? words(field), before: fieldText(field, previous[key][field], previous), after: fieldText(field, next[key][field], next) }));
    push({ type: fields.length || key === 'unassessedCategories' ? 'changed' : 'support_changed', entityType: key, id: key, title,
      before: key === 'unassessedCategories' ? previous[key].join('; ') : fields.map(f => `${f.label}: ${f.before}`).join('\n') || 'Earlier support',
      after: key === 'unassessedCategories' ? next[key].join('; ') : fields.map(f => `${f.label}: ${f.after}`).join('\n') || 'Updated support', fields,
      detail: 'Review this change even when the amount stays the same.', citations: citationsOf(previous[key], next[key]) });
  }
  for (const key of ['summary','changeNarrative']) if (previous[key] !== next[key]) push({ type: 'changed', entityType: 'narrative', id: key, title: key === 'summary' ? 'Account explanation' : 'Explanation of the change', before: previous[key], after: next[key], detail: 'The explanation changed. It remains an interpretation of the records.', importance: 'context' });
  return { summary: changes.length ? `${changes.length} change(s) found.${amountUnchanged ? ' The combined scoped amount is unchanged; the account, evidence or next action may still have changed.' : ''}` : 'No represented content change detected. This new version still needs its own review.', changes, requiresReview: true, amountUnchanged };
}

export function revisionComparison(baseline, candidate) {
  return { ...compareAnalyses(baseline?.analysis, candidate?.analysis), baselineRevisionId: baseline?.id ?? null,
    baselineRevisionNumber: baseline?.number ?? null, baselineReviewedAt: baseline?.review?.at ?? null,
    candidateRevisionId: candidate?.id ?? null, candidateRevisionNumber: candidate?.number ?? null };
}

// Legacy comparisons are projected for display; stored originals are untouched.
export function withRevisionComparisons(caseRecord) {
  const revisions = caseRecord.revisions.map((revision, index, all) => {
    if (revision.sinceReviewed && revision.sincePrevious) return revision;
    const baseline = all.slice(0, index).filter(r => r.review?.at && r.review.at <= revision.createdAt).at(-1);
    return { ...revision,
      sincePrevious: revision.sincePrevious ?? revisionComparison(all[index - 1], revision),
      sinceReviewed: revision.sinceReviewed ?? { ...revisionComparison(baseline, revision), derivedForLegacyRevision: true },
    };
  });
  return { ...caseRecord, revisions };
}
