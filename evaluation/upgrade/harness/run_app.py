#!/usr/bin/env python3
"""Gated black-box app runner for the dedicated upgrade instance. Default: no HTTP/inference."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlencode,urlsplit,unquote
import argparse,datetime,hashlib,io,json,mimetypes,re,shutil,sys,time,urllib.request,urllib.error,uuid,zipfile
from common import ROOT,APP,FAMILIES,sha,dump,read,manifest,require_execution_gates

DEFAULT_BASE='http://127.0.0.1:4325'
DEFAULT_DATA=(ROOT/'runtime/app-data').resolve()

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(value): return hashlib.sha256(value).hexdigest()
def safe_id(value):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',str(value or '')): raise ValueError('Unsafe identifier')
    return str(value)

def bind_runtime(freeze,health,base,data):
    expected=freeze.get('runtime',{}); actual=health.get('build',{})
    if expected.get('baseUrl')!=base or base!=DEFAULT_BASE: raise RuntimeError('Runtime must be frozen at the dedicated loopback base URL')
    fields=['sourceRoot','launchDirectory','dataDirectory','distDirectory','pid','sourceSha256','startedAt','label','builtAssets']
    for field in fields:
        if field not in expected or expected[field]!=actual.get(field): raise RuntimeError('Live startup identity differs from root freeze: '+field)
    if Path(actual['sourceRoot']).resolve()!=APP.resolve() or Path(actual['dataDirectory']).resolve()!=data:
        raise RuntimeError('Live source/data directory is outside the dedicated evaluation binding')
    if not health.get('ok') or not health.get('provider',{}).get('available'): raise RuntimeError('Local app/provider preflight failed')
    identity=health['provider'].get('identity',{})
    for actual_field,frozen_field in [('configuredModel','model'),('configuredProvider','provider'),('providerHost','providerHost'),('reasoningEffort','reasoningEffort')]:
        if identity.get(actual_field)!=freeze[frozen_field]: raise RuntimeError('App model/provider configuration differs from freeze: '+actual_field)
    return {'matched':True,'checkedFields':fields,'providerIdentity':identity}

def check_portable(raw,target,case,revision):
    target.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names=archive.namelist()
        if len(names)!=len(set(names)) or len({x.lower() for x in names})!=len(names): raise RuntimeError('Duplicate archive member')
        for info in archive.infolist():
            p=Path(info.filename)
            if p.is_absolute() or '..' in p.parts or not info.filename or info.is_dir() or ((info.external_attr>>16)&0o170000)==0o120000:
                raise RuntimeError('Unsafe archive member')
        if sum(x.file_size for x in archive.infolist())>128*1024*1024: raise RuntimeError('Archive exceeds bounded extraction budget')
        if archive.testzip() is not None: raise RuntimeError('Archive CRC mismatch')
        archive.extractall(target)
    m=read(target/'manifest.json')
    if m.get('caseId')!=case['id'] or m.get('revision',{}).get('id')!=revision['id']: raise RuntimeError('Archive exports the wrong case/revision')
    declared=m.get('files',[])
    declared_paths=[item.get('path') for item in declared]
    required={'update.html','update.md','supplement.html','supplement.md','evidence.html','evidence.md'}
    if len(declared_paths)!=len(set(declared_paths)) or set(declared_paths)!=(set(names)-{'manifest.json'}) or not required.issubset(declared_paths):
        raise RuntimeError('Archive file inventory is incomplete or duplicated')
    file_checks=[]
    for item in m.get('files',[]):
        p=(target/item['path']).resolve()
        good=p.is_relative_to(target.resolve()) and p.is_file() and sha(p)==item['sha256'] and p.stat().st_size==item['bytes']
        file_checks.append({'path':item['path'],'matchesManifest':good})
    sources={s['id']:s for s in case['sources']}; source_checks=[]
    included=m.get('sources',[])
    if len({item['id'] for item in included})!=len(included):raise RuntimeError('Duplicate source in archive inventory')
    for item in included:
        original=(target/item['originalPath']).resolve(); expected=sources.get(item['id'])
        source_checks.append({'sourceId':item['id'],'matchesFrozenCase':bool(original.is_relative_to(target.resolve()) and original.is_file() and item['originalPath'] in declared_paths and expected and item['id'] in revision['sourceIds'] and sha(original)==expected['sha256']==item['sha256'])})
    class Links(HTMLParser):
        def __init__(self): super().__init__();self.links=[];self.ids=set()
        def handle_starttag(self,tag,attrs):
            a=dict(attrs)
            if a.get('id'):self.ids.add(a['id'])
            if tag=='a' and a.get('href'):self.links.append(a['href'])
    parsed={}
    for p in target.rglob('*.html'):
        parser=Links();parser.feed(p.read_text());parsed[p.resolve()]=parser
    link_checks=[]
    for p,parser in parsed.items():
        for href in parser.links:
            u=urlsplit(href)
            if u.scheme in ['http','https']:
                okay=u.hostname not in ['127.0.0.1','localhost','::1']
                link_checks.append({'from':str(p.relative_to(target.resolve())),'href':href,'external':True,'valid':okay});continue
            q=(p.parent/unquote(u.path)).resolve() if u.path else p
            okay=not u.scheme and not u.netloc and not u.path.startswith('/') and q.is_relative_to(target.resolve()) and q.is_file()
            if okay and u.fragment and q in parsed: okay=unquote(u.fragment) in parsed[q].ids
            link_checks.append({'from':str(p.relative_to(target.resolve())),'href':href,'valid':okay})
    result={'fileChecks':file_checks,'sourceChecks':source_checks,'linkChecks':link_checks,
            'allManifestBytesMatch':all(x['matchesManifest'] for x in file_checks),
            'allIncludedOriginalsMatch':all(x['matchesFrozenCase'] for x in source_checks),
            'allLocalLinksResolve':all(x['valid'] for x in link_checks),
            'reviewStatus':m.get('revision',{}).get('review'),'selectedOriginalCount':len(source_checks),
            'scope':'Static archive integrity/relative-link checks; rendered usability and semantic correctness require separate review.'}
    if not all(result[x] for x in ['allManifestBytesMatch','allIncludedOriginalsMatch','allLocalLinksResolve']):
        dump(target.parent/'portable-integrity-failure.json',result);raise RuntimeError('Portable artifact integrity/link check failed')
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--family',choices=FAMILIES,default='D1')
    parser.add_argument('--stage',choices=['initial','later'],default='initial')
    parser.add_argument('--attempt',default='first')
    parser.add_argument('--base',default=DEFAULT_BASE)
    parser.add_argument('--data',default=str(DEFAULT_DATA))
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--technical-review-baseline',action='store_true',help='After freezing first initial artifacts, add an explicitly technical lifecycle marker, never gold-derived corrections')
    args=parser.parse_args();safe_id(args.attempt)
    if not args.execute:
        print(json.dumps({'status':'PREPARED_ONLY','baseUrl':args.base,'dataDirectory':args.data,'inferenceStarted':False,'httpRequests':0}));return
    task_start=time.monotonic();seal,freeze,_=require_execution_gates()
    base=args.base.rstrip('/');data=Path(args.data).resolve()
    if base!=DEFAULT_BASE or data!=DEFAULT_DATA: raise RuntimeError('Use only the dedicated frozen evaluation runtime/data')
    if not data.is_relative_to(ROOT/'runtime'): raise RuntimeError('Evaluation data path is not isolated')
    candidate=safe_id(freeze['candidateId']);sequence=ROOT/'runs'/candidate/args.family/args.attempt
    records=sequence/args.stage
    if records.exists(): raise RuntimeError('Retained stage already exists; use a new full-sequence attempt label')
    prior_state=sequence/'initial-state.json'
    if args.stage=='later':
        if not prior_state.exists(): raise RuntimeError('Later evidence withheld until initial output is frozen')
        prior=read(prior_state)
        if prior['candidateFreezeSha256']!=sha(ROOT/'public/CANDIDATE-FREEZE.json'): raise RuntimeError('Candidate/config changed between stages')
        if manifest(sequence/'initial/first-output')!=prior['firstOutputManifest']: raise RuntimeError('Initial frozen artifact changed')
    records.mkdir(parents=True);log=records/'api-events.jsonl'
    stage_cap=freeze['stageTimeoutSeconds'];job=None;case_id=None;pending_prior=None
    def event(value):
        with log.open('a') as f:f.write(json.dumps({'at':now(),**value})+'\n')
    def api(method,route,body=None,content_type=None,raw=False,cleanup=False):
        if body is not None and not isinstance(body,bytes):body=json.dumps(body).encode();content_type='application/json'
        remaining=stage_cap-(time.monotonic()-task_start)
        if remaining<=0 and not cleanup:raise TimeoutError('Total stage budget exhausted')
        req=urllib.request.Request(base+route,data=body,method=method,headers={'Content-Type':content_type} if content_type else {})
        try:
            with urllib.request.urlopen(req,timeout=30 if cleanup else min(180,max(.1,remaining))) as response:
                payload=response.read();code=response.status
        except urllib.error.HTTPError as exc:
            payload=exc.read();event({'method':method,'route':route,'status':exc.code,'errorBody':payload.decode(errors='replace')});raise
        event({'method':method,'route':route,'status':code,'bytes':len(payload)})
        return payload if raw else json.loads(payload)
    unwrap=lambda v:v.get('case',v)
    def save_exports(case,out):
        out.mkdir(parents=True);revision=next(r for r in case['revisions'] if r['id']==case['currentRevisionId'])
        dump(out/'case.json',case)
        for fmt in ['md','html','zip']:
            payload=api('GET',f'/api/cases/{case_id}/export?'+urlencode({'revision':revision['id'],'format':fmt}),raw=True)
            (out/('portable.zip' if fmt=='zip' else 'supplement.'+fmt)).write_bytes(payload)
            if fmt=='zip':dump(out/'portable-check.json',check_portable(payload,out/'portable-unpacked',case,revision))
        return revision
    try:
        health=api('GET','/api/health');dump(records/'health.json',health)
        dump(records/'runtime-binding.json',bind_runtime(freeze,health,base,data))
        dump(records/'run-configuration.json',{'candidateFreeze':freeze,'candidateFreezeSha256':sha(ROOT/'public/CANDIDATE-FREEZE.json'),'sealSha256':sha(ROOT/'public/SEAL.json'),'runnerSha256':sha(Path(__file__)),'inference':'Existing configured remote model; synthetic sources only','humanTimingStudy':False})
        if args.stage=='initial':case=unwrap(api('POST','/api/cases',{'title':'Independent synthetic case','stage':'unknown'}))
        else:
            case=unwrap(api('GET','/api/cases/'+safe_id(prior['caseId'])))
            if case['currentRevisionId']!=prior['currentRevisionId'] or case['version']!=prior['caseVersion']:raise RuntimeError('Case changed outside the retained sequence')
        case_id=safe_id(case['id']);before=case;dump(records/'case-before.json',before)
        files=sorted((ROOT/FAMILIES[args.family]/args.family/'input'/args.stage).iterdir())
        dump(records/'submitted-sources.json',[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in files])
        boundary='upgrade-evaluation-'+uuid.uuid4().hex;body=bytearray()
        for p in files:
            if p.is_symlink() or not p.is_file() or any(x in p.name for x in ['"','\r','\n']):raise RuntimeError('Unsupported source path')
            body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{p.name}"\r\nContent-Type: {mimetypes.guess_type(p.name)[0] or "application/octet-stream"}\r\n\r\n'.encode());body.extend(p.read_bytes());body.extend(b'\r\n')
        body.extend(f'--{boundary}--\r\n'.encode())
        case=unwrap(api('POST',f'/api/cases/{case_id}/sources',bytes(body),'multipart/form-data; boundary='+boundary));dump(records/'case-imported.json',case)
        released=['initial'] if args.stage=='initial' else ['initial','later']
        expected={sha(p) for stage in released for p in (ROOT/FAMILIES[args.family]/args.family/'input'/stage).iterdir() if p.is_file()}
        checks=[];downloads=records/'original-downloads';downloads.mkdir()
        for source in case['sources']:
            sid=safe_id(source['id']);raw=api('GET',f'/api/cases/{case_id}/sources/{sid}/file',raw=True);(downloads/sid).write_bytes(raw)
            checks.append({'sourceId':sid,'storedSha256':source['sha256'],'downloadedSha256':digest(raw),'matches':source['sha256']==digest(raw) and digest(raw) in expected})
        integrity={'checks':checks,'expectedUniqueSources':len(expected),'actualSources':len(case['sources']),'passed':len(case['sources'])==len(expected) and {x['downloadedSha256'] for x in checks}==expected and all(x['matches'] for x in checks)};dump(records/'original-integrity.json',integrity)
        if not integrity['passed']:raise RuntimeError('Original source integrity failure')
        job=api('POST',f'/api/cases/{case_id}/analyze',{'expectedVersion':case['version']})['job'];dump(records/'job-created.json',job)
        timeline=[];last=None
        while job['status'] in ['queued','running']:
            current=(job.get('status'),job.get('stage'),job.get('message'))
            if current!=last:timeline.append({'at':now(),'elapsedSeconds':round(time.monotonic()-task_start,3),'status':current[0],'stage':current[1],'message':current[2]});last=current;dump(records/'job-timeline.json',timeline)
            if time.monotonic()-task_start>=stage_cap:raise TimeoutError('Total stage budget exhausted while analysis active')
            time.sleep(min(1.5,max(.01,stage_cap-(time.monotonic()-task_start))))
            job=api('GET','/api/jobs/'+safe_id(job['id']))['job']
        dump(records/'job-final.json',job);case=unwrap(api('GET',f'/api/cases/{case_id}'));dump(records/'case-after.json',case)
        if job['status']!='completed':raise RuntimeError('Analysis did not complete successfully; see retained job/attempts')
        revision=save_exports(case,records/'first-output');first_manifest=manifest(records/'first-output');dump(records/'first-output-manifest.json',first_manifest)
        if args.stage=='later':
            old_sources={s['id']:s for s in before['sources']};new_sources={s['id']:s for s in case['sources']};old_revs={r['id']:r for r in before['revisions']};new_revs={r['id']:r for r in case['revisions']}
            history={'priorSourceBytesAndTextPreserved':all(k in new_sources and v['sha256']==new_sources[k]['sha256'] and v['text']==new_sources[k]['text'] for k,v in old_sources.items()),'priorAnalysesPreserved':all(k in new_revs and v['analysis']==new_revs[k]['analysis'] for k,v in old_revs.items()),'newRevisionDifferent':revision['id']!=before['currentRevisionId'],'newRevisionUnreviewed':not revision.get('review'),'reviewRelativeComparison':revision.get('sinceReviewed')}
            dump(records/'history-integrity.json',history)
            if not all(history[x] for x in ['priorSourceBytesAndTextPreserved','priorAnalysesPreserved','newRevisionDifferent','newRevisionUnreviewed']):raise RuntimeError('History/review integrity failure')
        if args.stage=='initial' and args.technical_review_baseline:
            request={'revisionId':revision['id'],'expectedVersion':case['version'],'note':'Technical evaluator lifecycle marker only. First unreviewed artifacts were saved and hashed. This is not worker/practitioner validation or a gold-derived correction.'}
            dump(records/'technical-review-request.json',request);case=unwrap(api('POST',f'/api/cases/{case_id}/review',request));dump(records/'technical-reviewed-case.json',case)
            save_exports(case,records/'technical-reviewed-output')
        if args.stage=='initial':pending_prior={'caseId':case_id,'currentRevisionId':case['currentRevisionId'],'caseVersion':case['version'],'candidateFreezeSha256':sha(ROOT/'public/CANDIDATE-FREEZE.json'),'firstOutputManifest':first_manifest,'technicalReviewMarker':args.technical_review_baseline}
        result={'status':'completed','family':args.family,'stage':args.stage,'candidateId':candidate,'attempt':args.attempt,'caseId':case_id,'elapsedSeconds':round(time.monotonic()-task_start,3),'humanActiveTime':None,'semanticScoring':'pending independent assessment','monetaryCost':None}
    except Exception as exc:
        result={'status':'failed','family':args.family,'stage':args.stage,'candidateId':candidate,'attempt':args.attempt,'caseId':case_id,'elapsedSeconds':round(time.monotonic()-task_start,3),'failureType':type(exc).__name__,'error':str(exc),'humanActiveTime':None,'monetaryCost':None}
        if job and job.get('status') in ['queued','running']:
            try:
                cancelled=api('POST','/api/jobs/'+safe_id(job['id'])+'/cancel',cleanup=True)
                dump(records/'cancellation-after-failure.json',cancelled);job=cancelled['job']
            except Exception as cancel_error:result['cancellationError']=str(cancel_error)
    finally:
        try:
            if job and job.get('id'):
                job_folder=data/'jobs'/safe_id(job['id'])
                if not job_folder.exists():raise RuntimeError('Job evidence directory is missing')
                # Cancellation marks the job before the aborted model process necessarily closes.
                # Retain a bounded, explicitly recorded settling interval outside the stage budget.
                settle_started=time.monotonic();stable=0;previous=None;settled=False
                while time.monotonic()-settle_started<20:
                    current=manifest(job_folder)
                    disk_job=read(job_folder/'job.json') if (job_folder/'job.json').exists() else job
                    terminal=disk_job.get('status') not in ['queued','running'] and all(a.get('status') not in ['queued','running'] for a in disk_job.get('attempts',[]))
                    stable=stable+1 if current==previous else 0;previous=current
                    if terminal and stable>=2:settled=True;break
                    time.sleep(.5)
                dump(records/'attempt-capture-settling.json',{'settled':settled,'elapsedSeconds':round(time.monotonic()-settle_started,3),'outsideStageBudget':True})
                dump(records/'model-attempt-source-manifest.json',previous);shutil.copytree(job_folder,records/'model-attempts')
                if manifest(records/'model-attempts')!=previous:raise RuntimeError('Model attempt evidence changed during capture')
                if not settled:raise RuntimeError('Model attempt evidence did not settle within the bounded capture interval')
        except Exception as capture_error:
            result['stageOutcomeBeforeEvidenceCapture']=result['status'];result['status']='failed';result['evidenceCaptureError']=str(capture_error)
        dump(records/'run.json',result);dump(records/'artifact-manifest.json',manifest(records))
    if result['status']=='completed' and pending_prior is not None:dump(prior_state,pending_prior)
    print(json.dumps({'status':result['status'],'family':args.family,'stage':args.stage,'candidateId':candidate,'records':str(records),'inferenceStarted':job is not None}))
    if result['status']!='completed':raise SystemExit(1)

if __name__=='__main__':main()
