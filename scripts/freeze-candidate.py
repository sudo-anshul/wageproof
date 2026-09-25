#!/usr/bin/env python3
"""Bind the exact local candidate to evaluation without modifying Git or case data."""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import zipfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('candidate_id')
parser.add_argument('--build-dir', default='dist-upgrade')
parser.add_argument('--port', type=int, default=4325)
parser.add_argument('--data-dir', default='evaluation/upgrade/runtime/app-data')
args = parser.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', args.candidate_id):
    parser.error('Use a simple candidate identifier.')
root = pathlib.Path(__file__).resolve().parents[1]
build = (root / args.build_dir).resolve()
if not build.is_relative_to(root) or not (build / 'index.html').is_file():
    parser.error('The build must exist within this project.')
out = root / 'release' / args.candidate_id
if out.exists():
    parser.error('This candidate already exists. Preserve it and choose a new identifier.')
identity = json.loads(subprocess.check_output(
    ['node', '--input-type=module', '-e', "import {providerIdentity} from './server/model.mjs';console.log(JSON.stringify(providerIdentity()));"],
    cwd=root, text=True))
if not all(identity.get(k) for k in ['configuredModel', 'configuredProvider', 'providerHost']):
    parser.error('Model/provider identity could not be established; no evaluation freeze written.')
base_url = f'http://127.0.0.1:{args.port}'
with urllib.request.urlopen(base_url + '/api/health', timeout=15) as response:
    health = json.load(response)
runtime = health['build']
expected = {'sourceRoot': str(root), 'launchDirectory': str(root),
            'distDirectory': str(build), 'dataDirectory': str((root / args.data_dir).resolve()),
            'label': args.candidate_id}
if any(runtime.get(k) != value for k, value in expected.items()):
    parser.error('Running service does not match the candidate paths/label. Restart the dedicated evaluation service.')
if not runtime.get('builtAssets') or not runtime.get('sourceSha256'):
    parser.error('Running service has no complete startup identity.')
paths = []
for folder in ['domain', 'server', 'src', 'scripts', 'public', 'tests', 'examples', args.build_dir]:
    base = root / folder
    for file in sorted(base.rglob('*')):
        if file.is_symlink():
            parser.error('Candidate source must not contain symlinks: ' + str(file))
        if file.is_file() and '__pycache__' not in file.parts:
            paths.append(file)
for name in ['package.json', 'package-lock.json', 'index.html', 'vite.config.mjs', '.gitignore']:
    if (root / name).is_file():
        paths.append(root / name)
for name in ['evaluation/upgrade/harness/run_app.py', 'evaluation/upgrade/harness/common.py',
             'evaluation/upgrade/baseline/run_baseline.py', 'evaluation/upgrade/baseline/run_tool_smoke.py',
             'evaluation/upgrade/public/SCOPE.md',
             'evaluation/upgrade/public/PROTOCOL.md']:
    paths.append(root / name)
paths = sorted(set(paths))
rows = [{'path': str(p.relative_to(root)), 'bytes': p.stat().st_size,
         'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
source_hash = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
out.mkdir(parents=True)
archive = out / 'candidate-source.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for p in paths:
        relative = pathlib.Path('dist') / p.relative_to(build) if p.is_relative_to(build) else p.relative_to(root)
        bundle.write(p, pathlib.Path('wageproof') / relative)
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip():
        raise RuntimeError('Candidate archive failed integrity verification.')
freeze = {
    'schemaVersion': 1, 'status': 'FROZEN_BY_ROOT', 'candidateId': args.candidate_id,
    'approvedBy': '/root', 'frozenAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'model': identity['configuredModel'], 'provider': identity['configuredProvider'],
    'providerHost': identity['providerHost'], 'cliVersion': identity['cliVersion'],
    'reasoningEffort': 'high', 'stageTimeoutSeconds': 1200,
    'sourceFileHashes': rows, 'sourceManifestSha256': source_hash,
    'sourceArchive': str(archive.relative_to(root)),
    'sourceArchiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'runtime': {**runtime, 'baseUrl': base_url, 'command': 'node server/index.mjs'},
    'scope': 'Local synthetic evaluation candidate, not final release or submission. Existing configured inference only; no new purchase. Archive excludes cases, provider logs, evaluation inputs/keys and media.',
    'limits': 'File hashes bind observed bytes. Evaluation results, runtime receipt and final documentation must be recorded separately. Different tools/pipelines do not establish equal compute.',
}
payload = json.dumps(freeze, indent=2) + '\n'
(out / 'candidate-freeze.json').write_text(payload)
public = root / 'evaluation/upgrade/public/CANDIDATE-FREEZE.json'
public.parent.mkdir(parents=True, exist_ok=True)
if public.exists():
    (out / 'previous-freeze.json').write_bytes(public.read_bytes())
public.write_text(payload)
print(json.dumps({'candidate': args.candidate_id, 'files': len(rows), 'sourceManifestSha256': source_hash,
                  'archive': str(archive), 'publicFreeze': str(public)}, indent=2))
