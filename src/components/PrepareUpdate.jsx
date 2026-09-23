import React, { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { referencedSourceIds } from '../experience.mjs';
import { dateTime, moneyRange } from '../format.js';

export default function PrepareUpdate({ caseRecord, revision, stale, historical, readOnly = false, onEditDetails, onSource }) {
  const referenced = useMemo(() => new Set(referencedSourceIds(revision.analysis)), [revision.analysis]);
  const available = caseRecord.sources.filter(source => (revision.sourceIds || [...referenced]).includes(source.id));
  const [selected, setSelected] = useState(() => available.filter(source => referenced.has(source.id)).map(source => source.id));
  const [preparing, setPreparing] = useState(false), [error, setError] = useState(''), [prepared, setPrepared] = useState(false);
  const reviewed = Boolean(revision.review?.at || revision.review?.status === 'reviewed');
  const currentReviewed = reviewed && !stale && !historical;
  const context = revision.analysis.caseContext || {};
  const recipient = context.recipient;
  const claimNumber = context.claimNumber;
  const calculation = revision.calculation || revision.reconciliation;
  const total = calculation?.totals;
  const omitted = [...referenced].filter(id => !selected.includes(id));
  const base = `/api/cases/${encodeURIComponent(caseRecord.id)}/export`;
  const exportUrl = format => `${base}?${new URLSearchParams({ revision: revision.id, format })}`;
  const packetPreviewUrl = `${base}?${new URLSearchParams({ revision: revision.id, format: 'preview', sources: selected.join(',') })}`;
  const toggle = id => { setPrepared(false); setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]); };
  async function prepare() {
    setPreparing(true); setError(''); setPrepared(false);
    try {
      const url = `${base}?${new URLSearchParams({ revision: revision.id, format: 'zip', sources: selected.join(',') })}`;
      const response = await fetch(url);
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error?.message || `The package could not be prepared (${response.status}).`); }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('zip') && !contentType.includes('octet-stream')) throw new Error('This running version does not provide the portable ZIP yet. The individual document formats below remain available.');
      const blob = await response.blob();
      const href = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = href; link.download = `WageProof-update-r${revision.number}.zip`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30000); setPrepared(true);
    } catch (e) { setError(e.message); } finally { setPreparing(false); }
  }
  return <section className="prepare-update" aria-labelledby="prepare-update-title">
    <div className="prepare-heading"><div><span className="eyebrow">Your next useful artifact</span><h2 id="prepare-update-title">Prepare the factual update</h2><p>Report what changed and keep the unanswered questions visible. This prepares files on your computer; it does not send or file them.</p></div><span className={`badge ${currentReviewed ? 'good' : 'attention'}`}>{historical ? 'Historical version' : stale ? 'Earlier version · newer sources pending' : currentReviewed ? 'Reviewed for this version' : 'Draft for review'}</span></div>
    <div className="prepare-layout"><div className="prepare-main">
      <section className="prepare-details"><h3>1. Check the update details</h3><dl><div><dt>Purpose</dt><dd>{context.purpose || 'Report the correction and current unresolved facts.'}</dd></div><div><dt>Intended recipient</dt><dd>{recipient || 'Not confirmed. Check existing correspondence before using this draft.'}</dd></div><div><dt>Claim number</dt><dd>{claimNumber || 'Not supplied. You can prepare a draft without it.'}</dd></div><div><dt>Selected account</dt><dd>Revision {revision.number} · prepared {dateTime(revision.createdAt)}</dd></div></dl>{!readOnly && !historical && !stale && <button type="button" className="text-button" onClick={onEditDetails}>Correct the update details<Icon name="edit" size={15} /></button>}</section>
      <section className="prepare-sources"><div className="section-title"><h3>2. Choose included sources</h3><span className="count-label">{selected.length} of {available.length}</span></div><p className="muted">Cited sources are selected first. Only originals belonging to this revision can be included.</p><div className="source-selection-actions"><button type="button" className="text-button" onClick={() => { setSelected(available.filter(source => referenced.has(source.id)).map(source => source.id)); setPrepared(false); }}>Cited sources</button><button type="button" className="text-button" onClick={() => { setSelected(available.map(source => source.id)); setPrepared(false); }}>All these sources</button><button type="button" className="text-button" onClick={() => { setSelected([]); setPrepared(false); }}>None</button></div>
        <div className="package-source-list">{available.map(source => <div className="package-source" key={source.id}><label className="check-field"><input type="checkbox" checked={selected.includes(source.id)} onChange={() => toggle(source.id)} /><span><strong>{source.name}</strong><small>{referenced.has(source.id) ? 'Cited in this account' : 'Available in this revision'} · {source.kind || 'source record'}</small></span></label><button type="button" className="icon-button" aria-label={`Inspect ${source.name}`} onClick={event => { event.currentTarget.focus(); onSource(source.id, null, { label: 'Source selected for the update', statement: source.name }); }}><Icon name="book" size={18} /></button></div>)}</div>
        {omitted.length > 0 && <div className="notice warning"><Icon name="info" /><div><strong>{omitted.length} cited {omitted.length === 1 ? 'source is' : 'sources are'} not included.</strong><p>The package will identify omitted sources. They will not be available as included originals.</p></div></div>}
      </section>
    </div><aside className="package-summary"><span className="eyebrow">Local package</span><h3>One update. Its evidence.</h3><ul><li>A readable HTML update</li><li>Calculation detail and current questions</li><li>{selected.length} selected {selected.length === 1 ? 'original' : 'originals'} with a source index</li><li>{selected.length ? 'Extracted text with source locations' : 'A record of source omissions'}</li></ul><p>The documents and included evidence use relative links, so the package can be inspected without WageProof running.</p><div className="package-position"><span>{total?.calculable ? 'Wage difference in this account' : 'Complete wage total'}</span><strong>{moneyRange(total?.differenceMinCents, total?.differenceMaxCents)}</strong><small>{total?.calculable ? 'Under the retained work account and correction premises.' : 'The payment facts can still form a useful update.'}{total?.uncreditedPaymentCount > 0 && ` Excludes ${total.uncreditedPaymentCount} unresolved or excluded payment(s).`}</small></div><button type="button" className="button" onClick={prepare} disabled={preparing}><Icon name="download" />{preparing ? 'Preparing package…' : 'Prepare and download ZIP'}</button>{prepared && <p className="package-success" role="status"><Icon name="check" size={17} />Package prepared. Your browser will save the ZIP; check your downloads. No communication was sent.</p>}{error && <div className="notice error" role="alert">{error}</div>}<details className="individual-formats"><summary>Individual document formats</summary><a href={exportUrl('md')} download>Download Markdown</a><a href={exportUrl('html')} target="_blank" rel="noreferrer">Open HTML / print preview</a><p>These individual views can contain local-server source links. Use the ZIP for included offline exhibits.</p></details></aside></div>
    <details className="prepared-preview"><summary><Icon name="file" size={17} />Preview this update and source selection</summary><iframe className="supplement-frame" title={`Factual update preview, revision ${revision.number}`} src={packetPreviewUrl} sandbox="allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox" /></details>
  </section>;
}
