import { Marked } from 'marked';
import { reconcile } from './reconcile.mjs';
import { formatMoney, formatMoneyRange } from './supplement.mjs';

export const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const inline = value => String(value ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character])).replace(/([\\`*_[\]{}()#+.!|>~\-])/g, '\\$1');
const supplied = value => value === null || value === undefined || value === '' ? 'Not supplied' : inline(value);

export function collectCitations(value, found = []) {
  if (Array.isArray(value)) for (const item of value) collectCitations(item, found);
  else if (value && typeof value === 'object') {
    if (typeof value.sourceId === 'string' && Number.isInteger(value.lineStart) && Number.isInteger(value.lineEnd) && typeof value.quote === 'string') found.push(value);
    else for (const item of Object.values(value)) collectCitations(item, found);
  }
  return found;
}

export function collectReferencedSourceIds(analysis) {
  return [...new Set(collectCitations(analysis).map(citation => citation.sourceId))];
}

export function revisionExportStatus(caseRecord, revision) {
  const reviewed = revision.review?.status === 'reviewed' || Boolean(revision.review?.at && revision.review.status === undefined);
  const historical = Boolean(caseRecord.currentRevisionId && revision.id !== caseRecord.currentRevisionId);
  const snapshotIds = new Set(revision.sourceIds ?? []);
  const stale = (caseRecord.sources ?? []).some(source => !snapshotIds.has(source.id)) || Boolean(caseRecord.currentSourceDigest && revision.sourceDigest && caseRecord.currentSourceDigest !== revision.sourceDigest);
  const label = reviewed ? stale || historical ? 'Previously reviewed version' : 'Reviewed for this version' : 'Draft for worker/advocate review';
  return { state: reviewed ? 'reviewed' : 'draft', reviewedAt: reviewed ? revision.review.at ?? null : null, historical, stale, label };
}

const comparable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function updateSelection(items, previousItems, retainedLimit) {
  const previous = new Map((previousItems ?? []).map(item => [item.id, item]));
  const added = items.filter(item => !previous.has(item.id));
  const changed = items.filter(item => previous.has(item.id) && comparable(previous.get(item.id)) !== comparable(item));
  const importantIds = new Set([...added, ...changed].map(item => item.id));
  const retained = items.filter(item => !importantIds.has(item.id));
  return {
    items: [...added, ...changed, ...retained.slice(0, retainedLimit)],
    addedIds: new Set(added.map(item => item.id)), changedIds: new Set(changed.map(item => item.id)),
    detailedIds: importantIds, omitted: Math.max(0, retained.length - retainedLimit),
  };
}

/** Typed amounts plus explicitly attributed positions and retained requests; no free-form model summary. */
export function renderShortUpdate({ caseRecord, revision, sourceEntries = [], omittedSources = [] }) {
  const analysis = revision.analysis;
  const calculation = revision.reconciliation ?? revision.calculation ?? reconcile(analysis);
  const status = revisionExportStatus(caseRecord, revision);
  const context = analysis.caseContext ?? {};
  const entries = new Map(sourceEntries.map(entry => [entry.id, entry]));
  const omittedLabels = new Map(omittedSources.map((source,index) => [source.id, `O${String(index+1).padStart(2,'0')}`]));
  const citations = list => {
    const unique = [...new Map((list ?? []).map(citation => [`${citation.sourceId}:${citation.lineStart}:${citation.lineEnd}`, citation])).values()];
    const references = unique.slice(0, 2).map(citation => {
      const entry = entries.get(citation.sourceId);
      return entry ? `[${entry.label}:${citation.lineStart}–${citation.lineEnd}](${entry.linesPath}#L${citation.lineStart})` : `[${omittedLabels.get(citation.sourceId)??'Record'} · omitted](evidence.html)`;
    });
    if (unique.length > 2) references.push(`[${unique.length - 2} more reference${unique.length === 3 ? '' : 's'}](supplement.html)`);
    return [...new Set(references)].join('; ');
  };
  const lines = ['# WageProof factual update', '', `**${status.label}${status.historical ? ' · historical revision' : ''}${status.stale ? ' · later material excluded' : ''}**`, '',
    `**Worker:** ${supplied(context.workerName)} · **Employer:** ${supplied(context.employerName)}  `,
    `**Claim:** ${supplied(context.claimNumber)} · ${context.claimStatus === 'pending' ? 'pending, as supplied' : context.claimStatus === 'not_filed' ? 'no filed claim reported' : 'status not established'}  `,
    `**Recipient:** ${supplied(context.recipient)} · **Revision:** ${supplied(revision.number ?? revision.id)}`, '',
    '## Payment facts in this account', ''];
  if (!calculation.payments.length) lines.push('No separate correction payment is represented in this account. This does not establish that no payment occurred.', '');
  const baseline = caseRecord.comparisonBaseline;
  const paymentSelection = updateSelection(calculation.payments, baseline?.calculation?.payments, 4);
  for (const payment of paymentSelection.items) {
    const receipt = payment.receiptStatus === 'documented' ? `Net receipt recorded in the supplied evidence: ${formatMoney(payment.receivedNetCents)}` : payment.receiptStatus === 'worker_reported' ? `Worker-reported net receipt: ${formatMoney(payment.receivedNetCents)}` : payment.receiptStatus === 'not_received' ? 'Receipt reported as not received' : 'Actual receipt remains unestablished';
    lines.push(`- **Reference ${supplied(payment.eventReference)}** · date ${supplied(payment.paymentDate)}. Gross correction stated: **${formatMoney(payment.grossCents)}**; stated net: **${formatMoney(payment.netCents)}**. ${receipt}. ${payment.credited ? 'Counted once as a distinct additional correction exclusively for its listed periods, under this account.' : 'Not credited in this calculation; see the appendix for the unresolved or excluded basis.'} ${citations(payment.citations)}`);
  }
  if (paymentSelection.omitted) lines.push(`- ${paymentSelection.omitted} further unchanged payment event(s) are retained in the detailed supplement.`);
  const claimOrder = { unsupported: 0, partly_supported: 1, unassessed: 2, supported: 3 };
  const previousClaims = caseRecord.comparisonBaseline?.responseClaims;
  const priorClaims = new Map((previousClaims ?? []).map(claim => [claim.id, claim]));
  const changedClaims = analysis.responseClaims.filter(claim => {
    const before = priorClaims.get(claim.id);
    return !before || ['author', 'statement', 'status', 'coverage'].some(field => before[field] !== claim[field]);
  });
  // A newly supplied date or exclusion can matter without changing any money.
  // Keep every changed position; a fixed one-position cut hid that information.
  const prominentClaims = [...changedClaims].sort((a, b) => Number(priorClaims.has(a.id)) - Number(priorClaims.has(b.id)) || (claimOrder[a.status] ?? 2) - (claimOrder[b.status] ?? 2));
  const selectedClaimIds = new Set(prominentClaims.map(claim => claim.id));
  const retainedClaims = analysis.responseClaims.filter(claim => !selectedClaimIds.has(claim.id)).sort((a, b) => (claimOrder[a.status] ?? 2) - (claimOrder[b.status] ?? 2));
  const retainedPosition = retainedClaims.find(claim => claim.status !== 'supported') ?? (!prominentClaims.length ? retainedClaims[0] : null);
  if (retainedPosition) prominentClaims.push(retainedPosition);
  const coverageOnly = claim => {
    const before = priorClaims.get(claim.id);
    return before && ['author', 'statement', 'status'].every(field => before[field] === claim[field]) && before.coverage !== claim.coverage;
  };
  const hasChangedStatement = prominentClaims.some(claim => selectedClaimIds.has(claim.id) && !coverageOnly(claim));
  const leadAssessment = hasChangedStatement ? null : prominentClaims.find(coverageOnly);
  const furtherAssessments = [];
  for (const claim of prominentClaims) {
    const before = priorClaims.get(claim.id);
    const assessmentChanged = before && before.statement === claim.statement && before.coverage !== claim.coverage;
    const changeLabel = previousClaims ? `${before ? selectedClaimIds.has(claim.id) ? 'Changed since' : 'Retained from' : 'New to this account since'} reviewed revision ${supplied(caseRecord.comparisonBaseline.number)}. ` : '';
    const destination = coverageOnly(claim) && claim !== leadAssessment ? furtherAssessments : lines;
    destination.push('', `**Attributed position — ${inline(claim.author)} (paraphrase):** ${inline(claim.statement)} ${changeLabel}Assessed coverage: **${inline(claim.status.replaceAll('_', ' '))}**. ${assessmentChanged ? `Updated assessment: ${inline(claim.coverage)} ` : ''}${citations(claim.citations)} [Detailed assessment](supplement.html).`);
  }
  if (prominentClaims.length < analysis.responseClaims.length) lines.push('', 'Other retained positions remain in the detailed supplement.');
  lines.push('', '## Calculation and remaining uncertainty', '');
  const total = calculation.totals;
  if (total.calculable) {
    lines.push(`The difference for the listed periods is **${formatMoneyRange(total.differenceMinCents, total.differenceMaxCents)}** under the retained premises. Additional gross corrections included: **${formatMoney(total.creditedGrossCents)}**. This is not a whole-claim balance or determination of legal entitlement.`);
    if (total.uncreditedPaymentCount) lines.push(`${total.uncreditedPaymentCount} reported payment event(s) are excluded from that figure because their credit treatment is unresolved or excluded. Their facts remain in the appendix.`);
    if (calculation.allocationGroups?.length) lines.push('Individual period ranges share an unallocated correction. Their upper or lower bounds must not be added together.');
  } else {
    lines.push('**The complete wage difference remains unassessed.** The payment facts can still support a factual update. Missing balances are not treated as zero.');
    if (calculation.knownSubtotal?.calculable) lines.push(`For the periods with an established account only, the subtotal difference is **${formatMoneyRange(calculation.knownSubtotal.differenceMinCents, calculation.knownSubtotal.differenceMaxCents)}**. The appendix identifies included and excluded periods; this subtotal is not the complete balance.`);
  }
  if (calculation.periods.length) {
    const priorPeriods = new Map((baseline?.calculation?.periods ?? []).map(period => [period.id, period]));
    const periodSelection = updateSelection(calculation.periods, baseline?.calculation?.periods, 4);
    lines.push('', `| Period | ${baseline ? `At reviewed revision ${inline(baseline.number)}` : 'Before corrections'} | Known allocated gross correction | Remaining difference |`, '|---|---:|---:|---:|');
    for (const period of periodSelection.items) {
      const prior = priorPeriods.get(period.id);
      const before = baseline ? prior ? formatMoneyRange(prior.differenceMinCents, prior.differenceMaxCents) : 'Not in prior account' : formatMoneyRange(period.initialDifferenceMinCents, period.initialDifferenceMaxCents);
      lines.push(`| ${inline(period.label)} | ${before} | ${formatMoney(period.knownCreditCents)}${period.allocationGroupIds.length ? ' + shared unallocated correction' : ''} | **${formatMoneyRange(period.differenceMinCents, period.differenceMaxCents)}** |`);
    }
    if (periodSelection.omitted) lines.push('', `${periodSelection.omitted} further unchanged period(s) are retained in the detailed supplement.`);
    lines.push('');
  }
  if (revision.sinceReviewed?.baselineRevisionId && revision.sinceReviewed.amountUnchanged) lines.push('The combined scoped amount is unchanged since the named reviewed version. Period allocation, source support or next actions may still have changed.');
  const unresolved = analysis.issues.filter(issue => ['open', 'partly_answered', 'unassessed'].includes(issue.status));
  const openActions = analysis.actions.filter(action => ['open', 'partly_answered'].includes(action.status) && !['review_available', 'deputy_update'].includes(action.route));
  const issueSelection = updateSelection(unresolved, baseline?.issues, 3);
  const actionSelection = updateSelection(openActions, baseline?.actions, 3);
  if (unresolved.length || openActions.length) {
    lines.push('', '## Still needed', '');
    for (const issue of issueSelection.items) {
      const label = baseline && issueSelection.addedIds.has(issue.id) ? 'New question' : baseline && issueSelection.changedIds.has(issue.id) ? 'Updated question' : 'Question retained';
      lines.push(`- **${label}:** ${inline(issue.title)}. ${issueSelection.detailedIds.has(issue.id) && issue.detail ? `${inline(issue.detail)} ` : ''}${citations(issue.citations)}`);
    }
    for (const action of actionSelection.items) {
      const partial = action.status === 'partly_answered';
      const label = partial ? 'Request partly answered' : baseline && actionSelection.addedIds.has(action.id) ? 'New request' : baseline && actionSelection.changedIds.has(action.id) ? 'Updated request' : 'Request retained';
      const detail = String(action.detail ?? '').trim() || String(action.establishes ?? '').trim();
      const body = partial ? detail || action.title : `${action.title}${actionSelection.detailedIds.has(action.id) && detail ? `. ${detail}` : ''}`;
      lines.push(`- **${label}:** ${inline(body)}${action.custodian ? ` — ${inline(action.custodian)}` : ''}. ${citations(action.citations)}`);
    }
    if (issueSelection.omitted || actionSelection.omitted) lines.push('Further unchanged questions and requests are listed in the detailed supplement.');
    lines.push('', 'Review does not close these factual questions.');
  }
  lines.push('', 'This update retains the account’s stated premises and unassessed matters. Confirm the recipient and claim routing before sending.');
  if (furtherAssessments.length) lines.push('', '## Other changed source assessments', ...furtherAssessments);
  lines.push('',
    '## Evidence packet and review record', '', `[Detailed supplement](supplement.html) · [Markdown supplement](supplement.md) · [Evidence index](evidence.html) · [Integrity manifest](manifest.json)`, '',
    `Prepared: ${supplied(revision.createdAt)}.`, '',
    status.reviewedAt ? `Review was recorded on ${inline(status.reviewedAt)} for this version and its retained assumptions and unknowns.` : 'This proposal has not been marked reviewed. Its factual interpretations and calculation premises require review.',
    status.historical ? 'This is a historical revision, not the current case proposal.' : '',
    status.stale ? 'Later or changed source material exists. This version does not incorporate that material.' : '', '',
    analysis.unassessedCategories.length ? `Unassessed categories: ${analysis.unassessedCategories.map(inline).join('; ')}.` : '', '',
    `${sourceEntries.length} original record(s) and their exact extracted-text companions are included. ${omittedSources.length ? `**${omittedSources.length} source(s) from this revision are omitted.** The evidence index lists each omission and whether it was cited.` : 'No source from this revision is omitted.'}`, '',
    'Exporting this packet does not send it, amend an official claim, accept a settlement or withdraw a claim. Source quotes and file hashes establish traceability and integrity, not authenticity or legal truth.', '');
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n');
}

