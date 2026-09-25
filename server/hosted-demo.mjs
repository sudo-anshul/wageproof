import path from 'node:path';
import { loadPreparedExample, PREPARED_EXAMPLE_ID } from './prepared-example.mjs';
import { createExportBundle } from './export-bundle.mjs';
import { requestDrafts, exportRequestDraft } from './request-drafts.mjs';

const ROOT = `/api/cases/${PREPARED_EXAMPLE_ID}`;
const MAX_URL_LENGTH = 4096;
const DOCUMENT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const HOSTED_NOTICE = 'Public fictional walkthrough. No uploads, saved personal cases or new analysis.';
const escapeAttribute = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

function send(req, res, status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { 'Content-Length': bytes.length, ...headers });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

function json(req, res, status, value, headers = {}) {
  send(req, res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

function queryFor(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw failure('INVALID_QUERY', 'Use one value for each supported example option.');
    }
  }
  return Object.fromEntries(url.searchParams);
}

function resolveRoute(url) {
  const routes = url.searchParams.getAll('__route');
  if (!routes.length) return url.pathname;
  // Vercel may pass either the original public URL or the rewritten function
  // URL. The reserved transport value can never override a different original
  // path, and it still passes through the fixed endpoint whitelist below.
  if (routes.length !== 1 || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(routes[0])) {
    throw failure('INVALID_ROUTE', 'The public example route is invalid.');
  }
  const target = `/api/${routes[0]}`;
  if (url.pathname !== '/api/demo' && url.pathname !== target) {
    throw failure('INVALID_ROUTE', 'The public example route does not match this URL.');
  }
  url.searchParams.delete('__route');
  url.pathname = target;
  return target;
}

function selectedRevision(c, id) {
  const revision = c.revisions.find(value => value.id === (id || c.currentRevisionId));
  if (!revision) throw failure('NOT_FOUND', 'The recorded revision was not found.', 404);
  return revision;
}

// Preview links remain inside the already verified, selected packet. Request
// headers never determine a hostname and user values cannot choose disk paths.
function previewHtml(file, bundle, revision, selectedSourceIds) {
  const members = new Set(bundle.files.map(member => member.path));
  return Buffer.from(file.bytes.toString('utf8').replace(/href="([^"]+)"/g, (match, href) => {
    if (href.startsWith('#') || /^https?:/.test(href)) return match;
    const [relative, fragment] = href.split('#');
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), relative));
    if (!members.has(target)) return match;
    const params = new URLSearchParams({ format: 'preview', revision: revision.id, asset: target });
    if (selectedSourceIds !== undefined) params.set('sources', selectedSourceIds.join(','));
    return `href="${escapeAttribute(`${ROOT}/export?${params}${fragment ? '#' + fragment : ''}`)}"`;
  }));
}

async function exportPacket(req, res, url, c, readOriginal) {
  const query = queryFor(url, ['format', 'revision', 'sources', 'asset']);
  const format = query.format || 'md';
  if (!['zip', 'preview', 'html', 'md'].includes(format) || (query.asset !== undefined && format !== 'preview')) {
    throw failure('EXPORT_FORMAT', 'Choose a ZIP, preview, HTML or Markdown example export.');
  }
  const revision = selectedRevision(c, query.revision);
  const selectedSourceIds = query.sources === undefined ? undefined : query.sources.split(',').filter(Boolean);
  // Always supply the fixed fixture's in-memory original reader. The local
  // storage fallback in the shared exporter is never used by this handler.
  const bundle = await createExportBundle({ caseRecord: c, revision, selectedSourceIds, readOriginal });
  if (format === 'zip') {
    return send(req, res, 200, bundle.buffer, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${bundle.filename}"`,
    });
  }
  const asset = format === 'preview' ? query.asset || 'update.html' : `supplement.${format}`;
  const file = bundle.files.find(member => member.path === asset);
  if (!file) throw failure('EXPORT_ASSET', 'This file is not part of the selected evidence packet.', 404);
  const html = file.path.endsWith('.html');
  const body = html ? previewHtml(file, bundle, revision, selectedSourceIds) : file.bytes;
  const contentType = html ? 'text/html; charset=utf-8'
    : file.path.endsWith('.json') ? 'application/json; charset=utf-8'
      : file.path.endsWith('.md') || file.path.endsWith('.txt') ? 'text/plain; charset=utf-8'
        : 'application/octet-stream';
  return send(req, res, 200, body, {
    'Content-Type': contentType,
    'Content-Security-Policy': DOCUMENT_POLICY,
    'X-Frame-Options': 'SAMEORIGIN',
    ...(file.role === 'original' || format === 'md' ? {
      'Content-Disposition': `attachment; filename="${format === 'md' ? `WageProof-fictional-r${revision.number}.md` : path.posix.basename(asset)}"`,
    } : {}),
  });
}

