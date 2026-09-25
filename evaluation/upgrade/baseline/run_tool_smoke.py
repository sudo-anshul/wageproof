#!/usr/bin/env python3
"""Prepare an innocuous tool smoke; --execute permits one frozen, gated model process."""
from pathlib import Path
import argparse
import collections
import datetime
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'harness'))
from common import (
    APP, ROOT, BASELINE_WORKSPACE_ROOT, baseline_command, dump, manifest,
    native_profile_options, probe_native_isolation, require_execution_gates, sha,
)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def summarize_events(path):
    """Count reported items once, retaining usage without treating turns as API calls."""
    event_types = collections.Counter()
    item_types = collections.Counter()
    usage = []
    malformed = []
    tool_items = {}
    completed_commands = {}
    tool_types = {'command_execution', 'mcp_tool_call', 'web_search',
                  'image_generation', 'custom_tool_call'}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError('JSON event is not an object')
        except ValueError as error:
            malformed.append({'line': number, 'error': str(error)})
            continue
        event_type = event.get('type', 'unknown')
        event_types[event_type] += 1
        if event.get('usage') is not None:
            usage.append({'line': number, 'eventType': event_type, 'usage': event['usage']})
        item = event.get('item')
        if not isinstance(item, dict):
            continue
        item_type = item.get('type', 'unknown')
        if event_type == 'item.completed':
            item_types[item_type] += 1
        if item_type in tool_types:
            # IDs join started/completed events; no ID means only completion is countable.
            item_id = item.get('id')
            if item_id is not None or event_type == 'item.completed':
                key = str(item_id) if item_id is not None else 'completed-line-' + str(number)
                tool_items[key] = item_type
                if event_type == 'item.completed' and item_type == 'command_execution':
                    completed_commands[key] = {
                        'exitCode': item.get('exit_code'), 'status': item.get('status'),
                    }
    totals = collections.Counter()
    for row in usage:
        if isinstance(row['usage'], dict):
            for name, value in row['usage'].items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    totals[name] += value
    return {
        'eventTypeCounts': dict(event_types),
        'completedItemTypeCounts': dict(item_types),
        'reportedToolItemCounts': dict(collections.Counter(tool_items.values())),
        'reportedToolItemsTotal': len(tool_items),
        'reportedCompletedCommandCount': len(completed_commands),
        'reportedSuccessfulCommandCount': sum(row['exitCode'] == 0 for row in completed_commands.values()),
        'observedUsageEvents': usage,
        'observedUsageEventSums': dict(totals),
        'malformedEventLines': malformed,
        'modelApiCallCount': None,
        'accountingLimitation': 'CLI JSONL exposes usage and reported tool items, not a reliable count of individual model API requests. Usage sums are sums of reported events; all raw events are retained.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--attempt', required=True, help='New short label; retained attempts are never overwritten')
    parser.add_argument('--execute', action='store_true', help='Requires reviewed seal, frozen candidate and passing native preflight')
    args = parser.parse_args()
    task_clock = time.monotonic()
    started = now()
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,60}', args.attempt):
        parser.error('Use a short alphanumeric attempt label')
    if args.execute:
        seal, freeze, identity = require_execution_gates()
        candidate = freeze['candidateId']
        script_path = str(Path(__file__).resolve().relative_to(APP))
        if not any(row['path'] == script_path and row['sha256'] == sha(__file__)
                   for row in freeze['sourceFileHashes']):
            raise SystemExit('NO INFERENCE: this smoke runner must be bound in the root candidate freeze')
    else:
        seal = freeze = identity = None
        candidate = 'preparation-only'
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', candidate):
        raise SystemExit('Candidate ID must be a safe single path component')

    workspace = BASELINE_WORKSPACE_ROOT / candidate / 'tool-smoke' / args.attempt
    records = ROOT / 'baseline/records' / candidate / 'tool-smoke' / args.attempt
    for target in [workspace, records]:
        if any(path.is_symlink() for path in [target, *target.parents]):
            raise SystemExit('Smoke workspace and record ancestors must not be symlinks')
        if target.exists():
            raise SystemExit('Retained smoke attempt already exists; choose a new --attempt label')
    records.mkdir(parents=True, mode=0o700)
    workspace.mkdir(parents=True, mode=0o700)
    (workspace / 'sources').mkdir(mode=0o700)
    (workspace / 'work').mkdir(mode=0o700)
    (workspace / 'outputs').mkdir(mode=0o700)

    marker = {'source_marker': 'SYNTHETIC_SOURCE_' + uuid.uuid4().hex,
              'proof_marker': 'SYNTHETIC_PROOF_' + uuid.uuid4().hex}
    dump(workspace / 'sources/marker.json', marker)
    task = '''This is an innocuous local tool-access smoke, using synthetic markers only.
Use a local shell tool to read sources/marker.json. Use a local shell tool to write the exact value of its proof_marker field followed by one newline to work/proof.txt. Do not add any other text to that file.
After those tool operations succeed, return exactly SMOKE_OK followed by one space and the source_marker value from the file as your final response.
Read the marker from the supplied file; do not guess it. Sources and this task are read-only. Put any optional temporary scripts or extraction outputs under work/. Do not modify sources/ or outputs/; the runner saves your final response.
Do not read outside this workspace, use external apps/connectors, browse the web, communicate with anyone, or run network commands. If a required tool operation is blocked, report that failure honestly and stop. Do not retry a blocked operation.
'''
    (workspace / 'TASK.md').write_text(task)
    (records / 'prompt.md').write_text(task)
    source_manifest = manifest(workspace / 'sources')
    task_hash = sha(workspace / 'TASK.md')
    final = workspace / 'outputs/update.md'
    command = baseline_command(workspace, final, freeze, identity) if args.execute else None
    configuration = {
        'candidateId': candidate, 'attempt': args.attempt, 'executeRequested': args.execute,
        'kind': 'innocuous-real-tool-smoke', 'rawFamilySourcesUsed': False,
        'workspacePath': str(workspace), 'recordsPath': str(records),
        'sourceManifest': source_manifest, 'runnerSha256': sha(__file__),
        'commonSha256': sha(ROOT / 'harness/common.py'),
        'candidateFreeze': freeze,
        'candidateFreezeSha256': sha(ROOT / 'public/CANDIDATE-FREEZE.json') if args.execute else None,
        'sealSha256': sha(ROOT / 'public/SEAL.json') if args.execute else None,
        'protocolSha256': sha(ROOT / 'public/PROTOCOL.md'),
        'command': command, 'outerSandbox': False, 'nativeCommandSandbox': True,
        'nativeProfileOptions': native_profile_options(workspace),
        'stageTimeoutSeconds': freeze['stageTimeoutSeconds'] if args.execute else None,
        'maximumCodexProcessInvocations': 1, 'automaticRetry': False,
        'inference': 'Existing configured remote model service; generated synthetic markers only',
        'humanTimingStudy': False,
        'systemTempLimitation': 'Installed runtime permits system-temp access despite deny entries. This smoke and all reserved evaluation inputs/keys/outputs stay in protected non-temp trees. No global work-only-write or temp-secrecy guarantee is claimed.',
    }
    dump(records / 'configuration.json', configuration)
    dump(records / 'source-manifest.json', source_manifest)
    dump(records / 'preparation.json', {
        'candidateId': candidate, 'attempt': args.attempt, 'startedAt': started,
        'executeRequested': args.execute, 'inferenceStarted': False,
    })
    # Create these even for a failed preflight or failed process startup.
    (records / 'events.jsonl').touch()
    (records / 'stderr.txt').touch()
    try:
        probe_native_isolation(workspace, records)
    except Exception as error:
        shutil.copytree(workspace, records / 'workspace-snapshot')
        dump(records / 'run.json', {
            'status': 'PREFLIGHT_FAILED', 'candidateId': candidate, 'attempt': args.attempt,
            'inferenceStarted': False, 'codexProcessInvocations': 0, 'error': str(error),
            'startedAt': started, 'finishedAt': now(),
            'wallClockSeconds': round(time.monotonic() - task_clock, 3),
        })
        dump(records / 'artifact-manifest.json', manifest(records))
        print(json.dumps({'status': 'PREFLIGHT_FAILED', 'inferenceStarted': False, 'recordsPath': str(records)}))
        return 1
    dump(records / 'pre-run-workspace-manifest.json', manifest(workspace))
    if not args.execute:
        shutil.copytree(workspace, records / 'workspace-snapshot')
        dump(records / 'run.json', {
            'status': 'PREPARED_ONLY', 'candidateId': candidate, 'attempt': args.attempt,
            'inferenceStarted': False, 'codexProcessInvocations': 0,
            'isolationAndExtractionPreflight': 'passed', 'startedAt': started, 'finishedAt': now(),
            'wallClockSeconds': round(time.monotonic() - task_clock, 3),
        })
        dump(records / 'artifact-manifest.json', manifest(records))
        print(json.dumps({'status': 'PREPARED_ONLY', 'inferenceStarted': False, 'recordsPath': str(records)}))
        return 0

    process_clock = time.monotonic()
    preparation_seconds = process_clock - task_clock
    remaining = freeze['stageTimeoutSeconds'] - preparation_seconds
    timed_out = False
    proc = None
    process_error = None
    try:
        if remaining <= 0:
            raise RuntimeError('Stage budget exhausted during preparation; no inference started')
        with (records / 'events.jsonl').open('w') as out, (records / 'stderr.txt').open('w') as err:
            proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=out, stderr=err,
                                    text=True, start_new_session=True, cwd=workspace)
            dump(records / 'process-started.json', {'pid': proc.pid, 'startedAt': now(), 'remainingSeconds': remaining})
            try:
                proc.communicate(task, timeout=remaining)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
    except Exception as error:
        process_error = str(error)
        if proc is not None and proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
    process_elapsed = time.monotonic() - process_clock
    accounting = summarize_events(records / 'events.jsonl')
    proof = workspace / 'work/proof.txt'
    final_text = final.read_text() if final.is_file() and not final.is_symlink() else None
    verification = {
        'sourceFilesPreserved': manifest(workspace / 'sources') == source_manifest,
        'taskPreserved': sha(workspace / 'TASK.md') == task_hash,
        'proofExactlyMatches': proof.is_file() and not proof.is_symlink() and proof.read_bytes() == (marker['proof_marker'] + '\n').encode(),
        'finalConfirmationMatches': final_text is not None and final_text.strip() == 'SMOKE_OK ' + marker['source_marker'],
        'successfulShellToolReported': accounting['reportedSuccessfulCommandCount'] >= 1,
        'usageReported': bool(accounting['observedUsageEvents']),
        'eventStreamParsed': not accounting['malformedEventLines'],
    }
    passed = (proc is not None and proc.returncode == 0 and not timed_out and
              process_error is None and all(verification.values()))
    result = {
        'status': 'PASSED' if passed else 'FAILED', 'candidateId': candidate, 'attempt': args.attempt,
        'startedAt': started, 'finishedAt': now(),
        'wallClockSeconds': round(time.monotonic() - task_clock, 3),
        'preparationSeconds': round(preparation_seconds, 3),
        'modelAndToolsProcessSeconds': round(process_elapsed, 3),
        'inferenceProcessStarted': proc is not None, 'codexProcessInvocations': int(proc is not None),
        'exitCode': proc.returncode if proc is not None else None,
        'timedOut': timed_out, 'processError': process_error, 'automaticRetry': False,
        'verification': verification, 'outputPresent': bool(final_text and final_text.strip()),
        'monetaryCost': None, 'humanActiveTime': None,
        'postRunWorkspaceManifest': manifest(workspace), **accounting,
    }
    shutil.copytree(workspace, records / 'workspace-snapshot')
    dump(records / 'run.json', result)
    dump(records / 'artifact-manifest.json', manifest(records))
    print(json.dumps({key: result[key] for key in ['status', 'candidateId', 'attempt', 'exitCode', 'timedOut', 'wallClockSeconds', 'verification']}))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
