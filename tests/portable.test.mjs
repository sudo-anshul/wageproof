import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExportBundle, makeZip } from '../server/export-bundle.mjs';
import { reconcile } from '../domain/reconcile.mjs';
import { revisionExportStatus, renderPortableHtml } from '../domain/portable.mjs';
import { sourceDigest } from '../server/store.mjs';

// Declared synthetic unit records only. These are not held-out model evidence.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = (id, text, name = 'record.txt') => ({ id, text, name, kind: 'evidence', mime: 'text/plain', sha256: hash(text), size: Buffer.byteLength(text), extraction: { method: 'declared-test-text', warnings: ['Inspect original <script>alert(1)</script>'] } });
function fixture() {
  const a = source('source-a', 'Gross correction: $60. Net: $48.\nActual receipt: $48.\n<script>alert("unsafe")</script>\n', '../../..\\record.txt');
  const b = source('source-b', 'Previously adopted gross earned: $100.\nOriginal gross paid: $0.\n', '../../record.txt');
  const unused = source('source-unused', 'Unreferenced original from the selected revision.', 'unused.txt');
  const later = source('source-later', 'LATER_PRIVATE_CONTENT', 'LATER_PRIVATE_FILENAME.txt');
  const cite = (s, line = 1) => ({ sourceId: s.id, lineStart: line, lineEnd: line, quote: s.text.split('\n')[line - 1] });
  const analysis = { schemaVersion: '1.0', summary: 'MODEL_PROSE_MARKER <script>bad()</script>', caseContext: { workerName: 'A <img src=x onerror=alert(1)>', employerName: 'Declared Employer', claimNumber: null, claimStatus: 'unknown', purpose: 'Factual update', recipient: null, asOf: null, attribution: 'Declared unit input', citations: [] }, scope: { jurisdiction: 'unknown', rule: 'unassessed', basisStatus: 'unknown', assumptions: [], workweek: null, workday: null, exclusions: [], citations: [] }, periods: [{ id: 'period-a', label: 'Known account', startDate: null, endDate: null, rateCents: null, originalGrossPaidCents: 0, calculationBasis: 'reviewed_earned', reviewedGrossEarnedCents: 10000, days: [], alternatives: [], notes: 'Adopted account supplied', citations: [cite(b)] }], payments: [{ id: 'payment-a', label: 'Correction', eventReference: 'REF <script>', grossCents: 6000, netCents: 4800, receivedNetCents: 4800, paymentDate: null, receiptStatus: 'documented', identityStatus: 'supported', additionality: 'supported', creditStatus: 'proposed_credit', creditReason: 'Distinct additional correction.', allocationStatus: 'known', allocationScope: 'exclusive_supported', periodIds: ['period-a'], allocations: [{ periodId: 'period-a', grossCents: 6000 }], citations: [cite(a), cite(a, 2)] }], issues: [{ id: 'support', title: 'Payroll reconciliation', detail: 'The underlying reconciliation is still missing.', status: 'open', materiality: 'support', periodIds: [], paymentIds: [], citations: [] }], actions: [{ id: 'request', title: 'Supporting reconciliation', detail: 'Request payroll detail.', status: 'partly_answered', route: 'payroll_record_request', priority: 'normal', custodian: 'Payroll', dateRange: null, establishes: 'The calculation basis', dependsOnIssueIds: ['support'], citations: [] }], responseClaims: [], unassessedCategories: ['Legal remedies'], changeNarrative: 'MODEL_CHANGE_MARKER' };
  const revision = { id: 'revision-one', number: 1, createdAt: '2026-09-23T01:00:00Z', sourceIds: [a.id, b.id, unused.id], sourceDigest: sourceDigest({ sources: [a, b, unused] }), analysis, calculation: reconcile(analysis), review: { status: 'reviewed', at: '2026-09-23T02:00:00Z' } };
  const caseRecord = { id: 'case-one', context: { worker: 'NEWER_INTAKE_PRIVATE' }, sources: [a, b, unused, later], currentRevisionId: 'revision-two', revisions: [revision], jobSecret: 'SHOULD_NOT_EXPORT_JOB' };
  const readOriginal = async source => Buffer.from(source.text);
  return { caseRecord, revision, readOriginal, a, b, unused, later };
}
function unzip(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0);
    const length = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    assert.ok(!files.has(name)); files.set(name, buffer.subarray(start, start + length)); offset = start + length;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return files;
}