/** No uploads, model calls, case discovery or persisted mutations are exposed. */
export default async function hostedDemo(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  try {
    // Check the method before any URL, body, fixture or local-state work. Even
    // arbitrary uploads receive a refusal without parsing or retaining bytes.
    if (!['GET', 'HEAD'].includes(req.method)) {
      return json(req, res, 405, { error: { code: 'HOSTED_DEMO_READ_ONLY', message: 'This public example is read-only. Run WageProof locally to work with your own records.' } }, { Allow: 'GET, HEAD' });
    }
    if (typeof req.url !== 'string' || req.url.length > MAX_URL_LENGTH || !req.url.startsWith('/api/')) {
      throw failure('NOT_FOUND', 'This public example endpoint does not exist.', 404);
    }
    const url = new URL(req.url, 'https://wageproof.invalid');
    // The raw URL must remain canonical. Encoded separators and dot segments
    // cannot be interpreted as alternate routes or filesystem instructions.
    if (req.url.split('?')[0] !== url.pathname || /%|\\/.test(url.pathname)) {
      throw failure('NOT_FOUND', 'This public example endpoint does not exist.', 404);
    }
    const pathname = resolveRoute(url);
    const globalRoute = ['/api/health', '/api/prepared-example', '/api/cases', '/api/examples'].includes(pathname);
    const caseRoute = pathname === ROOT || pathname === `${ROOT}/request-drafts` || pathname === `${ROOT}/request-drafts/export` || pathname === `${ROOT}/export`;
    const sourceMatch = pathname.match(new RegExp(`^${ROOT}/sources/([a-zA-Z0-9_-]{1,80})(/file)?$`));
    if (!globalRoute && !caseRoute && !sourceMatch) {
      throw failure('NOT_FOUND', 'Only the bundled fictional example is available here.', 404);
    }
    // A missing or changed fixture fails closed; health also checks readiness.
    const { metadata, caseRecord: c, readOriginal } = await loadPreparedExample();
    if (pathname === '/api/health') {
      queryFor(url, []);
      return json(req, res, 200, {
        ok: true, mode: 'hosted-demo', readOnly: true,
        provider: { available: false, name: 'Recorded example', description: HOSTED_NOTICE, authenticationCheck: 'No model service or credential check is performed.' },
        build: { label: 'lexhack-requests-2-hosted-demo', sourceRelease: metadata.sourceRelease },
      });
    }
    if (pathname === '/api/prepared-example') {
      queryFor(url, []);
      return json(req, res, 200, metadata);
    }
    if (pathname === '/api/cases') {
      queryFor(url, []);
      const analysis = selectedRevision(c).analysis;
      return json(req, res, 200, { cases: [{
        id: c.id, title: c.title, worker: analysis.caseContext?.workerName || '', employer: analysis.caseContext?.employerName || '',
        updatedAt: c.updatedAt, version: c.version, exampleId: c.exampleId,
        sourceCount: c.sources.length, revisionCount: c.revisions.length,
        reviewed: true, status: 'ready', readOnly: true,
      }] });
    }
    if (pathname === '/api/examples') {
      queryFor(url, []);
      return json(req, res, 200, { examples: [] });
    }
    if (pathname === ROOT) {
      queryFor(url, []);
      return json(req, res, 200, c);
    }
    if (sourceMatch) {
      queryFor(url, []);
      const source = c.sources.find(value => value.id === sourceMatch[1]);
      if (!source) throw failure('NOT_FOUND', 'The example source was not found.', 404);
      if (!sourceMatch[2]) return json(req, res, 200, source);
      return send(req, res, 200, await readOriginal(source), {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,
      });
    }
    if (pathname === `${ROOT}/request-drafts`) {
      const query = queryFor(url, ['revision']);
      if (query.revision !== undefined) selectedRevision(c, query.revision);
      return json(req, res, 200, requestDrafts(c, query.revision));
    }
    if (pathname === `${ROOT}/request-drafts/export`) {
      const query = queryFor(url, ['revision', 'actionId', 'format']);
      if (query.format !== undefined && !['json', 'txt'].includes(query.format)) throw failure('EXPORT_FORMAT', 'Choose JSON or text for the fictional request.');
      const result = exportRequestDraft(c, query);
      if (query.format !== 'txt') return json(req, res, 200, result);
      return send(req, res, 200, result.text, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${result.filename}"` });
    }
    return await exportPacket(req, res, url, c, readOriginal);
  } catch (error) {
    const known = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599;
    const status = known ? error.status : 503;
    const code = known ? error.code : 'HOSTED_DEMO_UNAVAILABLE';
    // Shared prepared-loader errors discuss local saved cases. A public caller
    // receives a truthful deployment message with no file or runtime details.
    const message = error.code === 'PREPARED_EXAMPLE_UNAVAILABLE' || !known
      ? 'The public example could not be verified. Please retry later or inspect the source repository.'
      : error.message;
    return json(req, res, status, { error: { code, message } });
  }
}
