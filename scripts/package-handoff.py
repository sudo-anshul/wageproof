#!/usr/bin/env python3
"""Plan or assemble WageProof's explicit, local-only public handoff.

Default mode is read-only. --assemble requires a complete reviewed inventory.
No discovery of media/evaluation files, remote operation, credential copying,
source-archive filtering, or claim of independently passing checks occurs here.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import tempfile
import zipfile
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
REQUIRED_ARTIFACTS = {
    "release-report": "report", "evaluation-report": "report",
    "example-supplement": "export", "recording-ready-video": "media",
    "captions": "media", "timed-script": "media",
}
REQUIRED_CHECKS = {
    "source-build-bound", "local-startup", "functional-regression",
    "rendered-ui", "evaluation-reported", "media-reviewed",
    "public-content-reviewed",
}
FORBIDDEN_PARTS = {
    ".git", ".data", ".hpdlc", "node_modules", "private-authoring",
    "reserved", "credentials", "credential", "secrets", "__pycache__",
}
PUBLIC_ROOT_FILES = {"README.md", "package.json", "package-lock.json", "vite.config.mjs", "index.html", ".gitignore"}
PUBLIC_DOCS = {
    "API.md", "DESIGN.md", "DOMAIN-CONTRACT.md", "DEVELOPMENT-REVIEW.md",
    "INPUT-BOUNDARY-PROBE.md", "INTEGRATION-REVIEW.md", "RETAINED-ACCOUNT-REGRESSION.md",
    "SUBMISSION-DRAFT.md", "UI-REVIEW.md", "UI-REVIEW-API2.md", "HANDOFF-PACKAGING.md",
}
PUBLIC_SCRIPTS = {"dev.mjs", "doctor.mjs", "probe-model.mjs", "snapshot-release.py", "store-lock.py", "package-handoff.py"}
PUBLIC_TEST_FIXTURES = {
    "tests/fixtures/extraction/README.md",
    "tests/fixtures/extraction/text-two-pages.pdf",
    "tests/fixtures/extraction/text-two-pages.expected.txt",
    "tests/fixtures/extraction/mixed-text-and-image-pages.pdf",
    "tests/fixtures/extraction/mixed-text-and-image-same-page.pdf",
    "tests/fixtures/extraction/image-only.pdf",
}
SOURCE_EXTENSIONS = {".js", ".jsx", ".mjs", ".css", ".svg", ".html"}
DIST_EXTENSIONS = {".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2", ".txt", ".json"}
ARTIFACT_EXTENSIONS = {
    "report": {".md", ".txt", ".json", ".html", ".pdf"},
    "export": {".md", ".txt", ".html", ".pdf"},
    "media": {".mp4", ".mov", ".webm", ".srt", ".vtt", ".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".zip"},
}
EXAMPLE_FILES = (
    "examples/01-partial-allocation/phase-0-reviewed-case.md",
    "examples/01-partial-allocation/phase-1-bank.csv",
    "examples/01-partial-allocation/phase-1-earnings-advice.txt",
    "examples/01-partial-allocation/phase-1-response.txt",
    "examples/01-partial-allocation/phase-2-allocation.csv",
    "examples/02-payment-identity/phase-0-reviewed-case.md",
    "examples/02-payment-identity/phase-1-advice.txt",
    "examples/02-payment-identity/phase-1-bank.csv",
    "examples/02-payment-identity/phase-1-mobile-crop.txt",
    "examples/02-payment-identity/phase-1-portal-copy.txt",
    "examples/02-payment-identity/phase-1-response.txt",
    "examples/02-payment-identity/phase-2-bank-export.csv",
    "examples/02-payment-identity/phase-2-second-advice.csv",
    "examples/03-new-issue/phase-0-reviewed-case.md",
    "examples/03-new-issue/phase-1-completion-log.csv",
    "examples/03-new-issue/phase-1-response.txt",
    "examples/03-new-issue/phase-2-worker-and-reviewer-note.txt",
    "examples/04-date-and-support/phase-0-reviewed-case.md",
    "examples/04-date-and-support/phase-1-audit-extract.csv",
    "examples/04-date-and-support/phase-1-response.txt",
    "examples/04-date-and-support/phase-2-complete-row.csv",
)


class PackagingError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_relative(value: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or any(ord(c) < 32 for c in value):
        raise PackagingError(f"Invalid relative path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in value.split("/")) or ":" in value:
        raise PackagingError(f"Path must be a clean, repository-relative path: {value!r}")
    for part in path.parts:
        lower = part.lower()
        if lower in FORBIDDEN_PARTS or lower.startswith((".data-", ".env")):
            raise PackagingError(f"Excluded path: {value}")
        if lower.endswith((".pem", ".key", ".p12", ".pfx", ".sqlite", ".sqlite3", ".db")):
            raise PackagingError(f"Credential/database-like file is excluded: {value}")
    if any(pair in {("evaluation", "baseline"), ("media", "raw")} for pair in zip(path.parts, path.parts[1:])):
        raise PackagingError(f"Raw baseline/media directory is excluded: {value}")
    return path


def regular_file(root: Path, value: str) -> Path:
    relative = safe_relative(value)
    candidate = root.joinpath(*relative.parts)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise PackagingError(f"Symlinks are not packaged: {value}")
    if not candidate.is_file():
        raise PackagingError(f"Missing required file: {value}")
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise PackagingError(f"File escapes the workspace: {value}")
    return candidate


def source_allowed(relative: PurePosixPath, additions: set[str]) -> bool:
    name = relative.as_posix()
    if name in PUBLIC_ROOT_FILES or name in EXAMPLE_FILES or name in PUBLIC_TEST_FIXTURES or name in additions:
        return True
    if len(relative.parts) == 2 and relative.parts[0] == "docs" and relative.name in PUBLIC_DOCS:
        return True
    if len(relative.parts) == 2 and relative.parts[0] == "scripts" and relative.name in PUBLIC_SCRIPTS:
        return True
    return len(relative.parts) >= 2 and relative.parts[0] in {"src", "server", "domain", "tests", "public"} and relative.suffix.lower() in SOURCE_EXTENSIONS


def inspect_zip(archive: Path, root: Path, additions: set[str], source: bool) -> list[str]:
    """Inspect all members; never extract, drop members silently, or follow links."""
    members, names = [], set()
    total_size = 0
    with zipfile.ZipFile(archive) as bundle:
        if len(bundle.infolist()) > 20000:
            raise PackagingError(f"Archive has too many entries: {archive.name}")
        for entry in bundle.infolist():
            name = entry.filename.rstrip("/")
            if not name:
                continue
            relative = safe_relative(name)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or (mode and stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}):
                raise PackagingError(f"Archive contains a link/special entry: {name}")
            if entry.flag_bits & 1:
                raise PackagingError(f"Encrypted archive entry cannot be reviewed: {name}")
            if entry.is_dir():
                continue
            if name in names:
                raise PackagingError(f"Duplicate archive member: {name}")
            names.add(name)
            total_size += entry.file_size
            if total_size > 512 * 1024 * 1024:
                raise PackagingError(f"Uncompressed archive exceeds the explicit 512 MiB source/project limit: {archive.name}")
            if source:
                if relative.parts[0] != "wageproof" or len(relative.parts) < 2:
                    raise PackagingError("Public source archive must use the wageproof/ prefix.")
                relative = PurePosixPath(*relative.parts[1:])
                safe_relative(relative.as_posix())
                if not source_allowed(relative, additions):
                    raise PackagingError(f"Unapproved public-source archive member: {relative}. Supply a reviewed public-only archive; this script will not filter it silently.")
                local = regular_file(root, relative.as_posix())
                if hashlib.sha256(bundle.read(entry)).hexdigest() != sha256(local):
                    raise PackagingError(f"Archived source differs from the current workspace: {relative}")
            members.append(relative.as_posix())
        corrupt = bundle.testzip()
        if corrupt:
            raise PackagingError(f"Corrupt archive entry: {corrupt}")
    return sorted(members)


def audit_report_links(root: Path, entries: list[dict], declarations: object) -> tuple[list[dict], list[str]]:
    """Check simple Markdown file links without copying their targets or rewriting evidence."""
    problems, local_only = [], []
    if not isinstance(declarations, list):
        return [], ["local_only_links must be an array of exact report-link declarations."]
    excluded = {}
    for item in declarations:
        if not isinstance(item, dict) or any(not isinstance(item.get(key), str) or not item[key].strip() for key in ("artifact_id", "href", "reason")):
            problems.append("Each local_only_links declaration needs artifact_id, href and a factual reason.")
            continue
        key = (item["artifact_id"], item["href"])
        if key in excluded:
            problems.append(f"Duplicate local-only link declaration: {key}")
        excluded[key] = item
    destinations = {entry["path"] for entry in entries}
    encountered = set()
    for entry in entries:
        if entry["kind"] != "report" or entry["source"].suffix.lower() != ".md":
            continue
        source_name = entry["source"].relative_to(root).as_posix()
        for match in re.finditer(r"\]\((<[^>]+>|[^)\n]+)\)", entry["source"].read_text(encoding="utf-8")):
            href = match.group(1).strip().removeprefix("<").removesuffix(">")
            parsed = urlsplit(href)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            target = posixpath.normpath(posixpath.join(posixpath.dirname(entry["path"]), unquote(parsed.path)))
            key = (entry["id"], href)
            if target in destinations:
                if key in excluded:
                    problems.append(f"Local-only declaration points to an included file: {entry['id']} → {href}")
                    encountered.add(key)
                continue
            if key not in excluded:
                problems.append(f"Report link has no packaged target or explicit retained-local classification: {entry['id']} → {href}")
                continue
            encountered.add(key)
            original_target = posixpath.normpath(posixpath.join(posixpath.dirname(source_name), unquote(parsed.path)))
            first = original_target.split("/", 1)[0]
            is_local_evidence = first == ".data" or first.startswith(".data-") or original_target.startswith(("work/", "evaluation/runs/", "evaluation/baseline/", "evaluation/reserved/", "evaluation/private-authoring/", "media/raw/"))
            if not is_local_evidence:
                problems.append(f"Missing public dependency cannot be excused as retained-local evidence: {entry['id']} → {href}")
                continue
            local_only.append({**excluded[key], "report_path": entry["path"], "retained_path": original_target})
    for key in excluded.keys() - encountered:
        problems.append(f"Local-only declaration does not match a missing Markdown report link: {key}")
    return local_only, problems


def make_plan(root: Path, label: str, spec: dict) -> dict:
    problems, entries = [], []
    if not SLUG.fullmatch(label):
        raise PackagingError("Label must be 1–64 lowercase letters/digits/hyphens/underscores, starting with a letter or digit.")
    if not isinstance(spec, dict):
        raise PackagingError("The specification must be a JSON object.")
    ref = spec.get("release_ref", "")
    if not isinstance(ref, str) or not re.fullmatch(r"[0-9a-f]{40}", ref):
        problems.append("release_ref must identify the full 40-character source commit.")
    if spec.get("narration_status") != "recording-ready-human-narration-pending":
        problems.append("narration_status must be recording-ready-human-narration-pending for this authorized handoff.")
    blockers = spec.get("open_blockers")
    if not isinstance(blockers, list) or blockers:
        problems.append("open_blockers must be an explicitly empty array after required work is complete.")
    limitations = spec.get("limitations")
    if not isinstance(limitations, list) or not limitations or any(not isinstance(x, str) or not x.strip() for x in limitations):
        problems.append("Supply explicit nonempty limitations, including human narration and validation limits.")
    artifacts = spec.get("artifacts", [])
    if not isinstance(artifacts, list):
        raise PackagingError("artifacts must be an explicit array of files.")
    by_id = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            problems.append("Each artifact must be an object.")
            continue
        key, kind = artifact.get("id", ""), artifact.get("kind", "")
        if not isinstance(key, str) or not SLUG.fullmatch(key) or key in by_id:
            problems.append(f"Artifact has invalid/duplicate id: {key!r}")
            continue
        by_id[key] = artifact
        if not isinstance(kind, str) or kind not in ARTIFACT_EXTENSIONS:
            problems.append(f"Artifact {key}: kind must be report, export or media.")
            continue
        try:
            path = regular_file(root, artifact.get("path", ""))
            relative = path.relative_to(root)
            if path.stat().st_size == 0:
                raise PackagingError(f"Artifact {key} is empty.")
            if path.suffix.lower() not in ARTIFACT_EXTENSIONS[kind]:
                raise PackagingError(f"Artifact {key}: extension is not allowed for {kind}.")
            if kind == "report" and not (relative.parts[0] == "docs" or relative.parts[:2] == ("evaluation", "public")):
                raise PackagingError(f"Report {key} must be an explicitly reviewed file in docs/ or evaluation/public/.")
            if kind == "media" and relative.parts[0] != "media":
                raise PackagingError(f"Media {key} must come from an explicit file in media/ (not raw/).")
            if path.suffix.lower() == ".zip":
                inspect_zip(path, root, set(), source=False)
            directory = {"report": "reports", "export": "exports", "media": "media"}[kind]
            destination = f"reports/{relative.as_posix()}" if kind == "report" else f"{directory}/{key}{path.suffix.lower()}"
            entries.append({"source": path, "path": destination, "id": key, "kind": kind, "title": str(artifact.get("title") or key.replace("-", " ")).strip()})
        except (PackagingError, zipfile.BadZipFile) as error:
            problems.append(str(error))
    for key, kind in REQUIRED_ARTIFACTS.items():
        if key not in by_id or by_id[key].get("kind") != kind:
            problems.append(f"Required reviewed artifact missing: {key} ({kind}).")
    extension_requirements = {
        "recording-ready-video": {".mp4", ".mov", ".webm"},
        "captions": {".srt", ".vtt"}, "timed-script": {".md", ".txt", ".pdf"},
    }
    for key, allowed in extension_requirements.items():
        if key in by_id and Path(str(by_id[key].get("path", ""))).suffix.lower() not in allowed:
            problems.append(f"Required artifact {key} has the wrong file type.")
    checks = spec.get("checks", [])
    check_ids = set()
    if not isinstance(checks, list):
        checks = []
        problems.append("checks must be an explicit array of recorded outcomes.")
    for check in checks:
        if not isinstance(check, dict):
            problems.append("Each check must be an object.")
            continue
        key = check.get("id")
        if not isinstance(key, str) or not SLUG.fullmatch(key):
            problems.append(f"Check has an invalid id: {key!r}")
            continue
        if key in check_ids:
            problems.append(f"Duplicate check: {key}")
        check_ids.add(key)
        if check.get("status") != "passed":
            problems.append(f"Check is not complete/passed: {key}")
        evidence = check.get("evidence", [])
        if not isinstance(evidence, list) or not evidence or any(not isinstance(v, str) or v not in by_id for v in evidence):
            problems.append(f"Check {key} must cite packaged artifact ids as evidence.")
        if not isinstance(check.get("note"), str) or not check["note"].strip():
            problems.append(f"Check {key} needs a factual note describing what actually passed.")
    for key in sorted(REQUIRED_CHECKS - check_ids):
        problems.append(f"Required completion check missing: {key}")

    additions = set()
    supplied_additions = spec.get("additional_public_source_files", [])
    if not isinstance(supplied_additions, list):
        problems.append("additional_public_source_files must be an array of exact reviewed file paths.")
        supplied_additions = []
    for value in supplied_additions:
        try:
            safe = safe_relative(value)
            if safe.parts[0] not in {"docs", "evaluation", "scripts"} or (safe.parts[0] == "evaluation" and safe.parts[:2] != ("evaluation", "public")):
                raise PackagingError(f"Additional public source file must be a specific reviewed docs/scripts/evaluation/public file: {value}")
            additions.add(safe.as_posix())
        except PackagingError as error:
            problems.append(str(error))

    source_members, source_manifest, archive_digest = [], {}, ""
    try:
        archive = regular_file(root, spec.get("source_archive", ""))
        manifest_file = regular_file(root, spec.get("release_manifest", ""))
        if archive.suffix.lower() != ".zip":
            raise PackagingError("source_archive must be a ZIP file.")
        source_manifest = json.loads(manifest_file.read_text())
        if not isinstance(source_manifest, dict) or not isinstance(source_manifest.get("files"), list):
            source_manifest = {}
            raise PackagingError("release_manifest must be an object with a files array.")
        if source_manifest.get("git_ref") != ref:
            raise PackagingError("release_manifest.git_ref does not match release_ref.")
        archive_digest = sha256(archive)
        if source_manifest.get("source_archive_sha256") != archive_digest:
            raise PackagingError("Source archive SHA-256 differs from the release manifest.")
        source_members = inspect_zip(archive, root, additions, source=True)
        mandatory = {"README.md", "package.json", "package-lock.json", "index.html", "vite.config.mjs", "server/index.mjs", "src/App.jsx", "domain/index.mjs", "scripts/dev.mjs", "scripts/doctor.mjs", "scripts/store-lock.py", *EXAMPLE_FILES}
        # A valid-looking but incomplete source ZIP cannot reproduce this app.
        # Enumerate only known runtime trees, never evaluation or evidence trees.
        for directory_name in ("src", "server", "domain", "public"):
            directory = root / directory_name
            if directory.is_symlink():
                raise PackagingError(f"Runtime tree contains a symlink: {directory_name}")
            if directory.is_dir():
                for parent, subdirs, filenames in os.walk(directory, followlinks=False):
                    for name in subdirs + filenames:
                        file = Path(parent) / name
                        if file.is_symlink():
                            raise PackagingError(f"Runtime tree contains a symlink: {file.relative_to(root)}")
                    mandatory.update((Path(parent) / name).relative_to(root).as_posix() for name in filenames)
        if "tests/extract.test.mjs" in source_members:
            mandatory.update(PUBLIC_TEST_FIXTURES)
        if missing := mandatory - set(source_members):
            raise PackagingError("Public source archive is missing required entries: " + ", ".join(sorted(missing)))
        entries.extend([
            {"source": archive, "path": "source/wageproof-source.zip", "id": "source-archive", "kind": "source", "title": "Public application source"},
            {"source": manifest_file, "path": "source/release-manifest.json", "id": "release-manifest", "kind": "source", "title": "Source/build release manifest"},
        ])
    except (PackagingError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        problems.append(str(error))

    declared_dist = {}
    for value in source_manifest.get("files", []):
        if not isinstance(value, dict) or not str(value.get("path", "")).startswith("dist/"):
            continue
        try:
            source = regular_file(root, value["path"])
            if source.suffix.lower() not in DIST_EXTENSIONS or source.name.endswith(".map"):
                raise PackagingError(f"Unexpected built artifact: {value['path']}")
            if value["path"] in declared_dist:
                raise PackagingError(f"Duplicate build-manifest path: {value['path']}")
            if sha256(source) != value.get("sha256"):
                raise PackagingError(f"Built file changed since release manifest: {value['path']}")
            declared_dist[value["path"]] = source
            entries.append({"source": source, "path": "app/" + value["path"], "id": value["path"], "kind": "build", "title": value["path"]})
        except PackagingError as error:
            problems.append(str(error))
    if "dist/index.html" not in declared_dist:
        problems.append("Release manifest must bind the current dist/index.html and all built assets.")
    # Enumerate only the intentionally included build tree, to detect unbound extras.
    actual_dist = set()
    if (root / "dist").is_dir():
        for directory, subdirs, filenames in os.walk(root / "dist", followlinks=False):
            for name in subdirs + filenames:
                child = Path(directory) / name
                if child.is_symlink():
                    problems.append(f"Build tree contains a symlink: {child.relative_to(root)}")
            actual_dist.update((Path(directory) / name).relative_to(root).as_posix() for name in filenames)
    if actual_dist != set(declared_dist):
        problems.append("Current dist file inventory does not exactly match the release manifest.")
    for name in EXAMPLE_FILES:
        try:
            entries.append({"source": regular_file(root, name), "path": name, "id": name, "kind": "example", "title": name})
        except PackagingError as error:
            problems.append(str(error))
    destinations = [entry["path"] for entry in entries]
    if len(destinations) != len(set(destinations)):
        problems.append("Two inputs would occupy the same handoff path.")
    local_only_links, link_problems = audit_report_links(root, entries, spec.get("local_only_links", []))
    problems.extend(link_problems)
    output = root / "release" / label / "handoff"
    for directory in (output.parent.parent, output.parent, output):
        if directory.is_symlink():
            problems.append(f"Output path contains a symlink: {directory.relative_to(root)}")
    if output.exists():
        problems.append(f"Refusing to replace existing handoff: {output.relative_to(root)}")
    for entry in entries:
        if entry["source"].resolve().is_relative_to(output.resolve()):
            problems.append("An input cannot come from the handoff being assembled.")
        entry["sha256"] = sha256(entry["source"])
        entry["bytes"] = entry["source"].stat().st_size
    return {"label": label, "release_ref": ref, "entries": entries, "problems": list(dict.fromkeys(problems)), "source_members": source_members, "source_archive_sha256": archive_digest, "checks": checks, "limitations": limitations or [], "local_only_links": local_only_links, "output": output}


def readable_index(plan: dict) -> tuple[str, str]:
    selected = [e for e in plan["entries"] if e["kind"] not in {"build", "example"}]
    links = "\n".join(f"- [{e['title']}]({quote(e['path'])})" for e in selected)
    limits = "\n".join(f"- {value}" for value in plan["limitations"])
    examples = "\n".join(f"- [{name.split('/')[1]}]({quote(name)})" for name in EXAMPLE_FILES if "phase-0" in name)
    retained = "\n".join(f"- [{item['artifact_id']}]({quote(item['report_path'])}) cites `{item['href']}`: {item['reason']}" for item in plan["local_only_links"]) or "No Markdown report links were declared as retained-local references."
    readme = f"""# WageProof local handoff — {plan['label']}

