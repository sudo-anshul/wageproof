import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';
import { parseCsvSource } from '../experience.mjs';

export default function SourceDrawer({ source, citation, context, caseId, onClose }) {
  const anchor = useRef(null), reader = useRef(null), textSizeId = useId();
  const [textSize, setTextSize] = useState(16);
  const text = source?.text || source?.content || '';
  const lines = text.split('\n');
  const csv = useMemo(() => /\.csv$/i.test(source?.name || '') || /csv/i.test(source?.mime || '') ? parseCsvSource(text) : null, [source?.name, source?.mime, text]);
  const [view, setView] = useState(csv ? 'rows' : 'text');
  useEffect(() => {
    if (anchor.current && reader.current) {
      const line = anchor.current, viewport = reader.current;
      viewport.scrollTop += line.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (viewport.clientHeight - line.clientHeight) / 2;
    }
  }, [source?.id, citation?.lineStart, textSize, view]);
  const activeRow = row => citation && row.lineEnd >= citation.lineStart && row.lineStart <= citation.lineEnd;
  const firstActive = csv?.rows.findIndex(activeRow);
  return <Dialog title={source?.name || 'Source record'} onClose={onClose} wide className="source-dialog">
    <div className="source-meta"><span><Icon name="file" />{source?.kind || 'Source record'}</span><span>{lines.length} lines</span><span>Original wording retained</span></div>
    {(context || citation) && <div className="source-context">
      <strong>{context?.label || 'Evidence for this interpretation'}</strong>
      {context?.statement && <p>{context.statement}</p>}
      {context?.detail && <details className="source-reason"><summary>Interpretation being checked</summary><p className="source-purpose">{context.detail}</p></details>}
      {citation && <><small>Exact source location: lines {citation.lineStart}–{citation.lineEnd}. An excerpt supports review; it does not certify its interpretation.</small><details className="exact-excerpt"><summary>Read the exact cited excerpt</summary><p style={{ fontSize: textSize }}>{citation.quote}</p></details></>}
    </div>}
    {source?.extraction?.warnings?.length > 0 && <div className="notice warning">{source.extraction.warnings.join(' ')}</div>}
    <div className="source-reader-tools">
      {csv && <div className="reader-view-options" role="group" aria-label="Source presentation"><button type="button" aria-pressed={view === 'rows'} onClick={() => setView('rows')}>Readable rows</button><button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')}>Raw text</button></div>}
      <label htmlFor={textSizeId}>Text size</label><select id={textSizeId} value={textSize} onChange={event => setTextSize(Number(event.target.value))}><option value={16}>Standard</option><option value={18}>Larger</option><option value={24}>Largest</option></select>
    </div>
    {view === 'rows' && csv ? <div ref={reader} className="source-lines csv-source" style={{ fontSize: textSize }} tabIndex={0} role="region" aria-label="Source rows with original columns and line references">
      <p className="csv-explainer">Columns from source line {csv.headerLine}. Cell values and wording are unchanged.</p>
      {csv.rows.map((row, i) => <article key={i} className={`csv-source-row ${activeRow(row) ? 'highlighted' : ''}`} ref={i === firstActive ? anchor : null}><span className="csv-location">{row.lineStart === row.lineEnd ? `Line ${row.lineStart}` : `Lines ${row.lineStart}–${row.lineEnd}`}{activeRow(row) && ' · cited'}</span><dl>{row.cells.map((cell, index) => <div key={index}><dt>{csv.headers[index] || `Column ${index + 1} (unnamed)`}</dt><dd>{cell || <span className="muted">Empty cell</span>}</dd></div>)}</dl></article>)}
    </div> : <div ref={reader} className="source-lines" style={{ fontSize: textSize }} tabIndex={0} role="region" aria-label="Source text with line numbers">{lines.map((line, i) => {
      const active = citation && i + 1 >= citation.lineStart && i + 1 <= citation.lineEnd;
      return <div className={`source-line ${active ? 'highlighted' : ''}`} key={i} ref={active && i + 1 === citation.lineStart ? anchor : null}><span className="line-number" aria-label={`Line ${i + 1}`}>{i + 1}</span><span>{line || ' '}</span></div>;
    })}</div>}
    {source?.extraction?.method && <details className="source-extraction"><summary>About this extracted view</summary><p>Extraction: {source.extraction.method}. Check the original if layout or text recognition affects the interpretation. Repeated views of a record are not independent corroboration.</p></details>}
    <div className="dialog-footer">{caseId && source?.id && <a className="button secondary" href={`/api/cases/${encodeURIComponent(caseId)}/sources/${encodeURIComponent(source.id)}/file`} target="_blank" rel="noreferrer"><Icon name="file" />Open original</a>}<button type="button" className="button" onClick={onClose}>Back to the account</button></div>
  </Dialog>;
}
