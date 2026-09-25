"""Create a local source snapshot and a file-bound release manifest."""
import argparse
import datetime
import hashlib
import json
import pathlib
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('label')
parser.add_argument('--build-dir', default='dist', help='Built frontend directory; manifest paths remain canonical dist/.')
args = parser.parse_args()
if not args.label or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in args.label):
    parser.error('Use a lowercase label containing letters, digits, hyphens or underscores.')
root = pathlib.Path(__file__).resolve().parents[1]
build_dir = (root / args.build_dir).resolve()
if not (build_dir / 'index.html').is_file():
    parser.error('Build directory must contain index.html.')
ref = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root, text=True)
if dirty.strip():
    parser.error('Commit the intended tracked release changes before creating the source snapshot.')
output = root / 'release' / args.label
output.mkdir(parents=True, exist_ok=False)
archive = output / 'wageproof-source.zip'
tracked = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', ref], cwd=root, text=True).splitlines()
public_roots = ('server/', 'domain/', 'src/', 'public/', 'scripts/', 'tests/', 'examples/', 'docs/', 'evaluation/public/')
public_root_files = {'.gitignore', 'README.md', 'package.json', 'package-lock.json', 'vite.config.mjs', 'index.html'}
public_files = [name for name in tracked if name.startswith(public_roots) or name in public_root_files]
subprocess.run(['git', 'archive', '--format=zip', '--prefix=wageproof/', '-o', str(archive), ref, '--', *public_files], cwd=root, check=True)
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None:
        raise SystemExit('Archive integrity check failed.')
    names = bundle.namelist()
    prohibited = ['/.hpdlc/', '/.data/', '/node_modules/', '/evaluation/reserved/', '/evaluation/private-authoring/']
    if any(part in name for name in names for part in prohibited):
        raise SystemExit('Source archive contains an excluded runtime or sealed-data directory.')
files = []
for directory in ['server', 'domain', 'scripts', 'src', 'dist', 'docs']:
    directory_root = build_dir if directory == 'dist' else root / directory
    for file in sorted(directory_root.rglob('*')):
        if file.is_file():
            files.append({'path': str(pathlib.Path(directory) / file.relative_to(directory_root)), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size})
for name in ['package.json', 'package-lock.json', 'README.md', 'vite.config.mjs']:
    file = root / name
    files.append({'path': name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size})
manifest = {
    'label': args.label, 'recorded_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'git_ref': ref, 'build_directory': str(build_dir), 'source_archive': archive.name,
    'source_archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'source_archive_entries': len(names), 'files': files,
    'publication': 'Local snapshot only; no remote Git operation, deployment or upload.',
    'validation': 'This records bytes and archive integrity. Runtime, usability, model and media validation must be linked separately.',
}
(output / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'release': str(output), 'git_ref': ref, 'source_sha256': manifest['source_archive_sha256']}, indent=2))