Source release: `{plan['release_ref']}`. This is a local recording-ready handoff. It has not been published or submitted.

## Start here

{links}

The video is a **recording-ready cut**. Record the user's own narration from the timed script; do not treat this as an already human-narrated submission.

## Run the application

Unzip `source/wageproof-source.zip`, open the `wageproof/` directory and follow its README. With the documented local prerequisites, run `npm ci`, `npm run doctor`, `npm run build`, then `npm start`. Open `http://127.0.0.1:4318`.

The already-built browser assets are retained in `app/dist/`. They require the local API/server; opening `index.html` as a file is not a substitute for running the application. Model inference uses the configured Codex model service and is not offline. No credentials are bundled.

## Fictional development examples

{examples}

These are the known synthetic development inputs, copied as an exact explicit inventory. No private records, reserved evaluator inputs, evaluator answer keys or raw baseline runs are included. The source archive may include public synthetic extraction regression fixtures and their expected text so its tests can run. Revisions/exports identify their own sources; original-download URLs in exported documents refer to a running local instance and are not portable access to someone else's computer.

## Remaining limitations

{limits}

## References to retained local evidence

{retained}

These references remain unchanged in the reports. Their targets are deliberately absent from this portable handoff; they are not missing public report dependencies and do not give a recipient access to local case storage.

