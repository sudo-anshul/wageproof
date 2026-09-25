import React, { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';
import Citations from './Citations.jsx';
import { centsInput, money, moneyRange } from '../format.js';
import { focusedPaymentCorrection, paymentStatement, paymentTopics } from '../experience.mjs';
import { reconcile } from '../../domain/reconcile.mjs';

const options = {
  receipt: [['received', 'I received it', 'Record the amount you can confirm receiving.'], ['not_received', 'I have not received it', 'Keep the reported payment, without treating it as received.'], ['uncertain', 'Keep receipt uncertain', 'Clear the assumed receipt and leave the payment out of the calculation.']],
  identity: [['supported', 'Use one payment in this draft', 'Explain the evidence or your account linking these records.'], ['uncertain', 'Keep the match uncertain', 'Do not count this as a supported distinct correction.']],
  additionality: [['supported', 'It is additional pay', 'Explain why it is additional to the pay already counted.'], ['not_additional', 'It replaces or repeats earlier pay', 'Exclude it as an additional correction.'], ['uncertain', 'Keep additional pay uncertain', 'Do not subtract this correction from the account.']],
  coverage: [['supported', 'Only these listed weeks', 'Explain the source or account establishing exclusive coverage.'], ['uncertain', 'Coverage is uncertain', 'Do not assume this correction belongs only to these weeks.']],
  allocation: [['known', 'Enter the supported split', 'The amounts must add up to the correction before deductions.'], ['uncertain', 'Keep the split uncertain', 'Remove the split. A supported shared correction can still be counted once.']],
};

export default function PaymentDecision({ analysis, paymentId, initialTopic = 'receipt', sources, onSource, onClose, onSave, onFullEditor, busy }) {
  const payment = analysis.payments.find(item => item.id === paymentId);
  const [topic, setTopic] = useState(initialTopic), [choice, setChoice] = useState('keep'), [reason, setReason] = useState(''), [error, setError] = useState('');
  const [received, setReceived] = useState(centsInput(payment?.receivedNetCents));
  const [allocations, setAllocations] = useState(() => Object.fromEntries((payment?.periodIds || []).map(id => [id, centsInput(payment.allocations.find(a => a.periodId === id)?.grossCents)])));
  const preview = useMemo(() => { try { const draft = focusedPaymentCorrection(analysis, paymentId, topic, choice, { received, allocations }); return { draft, calculation: reconcile(draft) }; } catch (e) { return { error: e.message }; } }, [analysis, paymentId, topic, choice, received, allocations]);
  if (!payment) return null;
  const shownPayment = preview.calculation?.payments.find(p => p.id === paymentId);
  const totals = preview.calculation?.totals;
  const subject = { label: paymentTopics[topic].question, statement: paymentStatement(payment, topic, analysis.periods), detail: paymentTopics[topic].hint };
  async function save(event) {
    event.preventDefault(); setError('');
    if (choice === 'keep') { onClose(); return; }
    if (reason.trim().length < 12) { setError('Explain your basis in at least 12 characters. Your words become an attributed correction source.'); return; }
    if (preview.error) { setError(preview.error); return; }
    try { await onSave(preview.draft, reason.trim()); } catch (e) { setError(e.message); }
  }
  return <Dialog title="Check this payment" wide className="payment-decision-dialog" onClose={onClose}><p className="dialog-intro">{payment.label}. Check one interpretation at a time. Saving creates a draft; it does not approve this version.</p>
    <div className="decision-topics" role="group" aria-label="Payment interpretations">{Object.entries(paymentTopics).map(([id, item]) => <button type="button" key={id} aria-pressed={topic === id} disabled={busy || (choice !== 'keep' && topic !== id)} onClick={() => { setTopic(id); setChoice('keep'); setReason(''); setError(''); }}>{item.label}</button>)}</div>
    <form onSubmit={save}><h3 className="decision-question">{paymentTopics[topic].question}</h3><p className="muted">{paymentTopics[topic].hint}</p><div className="decision-current"><span>Current interpretation</span><p>{paymentStatement(payment, topic, analysis.periods)}</p><div className="decision-money"><span>Before deductions <strong>{money(payment.grossCents)}</strong></span><span>Stated net <strong>{money(payment.netCents)}</strong></span><span>Recorded received <strong>{money(payment.receivedNetCents)}</strong></span></div><Citations items={payment.citations} sources={sources} onOpen={onSource} context={subject} /></div>
    <fieldset className="decision-options"><legend>How should the draft treat this?</legend><label className={`decision-option ${choice === 'keep' ? 'chosen' : ''}`}><input type="radio" name="decision" value="keep" checked={choice === 'keep'} onChange={() => setChoice('keep')} /><span><strong>Keep the current interpretation</strong><small>No change or approval is recorded by closing this check.</small></span></label>{options[topic].map(([value, label, detail]) => <label key={value} className={`decision-option ${choice === value ? 'chosen' : ''}`}><input type="radio" name="decision" value={value} checked={choice === value} onChange={() => setChoice(value)} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</fieldset>
    {topic === 'receipt' && choice === 'received' && <label className="field"><span>Amount actually received ($)</span><input type="number" min="0" step="0.01" value={received} onChange={e => setReceived(e.target.value)} required /></label>}
    {topic === 'allocation' && choice === 'known' && <div className="form-grid">{payment.periodIds.map(id => <label key={id} className="field"><span>{analysis.periods.find(p => p.id === id)?.label || id} ($)</span><input type="number" min="0" step="0.01" value={allocations[id] || ''} onChange={e => setAllocations(v => ({ ...v, [id]: e.target.value }))} required /></label>)}</div>}
    {choice !== 'keep' && <><div className="decision-effect" aria-live="polite"><strong>Effect on this draft</strong>{preview.error ? <p>{preview.error}</p> : <><p>{shownPayment?.credited ? 'This correction is counted once under the proposed premises.' : 'This payment is not counted in this draft’s wage calculation.'}</p>{shownPayment?.creditStatus === 'excluded' && <p>The payment retains an explicit exclusion. Use the full editor if that exclusion also needs correcting.</p>}<p>{totals?.calculable ? <><strong>{moneyRange(totals.differenceMinCents, totals.differenceMaxCents)}</strong> wage difference under the current work account. {totals.uncreditedPaymentCount > 0 && 'This excludes unresolved or excluded payments.'}</> : <>A complete wage total is not established. Missing work accounts remain unassessed; a factual payment update can still be prepared.</>}</p></>}</div><label className="field"><span>Your basis for the correction</span><textarea required minLength={12} maxLength={1200} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Say what you know and identify the record or conversation supporting it." /><small>Your explanation is retained with the changed fields. Original records and earlier accounts remain unchanged.</small></label><p className="decision-switch-note">Save this correction before checking another interpretation, or choose “Keep the current interpretation” to switch without saving.</p></>}
    {error && <div className="notice error" role="alert">{error}</div>}<button type="button" className="text-button" onClick={onFullEditor}>Need to change other amounts or weeks? Open the full editor<Icon name="arrow" size={15} /></button><div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button" type="submit" disabled={busy || (choice !== 'keep' && !!preview.error)}>{busy ? 'Saving correction…' : choice === 'keep' ? 'Keep in this draft' : 'Save correction as a draft'}<Icon name="check" size={16} /></button></div></form>
  </Dialog>;
}