test('portable ZIP defaults to cited originals, preserves exact bytes and has working offline links', async () => {
  const f = fixture(), result = await createExportBundle(f), files = unzip(result.buffer);
  assert.equal(result.manifest.selection.mode, 'referenced-default');
  assert.deepEqual(result.manifest.sources.map(entry => entry.id), [f.a.id, f.b.id]);
  assert.equal(result.manifest.omittedSources.length, 1);
  assert.equal(result.manifest.selection.laterSourcesExcluded, 1);
  for (const item of result.manifest.files) { assert.equal(files.get(item.path).length, item.bytes); assert.equal(hash(files.get(item.path)), item.sha256); }
  for (const entry of result.manifest.sources) {
    const original = f.caseRecord.sources.find(source => source.id === entry.id);
    assert.deepEqual(files.get(entry.originalPath), Buffer.from(original.text));
    assert.deepEqual(files.get(entry.textPath), Buffer.from(original.text));
    assert.match(files.get(entry.linesPath).toString(), new RegExp('id="L' + entry.lineCount + '"'));
  }
  for (const [name, bytes] of files) if (name.endsWith('.html')) {
    const html = bytes.toString();
    assert.doesNotMatch(html, /<script|<img|href="(?:javascript:|https:\/\/evil)/i);
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      if (match[1].startsWith('https://www.dir.ca.gov/')) continue;
      const resolved = new URL(match[1], 'file:///packet/' + name);
      assert.equal(resolved.protocol, 'file:'); assert.ok(resolved.pathname.startsWith('/packet/'));
      const target = resolved.pathname.slice('/packet/'.length);
      assert.ok(files.has(target), name + ' has a broken offline link: ' + match[1]);
      if (resolved.hash) assert.ok(files.get(target).toString().includes('id="' + resolved.hash.slice(1) + '"'), 'Missing anchor ' + match[1]);
    }
  }
  const rawPacketText = [...files.values()].map(value => value.toString()).join('\n');
  assert.doesNotMatch(rawPacketText, /LATER_PRIVATE_CONTENT|LATER_PRIVATE_FILENAME|SHOULD_NOT_EXPORT_JOB|NEWER_INTAKE_PRIVATE|\/api\/cases\//);
  assert.doesNotMatch(result.summaryMarkdown, /MODEL_PROSE_MARKER|MODEL_CHANGE_MARKER/);
  assert.match(result.supplementHtml, /MODEL_PROSE_MARKER/);
  assert.match(result.summaryMarkdown, /\$40\.00/); assert.match(result.summaryMarkdown, /Request partly answered:\*\* Request payroll detail/);
  assert.match(result.summaryMarkdown, /historical revision/); assert.match(result.summaryMarkdown, /Later or changed source material/);
  const python = spawnSync('python3', ['-c', 'import io,sys,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({"bad":z.testzip(),"count":len(z.namelist())}))'], { input: result.buffer, encoding: 'utf8' });
  assert.equal(python.status, 0, python.stderr); assert.deepEqual(JSON.parse(python.stdout), { bad: null, count: files.size });
});

test('explicit omissions are visible and never load omitted or later originals', async () => {
  const f = fixture(), reads = [];
  const result = await createExportBundle({ ...f, selectedSourceIds: [f.a.id], readOriginal: async source => { reads.push(source.id); return Buffer.from(source.text); } });
  assert.deepEqual(reads, [f.a.id]);
  assert.equal(result.manifest.omittedSources.find(source => source.id === f.b.id).referenced, true);
  assert.match(unzip(result.buffer).get('evidence.md').toString(), /Cited, but not selected/);
  const empty = await createExportBundle({ ...f, selectedSourceIds: [], readOriginal: async () => { throw new Error('must not read'); } });
  assert.equal(empty.manifest.sources.length, 0); assert.match(empty.summaryHtml, /O01 · omitted/);
  assert.doesNotMatch(empty.summaryHtml, /source source-a omitted/);
  assert.match(unzip(empty.buffer).get('evidence.html').toString(), /<strong>O01<\/strong>.*source-a/);
  await assert.rejects(createExportBundle({ ...f, selectedSourceIds: [f.later.id] }), { code: 'EXPORT_SELECTION' });
  await assert.rejects(createExportBundle({ ...f, selectedSourceIds: ['../secret'] }), { code: 'INVALID_ID' });
});

test('portable export rejects corrupted/missing originals, out-of-snapshot citations and unsafe ZIP paths', async () => {
  const f = fixture();
  await assert.rejects(createExportBundle({ ...f, readOriginal: async () => Buffer.from('changed') }), { code: 'EXPORT_SOURCE_CHANGED' });
  await assert.rejects(createExportBundle({ ...f, readOriginal: async () => { throw new Error('missing'); } }), { code: 'EXPORT_SOURCE_MISSING' });
  const alteredText = fixture(); alteredText.caseRecord.sources[0].text = 'Changed extraction';
  await assert.rejects(createExportBundle(alteredText), { code: 'EXPORT_SOURCE_TEXT' });
  f.revision.analysis.caseContext.citations = [{ sourceId: f.later.id, lineStart: 1, lineEnd: 1, quote: f.later.text }];
  await assert.rejects(createExportBundle(f), { code: 'EXPORT_SOURCE_SCOPE' });
  assert.throws(() => makeZip([{ path: '../outside', bytes: 'unsafe' }]), { code: 'EXPORT_PATH' });
  assert.throws(() => makeZip([{ path: 'same.txt', bytes: 'a' }, { path: 'SAME.txt', bytes: 'b' }]), { code: 'EXPORT_PATH' });
  await assert.rejects(createExportBundle({ ...fixture(), maxBytes: 20 }), { code: 'EXPORT_LIMIT' });
});

test('a frozen export ignores concurrent caller mutations and preserves factual-only unknown totals', async () => {
  const f = fixture();
  f.revision.analysis.periods[0].calculationBasis = 'unassessed'; f.revision.analysis.periods[0].reviewedGrossEarnedCents = null;
  f.revision.calculation = reconcile(f.revision.analysis); f.revision.review = null;
  const original = structuredClone(f.revision);
  const result = await createExportBundle({ ...f, readOriginal: async source => { f.revision.analysis.caseContext.workerName = 'MUTATED_DURING_EXPORT'; f.revision.review = { status: 'reviewed' }; return Buffer.from(source.text); } });
  assert.equal(result.manifest.revision.analysisSha256, hash(JSON.stringify(original.analysis)));
  assert.equal(result.manifest.revision.review.state, 'draft');
  assert.match(result.summaryMarkdown, /complete wage difference remains unassessed/i); assert.match(result.summaryMarkdown, /Gross correction stated: \*\*\$60\.00/);
  assert.doesNotMatch(result.summaryMarkdown, /MUTATED_DURING_EXPORT|difference.*\*\*\$0\.00/);
  const current = fixture(); current.caseRecord.sources = current.caseRecord.sources.filter(source => source.id !== current.later.id); current.caseRecord.currentRevisionId = current.revision.id;
  assert.deepEqual(revisionExportStatus(current.caseRecord, current.revision), { state: 'reviewed', reviewedAt: current.revision.review.at, historical: false, stale: false, label: 'Reviewed for this version' });
});

test('portable Markdown rendering permits only generated paths, footnotes and pinned official links', () => {
  const html = renderPortableHtml('<img src="https://evil/x" onerror="bad()">\n\n[bad](javascript:bad) [network](https://evil/x) [traversal](../secret) [good](sources/001.lines.html#L2)\n\n![remote](https://evil/x)', { allowedPaths: ['sources/001.lines.html'] });
  assert.doesNotMatch(html, /<img|href="(?:javascript:|https:\/\/evil|\.\.\/)/); assert.match(html, /href="sources\/001.lines.html#L2"/);
});

test('short updates retain newly supplied dates and exclusions ahead of older disputed positions', async () => {
  const f = fixture();
  const fresh = source('clarification-source', 'Payroll identifies February 2-15 as the service window.\nTravel reimbursements are outside this correction.\nThe letter does not establish actual attendance.\n', 'clarification.txt');
  const position = (id, statement, status, s, line) => ({ id, statement, status, author: 'Payroll', coverage: 'Attributed source statement, not independent proof.', periodIds: [], paymentIds: [], issueIds: [], citations: [{ sourceId: s.id, lineStart: line, lineEnd: line, quote: s.text.split('\n')[line - 1] }] });
  const old = position('old-position', 'An earlier account leaves the period uncertain.', 'unsupported', f.a, 1);
  const prior = structuredClone(f.revision);
  prior.id = 'reviewed-before-clarification'; prior.analysis.responseClaims = [old];
  f.revision.analysis.responseClaims = [old, ...fresh.text.trim().split('\n').map((statement, index) => position(`new-position-${index}`, statement, 'supported', fresh, index + 1))];
  f.revision.number = 2; f.revision.sourceIds.push(fresh.id);
  f.revision.sinceReviewed = { baselineRevisionId: prior.id, baselineRevisionNumber: 1, amountUnchanged: true };
  f.caseRecord.sources.push(fresh); f.caseRecord.revisions = [prior, f.revision];
  f.caseRecord.currentRevisionId = f.revision.id;
  const result = await createExportBundle(f);
  assert.match(result.summaryHtml, /February 2-15/);
  assert.match(result.summaryHtml, /Travel reimbursements are outside/);
  assert.match(result.summaryHtml, /does not establish actual attendance/);
  assert.match(result.summaryHtml, /earlier account leaves the period uncertain/);
  assert.ok(result.summaryHtml.indexOf('February 2-15') < result.summaryHtml.indexOf('earlier account leaves'));
  assert.match(result.summaryHtml, /Attributed position — Payroll/);
  const initial = structuredClone(f.revision); delete initial.sinceReviewed;
  const withoutBaseline = await createExportBundle({ ...f, revision: initial });
  assert.match(withoutBaseline.summaryHtml, /February 2-15/);
  assert.match(withoutBaseline.summaryHtml, /does not establish actual attendance/);
});

test('a changed assessment survives the short update when the attributed statement is unchanged', async () => {
  const f = fixture();
  const prior = structuredClone(f.revision); prior.id = 'prior-assessment';
  const old = { id: 'same-statement', author: 'Payroll', statement: 'Payroll describes an additional correction.', status: 'partly_supported', coverage: 'The covered dates are unknown.', periodIds: [], paymentIds: [], issueIds: [], citations: [] };
  prior.analysis.responseClaims = [old];
  const fresh = source('assessment-source', 'The correction covers February 2-15. Actual worked hours remain unknown.', 'assessment.txt');
  f.revision.analysis.responseClaims = [{ ...old, coverage: fresh.text, citations: [{ sourceId: fresh.id, lineStart: 1, lineEnd: 1, quote: fresh.text }] }];
  f.revision.sourceIds.push(fresh.id); f.caseRecord.sources.push(fresh);
  f.revision.sinceReviewed = { baselineRevisionId: prior.id, baselineRevisionNumber: 1, amountUnchanged: false };
  f.caseRecord.revisions = [prior, f.revision];
  const result = await createExportBundle(f);
  assert.match(result.summaryHtml, /Updated assessment: The correction covers February 2-15/);
  assert.match(result.summaryHtml, /Actual worked hours remain unknown/);
  assert.match(result.summaryHtml, /Assessed coverage: <strong>partly supported/);
});

test('same-total update exposes $55/$25, prior reviewed ranges, employer coverage and the remaining payroll request', async () => {
  const f = fixture();
  Object.assign(f.b, source(f.b.id, 'Week A adopted earned: $80; original gross paid: $0.\nWeek B adopted earned: $60; original gross paid: $0.\nPayroll says the correction resolves all wages; supporting reconciliation was not supplied.\n'));
  const periodTemplate = f.revision.analysis.periods[0];
  f.revision.analysis.periods = [8000, 6000].map((earned, index) => ({ ...structuredClone(periodTemplate), id: `period-${index}`, label: `Week ${index ? 'B' : 'A'}`, reviewedGrossEarnedCents: earned, citations: [{ sourceId: f.b.id, lineStart: index + 1, lineEnd: index + 1, quote: f.b.text.split('\n')[index] }] }));
  const payment = f.revision.analysis.payments[0]; payment.periodIds = ['period-0', 'period-1']; payment.allocations = [{ periodId: 'period-0', grossCents: 2500 }, { periodId: 'period-1', grossCents: 3500 }];
  f.revision.analysis.responseClaims = [{ id: 'position', author: 'Payroll', statement: 'The correction resolves all wages.', status: 'partly_supported', coverage: 'The correction and allocation are supported; payroll reconciliation remains unprovided.', periodIds: payment.periodIds, paymentIds: [payment.id], issueIds: ['support'], citations: [{ sourceId: f.b.id, lineStart: 3, lineEnd: 3, quote: f.b.text.split('\n')[2] }] }];
  const prior = structuredClone(f.revision); prior.id = 'revision-before'; prior.number = 1; prior.analysis.payments[0].allocationStatus = 'unknown'; prior.analysis.payments[0].allocations = []; prior.calculation = reconcile(prior.analysis);
  f.revision.number = 2; f.revision.sourceDigest = sourceDigest({ sources: [f.a, f.b, f.unused] }); f.revision.calculation = reconcile(f.revision.analysis);
  f.revision.sinceReviewed = { baselineRevisionId: prior.id, baselineRevisionNumber: 1, amountUnchanged: true };
  f.caseRecord.revisions = [prior, f.revision]; f.caseRecord.currentRevisionId = f.revision.id; f.caseRecord.sources = f.caseRecord.sources.filter(source => source.id !== f.later.id);
  const result = await createExportBundle(f);
  const opening = result.summaryMarkdown.split('## Evidence packet and review record')[0];
  assert.match(opening, /\| Week A \| \$20\.00–\$80\.00 \| \$25\.00 \| \*\*\$55\.00\*\* \|/);
  assert.match(opening, /\| Week B \| \$0\.00–\$60\.00 \| \$35\.00 \| \*\*\$25\.00\*\* \|/);
  assert.match(opening, /difference for the listed periods is \*\*\$80\.00/);
  assert.match(opening, /combined scoped amount is unchanged/);
  assert.match(opening, /Attributed position — Payroll/); assert.match(opening, /partly supported/);
  assert.match(result.supplementMarkdown, /payroll reconciliation remains unprovided/i); assert.match(opening, /Question retained:\*\* Payroll reconciliation/);
  assert.match(opening, /Request partly answered:\*\* Request payroll detail/); assert.match(opening, /distinct additional correction exclusively/);
  assert.equal(result.manifest.revision.comparisonBaselineId, prior.id);
  assert.ok(opening.split(/\s+/).length < 300, 'The useful opening should remain concise for this two-period case.');
  assert.match(result.summaryHtml, /class="packet-break"/);
  const unknown = structuredClone(f.revision.analysis.periods[1]); unknown.id = 'unknown-period'; unknown.label = 'Outside period'; unknown.calculationBasis = 'unassessed'; unknown.reviewedGrossEarnedCents = null; unknown.originalGrossPaidCents = null;
  f.revision.analysis.periods.push(unknown); f.revision.calculation = reconcile(f.revision.analysis);
  const partial = await createExportBundle(f);
  assert.match(partial.summaryMarkdown, /complete wage difference remains unassessed/i);
  assert.match(partial.summaryMarkdown, /subtotal difference is \*\*\$80\.00/);
  assert.match(partial.summaryMarkdown, /Outside period.*Unassessed/);
});

test('partly answered requests show what remains without repeating an obsolete compound instruction', async () => {
  const f = fixture();
  const prior = structuredClone(f.revision); prior.id = 'before-answer';
  const action = f.revision.analysis.actions[0];
  action.title = 'Obtain the split and supporting worksheet';
  action.detail = 'The split is supplied; do not request it again. Request only the supporting worksheet.';
  prior.analysis.actions[0] = { ...action, status: 'open', detail: 'Request both the split and worksheet.' };
  f.revision.sinceReviewed = { baselineRevisionId: prior.id };
  f.caseRecord.revisions = [prior, f.revision];
  const result = await createExportBundle(f);
  assert.match(result.summaryHtml, /Request partly answered/);
  assert.match(result.summaryHtml, /The split is supplied; do not request it again/);
  assert.match(result.summaryHtml, /Request only the supporting worksheet/);
  assert.doesNotMatch(result.summaryHtml, /Obtain the split and supporting worksheet/);
  assert.match(result.supplementHtml, /Obtain the split and supporting worksheet/);
});

test('short updates retain new and changed work questions beyond the old caps without changing earlier exports', async () => {
  const f = fixture();
  const issueTemplate = f.revision.analysis.issues[0], actionTemplate = f.revision.analysis.actions[0];
  f.revision.analysis.issues = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(issueTemplate), id: `question-${i}`, title: `Older question ${i}`, detail: `Retained detail ${i}` }));
  f.revision.analysis.actions = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(actionTemplate), id: `request-${i}`, title: `Older request ${i}`, status: 'open', detail: `Retained request detail ${i}`, dependsOnIssueIds: [`question-${i}`] }));
  const prior = structuredClone(f.revision); prior.id = 'before-new-work';
  f.caseRecord.revisions = [prior, f.revision];
  const before = await createExportBundle({ ...f, revision: prior, generatedAt: '2026-09-24T00:00:00Z' });
  f.revision.sinceReviewed = { baselineRevisionId: prior.id };
  f.revision.analysis.issues[5].detail = 'The worker now distinguishes scheduled work from cleaning after closing; dates and duration remain unknown.';
  f.revision.analysis.actions[5].detail = 'Request dated records of closing work; do not infer duration from a completion timestamp.';
  f.revision.analysis.issues.push({ ...structuredClone(issueTemplate), id: 'new-work', title: 'Additional closing work', detail: 'The worker reports cleaning equipment after clocking out. No time is assigned; inclusion in prior pay remains unknown.', status: 'unassessed' });
  f.revision.analysis.actions.push({ ...structuredClone(actionTemplate), id: 'new-records', title: 'Establish the closing-work account', detail: 'Separate worker recollection from dated records and establish duration and prior payment.', status: 'open', dependsOnIssueIds: ['new-work'] });
  const result = await createExportBundle(f);
  assert.match(result.summaryHtml, /New question.*Additional closing work/);
  assert.match(result.summaryHtml, /worker reports cleaning equipment after clocking out/);
  assert.match(result.summaryHtml, /No time is assigned; inclusion in prior pay remains unknown/);
  assert.match(result.summaryHtml, /Updated question.*Older question 5/);
  assert.match(result.summaryHtml, /dates and duration remain unknown/);
  assert.match(result.summaryHtml, /do not infer duration from a completion timestamp/);
  assert.match(result.summaryHtml, /Separate worker recollection from dated records/);
  assert.match(result.summaryHtml, /Further unchanged questions and requests/);
  assert.ok(result.summaryHtml.indexOf('Additional closing work') < result.summaryHtml.indexOf('Older question 0'));
  const after = await createExportBundle({ ...f, revision: prior, generatedAt: '2026-09-24T00:00:00Z' });
  assert.deepEqual(after.buffer, before.buffer, 'Later issue and action content must not contaminate a historical export');
  assert.doesNotMatch(after.summaryHtml, /Additional closing work|completion timestamp/);
  const initial = structuredClone(f.revision); delete initial.sinceReviewed;
  const initialResult = await createExportBundle({ ...f, revision: initial });
  for (let i = 0; i < 6; i++) assert.match(initialResult.summaryHtml, new RegExp(`Older question ${i}`));
  assert.match(initialResult.summaryHtml, /No time is assigned/);
  assert.doesNotMatch(initialResult.summaryHtml, /Further unchanged questions/);
});