## Integrity and evidence

`manifest.json` records copied-file hashes and the release checks declared in the supplied specification. The packager verifies paths, archive members, current-source equality, build hashes and completeness; it does not independently perform model evaluation, legal review, usability testing or media review. Check evidence is in the linked reports.

`SHA256SUMS` covers all package files except itself, including `manifest.json`. Verify locally from this directory with `shasum -a 256 -c SHA256SUMS` (or `sha256sum -c SHA256SUMS`). The manifest's file list excludes itself and `SHA256SUMS` to avoid circular hashes.
"""
    rows = "".join(f"<tr><td>{html.escape(e['kind'])}</td><td><a href=\"{quote(e['path'])}\">{html.escape(e['title'])}</a></td><td>{e['bytes']:,}</td></tr>" for e in selected)
    example_links = "".join(f"<li><a href=\"{quote(name)}\">{html.escape(name.split('/')[1])}</a></li>" for name in EXAMPLE_FILES if "phase-0" in name)
    limit_html = "".join(f"<li>{html.escape(value)}</li>" for value in plan["limitations"])
    index = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>WageProof local handoff</title><style>body{{font:16px/1.6 system-ui,sans-serif;max-width:950px;margin:45px auto;padding:0 24px;color:#173b38;background:#f8f6f0}}h1{{font:38px/1.2 Georgia,serif}}h2{{font-size:21px;margin-top:36px}}a{{color:#17675d}}table{{width:100%;border-collapse:collapse}}th,td{{padding:12px 10px;text-align:left;border-bottom:1px solid #cfd9cb;overflow-wrap:anywhere}}code{{overflow-wrap:anywhere}}.note{{padding:18px;background:#eaf0e3;border-left:3px solid #56744b}}@media(max-width:550px){{body{{font-size:14px}}h1{{font-size:29px}}th,td{{padding:9px 5px}}}}</style></head><body><h1>WageProof local handoff</h1><p>{html.escape(plan['label'])} · source <code>{html.escape(plan['release_ref'])}</code></p><p class="note">Recording-ready cut. The user's human narration remains to be recorded. Nothing in this package has been published or submitted.</p><table><thead><tr><th>Kind</th><th>Artifact</th><th>Bytes</th></tr></thead><tbody>{rows}</tbody></table><h2>Run locally</h2><p>Unzip the source archive and follow its README. The built files in <code>app/dist/</code> need the local API server. Model analysis uses the configured model service; it is not offline. No credentials are bundled.</p><p><a href="README.md">Complete handoff instructions</a> · <a href="manifest.json">File and evidence manifest</a> · <a href="SHA256SUMS">SHA-256 checksums</a></p><h2>Fictional development examples</h2><ul>{example_links}</ul><h2>Limitations</h2><ul>{limit_html}</ul><p>Packaging checks completeness and bytes. It does not establish the quality or correctness of the linked reports' conclusions.</p></body></html>"""
    return readme, index


