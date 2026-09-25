import { createHash } from 'node:crypto';
import { sourceBytes } from './extract.mjs';
import { error, sourceDigest, validId } from './store.mjs';
import { labelPreparedExport, preparedExportProvenance } from './prepared-example.mjs';
import { renderSupplement } from '../domain/supplement.mjs';
import { collectCitations, collectReferencedSourceIds, renderShortUpdate, renderPortableHtml, renderSourceLines, renderEvidenceIndex, revisionExportStatus } from '../domain/portable.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const DEFAULT_LIMIT = 128 * 1024 * 1024;
const extensionByMime = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv' };

function safeFilename(source, index) {
  const last = String(source.name ?? 'record').split(/[\\/]/).at(-1);
  const fromName = last.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const extension = extensionByMime[source.mime] ?? (['pdf', 'png', 'jpg', 'jpeg', 'txt', 'md', 'csv'].includes(fromName) ? fromName : 'bin');
  const stem = last.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'record';
  return `${String(index + 1).padStart(3, '0')}-${stem}.${extension}`;
}

const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }

/** Bounded, uncompressed ZIP32. Paths and timestamps are generated, never taken from records. */
export function makeZip(files, maxBytes = DEFAULT_LIMIT) {
  if (files.length > 65535) throw error('EXPORT_LIMIT', 'Too many files for one evidence packet.', 413);
  let offset = 0;
  const local = [], central = [], names = new Set();
  for (const file of files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.startsWith('/') || file.path.split('/').some(part => !part || part === '.' || part === '..') || names.has(file.path.toLowerCase())) throw error('EXPORT_PATH', 'The export contains an unsafe or duplicate generated path.', 500);
    names.add(file.path.toLowerCase());
    const name = Buffer.from(file.path), bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes), crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, bytes); central.push(directory, name); offset += header.length + name.length + bytes.length;
    if (offset > maxBytes) throw error('EXPORT_LIMIT', 'This packet exceeds the 128 MiB local export limit. Select fewer original records.', 413);
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize + 22 > maxBytes) throw error('EXPORT_LIMIT', 'This packet exceeds the local export limit. Select fewer original records.', 413);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/** No store writes. Inputs are cloned before the first await; only selected immutable blobs are read. */
export async function createExportBundle({ caseRecord, revision, selectedSourceIds, readOriginal, maxBytes = DEFAULT_LIMIT, generatedAt = new Date().toISOString() }) {
  const c = structuredClone(caseRecord), r = structuredClone(revision);
  validId(c?.id); validId(r?.id);
  if (!r.analysis || !Array.isArray(r.sourceIds)) throw error('EXPORT_REVISION', 'This revision does not contain a complete source snapshot for portable export.', 409);
  if (!Array.isArray(c.sources)) throw error('EXPORT_SOURCE', 'The selected case has no readable source index.', 409);
  const sourceMap = new Map();
  for (const source of c.sources) {
    validId(source.id);
    if (sourceMap.has(source.id)) throw error('EXPORT_SOURCE', 'The case has duplicate source identifiers. Restore its source index before exporting.', 409);
    sourceMap.set(source.id, source);
  }
  const revisionIds = new Set(r.sourceIds);
  for (const id of revisionIds) if (!sourceMap.has(id)) throw error('EXPORT_SOURCE', 'A source in this revision is missing from the case index. Restore it before exporting.', 409);
  const referenced = new Set(collectReferencedSourceIds(r.analysis));
  for (const id of referenced) if (!revisionIds.has(id)) throw error('EXPORT_SOURCE_SCOPE', 'The revision cites a source outside its frozen source set. Correct the revision before exporting.', 409);
  for (const citation of collectCitations(r.analysis)) {
    const lines = String(sourceMap.get(citation.sourceId).text ?? '').replace(/\r\n?/g, '\n').split('\n');
    if (citation.lineStart < 1 || citation.lineStart > citation.lineEnd || citation.lineEnd > lines.length || !citation.quote.trim() || !lines.slice(citation.lineStart - 1, citation.lineEnd).join('\n').includes(citation.quote.replace(/\r\n?/g, '\n'))) throw error('EXPORT_SOURCE_TEXT', 'The retained extracted text no longer supports a citation in this revision. Restore or correct the source account before exporting.', 409, { sourceId: citation.sourceId });
  }
  if (selectedSourceIds !== undefined && !Array.isArray(selectedSourceIds)) throw error('EXPORT_SELECTION', 'Select original records using a list of source IDs.');
  const selected = new Set(selectedSourceIds === undefined ? referenced : selectedSourceIds);
  for (const id of selected) { validId(id); if (!revisionIds.has(id)) throw error('EXPORT_SELECTION', 'An original record was selected outside this revision. Select only records in the chosen revision.'); }
  const selectedSources = r.sourceIds.filter((id, index, ids) => selected.has(id) && ids.indexOf(id) === index).map(id => sourceMap.get(id));
  const estimatedBytes = selectedSources.reduce((sum, source) => sum + (Number.isSafeInteger(source.size) ? source.size : 0) + Buffer.byteLength(String(source.text ?? '')), 0);
  if (estimatedBytes > maxBytes) throw error('EXPORT_LIMIT', 'This packet exceeds the local export limit. Select fewer original records.', 413);
  const files = [], sourceEntries = [];
  let payloadBytes = 0;
  const add = (pathname, contents, role) => {
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents); payloadBytes += bytes.length;
    if (payloadBytes > maxBytes) throw error('EXPORT_LIMIT', 'This packet exceeds the local export limit. Select fewer original records.', 413);
    files.push({ path: pathname, bytes, role });
  };
  const load = readOriginal ?? (source => sourceBytes(c.id, source.id));
  for (const [index, source] of selectedSources.entries()) {
    let bytes;
    try { bytes = Buffer.from(await load(source)); }
    catch { throw error('EXPORT_SOURCE_MISSING', 'A selected original cannot be read. Restore the original or explicitly omit it before exporting.', 409, { sourceId: source.id }); }
    const digest = sha256(bytes);
    if (!/^[a-f0-9]{64}$/i.test(source.sha256 ?? '') || digest !== source.sha256.toLowerCase()) throw error('EXPORT_SOURCE_CHANGED', 'A selected original no longer matches its recorded hash. Restore the original before exporting.', 409, { sourceId: source.id });
    const textBytes = Buffer.from(String(source.text ?? ''), 'utf8');
    const base = safeFilename(source, index);
    const entry = { id: source.id, label: `S${String(index + 1).padStart(2, '0')}`, name: source.name, kind: source.kind, mime: source.mime ?? 'application/octet-stream', size: bytes.length, sha256: digest, referenced: referenced.has(source.id), originalPath: `originals/${base}`, textPath: `sources/${base}.extracted.txt`, linesPath: `sources/${base}.lines.html`, textSha256: sha256(textBytes), lineCount: String(source.text ?? '').split('\n').length, extractionMethod: source.extraction?.method ?? null, warnings: (source.extraction?.warnings ?? []).map(String) };
    sourceEntries.push(entry);
    add(entry.originalPath, bytes, 'original'); add(entry.textPath, textBytes, 'extracted-text'); add(entry.linesPath, renderSourceLines(source, entry), 'source-lines');
  }
  const omittedSources = [...revisionIds].filter(id => !selected.has(id)).map(id => ({ id, name: sourceMap.get(id).name, referenced: referenced.has(id), reason: referenced.has(id) ? 'cited-not-selected' : 'not-cited-not-selected' }));
  const laterSourceCount = c.sources.filter(source => !revisionIds.has(source.id)).length;
  const entryMap = new Map(sourceEntries.map(entry => [entry.id, entry]));
  // Historical identity comes from the selected analysis, never newer intake edits.
  const baseline = c.revisions?.find(candidate => candidate.id === r.sinceReviewed?.baselineRevisionId && candidate.review?.at);
  const comparisonBaseline = baseline ? { id: baseline.id, number: baseline.number, calculation: baseline.reconciliation ?? baseline.calculation, responseClaims: baseline.analysis.responseClaims, issues: baseline.analysis.issues, actions: baseline.analysis.actions } : null;
  const renderCase = { id: c.id, context: {}, currentRevisionId: c.currentRevisionId, currentSourceDigest: sourceDigest(c), sources: c.sources, comparisonBaseline };
  const status = revisionExportStatus(renderCase, r);
  const supplementMarkdown = labelPreparedExport(renderSupplement({ caseRecord: renderCase, revision: r, sourceLinkResolver: ({ sourceId }) => entryMap.get(sourceId)?.originalPath ?? null }), c, r);
  if (/\]\([^\s)]*(?:\/api\/cases\/|127\.0\.0\.1|localhost)/.test(supplementMarkdown)) throw error('EXPORT_LINKS', 'Portable source-link rendering is unavailable in this build.', 500);
  const summaryMarkdown = labelPreparedExport(renderShortUpdate({ caseRecord: renderCase, revision: r, sourceEntries, omittedSources }), c, r);
  const evidenceMarkdown = labelPreparedExport(renderEvidenceIndex({ sourceEntries, omittedSources, laterSourceCount }), c, r);
  const allowedPaths = ['update.html', 'update.md', 'supplement.html', 'supplement.md', 'evidence.html', 'evidence.md', 'manifest.json', ...sourceEntries.flatMap(entry => [entry.originalPath, entry.textPath, entry.linesPath])];
  const summaryHtml = renderPortableHtml(summaryMarkdown, { allowedPaths });
  const supplementHtml = renderPortableHtml(supplementMarkdown, { title: 'WageProof detailed supplement', allowedPaths });
  const evidenceHtml = renderPortableHtml(evidenceMarkdown, { title: 'WageProof evidence index', allowedPaths });
  add('update.md', summaryMarkdown, 'short-update'); add('update.html', summaryHtml, 'short-update');
  add('supplement.md', supplementMarkdown, 'detailed-supplement'); add('supplement.html', supplementHtml, 'detailed-supplement');
  add('evidence.md', evidenceMarkdown, 'evidence-index'); add('evidence.html', evidenceHtml, 'evidence-index');
  const citationLocations = collectCitations(r.analysis).map(citation => ({ sourceId: citation.sourceId, lineStart: citation.lineStart, lineEnd: citation.lineEnd, included: selected.has(citation.sourceId) }));
  const manifest = {
    format: 'wageproof-portable-update', version: 1, generatedAt,
    caseId: c.id, revision: { id: r.id, number: r.number, createdAt: r.createdAt, sourceDigest: r.sourceDigest ?? null, analysisSha256: sha256(JSON.stringify(r.analysis)), calculationSha256: sha256(JSON.stringify(r.reconciliation ?? r.calculation ?? null)), comparisonBaselineId: comparisonBaseline?.id ?? null, review: status },
    selection: { mode: selectedSourceIds === undefined ? 'referenced-default' : 'explicit', revisionSourceCount: revisionIds.size, includedSourceCount: sourceEntries.length, omittedSourceCount: omittedSources.length, laterSourcesExcluded: laterSourceCount },
    sources: sourceEntries, omittedSources, citationLocations,
    ...(preparedExportProvenance(c,r)?{preparedExample:preparedExportProvenance(c,r)}:{}),
    files: files.map(file => ({ path: file.path, role: file.role, bytes: file.bytes.length, sha256: sha256(file.bytes) })),
    integrity: 'SHA-256 values describe included bytes and retained account content. They do not prove authenticity, legal truth or agency acceptance. The manifest does not hash itself.',
  };
  add('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'manifest');
  const buffer = makeZip(files, maxBytes);
  return { buffer, files, manifest, filename: `WageProof-${c.id.slice(0, 8)}-r${Number.isSafeInteger(r.number) ? r.number : 'selected'}.zip`, summaryMarkdown, summaryHtml, supplementMarkdown, supplementHtml };
}
