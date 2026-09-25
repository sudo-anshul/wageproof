import { execFileSync } from 'node:child_process';
import { providerStatus, runtimeIdentity } from '../server/model.mjs';

const inspection = process.argv.includes('--inspection');
const commands = [['Node', process.execPath, ['--version'], true], ['Python 3', 'python3', ['--version'], true], ['Codex CLI', 'codex', ['--version'], !inspection], ['PDF metadata', 'pdfinfo', ['-v'], false], ['PDF text', 'pdftotext', ['-v'], false], ['PDF image inspection', 'pdfimages', ['-v'], false], ['PDF page rasterization', 'pdftoppm', ['-v'], false], ['Image OCR', 'tesseract', ['--version'], false]];
const checks = commands.map(([label, program, args, required]) => {
  try { execFileSync(program, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }); return { label, available: true, required }; }
  catch { return { label, available: false, required }; }
});
let englishOcr = false;
try { englishOcr = execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).split(/\r?\n/).some(line => line.trim() === 'eng'); } catch {}
const provider = providerStatus(), runtime = runtimeIdentity();
const report = { mode: inspection ? 'inspection' : 'analysis', checks, englishOcr, provider, runtime, liveModelProbeRun: false };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(inspection ? 'Inspection mode: open the prepared example without model access. Fresh analysis still requires Codex.' : 'Analysis mode: check the prerequisites for creating a new model proposal.');
  for (const check of checks) console.log(check.label + ': ' + (check.available ? 'available' : 'missing — ' + (check.required ? 'required' : check.label === 'Codex CLI' ? 'needed for fresh analysis, not recorded inspection' : 'required for this file format')));
  console.log('English OCR data: ' + (englishOcr ? 'available' : 'missing — install Tesseract English data before importing scanned/image records'));
  console.log('Codex model: ' + (provider.identity.configuredModel ?? 'CLI default or not readable') + '; provider: ' + (provider.identity.configuredProvider ?? 'CLI default or not readable') + '; reasoning: high');
  console.log('Local authentication evidence: ' + (provider.identity.configuredCredentialPresent ? 'configured provider environment credential is present' : provider.identity.storedAuthenticationPresent ? 'stored authentication file is present' : 'not detected; use the existing Codex setup to check access') + '. This does not verify live access.');
  console.log('Source directory: ' + runtime.sourceRoot);
  console.log('Launch directory: ' + runtime.launchDirectory);
  console.log('Data directory: ' + runtime.dataDirectory);
  console.log('Built-assets directory: ' + runtime.distDirectory);
  console.log('Source SHA-256: ' + runtime.sourceSha256);
  console.log('Built assets: ' + (runtime.builtAssets ? runtime.builtAssets.sha256 + ' (' + runtime.builtAssets.fileCount + ' files)' : 'missing — run npm run build before production startup'));
  console.log('Platform: ' + runtime.supportedSetup);
  console.log('No model request was sent. These checks do not prove service availability, billing access, OCR accuracy or cross-platform support. Analysis uses your existing configured Codex service.');
}
process.exitCode = checks.some(check => check.required && !check.available) || process.platform === 'win32' ? 1 : 0;