def assemble(plan: dict, make_zip: bool) -> dict:
    if plan["problems"]:
        raise PackagingError("The inventory is incomplete; no handoff was assembled.")
    output = plan["output"]
    archive_output = output.parent / "handoff.zip"
    if output.exists() or output.is_symlink():
        raise PackagingError("Refusing to replace an existing handoff.")
    if any(directory.is_symlink() for directory in (output.parent, output.parent.parent)):
        raise PackagingError("Output path acquired a symlink after preflight.")
    if make_zip and (archive_output.exists() or archive_output.with_suffix(".zip.sha256").exists()):
        raise PackagingError("Refusing to replace an existing handoff ZIP/checksum.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".handoff-stage-", dir=output.parent) as temporary:
        stage = Path(temporary) / "handoff"
        stage.mkdir()
        rows = []
        for entry in plan["entries"]:
            if sha256(entry["source"]) != entry["sha256"]:
                raise PackagingError(f"Input changed after preflight: {entry['source']}")
            destination = stage / entry["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(entry["source"], destination)
            if sha256(destination) != entry["sha256"]:
                raise PackagingError(f"Copied file failed integrity check: {entry['path']}")
            rows.append({key: entry[key] for key in ("path", "id", "kind", "title", "sha256", "bytes")})
        readme, index = readable_index(plan)
        for name, body in [("README.md", readme), ("index.html", index)]:
            file = stage / name
            file.write_text(body, encoding="utf-8")
            rows.append({"path": name, "id": name, "kind": "index", "title": name, "sha256": sha256(file), "bytes": file.stat().st_size})
        manifest = {
            "schema_version": 1, "label": plan["label"], "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "release_ref": plan["release_ref"], "source_archive_sha256": plan["source_archive_sha256"],
            "public_source_members": plan["source_members"], "narration_status": "recording-ready-human-narration-pending",
            "declared_release_checks": plan["checks"], "limitations": plan["limitations"],
            "retained_local_report_links": plan["local_only_links"],
            "publication": "Local files only; no remote Git operation, deployment, upload or submission.",
            "coverage": "files excludes manifest.json and SHA256SUMS; SHA256SUMS includes manifest.json and excludes itself.",
            "files": sorted(rows, key=lambda row: row["path"]),
        }
        manifest_path = stage / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        checksum_rows = [(row["path"], row["sha256"]) for row in rows] + [("manifest.json", sha256(manifest_path))]
        (stage / "SHA256SUMS").write_text("".join(f"{digest}  {name}\n" for name, digest in sorted(checksum_rows)), encoding="utf-8")
        temporary_zip = Path(temporary) / "handoff.zip"
        if make_zip:
            with zipfile.ZipFile(temporary_zip, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                for name, _ in sorted(checksum_rows):
                    bundle.write(stage / name, f"handoff/{name}")
                bundle.write(stage / "SHA256SUMS", "handoff/SHA256SUMS")
            with zipfile.ZipFile(temporary_zip) as bundle:
                if bundle.testzip():
                    raise PackagingError("Handoff ZIP integrity check failed.")
        stage.rename(output)
        result = {"handoff": str(output), "files": len(checksum_rows) + 1, "manifest_sha256": sha256(output / "manifest.json")}
        if make_zip:
            temporary_zip.rename(archive_output)
            digest = sha256(archive_output)
            archive_output.with_suffix(".zip.sha256").write_text(f"{digest}  {archive_output.name}\n", encoding="utf-8")
            result.update({"zip": str(archive_output), "zip_sha256": digest})
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("label", help="Final release label; output is release/<label>/handoff/.")
    parser.add_argument("--spec", required=True, help="Repository-relative explicit reviewed inventory JSON.")
    parser.add_argument("--assemble", action="store_true", help="Write only after the full inventory passes; default is read-only preflight.")
    parser.add_argument("--zip", action="store_true", help="Also create release/<label>/handoff.zip when assembling.")
    args = parser.parse_args()
    try:
        spec_path = regular_file(ROOT, args.spec)
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        plan = make_plan(ROOT, args.label, spec)
        if not args.assemble or plan["problems"]:
            print(json.dumps({"mode": "preflight", "ready": not plan["problems"], "output": str(plan["output"]), "files": [{k: e[k] for k in ("path", "id", "kind", "bytes", "sha256")} for e in plan["entries"]], "missing_or_blocked": plan["problems"], "written": False}, indent=2))
            return 2 if plan["problems"] else 0
        print(json.dumps(assemble(plan, args.zip), indent=2))
        return 0
    except (PackagingError, OSError, json.JSONDecodeError, zipfile.BadZipFile, TypeError) as error:
        # A disk error can happen after the assembled directory was committed.
        # Do not falsely promise that nothing was written on this path.
        print(json.dumps({"error": str(error), "mode": "assembly" if args.assemble else "preflight", "assembly_attempted": bool(args.assemble)}, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