const printCss = 'html{background:#f6f7fb}body{max-width:840px;margin:28px auto;padding:36px;background:#fff;color:#171a28;font:15px/1.6 system-ui,sans-serif}h1{font-size:29px;line-height:1.2}h2{font-size:19px;border-top:1px solid #dfe3ee;padding-top:18px;margin-top:26px}h3{font-size:16px}a{color:#2546c9;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dfe3ee;padding:8px}th{background:#e9edff}blockquote{border-left:3px solid #3153ed;margin:18px 0;padding:8px 16px;background:#f6f7fb}blockquote p{white-space:pre-line}pre{white-space:pre-wrap;overflow-wrap:anywhere}body>h1+p{border-left:3px solid #3153ed;background:#e9edff;padding:10px 14px}.source-line{display:grid;grid-template-columns:4em minmax(0,1fr);gap:12px;padding:2px 0}.source-line:target{background:#fff1ba}.line-number{color:#4e5771;text-align:right;user-select:none}.line-text{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace}@media(max-width:600px){body{margin:0;padding:20px}table{display:block;overflow-x:auto}.source-line{grid-template-columns:2.5em minmax(0,1fr);gap:8px}}@media print{.packet-break{break-before:page}html,body{background:#fff}body{max-width:none;margin:0;padding:0;font-size:10pt;line-height:1.4}h1{font-size:20pt;margin:0 0 14pt}h2{font-size:12pt;margin:14pt 0 8pt;padding-top:10pt}h2,h3{break-after:avoid}p{margin:8pt 0}th,td{padding:6px}tr{break-inside:avoid}thead{display:table-header-group}a{color:inherit}blockquote{background:transparent}table{font-size:9pt}}@page{size:A4;margin:18mm}';

