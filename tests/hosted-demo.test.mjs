import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import hostedDemo from '../api/demo.mjs';

const ROOT = '/api/cases/prepared-example';
const repository = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let c, scratch;

// These use the same Node request/response surface Vercel provides. Any attempt
// to read a body is a test failure, including the refused upload endpoints.
async function invoke(url, method = 'GET', handler = hostedDemo) {
  const headers = {};
  let status, bytes;
  const request = {
    method, url,
    get body() { assert.fail('Public demo must not read request bodies.'); },
    get headers() { assert.fail('Public demo must not probe host, cookies or authorization.'); },
    [Symbol.asyncIterator]() { assert.fail('Public demo must not consume upload streams.'); },
    on() { assert.fail('Public demo must not consume request streams.'); },
  };
  const response = {
    setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
    writeHead(code, additions = {}) {
      assert.equal(status, undefined, 'response headers are written once');
      status = code;
      for (const [name, value] of Object.entries(additions)) headers[name.toLowerCase()] = String(value);
    },
    end(value) { bytes = value === undefined ? Buffer.alloc(0) : Buffer.from(value); },
  };
  await handler(request, response);
  assert.ok(status, 'handler completed a response');
  if (method !== 'HEAD') assert.equal(Number(headers['content-length']), bytes.length);
  return {
    status, headers, bytes, text: bytes.toString('utf8'),
    value: headers['content-type']?.includes('json') && bytes.length ? JSON.parse(bytes) : null,
  };
}

function zipEntries(bytes) {
  const entries = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'originals retain stored bytes');
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, bytes.subarray(start, start + size)); offset = start + size;
  }
  return entries;
}

before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'wageproof-hosted-test-'));
  const response = await invoke(ROOT);
  assert.equal(response.status, 200);
  c = response.value;
});
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

test('hosted entry points expose only a labelled fictional case and safe build metadata', async () => {
  const health = await invoke('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.value.ok, true);
  assert.equal(health.value.mode, 'hosted-demo');
  assert.equal(health.value.readOnly, true);
  assert.equal(health.value.provider.available, false);
  assert.deepEqual(Object.keys(health.value.build).sort(), ['label', 'sourceRelease']);
  assert.doesNotMatch(health.text, /dataDirectory|sourceRoot|distDirectory|launchDirectory|credentialPresent|providerHost|\/Users\/|\/home\/|127\.0\.0\.1|process\.env/);
  const metadata = await invoke('/api/prepared-example');
  assert.equal(metadata.value.fictional, true);
  assert.equal(metadata.value.recordedModelOutputs, true);
  assert.equal(metadata.value.caseId, 'prepared-example');
  const list = await invoke('/api/cases');
  assert.equal(list.value.cases.length, 1);
  assert.equal(list.value.cases[0].id, 'prepared-example');
  assert.equal(list.value.cases[0].readOnly, true);
  assert.equal(list.value.cases[0].sourceCount, 6);
  assert.deepEqual((await invoke('/api/examples')).value, { examples: [] });
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal(health.headers['referrer-policy'], 'no-referrer');
});

test('recorded accounting, revision-specific provenance and unresolved matters are preserved', async () => {
  assert.equal(c.readOnly, true);
  assert.equal(c.revisions.length, 3);
  assert.deepEqual(c.revisions.map(r => r.calculation.totals.differenceMinCents), [14000, 8000, 8000]);
  assert.deepEqual(c.revisions.at(-1).calculation.periods.map(p => p.differenceMinCents), [5500, 2500]);
  assert.match(c.preparedExample.reviewMeaning, /technical review.*not worker or practitioner approval/i);
  assert.equal(c.preparedExample.sourceRelease, 'upgrade-candidate-4');
  assert.equal(c.activeJobId, null);
  assert.equal(c.lastJobId, null);
  assert.equal(c.revisions[2].sinceReviewed.baselineRevisionId, c.revisions[1].id);
  assert.ok(c.revisions.at(-1).analysis.actions.some(action => ['open', 'partly_answered'].includes(action.status)));
  for (const r of c.revisions) assert.equal(r.createdByJobId, undefined);
});

test('all writes are refused without reading bodies and all other cases and jobs stay unavailable', async () => {
  const targets = ['/api/cases', ROOT, `${ROOT}/sources`, `${ROOT}/notes`, `${ROOT}/analyze`, `${ROOT}/review`, `${ROOT}/revisions`, `${ROOT}/request-drafts`, '/api/examples/01-partial-allocation/start', '/api/jobs/anything/cancel'];
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const route of targets) {
      const response = await invoke(route, method);
      assert.equal(response.status, 405, `${method} ${route}`);
      assert.equal(response.value.error.code, 'HOSTED_DEMO_READ_ONLY');
      assert.equal(response.headers.allow, 'GET, HEAD');
    }
  }
  for (const route of ['/api/cases/private-case', '/api/cases/private-case/sources/record/file', '/api/jobs/example', `${ROOT}/analyze`, `${ROOT}/review`, '/api/demo', '/api/.data/cases', '/api/cases/%70repared-example', '/api/cases/prepared-example/../prepared-example']) {
    assert.equal((await invoke(route)).status, 404, route);
  }
  assert.equal((await invoke('https://untrusted.example/api/health')).status, 404);
});