test('new and changed payments and periods beyond four remain in the short accounting table', async () => {
  const f = fixture();
  const periodTemplate = f.revision.analysis.periods[0], paymentTemplate = f.revision.analysis.payments[0];
  f.revision.analysis.periods = Array.from({ length: 7 }, (_, i) => ({ ...structuredClone(periodTemplate), id: `period-${i}`, label: `Account ${i}` }));
  f.revision.analysis.payments = Array.from({ length: 7 }, (_, i) => ({ ...structuredClone(paymentTemplate), id: `payment-${i}`, eventReference: `REF-${i}`, periodIds: [`period-${i}`], allocations: [{ periodId: `period-${i}`, grossCents: 6000 }] }));
  f.revision.calculation = reconcile(f.revision.analysis);
  const prior = structuredClone(f.revision); prior.id = 'before-late-correction';
  f.revision.sinceReviewed = { baselineRevisionId: prior.id };
  f.caseRecord.revisions = [prior, f.revision];
  f.revision.analysis.payments[6].receiptStatus = 'not_received';
  f.revision.analysis.payments[6].receivedNetCents = 0;
  f.revision.analysis.periods[6].reviewedGrossEarnedCents = 11000;
  f.revision.analysis.periods.push({ ...structuredClone(periodTemplate), id: 'period-new', label: 'Newly documented account' });
  f.revision.analysis.payments.push({ ...structuredClone(paymentTemplate), id: 'payment-new', eventReference: 'NEW-EVENT', periodIds: ['period-new'], allocations: [{ periodId: 'period-new', grossCents: 6000 }] });
  f.revision.calculation = reconcile(f.revision.analysis);
  const result = await createExportBundle(f);
  assert.match(result.summaryHtml, /Reference NEW-EVENT/);
  assert.match(result.summaryHtml, /Reference REF-6.*Receipt reported as not received/);
  assert.match(result.summaryHtml, /Newly documented account/);
  assert.match(result.summaryMarkdown, /\| Account 6 \| \$40\.00 \| \$0\.00 \| \*\*\$110\.00\*\*/);
  assert.match(result.summaryHtml, /2 further unchanged payment event/);
  assert.match(result.summaryHtml, /2 further unchanged period/);
});