export function htmlDocument(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${htmlEscape(title)}</title><style>${printCss}</style></head><body>${body}</body></html>`;
}

export function renderPortableHtml(md, { title = 'WageProof factual update', allowedPaths = [] } = {}) {
  const allowed = new Set(allowedPaths);
  const official = new Set(['https://www.dir.ca.gov/dlse/policies.htm', 'https://www.dir.ca.gov/dlse/HowToFileWageClaim.htm']);
  const markdown = new Marked({ renderer: {
    html: token => htmlEscape(token.text), image: token => htmlEscape(token.text),
    heading(token) { const match = token.text.match(/^Source (R\d+)$/); return `<h${token.depth}${match ? ` id="source-${match[1]}"` : ''}${token.text === 'Evidence packet and review record' ? ' class="packet-break"' : ''}>${this.parser.parseInline(token.tokens)}</h${token.depth}>`; },
    link(token) {
      const content = this.parser.parseInline(token.tokens);
      const [pathname, fragment] = token.href.split('#');
      const permitted = official.has(token.href) || /^#source-R\d+$/.test(token.href) || (allowed.has(pathname) && (!fragment || /^L\d+$/.test(fragment)));
      return permitted ? `<a href="${htmlEscape(token.href)}" rel="noopener noreferrer">${content}</a>` : content;
    },
  } });
  let inSources = false;
  const footnotes = md.split('\n').map(line => {
    const match = line.match(/^\[\^(R\d+)\]: (.*)$/);
    if (match) { inSources = true; return `### Source ${match[1]}\n\n${match[2]}\n`; }
    if (inSources && line.startsWith('    > ')) return line.slice(4);
    return line.replace(/\[\^(R\d+)\]/g, '[$1](#source-$1)');
  }).join('\n');
  return htmlDocument(title, markdown.parse(footnotes));
}