test('exact source bytes are downloadable and HEAD reveals only matching response metadata', async () => {
  for (const source of c.sources) {
    const inspected = await invoke(`${ROOT}/sources/${source.id}`);
    assert.equal(inspected.status, 200);
    assert.deepEqual(inspected.value, source);
    const original = await invoke(`${ROOT}/sources/${source.id}/file`);
    assert.equal(original.status, 200);
    assert.equal(original.bytes.length, source.size);
    assert.equal(digest(original.bytes), source.sha256);
    assert.match(original.headers['content-disposition'], /attachment; filename\*=UTF-8''/);
    const head = await invoke(`${ROOT}/sources/${source.id}/file`, 'HEAD');
    assert.equal(head.status, original.status);
    assert.equal(head.bytes.length, 0);
    assert.deepEqual(head.headers, original.headers);
  }
  assert.equal((await invoke(`${ROOT}/sources/unknown/file`)).status, 404);
  const missingHead = await invoke('/api/cases/unknown', 'HEAD');
  assert.equal(missingHead.status, 404); assert.equal(missingHead.bytes.length, 0);
});

test('historical packets keep their source snapshot and cryptographically matching originals', async () => {
  for (const revision of c.revisions) {
    const response = await invoke(`${ROOT}/export?${new URLSearchParams({ format: 'zip', revision: revision.id, sources: revision.sourceIds.join(',') })}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/zip');
    const entries = zipEntries(response.bytes), manifest = JSON.parse(entries.get('manifest.json'));
    assert.equal(manifest.revision.id, revision.id);
    assert.equal(manifest.revision.number, revision.number);
    assert.equal(manifest.preparedExample.fictional, true);
    assert.equal(manifest.preparedExample.recordedAt, c.preparedExample.recordedAt);
    assert.equal(manifest.selection.laterSourcesExcluded, c.sources.length - revision.sourceIds.length);
    assert.deepEqual(manifest.sources.map(s => s.id), revision.sourceIds);
    for (const file of manifest.files) assert.equal(digest(entries.get(file.path)), file.sha256);
    for (const source of manifest.sources) assert.equal(digest(entries.get(source.originalPath)), c.sources.find(s => s.id === source.id).sha256);
    assert.match(entries.get('update.md').toString(), /Prepared fictional example/);
    assert.doesNotMatch(entries.get('update.md').toString(), /localhost|127\.0\.0\.1|\/Users\//);
    assert.doesNotMatch(entries.get('supplement.md').toString(), /localhost|127\.0\.0\.1|\/Users\//);
  }
});

test('explicit omissions are represented and future or unknown source selections are refused', async () => {
  const current = c.revisions.at(-1);
  const none = await invoke(`${ROOT}/export?${new URLSearchParams({ format: 'zip', revision: current.id, sources: '' })}`);
  const entries = zipEntries(none.bytes), manifest = JSON.parse(entries.get('manifest.json'));
  assert.equal(manifest.selection.mode, 'explicit');
  assert.equal(manifest.selection.includedSourceCount, 0);
  assert.equal(manifest.selection.omittedSourceCount, current.sourceIds.length);
  assert.equal(manifest.sources.length, 0);
  assert.equal([...entries.keys()].filter(name => name.startsWith('originals/')).length, 0);
  assert.match(entries.get('update.md').toString(), /not included|omitted/i);
  const older = c.revisions[0], laterId = current.sourceIds.find(id => !older.sourceIds.includes(id));
  assert.ok(laterId);
  const future = await invoke(`${ROOT}/export?${new URLSearchParams({ format: 'zip', revision: older.id, sources: laterId })}`);
  assert.equal(future.status, 400); assert.equal(future.value.error.code, 'EXPORT_SELECTION');
  assert.equal((await invoke(`${ROOT}/export?format=zip&sources=unknown`)).status, 400);
  assert.equal((await invoke(`${ROOT}/export?format=zip&revision=unknown`)).status, 404);
});

test('previews link only to selected packet members, preserve selection, and allow the same-origin frame', async () => {
  const revision = c.revisions.at(-1), selection = revision.sourceIds[0];
  const response = await invoke(`${ROOT}/export?${new URLSearchParams({ format: 'preview', revision: revision.id, sources: selection })}`);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.match(response.headers['content-security-policy'], /default-src 'none'/);
  const links = [...response.text.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
  const previewLinks = links.filter(link => link.startsWith(`${ROOT}/export?`));
  assert.ok(previewLinks.length > 0, 'source links remain inspectable');
  for (const link of previewLinks) {
    const url = new URL(link, 'https://example.invalid');
    assert.equal(url.searchParams.get('revision'), revision.id);
    assert.equal(url.searchParams.get('sources'), selection);
    assert.equal(url.searchParams.get('format'), 'preview');
    assert.equal((await invoke(url.pathname + url.search)).status, 200);
  }
  for (const asset of ['../../server/model.mjs', '/etc/passwd', 'case.json', 'originals/unknown.txt']) {
    const refused = await invoke(`${ROOT}/export?${new URLSearchParams({ format: 'preview', asset })}`);
    assert.equal(refused.status, 404);
  }
  const supplement = await invoke(`${ROOT}/export?format=html`);
  assert.equal(supplement.status, 200);
  assert.match(supplement.text, /Prepared fictional example/);
  const markdown = await invoke(`${ROOT}/export?format=md`);
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers['content-disposition'], /attachment/);
  assert.match(markdown.text, /Prepared fictional example/);
});

test('current unsent request previews export truthfully and historical requests cannot appear current', async () => {
  const current = c.revisions.at(-1);
  const response = await invoke(`${ROOT}/request-drafts?revision=${current.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.value.readOnly, true);
  assert.equal(response.value.canPrepare, true);
  assert.deepEqual(response.value.drafts, []);
  assert.ok(response.value.actions.length > 0);
  const action = response.value.actions[0];
  const query = new URLSearchParams({ revision: current.id, actionId: action.id });
  const result = await invoke(`${ROOT}/request-drafts/export?${query}`);
  assert.equal(result.status, 200);
  assert.equal(result.value.draftId, null);
  assert.match(result.value.text, /FICTIONAL PREVIEW — UNSENT REQUEST DRAFT/);
  assert.match(result.value.text, /no request has been saved or sent/);
  assert.match(result.value.text, /Not confirmed — choose and verify the recipient/);
  const download = await invoke(`${ROOT}/request-drafts/export?${query}&format=txt`);
  assert.equal(download.status, 200);
  assert.equal(download.text, result.value.text);
  assert.match(download.headers['content-disposition'], /attachment/);
  const old = await invoke(`${ROOT}/request-drafts?revision=${c.revisions[0].id}`);
  assert.equal(old.value.canPrepare, false);
  const oldExport = await invoke(`${ROOT}/request-drafts/export?${new URLSearchParams({ revision: c.revisions[0].id, actionId: action.id })}`);
  assert.equal(oldExport.status, 409);
  assert.equal(oldExport.value.error.code, 'REQUEST_NOT_CURRENT');
});

test('query parameters cannot choose alternate fixtures, duplicate interpretations or unsupported formats', async () => {
  for (const route of [
    '/api/prepared-example?directory=/tmp/alternate',
    '/api/health?detail=credentials',
    `${ROOT}/export?format=zip&format=preview`,
    `${ROOT}/export?format=json`,
    `${ROOT}/export?format=zip&asset=manifest.json`,
    `${ROOT}/request-drafts/export?format=html`,
    `${ROOT}/request-drafts/export?draftId=private-draft`,
  ]) assert.equal((await invoke(route)).status, 400, route);
  assert.equal((await invoke('/api/health?' + 'q'.repeat(4096))).status, 404);
});

test('Vercel transport routes preserve public behavior and cannot override an original URL', async () => {
  const original = await invoke('/api/health');
  const canonical = await invoke('/api/demo?__route=health');
  const retained = await invoke('/api/health?__route=health');
  assert.equal(canonical.status, 200); assert.equal(retained.status, 200);
  assert.deepEqual(canonical.value, original.value);
  assert.deepEqual(retained.value, original.value);
  const source = c.sources[0];
  const downloaded = await invoke(`/api/demo?${new URLSearchParams({ __route: `cases/prepared-example/sources/${source.id}/file` })}`);
  assert.equal(downloaded.status, 200);
  assert.equal(digest(downloaded.bytes), source.sha256);
  const exported = await invoke(`/api/demo?${new URLSearchParams({ __route: 'cases/prepared-example/export', format: 'preview', sources: '' })}`);
  assert.equal(exported.status, 200);
  assert.match(exported.text, /Prepared fictional example/);
  assert.doesNotMatch(exported.text, /__route|\/api\/demo\?/);
  const head = await invoke('/api/demo?__route=health', 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
  for (const route of [
    '/api/health?__route=cases',
    '/api/cases/unknown?__route=cases/prepared-example',
    '/api/demo?__route=health&__route=cases',
    '/api/demo?__route=',
    '/api/demo?__route=/health',
    '/api/demo?__route=cases//prepared-example',
    '/api/demo?__route=cases/../health',
    '/api/demo?__route=health%3Fprivate=true',
    '/api/demo?__route=health%23fragment',
    '/api/demo?__route=cases%255cprepared-example',
  ]) assert.equal((await invoke(route)).status, 400, route);
  for (const target of ['cases/private-case', 'jobs/private-job', 'cases/prepared-example/analyze', 'demo']) {
    assert.equal((await invoke(`/api/demo?${new URLSearchParams({ __route: target })}`)).status, 404, target);
  }
  assert.equal((await invoke('/api/demo?__route=cases/prepared-example/sources', 'POST')).status, 405);
  assert.equal((await invoke('/api/demo?__route=health&path=health')).status, 400, 'obsolete implicit transport is not accepted');
});

test('an incomplete or tampered deployment fails closed without disclosing fixture paths', async () => {
  const app = path.join(scratch, 'incomplete');
  await mkdir(app);
  for (const folder of ['server', 'domain', 'api']) await cp(path.join(repository, folder), path.join(app, folder), { recursive: true });
  await symlink(path.join(repository, 'node_modules'), path.join(app, 'node_modules'), 'dir');
  const isolated = (await import(pathToFileURL(path.join(app, 'api/demo.mjs')))).default;
  for (const route of ['/api/health', '/api/prepared-example', ROOT, `${ROOT}/export?format=zip`]) {
    const response = await invoke(route, 'GET', isolated);
    assert.equal(response.status, 503);
    assert.equal(response.value.error.code, 'PREPARED_EXAMPLE_UNAVAILABLE');
    assert.doesNotMatch(response.text, /\.data|\.codex|\/Users\/|\/var\/|ENOENT|case\.json/);
  }
  assert.equal((await invoke(`${ROOT}/sources`, 'POST', isolated)).status, 405);
  await mkdir(path.join(app, 'examples'));
  const fixture = path.join(app, 'examples', 'prepared-walkthrough');
  await cp(path.join(repository, 'examples', 'prepared-walkthrough'), fixture, { recursive: true });
  const healthy = await invoke('/api/health', 'GET', isolated);
  assert.equal(healthy.status, 200);
  const source = c.sources[0], sourcePath = path.join(fixture, 'originals', source.id);
  await writeFile(sourcePath, Buffer.concat([await readFile(sourcePath), Buffer.from('\nTampered bytes')]));
  const corrupted = await invoke(`${ROOT}/sources/${source.id}/file`, 'GET', isolated);
  assert.equal(corrupted.status, 503);
  assert.equal(corrupted.value.error.code, 'PREPARED_EXAMPLE_UNAVAILABLE');
  assert.ok(!(await readdir(app)).includes('.data'), 'read-only adapter creates no case store');
});
