import React from 'react';
import Icon from './Icon.jsx';
import Citations from './Citations.jsx';
import { dateTime } from '../format.js';

export default function ChangeReview({ revision, sources, historical, readOnly = false, stale, reviewed, busy, onSource, onReview, onPrepare, onPayment }) {
  const comparison = revision.sinceReviewed;
  const changes = comparison?.changes || [];
  const consequential = changes.filter(change => change.importance !== 'context');
  const context = changes.filter(change => change.importance === 'context');
  const baseline = comparison?.baselineRevisionNumber;
  const nextAction = consequential.find(change => change.entityType === 'actions' && ['superseded', 'resolved', 'added', 'removed'].includes(change.type)) || consequential.find(change => change.entityType === 'actions');
  const prominent = [...new Set([consequential.find(change => change.entityType === 'payments'), nextAction, ...consequential.filter(change => ['schedule', 'period_amount'].includes(change.entityType)), ...consequential].filter(Boolean))].slice(0, 4);
  const remaining = consequential.filter(change => !prominent.includes(change));
  const sourceOrder = new Map(sources.map((source, index) => [source.id, index]));
  const item = (change, index) => {
    const longFields = (change.fields || []).filter(field => Math.max(field.before?.length || 0, field.after?.length || 0) > 280);
    const briefFields = (change.fields || []).filter(field => !longFields.includes(field));
    const before = longFields.length ? briefFields.map(field => `${field.label}: ${field.before}`).join('\n') : change.before;
    const after = longFields.length ? briefFields.map(field => `${field.label}: ${field.after}`).join('\n') : change.after;
    const citations = [...(change.citations || [])].sort((a, b) => (sourceOrder.get(b.sourceId) ?? -1) - (sourceOrder.get(a.sourceId) ?? -1));
    const citationContext = { label: 'Why this change is proposed', statement: change.title, detail: after || change.detail };
    const paymentTopic = (change.fields || []).some(field => ['Correction split', 'Whether the split is established'].includes(field.label)) ? 'allocation' : 'coverage';
    return <article className={`review-change ${change.type === 'support_changed' ? 'support-change' : ''}`} key={`${change.entityType}-${change.id}-${index}`}>
    <div className="change-heading"><span className="change-category">{change.type === 'support_changed' ? 'Evidence changed' : change.type === 'removed' ? 'No longer represented' : change.entityType === 'actions' ? 'Next step changed' : 'Account change'}</span><h3>{change.title}</h3></div>
    {(before || after) && <div className="change-comparison">{before && <div><span>Before</span><p>{before}</p></div>}{after && <div><span>{reviewed ? 'This account' : 'Proposed'}</span><p>{after}</p></div>}</div>}
    {longFields.length > 0 && <details className="change-supporting-detail"><summary>Read the changed explanation{longFields.length > 1 ? 's' : ''}</summary>{longFields.map((field, i) => <div key={i}><h4>{field.label}</h4><div className="change-comparison"><div><span>Before</span><p>{field.before}</p></div><div><span>{reviewed ? 'This account' : 'Proposed'}</span><p>{field.after}</p></div></div></div>)}</details>}
    {change.detail && <p className="change-explanation">{change.detail}</p>}
    <Citations items={citations.slice(0, 2)} sources={sources} onOpen={onSource} context={citationContext} />
    {citations.length > 2 && <details className="change-supporting-detail change-sources"><summary>{citations.length - 2} more cited excerpts</summary><Citations items={citations.slice(2)} sources={sources} onOpen={onSource} context={citationContext} /></details>}
    {!readOnly && !historical && !stale && change.entityType === 'payments' && revision.analysis.payments.some(payment => payment.id === change.id) && <button type="button" className="text-button" disabled={busy} onClick={() => onPayment(change.id, paymentTopic)}>Review this payment<Icon name="arrow" size={15} /></button>}
  </article>;
  };
  return <section className="change-review" aria-labelledby="change-review-title">
    <div className="change-review-heading"><div><span className="eyebrow">{historical ? 'Preserved comparison' : stale ? 'Earlier account · new evidence pending' : reviewed ? 'Reviewed account' : 'Your next review'}</span><h2 id="change-review-title">{baseline != null ? 'What changed since your review' : comparison ? 'Review the first account' : 'Review this account'}</h2><p>{baseline != null ? `Reviewed revision ${baseline} → ${reviewed ? 'revision' : 'proposed revision'} ${revision.number}` : `Revision ${revision.number}${comparison ? ' · no earlier reviewed account' : ''}`}{comparison?.baselineReviewedAt && <span> · reviewed {dateTime(comparison.baselineReviewedAt)}</span>}</p></div>{comparison?.amountUnchanged && <span className="same-amount"><Icon name="info" size={17} />Total unchanged. Check what changed around it.</span>}</div>
    <p className="change-review-summary">{comparison?.summary || revision.analysis.summary}</p>
    {!comparison && <p className="small muted">A review-relative comparison is not available for this version. The complete account remains below.</p>}
    {comparison && !changes.length && <p className="no-change-note">No represented change was found in this comparison. Source support and this version's review status still matter.</p>}
    {prominent.length > 0 && <div className="review-change-list">{prominent.map(item)}</div>}
    {remaining.length > 0 && <details className="remaining-changes"><summary>Show {remaining.length} more changes found</summary><div className="review-change-list">{remaining.map(item)}</div></details>}
    {context.length > 0 && <details className="remaining-changes"><summary>Context and supporting changes ({context.length})</summary><div className="review-change-list">{context.map(item)}</div></details>}
    <div className="change-review-footer"><button type="button" className="text-button" onClick={() => { const account = document.getElementById('full-account'); account?.scrollIntoView({ block: 'start' }); account?.focus({ preventScroll: true }); }}>Read the complete account<Icon name="down" size={15} /></button><div>{!readOnly && !historical && !stale && !reviewed && <button className="button" disabled={busy} onClick={onReview}>Review this version<Icon name="check" size={16} /></button>}<button className="button secondary" onClick={onPrepare}>Prepare {reviewed && !stale && !historical ? 'update' : 'a draft update'}<Icon name="arrow" size={16} /></button></div></div>
    <p className="change-review-limit">Changes found are a guide to review. Unchanged fields are retained context, not newly verified facts.</p>
  </section>;
}