export function renderSourceLines(source, entry) {
  const warnings = (source.extraction?.warnings ?? []).map(warning => `<li>${htmlEscape(warning)}</li>`).join('');
  const lines = String(source.text ?? '').split('\n').map((text, index) => `<div class="source-line" id="L${index + 1}"><a class="line-number" href="#L${index + 1}" aria-label="Line ${index + 1}">${index + 1}</a><span class="line-text">${htmlEscape(text)}</span></div>`).join('\n');
  return htmlDocument(`${entry.label} · extracted source text`, `<h1>${htmlEscape(entry.label)} · ${htmlEscape(source.name)}</h1><p><a href="../${htmlEscape(entry.originalPath)}">Open the original record</a> · <a href="../evidence.html">Evidence index</a></p><p>These lines reproduce the retained extraction exactly. Line numbers are presentation only. Extraction and OCR can be incomplete or wrong; compare consequential readings with the immutable original.</p>${warnings ? `<ul>${warnings}</ul>` : ''}<p>Original SHA-256: <code>${htmlEscape(entry.sha256)}</code></p><section aria-label="Extracted source lines">${lines}</section>`);
}

export function renderEvidenceIndex({ sourceEntries, omittedSources, laterSourceCount }) {
  const lines = ['# Evidence included with this revision', '', '[Short factual update](update.html) · [Detailed supplement](supplement.html) · [Integrity manifest](manifest.json)', '', 'Originals are unchanged. Extracted text is retained separately; matching a quote does not verify its interpretation or the document\'s authenticity.', ''];
  for (const entry of sourceEntries) lines.push(`## ${entry.label} · ${inline(entry.name)}`, '', `[Original record](${entry.originalPath}) · [Numbered source lines](${entry.linesPath}) · [Exact extracted text](${entry.textPath})`, '', `Source ID: ${inline(entry.id)}  `, `Original SHA-256: ${entry.sha256}  `, `Extracted-text SHA-256: ${entry.textSha256}  `, `Extraction: ${inline(entry.extractionMethod || 'Not recorded')}  `, `Cited in selected account: ${entry.referenced ? 'Yes' : 'No; explicitly included as context'}`, '', ...entry.warnings.map(warning => `- ${inline(warning)}`), '');
  if (!sourceEntries.length) lines.push('No originals are included in this packet.', '');
  if (omittedSources.length) {
    lines.push('## Omitted sources', '', 'These original records and extracted-text companions are not included. A citation in the supplement may therefore refer to evidence the recipient cannot inspect from this packet.', '');
    for (const [index,source] of omittedSources.entries()) lines.push(`- **O${String(index+1).padStart(2,'0')}** · ${inline(source.name)} · source ${inline(source.id)} · ${source.referenced ? '**Cited, but not selected for inclusion**' : 'Not cited and not selected for inclusion'}.`);
  }
  if (laterSourceCount) lines.push('', `${laterSourceCount} later source(s) outside the selected revision are excluded. Their names, text and bytes are not included in this packet.`);
  return `${lines.join('\n')}\n`;
}
