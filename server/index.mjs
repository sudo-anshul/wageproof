import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {Marked} from 'marked';
import {fileURLToPath} from 'node:url';
import {createCase,listCases,readCase,withCase,expectVersion,touch,saveCase,readJob,recoverJobs,sourceDigest,now,error,validId,DATA} from './store.mjs';
import {addFiles,sourceBytes,limits} from './extract.mjs';
import {providerStatus,runtimeIdentity} from './model.mjs';
import {createAnalysisJob,cancelJob,stopAnalysisWorker} from './jobs.mjs';
import {acquireDataLock} from './lock.mjs';
import {saveCorrection} from './corrections.mjs';
import {createExportBundle} from './export-bundle.mjs';
import {listExamples,startExample,addExamplePhase} from './examples.mjs';
import {loadPreparedExample,PREPARED_EXAMPLE_ID,labelPreparedExport} from './prepared-example.mjs';
import {requestDrafts,saveRequestDraft,exportRequestDraft} from './request-drafts.mjs';
import {renderSupplement,withRevisionComparisons} from '../domain/index.mjs';

const PORT=Number(process.env.PORT||4318),HOST='127.0.0.1';
const startedAt=now(),DIST=path.resolve(process.env.WAGEPROOF_DIST_DIR||'dist');
const startupIdentity=runtimeIdentity();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markdown=new Marked({renderer:{html:token=>escape(token.text),image:token=>escape(token.text),heading(token){const match=token.text.match(/^Source (R\d+)$/);return `<h${token.depth}${match?` id="source-${match[1]}"`:''}>${this.parser.parseInline(token.tokens)}</h${token.depth}>`;},link(token){const text=this.parser.parseInline(token.tokens);return /^https?:\/\//.test(token.href)||token.href.startsWith('/api/')||/^#source-R\d+$/.test(token.href)?`<a href="${escape(token.href)}"${/^https?:\/\//.test(token.href)&&!/^http:\/\/127\.0\.0\.1:\d+\/api\//.test(token.href)?' target="_blank"':''} rel="noopener noreferrer">${text}</a>`:text;}}});
function printableFootnotes(md){
  // Marked does not implement footnotes. Convert our generated, numbered
  // source definitions to ordinary Markdown with safe local anchors.
  let inSources=false;
  return md.split('\n').map(line=>{
    const match=line.match(/^\[\^(R\d+)\]: (.*)$/);
    if(match){inSources=true;return `### Source ${match[1]}\n\n${match[2]}\n`;}
    if(inSources&&line.startsWith('    > '))return line.slice(4);
    return line.replace(/\[\^(R\d+)\]/g,'[$1](#source-$1)');
  }).join('\n');
}
function printable(md){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WageProof case update</title><style>html{background:#f6f7fb}body{box-sizing:border-box;max-width:840px;margin:32px auto;padding:40px 40px;background:#fff;border:1px solid #dfe3ee;border-radius:12px;color:#171a28;font:15px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}h1{margin:0 0 20px;font:700 32px/1.16 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:-.8px}body>h1+p{padding:10px 14px;border-left:3px solid #3153ed;background:#e9edff;border-radius:0 6px 6px 0}h2{font-size:18px;line-height:1.35;border-top:1px solid #dfe3ee;padding-top:22px;margin-top:32px}h3{font-size:15px;line-height:1.4}table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}td,th{padding:10px 8px;border-bottom:1px solid #dfe3ee;text-align:left;vertical-align:top}th{background:#e9edff;color:#171a28;font-weight:650}a{color:#3153ed;text-underline-offset:2px}pre{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:3px solid #3153ed;margin:20px 0;padding:12px 16px;background:#f6f7fb}blockquote p{white-space:pre-line}p,li{overflow-wrap:anywhere}@media screen and (max-width:640px){body{margin:0;padding:24px 18px;border:0;border-radius:0}h1{font-size:28px}table{display:block;max-width:100%;overflow-x:auto}}@media print{html,body{background:#fff}body{margin:0;padding:0;max-width:none;border:0;border-radius:0;font-size:10pt}h1{font-size:21pt}h2,h3{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}table{font-size:9pt}a{color:inherit}blockquote,body>h1+p{background:transparent;border-left-color:#171a28}}@page{size:A4;margin:18mm}</style></head><body>${markdown.parse(printableFootnotes(md))}</body></html>`;}
function json(res,data,status=200){if(data?.revisions&&data?.sources)data=withRevisionComparisons(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,max=1_500_000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw error('REQUEST_LIMIT','This upload exceeds the request size limit.',413);chunks.push(chunk);}return Buffer.concat(chunks);}
async function jsonBody(req){if(!(req.headers['content-type']||'').startsWith('application/json'))throw error('CONTENT_TYPE','Use JSON for this action.',415);let value;try{value=JSON.parse((await body(req)).toString('utf8')||'{}');}catch(e){if(e.status)throw e;throw error('INVALID_JSON','This request is not valid JSON.');}if(!value||Array.isArray(value)||typeof value!=='object')throw error('INVALID_JSON','Expected a JSON object.');return value;}
function validateRequest(req){const host=String(req.headers.host||'').split(':')[0];if(!['127.0.0.1','localhost','[::1]'].includes(host))throw error('HOST_REJECTED','This service is available only from localhost.',403);const origin=req.headers.origin;if(origin){let u;try{u=new URL(origin);}catch{throw error('ORIGIN_REJECTED','Cross-origin requests are not accepted.',403);}if(!['127.0.0.1','localhost'].includes(u.hostname)||!['4318','5173',String(PORT)].includes(u.port))throw error('ORIGIN_REJECTED','Cross-origin requests are not accepted.',403);}if(req.method!=='GET'&&req.headers['sec-fetch-site']==='cross-site')throw error('ORIGIN_REJECTED','Cross-site changes are not accepted.',403);}
function sourceOf(c,sourceId){validId(sourceId);const s=c.sources.find(s=>s.id===sourceId);if(!s)throw error('NOT_FOUND','Source not found.',404);return s;}
async function inspectedCase(id){return id===PREPARED_EXAMPLE_ID?loadPreparedExample():{caseRecord:await readCase(id)};}
async function portableExport(req,res,url,c,r,readOriginal){
  const selectedSourceIds=url.searchParams.has('sources')?url.searchParams.get('sources').split(',').filter(Boolean):undefined;
  const bundle=await createExportBundle({caseRecord:c,revision:r,selectedSourceIds,readOriginal});
  if(url.searchParams.get('format')==='zip'){
    res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${bundle.filename}"`,'Cache-Control':'no-store'});
    return res.end(bundle.buffer);
  }
  const asset=url.searchParams.get('asset')||'update.html',file=bundle.files.find(file=>file.path===asset);
  if(!file)throw error('EXPORT_ASSET','This file is not part of the selected evidence packet.',404);
  const html=asset.endsWith('.html');let bytes=file.bytes;
  if(html){
    // Preview the exact packet renderer with working local links. Only generated
    // members can become routes; all record-provided text remains escaped.
    const members=new Set(bundle.files.map(file=>file.path));
    bytes=Buffer.from(bytes.toString('utf8').replace(/href="([^"]+)"/g,(match,href)=>{
      if(href.startsWith('#')||/^https?:/.test(href))return match;
      const [relative,fragment]=href.split('#'),target=path.posix.normalize(path.posix.join(path.posix.dirname(asset),relative));
      if(!members.has(target))return match;
      const params=new URLSearchParams({format:'preview',revision:r.id,asset:target});
      if(selectedSourceIds!==undefined)params.set('sources',selectedSourceIds.join(','));
      return `href="${escape(url.pathname+'?'+params.toString()+(fragment?'#'+fragment:''))}"`;
    }));
  }
  res.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':asset.endsWith('.json')?'application/json; charset=utf-8':asset.endsWith('.md')||asset.endsWith('.txt')?'text/plain; charset=utf-8':'application/octet-stream','Cache-Control':'no-store','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",...(file.role==='original'?{'Content-Disposition':`attachment; filename="${path.posix.basename(asset)}"`}:{})});
  return res.end(bytes);
}
async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  try{
    validateRequest(req);const url=new URL(req.url,`http://${HOST}:${PORT}`),p=url.pathname;
    if(p.startsWith('/api')){
      let m;
      const caseTarget=p.match(/^\/api\/cases\/([^/]+)(?:\/|$)/)?.[1];
      if(req.method!=='GET'&&caseTarget){let decoded;try{decoded=decodeURIComponent(caseTarget);}catch{}if(decoded===PREPARED_EXAMPLE_ID)throw error('PREPARED_EXAMPLE_READ_ONLY','This prepared fictional example is read-only. Start your own case to add records or create a new analysis.',403);}
      if(req.method==='GET'&&p==='/api/health')return json(res,{ok:true,provider:providerStatus(),limits,build:{...startupIdentity,label:process.env.WAGEPROOF_RELEASE||'working-tree',startedAt,distDirectory:DIST,dataDirectory:DATA,identityObservedAt:'server-startup'}});
      if(req.method==='GET'&&p==='/api/prepared-example')return json(res,(await loadPreparedExample()).metadata);
      if(req.method==='GET'&&p==='/api/cases')return json(res,{cases:await listCases()});
      if(req.method==='POST'&&p==='/api/cases')return json(res,await createCase(await jsonBody(req)),201);
      if(req.method==='GET'&&p==='/api/examples')return json(res,{examples:await listExamples()});
      if(req.method==='POST'&&(m=p.match(/^\/api\/examples\/([^/]+)\/start$/)))return json(res,await startExample(m[1]),201);
      if(req.method==='GET'&&(m=p.match(/^\/api\/jobs\/([^/]+)$/)))return json(res,{job:await readJob(m[1])});
      if(req.method==='POST'&&(m=p.match(/^\/api\/jobs\/([^/]+)\/cancel$/)))return json(res,{job:await cancelJob(m[1])});
      if(req.method==='GET'&&(m=p.match(/^\/api\/cases\/([^/]+)$/)))return json(res,(await inspectedCase(m[1])).caseRecord);
      if(req.method==='GET'&&(m=p.match(/^\/api\/cases\/([^/]+)\/request-drafts$/)))return json(res,requestDrafts((await inspectedCase(m[1])).caseRecord,url.searchParams.get('revision')));
      if(req.method==='POST'&&(m=p.match(/^\/api\/cases\/([^/]+)\/request-drafts$/))){const b=await jsonBody(req);const result=await withCase(m[1],async c=>{expectVersion(c,b.expectedVersion);const draft=await saveRequestDraft(c,b);return {case:withRevisionComparisons(c),draft};});return json(res,result);}
      if(req.method==='GET'&&(m=p.match(/^\/api\/cases\/([^/]+)\/request-drafts\/export$/))){
        const {caseRecord:c}=await inspectedCase(m[1]),result=exportRequestDraft(c,Object.fromEntries(url.searchParams));
        if(url.searchParams.get('format')!=='txt')return json(res,result);
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${result.filename}"`,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});return res.end(result.text);
      }
      if(req.method==='POST'&&(m=p.match(/^\/api\/cases\/([^/]+)\/sources$/))){
        const contentType=req.headers['content-type']||'';if(!contentType.startsWith('multipart/form-data'))throw error('CONTENT_TYPE','Choose files to import.',415);
        const bytes=await body(req,limits.requestBytes);let form;try{form=await new Request('http://localhost',{method:'POST',headers:{'content-type':contentType},body:bytes}).formData();}catch{throw error('INVALID_UPLOAD','The file upload was incomplete. Retry the import.');}
        const blobs=form.getAll('files');const files=[];for(const f of blobs){if(typeof f==='string')throw error('INVALID_UPLOAD','Expected file bytes.');if(f.size>limits.fileBytes)throw error('FILE_TOO_LARGE',`${f.name} exceeds 12 MiB.`);files.push({name:f.name,buffer:Buffer.from(await f.arrayBuffer())});}
        const c=await withCase(m[1],async c=>{const v=form.get('expectedVersion');if(v!==null)expectVersion(c,v);return addFiles(c,files,form.get('kind')||'evidence');});return json(res,c);
      }
      if(req.method==='POST'&&(m=p.match(/^\/api\/cases\/([^/]+)\/notes$/))){const b=await jsonBody(req);if(typeof b.text!=='string'||!b.text.trim())throw error('EMPTY_NOTE','Write the account or correction first.');if(b.text.length>50000)throw error('NOTE_LIMIT','Use a note shorter than50,000 characters.');const c=await withCase(m[1],async c=>{expectVersion(c,b.expectedVersion);return addFiles(c,[{name:(String(b.title||'Worker account').replace(/[\\/\r\n]/g,' ').slice(0,130)||'Worker account')+'.txt',buffer:Buffer.from(b.text)}],b.kind==='correction'?'correction':'worker-account');});return json(res,c);}
      if(req.method==='GET'&&(m=p.match(/^\/api\/cases\/([^/]+)\/sources\/([^/]+)(\/file)?$/))){const {caseRecord:c,readOriginal}=await inspectedCase(m[1]),s=sourceOf(c,m[2]);if(!m[3])return json(res,s);const bytes=readOriginal?await readOriginal(s):await sourceBytes(c.id,s.id);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(s.name)}`,'Cache-Control':'no-store'});return res.end(bytes);}
      if(req.method==='POST'&&(m=p.match(/^\/api\/cases\/([^/]+)\/analyze$/))){const b=await jsonBody(req);return json(res,{job:await createAnalysisJob(m[1],b.expectedVersion)},202);}
      if(req.method==='POST'&&(m=p.match(/^\/api\/cases\/([^/]+)\/example-phase$/))){const b=await jsonBody(req);return json(res,await addExamplePhase(m[1],b.phaseId,b.expectedVersion));}
      if(req.method==='POST'&&(m=p.match(/^\/api\/cases\/([^/]+)\/revisions$/))){const b=await jsonBody(req);const c=await withCase(m[1],async c=>{expectVersion(c,b.expectedVersion);if(c.activeJobId)throw error('ANALYSIS_ACTIVE','Wait for or cancel the running analysis before editing this account.',409);return saveCorrection(c,b);});return json(res,c);}
      if(req.method==='POST'&&(m=p.match(/^\/api\/cases\/([^/]+)\/review$/))){const b=await jsonBody(req);const c=await withCase(m[1],async c=>{expectVersion(c,b.expectedVersion);if(c.activeJobId)throw error('ANALYSIS_ACTIVE','Wait for or cancel the current analysis before reviewing the case.',409);const r=c.revisions.find(r=>r.id===b.revisionId);if(!r||r.id!==c.currentRevisionId)throw error('NOT_CURRENT','Only the current revision can be marked reviewed.',409);if(r.sourceDigest!==sourceDigest(c))throw error('SOURCES_CHANGED','New sources have not been reconciled yet. Analyze them before marking this update reviewed.',409);r.review={status:'reviewed',at:now(),note:typeof b.note==='string'?b.note.slice(0,2000):''};c.reviewedRevisionId=r.id;c.reviewedSourceDigest=r.sourceDigest;touch(c,'reviewed',`Revision ${r.number} reviewed with its stated assumptions and unresolved questions.`);r.supplement=renderSupplement({caseRecord:{...c,baseUrl:`http://${HOST}:${PORT}`},revision:r});await saveCase(c);return c;});return json(res,c);}
      if(req.method==='GET'&&(m=p.match(/^\/api\/cases\/([^/]+)\/export$/))){const {caseRecord,readOriginal}=await inspectedCase(m[1]),c=withRevisionComparisons(caseRecord);const r=c.revisions.find(r=>r.id===(url.searchParams.get('revision')||c.currentRevisionId));if(!r)throw error('NO_REVISION','Create an analysis before exporting a supplement.',404);if(['zip','preview'].includes(url.searchParams.get('format')))return await portableExport(req,res,url,c,r,readOriginal);const md=labelPreparedExport(renderSupplement({caseRecord:{...c,baseUrl:`http://${HOST}:${PORT}`},revision:r}),c,r);const html=url.searchParams.get('format')==='html';if(html)res.setHeader('X-Frame-Options','SAMEORIGIN');res.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':'text/markdown; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",...(html?{}:{'Content-Disposition':`attachment; filename="WageProof-${c.id.slice(0,8)}-r${r.number}.md"`})});return res.end(html?printable(md):md);}
      throw error('NOT_FOUND','This endpoint does not exist.',404);
    }
    if(req.method!=='GET')throw error('NOT_FOUND','Not found.',404);
    const dist=DIST;let file=path.resolve(dist,'.'+decodeURIComponent(p));if(!file.startsWith(dist+path.sep)&&file!==dist)throw error('NOT_FOUND','Not found.',404);
    try{if(!(await stat(file)).isFile())file=path.join(dist,'index.html');}catch{file=path.join(dist,'index.html');}
    let bytes;try{bytes=await readFile(file);}catch{res.writeHead(503,{'Content-Type':'text/plain'});return res.end('WageProof API is running. For development open http://127.0.0.1:5173, or run npm run build then refresh.');}
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});res.end(bytes);
  }catch(e){if(!res.headersSent)json(res,{error:{code:e.code||'INTERNAL_ERROR',message:e.status||e.code==='MODEL_UNAVAILABLE'?e.message:'The local operation could not be completed. Your saved case is preserved.',...(e.details?{details:e.details}:{})}},e.status||500);else res.end();if(!e.status)console.error('Local request failure:',e.code||e.name,e.message);}
}
let releaseLock,server,ready=false,stopping=false;
try{
  releaseLock=await acquireDataLock();
  server=http.createServer((req,res)=>ready?handler(req,res):json(res,{error:{code:'STARTING',message:'Local case recovery is finishing.'}},503));
  server.requestTimeout=120000;server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
  await recoverJobs();ready=true;
  console.log(`WageProof local server: http://${HOST}:${PORT}`);
  const stop=async()=>{if(stopping)return;stopping=true;ready=false;server.close();await stopAnalysisWorker();releaseLock();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}catch(e){server?.close();releaseLock?.();console.error('Cannot start local server:',e.code||e.message);process.exitCode=1;}