test('runtime identity hashes the explicitly selected build directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wageproof-runtime-'));
  try {
    await writeFile(path.join(dir, 'index.html'), '<h1>Isolated build marker</h1>');
    const moduleUrl = new URL('../server/model.mjs', import.meta.url).href;
    const program = `import {runtimeIdentity} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(runtimeIdentity()));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env: { ...process.env, WAGEPROOF_DIST_DIR: dir, WAGEPROOF_DATA_DIR: path.join(dir, 'isolated-data') } });
    assert.equal(run.status, 0, run.stderr); const identity = JSON.parse(run.stdout);
    assert.equal(identity.distDirectory, dir); assert.equal(identity.builtAssets.fileCount, 1); assert.equal(identity.dataDirectory, path.join(dir, 'isolated-data'));
    assert.equal(identity.builtAssets.sha256, hash(Buffer.concat([Buffer.from('index.html\0'), Buffer.from('<h1>Isolated build marker</h1>'), Buffer.from('\0')])));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('restart recovery distinguishes pre-commit interruption from a saved revision and remains idempotent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wageproof-recovery-'));
  try {
    const moduleUrl = new URL('../server/store.mjs', import.meta.url).href;
    const program = `import {createCase,saveCase,saveJob,readCase,readJob,recoverJobs} from ${JSON.stringify(moduleUrl)};
const before=await createCase({title:'Pre-commit'}), after=await createCase({title:'Post-commit'});
for(const [c,name,committed] of [[before,'job-before',false],[after,'job-after',true]]){
c.revisions=[{id:'reviewed-'+name,review:{at:'2026-01-01T00:00:00Z'},sourceDigest:'digest'}];c.currentRevisionId=c.revisions[0].id;c.reviewedRevisionId=c.currentRevisionId;c.activeJobId=name;
if(committed){c.revisions.push({id:'committed-'+name,createdByJobId:name,sourceDigest:'digest',createdAt:'2026-01-01T00:00:02Z'});c.currentRevisionId='committed-'+name;c.activeJobId=null;}
await saveCase(c);await saveJob({id:name,caseId:c.id,status:'running',sourceDigest:'digest',createdAt:'2026-01-01T00:00:01Z',attempts:[{status:committed?'completed':'running'}]});}
await recoverJobs();const first=[await readCase(before.id),await readCase(after.id),await readJob('job-before'),await readJob('job-after')];await recoverJobs();const second=[await readCase(before.id),await readCase(after.id),await readJob('job-before'),await readJob('job-after')];console.log(JSON.stringify({first,second}));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env: { ...process.env, WAGEPROOF_DATA_DIR: dir } });
    assert.equal(run.status, 0, run.stderr); const { first, second } = JSON.parse(run.stdout);
    assert.deepEqual(first, second);
    assert.equal(first[0].currentRevisionId, 'reviewed-job-before'); assert.equal(first[0].revisions.length, 1); assert.equal(first[0].activeJobId, null);
    assert.equal(first[2].status, 'failed'); assert.equal(first[2].error.code, 'INTERRUPTED'); assert.equal(first[2].attempts[0].status, 'interrupted');
    assert.equal(first[1].currentRevisionId, 'committed-job-after'); assert.equal(first[1].revisions.length, 2); assert.equal(first[1].reviewedRevisionId, 'reviewed-job-after');
    assert.equal(first[3].status, 'completed'); assert.equal(first[3].revisionId, 'committed-job-after'); assert.equal(first[3].recoveredCommit, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('model attempt telemetry survives success, output failure, timeout and cancellation without real inference', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wageproof-attempt-'));
  try {
    const bin = path.join(dir, 'bin'); await mkdir(bin);
    await writeFile(path.join(bin, 'codex'), '#!/usr/bin/env node\nconst fs=require("node:fs");if(process.argv.includes("--version")){console.log("fake-test-cli");process.exit(0)}const mode=process.env.TEST_MODEL_MODE;process.stdin.resume();process.stdin.on("end",()=>{if(mode==="timeout")return setTimeout(()=>{},5000);const p=process.argv[process.argv.indexOf("--output-last-message")+1];fs.writeFileSync(p,mode==="bad"?"not json":JSON.stringify({ok:true}));console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:11,output_tokens:7,secret:"must-not-copy"}}));});\n', { mode: 0o700 });
    const moduleUrl = new URL('../server/model.mjs', import.meta.url).href;
    for (const mode of ['success', 'bad', 'timeout', 'cancel']) {
      const jobDir = path.join(dir, mode);
      const program = `import {runModel} from ${JSON.stringify(moduleUrl)};const controller=new AbortController();if(process.env.TEST_MODEL_MODE==='cancel')controller.abort();let callback;try{const result=await runModel({prompt:'Synthetic test only',schema:{},jobDir:${JSON.stringify(jobDir)},signal:controller.signal,timeoutMs:200,onMetadata:m=>{callback=m}});console.log(JSON.stringify({result,callback}));}catch(e){console.log(JSON.stringify({error:e.code,metadata:e.modelMetadata,callback}));}`;
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, TEST_MODEL_MODE: mode } });
      assert.equal(run.status, 0, run.stderr);
      const value = JSON.parse(run.stdout), metadata = value.result?.metadata ?? value.metadata;
      assert.deepEqual(value.callback, metadata); assert.deepEqual(JSON.parse(await readFile(path.join(jobDir, 'attempt-metadata.json'), 'utf8')), metadata);
      assert.ok(metadata.durationMs >= metadata.processDurationMs); assert.equal(metadata.monetaryCost, null); assert.equal(metadata.toolsDisabled, true);
      if (mode === 'success' || mode === 'bad') { assert.deepEqual(metadata.usage, { input_tokens: 11, output_tokens: 7 }); assert.equal(metadata.usageEventCount, 1); }
      if (mode === 'success') assert.equal(metadata.status, 'completed');
      if (mode === 'bad') { assert.equal(value.error, 'MODEL_OUTPUT'); assert.equal(metadata.status, 'failed'); }
      if (mode === 'timeout') { assert.equal(value.error, 'MODEL_TIMEOUT'); assert.equal(metadata.status, 'timed_out'); }
      if (mode === 'cancel') { assert.equal(value.error, 'CANCELLED'); assert.equal(metadata.status, 'cancelled'); assert.equal(metadata.modelStartedAt, null); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
