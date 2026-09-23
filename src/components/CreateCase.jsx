import React, { useState } from 'react';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';

export default function CreateCase({ onClose, onCreate, busy }) {
  const [title, setTitle] = useState(''), [stage, setStage] = useState('unknown'), [worker, setWorker] = useState(''), [employer, setEmployer] = useState(''), [claimNumber, setClaimNumber] = useState(''), [recipient, setRecipient] = useState(''), [error, setError] = useState('');
  return <Dialog title="Start with what changed" onClose={onClose}><form onSubmit={async event => { event.preventDefault(); setError(''); try { await onCreate({ title: title.trim() || 'New pay correction', stage, worker, employer, claimNumber, recipient }); } catch (e) { setError(e.message); } }}>
    <p className="dialog-intro">Bring a pay correction, an employer reply, or your account of what was said. You can prepare a factual update while missing details stay open.</p>
    <label className="field"><span>Name this workspace <small>(optional)</small></span><input autoFocus data-autofocus value={title} onChange={e => setTitle(e.target.value)} placeholder="For example, September pay correction" /></label>
    <label className="field"><span>Is there already a wage claim?</span><select value={stage} onChange={e => setStage(e.target.value)}><option value="unknown">Not sure / leave open</option><option value="pending-claim">A claim is pending</option><option value="no-claim">No claim has been filed</option></select><small>This sets the purpose of the update. It does not file or change a claim.</small></label>
    <details className="intake-details"><summary>Add known names or case details <span>Optional</span></summary><div className="form-grid"><label className="field"><span>Worker name</span><input value={worker} onChange={e => setWorker(e.target.value)} autoComplete="off" /></label><label className="field"><span>Employer</span><input value={employer} onChange={e => setEmployer(e.target.value)} autoComplete="off" /></label><label className="field"><span>Claim number</span><input value={claimNumber} onChange={e => setClaimNumber(e.target.value)} /></label><label className="field"><span>Intended recipient</span><input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Use the contact on your correspondence" /></label></div></details>
    <p className="privacy-note"><Icon name="lock" />Files stay on this computer. Choosing Analyze sends extracted text to the configured model service. Use fictional records for this local demonstration.</p>
    {error && <div className="notice error" role="alert">{error}</div>}<div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button" disabled={busy}>{busy ? 'Creating…' : 'Add the first record'}<Icon name="arrow" /></button></div>
  </form></Dialog>;
}
