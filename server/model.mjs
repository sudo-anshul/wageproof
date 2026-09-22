import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const disabledFeatures = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'image_generation', 'view_image', 'skill_search', 'workspace_dependencies', 'goals'];
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPrelude = 'import pathlib,tomllib,json,os; root=pathlib.Path(os.environ.get("CODEX_HOME",str(pathlib.Path.home()/".codex"))); p=root/"config.toml"; d=tomllib.loads(p.read_text()) if p.exists() else {}; ';

function disabledServers() {
  try { return JSON.parse(execFileSync('python3', ['-c', configPrelude + 'print(json.dumps(list(d.get("mcp_servers",{}))))'], { encoding: 'utf8', timeout: 5000 })); }
  catch { return []; }
}

export function providerIdentity() {
  let cliVersion = null, configuration = { configAvailable: false, configuredModel: null, configuredProvider: null, providerHost: null, configuredCredentialPresent: null, storedAuthenticationPresent: null };
  try { cliVersion = execFileSync('codex', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim(); } catch {}
  // Only allowlisted identity and presence bits leave this subprocess. Never
  // return credentials, headers, query strings, auth contents or env values.
  try {
    configuration = JSON.parse(execFileSync('python3', ['-c', configPrelude + 'import urllib.parse; provider=d.get("model_provider"); entry=d.get("model_providers",{}).get(provider,{}); key=entry.get("env_key"); print(json.dumps({"configAvailable":p.exists(),"configuredModel":d.get("model"),"configuredProvider":provider,"providerHost":urllib.parse.urlparse(entry.get("base_url","")).hostname,"configuredCredentialPresent":bool(os.environ.get(key)) if key else None,"storedAuthenticationPresent":(root/"auth.json").is_file()}))'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }));
  } catch {}
  return { cliVersion, ...configuration, reasoningEffort: 'high', liveAccessVerified: false };
}

function hashTree(directory) {
  const hash = createHash('sha256');
  let count = 0;
  const walk = (folder, relative = '') => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if(entry.name==='__pycache__'||entry.name==='.DS_Store')continue;
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(folder, entry.name), name);
      else if (entry.isFile()) { hash.update(name).update('\0').update(readFileSync(path.join(folder, entry.name))).update('\0'); count++; }
    }
  };
  walk(directory);
  return { sha256: hash.digest('hex'), fileCount: count };
}

export function runtimeIdentity() {
  const hash = createHash('sha256');
  for (const folder of ['domain', 'server', 'src', 'scripts']) if (existsSync(path.join(sourceRoot, folder))) hash.update(folder).update('\0').update(hashTree(path.join(sourceRoot, folder)).sha256).update('\0');
  for (const name of ['package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'vite.config.mjs']) if (existsSync(path.join(sourceRoot, name))) hash.update(name).update('\0').update(readFileSync(path.join(sourceRoot, name))).update('\0');
  let gitHead = null;
  try { gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).trim(); } catch {}
  const distDirectory = path.resolve(process.env.WAGEPROOF_DIST_DIR || path.join(sourceRoot, 'dist'));
  const dist = existsSync(distDirectory) ? hashTree(distDirectory) : null;
  return { sourceRoot, launchDirectory: process.cwd(), dataDirectory: path.resolve(process.env.WAGEPROOF_DATA_DIR || '.data'), distDirectory, nodeVersion: process.version, platform: process.platform, pid: process.pid, gitHead, sourceSha256: hash.digest('hex'), builtAssets: dist, supportedSetup: process.platform === 'darwin' ? 'macOS: supported; consult the release report for executed setup checks' : process.platform === 'win32' ? 'Windows: unsupported POSIX data lock' : 'POSIX: setup not verified for this release' };
}

export function providerStatus() {
  const identity = providerIdentity();
  return { name: 'Codex CLI', available: Boolean(identity.cliVersion), identity, authenticationCheck: 'Local credential presence only; no model request was sent and live access is unverified.', description: 'Files and case state stay on this computer. Analysis uses your configured Codex model service; inference is not offline.' };
}

function observedUsage(stdout) {
  const allowed = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'total_tokens'];
  let usage = null, events = 0;
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type !== 'turn.completed' || !event.usage) continue;
      events++;
      for (const key of allowed) if (Number.isSafeInteger(event.usage[key]) && event.usage[key] >= 0) { usage ??= {}; usage[key] = (usage[key] ?? 0) + event.usage[key]; }
    } catch {}
  }
  return { usage, usageEventCount: events };
}

