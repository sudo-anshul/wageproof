import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { dateTime } from '../format.js';
import Citations from './Citations.jsx';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';

const fieldsOf = value => ({ recipient: value?.recipient || '', subject: value?.subject || '', body: value?.body || '' });
const sameFields = (a, b) => ['recipient', 'subject', 'body'].every(key => a[key] === b[key]);
const sameBasis = (a, b) => a && b && ['revisionId', 'sourceDigest', 'actionFingerprint'].every(key => a[key] === b[key]);

export default function RequestDraftDialog({ caseRecord, selection, index, onSave, onRefresh, onSource, onClose, onStartCurrent, onCurrentAccount, navigationGuard }) {
  const initialDraft = index.drafts.find(d => d.id === selection.draftId);
  const initialAction = index.actions.find(a => a.id === (initialDraft?.actionId || selection.actionId));
  const [basis] = useState(() => initialDraft?.basis || initialAction?.basis);
  const [saved, setSaved] = useState(initialDraft || null);
  const [initial] = useState(() => fieldsOf(initialDraft || initialAction?.seed));
  const [fields, setFields] = useState(initial);
  const [expectedVersion, setExpectedVersion] = useState(index.caseVersion);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false), [exporting, setExporting] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [discard, setDiscard] = useState(false);
  const discardRef = useRef(null);
  const pendingExit = useRef(onClose);
  const prepared = index.readOnly;
  const currentAction = index.actions.find(a => a.id === basis?.actionId);
  const observedDraft = saved && index.drafts.find(d => d.id === saved.id);
  const changedElsewhere = Boolean(observedDraft && saved && observedDraft.version > saved.version);
  const current = Boolean(index.canPrepare && sameBasis(basis, currentAction?.basis) && (!observedDraft || observedDraft.current));
  const dirty = !saved || !sameFields(fields, fieldsOf(saved));
  const edited = !sameFields(fields, saved ? fieldsOf(saved) : initial);
  const blocked = !current || changedElsewhere;
  const immutable = prepared || blocked;
  const canExport = current && !changedElsewhere && (prepared || (saved && !dirty)) && !saving && !exporting;
  const reason = changedElsewhere ? 'This saved draft changed in another view. Your typed text is still here. Reopen the saved draft to inspect its latest version, or start a separate current draft.' : observedDraft?.reason || index.reason || 'The account, its sources or this request changed. This earlier draft is kept for inspection.';
  const leave = action => {
    if (saving || exporting) return false;
    if (edited) { pendingExit.current = action; setDiscard(true); return false; }
    action(); return true;
  };
  const close = () => leave(onClose);
  useEffect(() => { if (navigationGuard) navigationGuard.current = close; return () => { if (navigationGuard) navigationGuard.current = null; }; });
  useEffect(() => { if (discard) discardRef.current?.focus(); }, [discard]);
  useEffect(() => {
    if (!edited) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edited]);
  const update = (key, value) => { setFields(currentFields => ({ ...currentFields, [key]: value })); setNotice(''); };
  async function save(event) {
    event.preventDefault(); if (immutable || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await onSave({ expectedVersion, revisionId: basis.revisionId, actionId: basis.actionId, ...(saved ? { draftId: saved.id } : {}), ...fields });
      setSaved(result.draft); setFields(fieldsOf(result.draft)); setExpectedVersion(result.case.version); setConflict(false); setNotice('Request draft saved on this computer. Nothing was sent.');
    } catch (e) { setConflict(e.status === 409); setError(`${e.message} Your text is still in this editor.`); }
    finally { setSaving(false); }
  }
  async function exportDraft(mode) {
    if (!canExport) return;
    setExporting(true); setError(''); setNotice('');
    try {
      const query = new URLSearchParams(prepared ? { actionId: basis.actionId, revision: basis.revisionId } : { draftId: saved.id, draftVersion: saved.version });
      const result = await api(`/cases/${caseRecord.id}/request-drafts/export?${query}`);
      if (mode === 'copy') {
        try { await navigator.clipboard.writeText(result.text); }
        catch (e) { setError(`The request could not be copied to your clipboard. Download the text instead. ${e.message || ''}`); return; }
        setNotice('Copied the request and its preparation record. Nothing was sent.');
      } else {
        const url = URL.createObjectURL(new Blob([result.text], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = result.filename; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setNotice('Request text prepared for download. Nothing was sent.');
      }
    } catch (e) {
      setError(e.message || 'The current request could not be exported. Check its status and try again.');
      await onRefresh();
    } finally { setExporting(false); }
  }
  return <Dialog title={prepared ? 'Preview a fictional request' : 'Prepare a request'} wide className="request-draft-dialog" onClose={close}>
    <p className="dialog-intro">One request, with the account behind it. Prepare wording to use yourself; WageProof does not send it or mark the question answered.</p>
    {discard && <div className="request-discard notice warning" role="alert"><strong>Your changes are not saved.</strong><p>Keep editing, or discard these changes to continue.</p><div><button type="button" className="button secondary" ref={discardRef} onClick={() => setDiscard(false)}>Keep editing</button><button type="button" className="text-button" onClick={() => pendingExit.current()}>Discard changes</button></div></div>}
    {prepared && <div className="notice prepared-request-note"><strong>Fictional preview from a recorded example</strong><p>These starting fields are read-only. Copy or download this exact example; no request is saved and no new model run is performed.</p></div>}
    {blocked && <div className="notice warning" role="status"><strong>{changedElsewhere ? 'A newer saved version exists' : 'Earlier draft · not current'}</strong><p>{reason}</p>{index.canPrepare && currentAction && !prepared ? <button type="button" className="text-button" onClick={() => leave(() => onStartCurrent(basis.actionId))}>Start a current draft<Icon name="arrow" size={15}/></button> : <button type="button" className="text-button" onClick={() => leave(onCurrentAccount)}>View the current account<Icon name="arrow" size={15}/></button>}</div>}
    <form onSubmit={save}>
      <div className="request-draft-layout">
        <div className="request-draft-fields">
          <div className="request-draft-status"><span className={`badge ${blocked ? 'attention' : saved && !dirty ? 'good' : 'neutral'}`}>{blocked ? 'Outdated' : prepared ? 'Fictional preview' : saving ? 'Saving…' : dirty ? 'Unsaved draft' : 'Saved locally'}</span><span>Not sent · Account revision {basis?.revisionNumber}</span></div>
          <label className="field"><span id="request-recipient-label">To <small>(optional)</small></span><input data-autofocus aria-labelledby="request-recipient-label" value={fields.recipient} maxLength={300} readOnly={immutable} disabled={saving} onChange={e => update('recipient', e.target.value)} placeholder="Confirm the person or payroll contact"/><small>Use the intended recipient for this request. This can differ from the deputy receiving a case update.</small></label>
          <label className="field"><span>Subject</span><input required value={fields.subject} maxLength={240} readOnly={immutable} disabled={saving} onChange={e => update('subject', e.target.value)}/></label>
          <label className="field"><span id="request-wording-label">Request wording</span><small id="request-wording-hint">{blocked ? 'This earlier wording is retained for inspection.' : prepared ? 'This preview preserves the current action wording.' : 'Starting text includes the current action wording. Edit it into the request you want to make.'}</small><textarea required rows={14} maxLength={12000} aria-labelledby="request-wording-label" aria-describedby="request-wording-hint" value={fields.body} readOnly={immutable} disabled={saving} onChange={e => update('body', e.target.value)}/></label>
          {saved && <p className="small muted">Saved {dateTime(saved.updatedAt)} · draft version {saved.version}. Saving request wording does not review or change the wage account.</p>}
        </div>
        <aside className="request-draft-basis"><details open><summary>{blocked ? 'Basis of this earlier draft' : 'Why this request remains open'}</summary><div><h3>{basis?.title}</h3><p className="request-original-scope">{basis?.detail}</p>{basis?.dateRange && <p><strong>Period covered</strong><br/>{basis.dateRange}</p>}<p className="small muted">Original action wording · account revision {basis?.revisionNumber}. Check the cited records when editing your request.</p><Citations items={basis?.citations || []} sources={caseRecord.sources} onOpen={onSource} context={{ label: 'Basis for this request', statement: basis?.title, detail: basis?.detail }}/></div></details></aside>
      </div>
      {error && <div className="notice error" role="alert"><div>{error}{conflict && !blocked && index.caseVersion !== expectedVersion && <button type="button" className="text-button" onClick={() => { setExpectedVersion(index.caseVersion); setConflict(false); setError(''); setNotice('The current request basis is unchanged. Your wording is ready to save again.'); }}>Keep this text and retry</button>}</div></div>}
      {notice && <p className="request-feedback" role="status"><Icon name="check" size={17}/>{notice}</p>}
      <div className="dialog-footer request-draft-footer"><div className="request-export-actions"><button type="button" className="button secondary" disabled={!canExport} onClick={() => exportDraft('copy')}>Copy request</button><button type="button" className="button secondary" disabled={!canExport} onClick={() => exportDraft('download')}><Icon name="download" size={16}/>Download text</button></div><button type="button" className="text-button" onClick={close}>Close</button>{!prepared && !blocked && <button type="submit" className="button" disabled={saving || !dirty || exporting}><Icon name="check" size={16}/>{saving ? 'Saving…' : 'Save request draft'}</button>}</div>
      {!prepared && current && dirty && <p className="request-export-hint">Save this wording before copying or downloading it. Your download includes a separate record of the source account.</p>}
    </form>
  </Dialog>;
}
