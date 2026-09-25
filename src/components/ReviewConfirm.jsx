import React, { useState } from 'react';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';
import { money, moneyRange } from '../format.js';

export default function ReviewConfirm({ revision, onClose, onConfirm, busy }) {
  const [note, setNote] = useState(''), [checked, setChecked] = useState(false), [error, setError] = useState('');
  const analysis = revision.analysis, calculation = revision.calculation || revision.reconciliation;
  const open = analysis.issues.filter(issue => ['open', 'unassessed'].includes(issue.status));
  const uncertainPayments = analysis.payments.filter(payment => payment.allocationStatus === 'unknown' || payment.allocationScope !== 'exclusive_supported' || payment.identityStatus !== 'supported' || payment.additionality !== 'supported' || !['documented', 'worker_reported'].includes(payment.receiptStatus));
  return <Dialog title="Review this version" onClose={onClose}><form onSubmit={async e => { e.preventDefault(); try { await onConfirm(note); } catch (error) { setError(error.message); } }}>
    <p className="dialog-intro">Revision {revision.number} becomes the reviewed working account. You are retaining its stated assumptions and open questions; later evidence needs a fresh review.</p>
    <div className="review-confirm-summary"><span>Wage difference under this account</span><strong>{moneyRange(calculation?.totals?.differenceMinCents, calculation?.totals?.differenceMaxCents)}</strong>{calculation?.totals?.uncreditedPaymentCount > 0 && <p>This excludes {calculation.totals.uncreditedPaymentCount} unresolved or excluded payment(s).</p>}</div>
    {(open.length > 0 || uncertainPayments.length > 0) && <section className="review-retained"><h3>These questions stay open</h3><ul>{open.map(issue => <li key={issue.id}>{issue.title}</li>)}{uncertainPayments.map(payment => <li key={payment.id}>{payment.label}: {payment.allocationStatus === 'unknown' ? 'the split is not established' : 'one or more payment premises remain uncertain'}.</li>)}</ul></section>}
    <p className="muted small">Corrections included before deductions: {money(calculation?.totals?.creditedGrossCents)}. Payment timing, legal entitlement and other claim categories remain outside this calculation.</p>
    <label className="field"><span>Review note <small>(optional)</small></span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Describe an uncertainty or premise you are retaining." /></label>
    <label className="check-field review-check"><input type="checkbox" required checked={checked} onChange={e => setChecked(e.target.checked)} /><span>I checked the consequential interpretations and their sources. I am retaining the stated assumptions and uncertainties for this version.</span></label>
    {error && <div className="notice error" role="alert">{error}</div>}<div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose}>Back to the account</button><button className="button" disabled={!checked || busy}>{busy ? 'Saving review…' : 'Mark this version reviewed'}<Icon name="check" /></button></div>
  </form></Dialog>;
}