/** One model attempt. Job-level retries and validation remain the caller's responsibility. */
export async function runModel({ prompt, schema, jobDir, signal, onProgress = () => {}, onMetadata, timeoutMs = 600_000 }) {
  const started = Date.now();
  let modelStarted = null, modelEnded = null, stdout = '', stderr = '', timedOut = false, exitCode = null, closeSignal = null;
  let child, timer, killTimer, identity = {}, analysis, failure, metadata, responseBytes = 0;
  const cancelled = () => Object.assign(new Error('Analysis cancelled. Your sources and reviewed account are preserved.'), { code: 'CANCELLED' });
  const stop = () => { if (!child || child.exitCode !== null || child.signalCode !== null) return; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); killTimer.unref(); };
  try {
    if (signal?.aborted) throw cancelled();
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw Object.assign(new Error('Invalid model attempt timeout.'), { code: 'MODEL_CONFIGURATION' });
    await mkdir(jobDir, { recursive: true, mode: 0o700 });
    const schemaPath = path.join(jobDir, 'schema.json'), outputPath = path.join(jobDir, 'response.json');
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 }); await writeFile(path.join(jobDir, 'prompt.txt'), prompt, { mode: 0o600 });
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--json', '--output-schema', schemaPath, '--output-last-message', outputPath, '-c', 'model_reasoning_effort="high"'];
    for (const feature of disabledFeatures) args.push('--disable', feature);
    for (const name of disabledServers()) if (/^[a-zA-Z0-9_-]+$/.test(name)) args.push('-c', 'mcp_servers.' + name + '.enabled=false');
    args.push('-'); identity = providerIdentity();
    if (signal?.aborted) throw cancelled();
    modelStarted = Date.now();
    child = spawn('codex', args, { cwd: jobDir, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.stdout.on('data', bytes => { stdout += bytes.toString(); if (stdout.length > 10_000_000) stdout = stdout.slice(-10_000_000); });
    child.stderr.on('data', bytes => { stderr += bytes.toString(); if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000); });
    child.stdin.on('error', () => {}); child.stdin.end(prompt);
    onProgress('Reading source records and constructing a proposed update…');
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, processSignal) => { exitCode = code; closeSignal = processSignal; modelEnded = Date.now(); resolve(); }); });
    if (signal?.aborted) throw cancelled();
    if (timedOut) throw Object.assign(new Error('The model did not finish within ' + Math.round(timeoutMs / 1000) + ' seconds. Your records are safe; retry this analysis.'), { code: 'MODEL_TIMEOUT' });
    if (exitCode !== 0) throw Object.assign(new Error(/quota|rate.limit|429/i.test(stderr + stdout) ? 'The configured model service is temporarily unavailable or rate limited. Retry when access is available.' : 'The configured Codex model could not complete this analysis. Check local Codex access and retry.'), { code: 'MODEL_UNAVAILABLE' });
    let raw;
    try { raw = await readFile(outputPath, 'utf8'); responseBytes = Buffer.byteLength(raw); }
    catch { throw Object.assign(new Error('The model completed without a structured case response.'), { code: 'MODEL_OUTPUT' }); }
    try { analysis = JSON.parse(raw); }
    catch { throw Object.assign(new Error('The model response was not valid structured data. No case revision was adopted.'), { code: 'MODEL_OUTPUT' }); }
  } catch (exception) {
    failure = signal?.aborted ? cancelled() : exception;
    if (failure.code === 'ENOENT') failure = Object.assign(new Error('The configured Codex executable could not be started. Check the local installation and retry.'), { code: 'MODEL_UNAVAILABLE' });
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
    if (child && modelEnded === null) stop();
    const completed = Date.now();
    metadata = { metadataVersion: 2, provider: 'Codex CLI / configured model service', ...identity, startedAt: new Date(started).toISOString(), modelStartedAt: modelStarted === null ? null : new Date(modelStarted).toISOString(), completedAt: new Date(completed).toISOString(), durationMs: completed - started, processDurationMs: modelStarted === null ? 0 : (modelEnded ?? completed) - modelStarted, status: failure ? failure.code === 'CANCELLED' ? 'cancelled' : failure.code === 'MODEL_TIMEOUT' ? 'timed_out' : 'failed' : 'completed', errorCode: failure?.code ?? null, exitCode, signal: closeSignal, timeoutMs, promptBytes: Buffer.byteLength(prompt ?? ''), responseBytes, ...observedUsage(stdout), toolsDisabled: true, monetaryCost: null };
    try {
      await mkdir(jobDir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(jobDir, 'events.jsonl'), stdout, { mode: 0o600 }); await writeFile(path.join(jobDir, 'stderr.log'), stderr, { mode: 0o600 });
      await writeFile(path.join(jobDir, 'attempt-metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
    } catch {
      if (!failure) failure = Object.assign(new Error('The local attempt record could not be saved. The prior account is preserved.'), { code: 'MODEL_RECORD' });
    }
    if(failure){metadata.status=failure.code==='CANCELLED'?'cancelled':failure.code==='MODEL_TIMEOUT'?'timed_out':'failed';metadata.errorCode=failure.code??'MODEL_FAILED';}
    try { if (onMetadata) await onMetadata(metadata); }
    catch { if (!failure) failure = Object.assign(new Error('The model attempt completed, but its job metadata could not be recorded. The prior account is preserved.'), { code: 'MODEL_RECORD' }); }
    if(failure&&metadata.errorCode!==failure.code){metadata.status='failed';metadata.errorCode=failure.code??'MODEL_FAILED';}
  }
  if (failure) { failure.modelMetadata = metadata; throw failure; }
  return { analysis, metadata };
}
