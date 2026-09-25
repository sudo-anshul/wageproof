"""Upgrade evaluator helpers. No inference is performed by this module."""
from pathlib import Path
import hashlib, json, os, re, subprocess, sys, tomllib

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT.parents[1]
PROJECTS = Path('/Users/anshul/Documents/Codex').resolve()
BASELINE_WORKSPACE_ROOT = ROOT/'baseline/workspaces'
FAMILIES = {'D1':'open','D2':'open','T1':'private/corpus','T2':'private/corpus','T3':'private/corpus','T4':'private/corpus','R1':'private/corpus','R2':'private/corpus'}

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def dump(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
def read(path): return json.loads(Path(path).read_text())
def manifest(folder):
    folder=Path(folder); result=[]
    for p in sorted(folder.rglob('*')):
        if p.is_symlink(): raise RuntimeError('Symlinks are forbidden in evaluation data/workspaces')
        if p.is_file(): result.append({'path':str(p.relative_to(folder)),'bytes':p.stat().st_size,'sha256':sha(p)})
    return result
def corpus_manifest():
    paths=[]
    for fid,partition in FAMILIES.items():
        base=ROOT/partition/fid
        paths.extend(p for p in (base/'input').rglob('*') if p.is_file())
        paths.append(base/'ANSWER-KEY.json')
    return [{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(paths)]
def object_hash(value): return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def config_identity():
    cfg=Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'config.toml'
    data=tomllib.loads(cfg.read_text()) if cfg.exists() else {}
    from urllib.parse import urlsplit
    provider=data.get('model_provider')
    return {'model':data.get('model'),'provider':provider,
            'providerHost':urlsplit(data.get('model_providers',{}).get(provider,{}).get('base_url','')).hostname,
            'serverNames':list(data.get('mcp_servers',{}))}
def require_execution_gates():
    seal_path=ROOT/'public/SEAL.json'
    if not seal_path.exists(): raise RuntimeError('NO INFERENCE: corpus has not been independently reviewed and sealed')
    seal=read(seal_path); receipt=ROOT/'private/review/KEY-REVIEW.json'; review=read(receipt)
    actual=object_hash(corpus_manifest())
    if seal.get('status')!='SEALED_AFTER_INDEPENDENT_KEY_REVIEW' or seal.get('corpusManifestSha256')!=actual:
        raise RuntimeError('NO INFERENCE: corpus seal mismatch')
    if review.get('decision')!='approved' or review.get('corpusManifestSha256')!=actual or not review.get('reviewerId') or review.get('reviewerId')==review.get('authorId'):
        raise RuntimeError('NO INFERENCE: independent key review is missing or invalid')
    report=(ROOT/review.get('reviewReportPath','')).resolve()
    if sha(receipt)!=seal.get('keyReviewReceiptSha256') or not report.is_relative_to(ROOT/'private/review') or not report.is_file() or sha(report)!=seal.get('keyReviewReportSha256'):
        raise RuntimeError('NO INFERENCE: sealed key-review evidence changed')
    protocol_hashes=seal.get('protocolFileHashes',[])
    if not protocol_hashes: raise RuntimeError('NO INFERENCE: protocol/harness binding missing')
    for row in protocol_hashes:
        p=(ROOT/row['path']).resolve()
        if not p.is_relative_to(ROOT) or sha(p)!=row['sha256']:
            raise RuntimeError('NO INFERENCE: protocol/harness changed after sealing')
    freeze=read(ROOT/'public/CANDIDATE-FREEZE.json')
    if freeze.get('status')!='FROZEN_BY_ROOT' or not all(freeze.get(x) for x in ['candidateId','approvedBy','frozenAt','model','provider','providerHost','sourceFileHashes']):
        raise RuntimeError('NO INFERENCE: root candidate/configuration freeze is pending')
    if freeze.get('reasoningEffort')!='high' or freeze.get('stageTimeoutSeconds')!=1200:
        raise RuntimeError('NO INFERENCE: protocol/configuration mismatch')
    required={'server/index.mjs','server/extract.mjs','server/model.mjs','server/jobs.mjs','domain/prompt.mjs','domain/schema.mjs','domain/validation.mjs','domain/reconcile.mjs','domain/revision.mjs','domain/supplement.mjs'}
    if not required.issubset({row['path'] for row in freeze['sourceFileHashes']}):
        raise RuntimeError('NO INFERENCE: candidate binding omits a required semantic/runtime component')
    for row in freeze['sourceFileHashes']:
        p=(APP/row['path']).resolve()
        if not p.is_relative_to(APP) or sha(p)!=row['sha256']:
            raise RuntimeError('NO INFERENCE: candidate bytes changed after freeze')
    identity=config_identity()
    for k in ['provider','providerHost']:
        if identity[k]!=freeze[k]: raise RuntimeError('NO INFERENCE: configured provider differs from frozen identity')
    return seal,freeze,identity

NATIVE_PROFILE = 'upgrade-baseline-v3'
DEPENDENCIES = Path('/Users/anshul/.cache/codex-runtimes/codex-primary-runtime/dependencies')
BASELINE_DISABLED = ['apps','plugins','multi_agent','browser_use','browser_use_external','computer_use','in_app_browser','image_generation','skill_search','goals','memories','external_agent_memory_import','hooks','shell_snapshot']

def native_profile_options(workspace):
    workspace=Path(workspace).resolve()
    fs={':root':'deny',':minimal':'read',':tmpdir':'deny',':slash_tmp':'deny',
        str(workspace):'read',str(workspace/'work'):'write',str(DEPENDENCIES):'read','/opt/homebrew':'read'}
    inline='{'+', '.join(json.dumps(k)+'='+json.dumps(v) for k,v in fs.items())+'}'
    return ['-c','default_permissions='+json.dumps(NATIVE_PROFILE),
            '-c','permissions.'+NATIVE_PROFILE+'.filesystem='+inline,
            '-c','permissions.'+NATIVE_PROFILE+'.network.enabled=false',
            '-c','project_doc_max_bytes=0']

def baseline_command(workspace,final,freeze,identity):
    # Legacy sandbox flags would override native profiles, so reject them in the
    # loaded user config and never pass --sandbox or workspace-write settings.
    cfg=Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'config.toml'
    data=tomllib.loads(cfg.read_text()) if cfg.exists() else {}
    if 'sandbox_mode' in data or 'sandbox_workspace_write' in data:
        raise RuntimeError('NO INFERENCE: legacy user sandbox settings override native permission profiles')
    command=['codex','exec','--ephemeral','--ignore-rules','--skip-git-repo-check','--json','--color','never',
             '-m',freeze['model'],'-c','model_reasoning_effort="high"','-c','approval_policy="never"',
             *native_profile_options(workspace),'-C',str(workspace),'-o',str(final)]
    for flag in BASELINE_DISABLED: command.extend(['--disable',flag])
    for name in identity['serverNames']:
        if not re.fullmatch(r'[a-zA-Z0-9_-]+',name):raise RuntimeError('Unsafe configured server name')
        command.extend(['-c',f'mcp_servers.{name}.enabled=false'])
    command.append('-')
    return command

def probe_native_isolation(workspace,records):
    # One native sandbox executes real extraction tools on harmless generated
    # markers. No model is invoked. Probe paths/results stay outside model context.
    import shutil, socket, uuid
    from PIL import Image, ImageDraw, ImageFont
    workspace=Path(workspace).resolve();records=Path(records).resolve()
    tag=uuid.uuid4().hex;inputs=workspace/('.native-probe-'+tag);scratch=workspace/'work'/('.native-probe-'+tag)
    inputs.mkdir();scratch.mkdir(parents=True)
    captured=records/'native-preflight';captured.mkdir()
    allowed=inputs/'allowed.txt';allowed.write_text('ALLOW_PROBE\n')
    immutable=workspace/'sources'/('isolation-source-'+tag+'.txt');immutable.write_text('IMMUTABLE_PROBE\n')
    private=ROOT/'private/qa/isolation-denied.txt';private.write_text('DENY_PROBE\n')
    sibling=BASELINE_WORKSPACE_ROOT/('isolation-other-workspace-'+tag+'.txt');sibling.write_text('DENY_OTHER_WORKSPACE\n')
    png=inputs/'marker.png';pdf=inputs/'image-only.pdf'
    canvas=Image.new('RGB',(1200,240),'white');draw=ImageDraw.Draw(canvas)
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',48)
    draw.text((40,80),'SYNTHETIC PROBE 7421',font=font,fill='black')
    canvas.save(png);canvas.save(pdf,'PDF',resolution=150)
    program=r"""import json,pathlib,socket,subprocess,sys
out={}
for name,path in [('allowed',sys.argv[1]),('privateProject',sys.argv[2]),('appSource',sys.argv[3]),('otherWorkspace',sys.argv[4])]:
 try:pathlib.Path(path).read_bytes();out[name]=True
 except PermissionError:out[name]=False
for name,path in [('workspaceWrite',sys.argv[5]),('sourceWrite',sys.argv[6]),('outsideProjectWrite',sys.argv[7])]:
 try:pathlib.Path(path).write_text('PROBE_WRITE');out[name]=True
 except PermissionError:out[name]=False
for name,host,port in [('localNetwork','127.0.0.1',int(sys.argv[8])),('remoteNetwork','1.1.1.1',443)]:
 s=socket.socket();s.settimeout(1)
 try:s.connect((host,port));out[name]='allowed'
 except PermissionError:out[name]='denied'
 except Exception as e:out[name]=type(e).__name__
 finally:s.close()
try:next(pathlib.Path(sys.argv[14]).iterdir(),None);out['historyRead']=True
except PermissionError:out['historyRead']=False
png,pdf,base,tesseract,pdftoppm=sys.argv[9:14]
p=subprocess.run([tesseract,png,'stdout','--psm','6'],capture_output=True,text=True)
out['pngOcr']={'exitCode':p.returncode,'markerFound':'SYNTHETIC PROBE 7421' in p.stdout,'stderr':p.stderr[-300:]}
p=subprocess.run([pdftoppm,'-singlefile','-png','-r','150',pdf,base],capture_output=True,text=True)
out['imagePdfRender']={'exitCode':p.returncode,'outputInWork':pathlib.Path(base+'.png').is_file(),'stderr':p.stderr[-300:]}
p=subprocess.run([tesseract,base+'.png','stdout','--psm','6'],capture_output=True,text=True)
out['imagePdfOcr']={'exitCode':p.returncode,'markerFound':'SYNTHETIC PROBE 7421' in p.stdout,'stderr':p.stderr[-300:]}
print(json.dumps(out))
"""
    listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
    tesseract=shutil.which('tesseract');pdftoppm=shutil.which('pdftoppm')
    if not tesseract or not pdftoppm:raise RuntimeError('Required local OCR/PDF probe tools unavailable')
    options=native_profile_options(workspace)
    command=['codex','sandbox',*options,'--permission-profile',NATIVE_PROFILE,'-C',str(workspace),'--',sys.executable,'-I','-c',program,
             str(allowed),str(private),str(APP/'server/index.mjs'),str(sibling),str(scratch/'write.txt'),str(immutable),str(records/'forbidden-write.txt'),
             str(listener.getsockname()[1]),str(png),str(pdf),str(scratch/'rendered'),tesseract,pdftoppm,str(Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'sessions')]
    proc=None;result={'inferenceStarted':False,'boundary':'single native Codex sandbox for commands','nativeProfileOptions':options,
                     'systemTempLimitation':'This installed runtime still permits system-temp access despite deny entries; no reserved evaluation source/key/output is staged there.'}
    try:
        proc=subprocess.run(command,text=True,capture_output=True,cwd=workspace,timeout=45)
        result.update(exitCode=proc.returncode,stdout=proc.stdout,stderr=proc.stderr,result=json.loads(proc.stdout) if proc.returncode==0 else None)
        expected={'allowed':True,'privateProject':False,'appSource':False,'otherWorkspace':False,'workspaceWrite':True,'sourceWrite':False,'outsideProjectWrite':False,'localNetwork':'denied','remoteNetwork':'denied','historyRead':False}
        got=result['result'] or {}
        result['passed']=all(got.get(k)==v for k,v in expected.items()) and immutable.read_text()=='IMMUTABLE_PROBE\n' and all(got.get(k,{}).get('exitCode')==0 for k in ['pngOcr','imagePdfRender','imagePdfOcr']) and got.get('pngOcr',{}).get('markerFound') and got.get('imagePdfRender',{}).get('outputInWork') and got.get('imagePdfOcr',{}).get('markerFound')
    except Exception as exc:
        result.update(passed=False,error=str(exc))
    finally:
        listener.close();dump(records/'isolation-probe.json',result)
        (captured/'probe-program.py').write_text(program);dump(captured/'command.json',command)
        shutil.copytree(inputs,captured/'inputs');shutil.copytree(scratch,captured/'work-output')
        immutable.unlink(missing_ok=True);sibling.unlink(missing_ok=True);shutil.rmtree(inputs);shutil.rmtree(scratch)
    if not result['passed']:raise RuntimeError('NO INFERENCE: native isolation/extraction preflight failed; retain and inspect report')
    return result
