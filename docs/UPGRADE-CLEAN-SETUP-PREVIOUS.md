# Upgrade candidate: clean setup verification

> Portable derived copy of `docs/UPGRADE-CLEAN-SETUP.md`. Original SHA-256: `143704717743e2ea3c20900a6f80cb9c2322bb1ad9cd8a832ec4f10a25533ddd`. The full authored findings are retained. Only link destinations and this provenance/omission appendix were added or changed. Absolute paths quoted in the original identify workspace evidence; they are not portable download locations.

Verified **upgrade-candidate-1** from a fresh archive extraction and fresh dependency install on this already provisioned macOS host. The install, doctor, all 75 tests, production build, and 24 isolated runtime checks passed. Rebuilding reproduced all eight packaged build files byte for byte. This report does not claim a clean operating-system installation or live model access.

## Scope and identity

- Candidate frozen: **2026-09-24 00:55:40.708271 UTC**.
- Verification began: **2026-09-24 00:59:17.565282 UTC**.
- Isolated runtime checks: **2026-09-24 01:02:47.026408–01:02:48.040861 UTC**.
- Source archive: `/Users/anshul/Documents/Codex/2026-09-23/no/wageproof/release/upgrade-candidate-1/candidate-source.zip`.
- Manifest: `/Users/anshul/Documents/Codex/2026-09-23/no/wageproof/release/upgrade-candidate-1/candidate-freeze.json`.
- Fresh extraction: `/Users/anshul/Documents/Codex/2026-09-23/no/wageproof/work/upgrade/clean-setup/candidate-20260924-po_ge6h1/wageproof`.
- Evidence directory: `/Users/anshul/Documents/Codex/2026-09-23/no/wageproof/work/upgrade/clean-setup/candidate-20260924-po_ge6h1`.

The archive was checked for unsafe member paths before extraction. Its 102 file members matched all 102 manifest entries, with no missing, mismatched, or unmanifested files. The manifest's `dist-upgrade/` paths were mapped to the archive's `dist/` paths. No root frozen source or build files were edited. The original archive remained unchanged.

| Identity | SHA-256 |
| --- | --- |
| Original candidate archive | `0bc4c358cd2eb95deccd75b8dec3a3c98b249d290b2694a60402e9961e7f397a` |
| Frozen source manifest | `22be91972d06f889f02777ea704cad9ba3f402bbb934d34001213f749a29f479` |
| Runtime source identity | `2cbbb664c2e4aae94ba3adcbb1c396ae73ba4ab5ef0d536e5e3474290975d26e` |
| Runtime built-assets aggregate, eight files | `9c1dd99e0e1217a6c06145064efb071acaa98200d39c9020aed786966fe6b6c0` |

## Executed setup

Host: **macOS 27.0, build 26A428, arm64**. Node **v22.20.0**; npm **10.9.3**. Each command below ran from the fresh extracted project. Logs retain the actual command output.

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0; 24 packages added, 25 audited; npm reported zero vulnerabilities. |
| `npm run doctor -- --json` | Exit 0; all eight checked tools available; English OCR data available; no model probe. |
| `npm test` | Exit 0; **75 passed, 0 failed, 0 skipped, 0 cancelled**; Node test duration 12.919 seconds. |
| `npm run build` | Exit 0; Vite 7.3.6 built 43 modules; all eight output files matched the frozen candidate. |

Doctor found Node, Python 3, Codex CLI, Poppler `pdfinfo`, `pdftotext`, `pdfimages`, `pdftoppm`, and Tesseract. It found Tesseract's `eng` language data. Its provider report identified the existing Codex CLI **0.147.0**, model **gpt-6-astra**, provider **azure**, service host **codecli.services.ai.azure.com**, and **high** reasoning effort. It recorded credential/authentication presence only: `liveAccessVerified: false` and `liveModelProbeRun: false`. No credential values were captured.

The test suite's analysis API tests use a test-only fake Codex executable in a temporary PATH and temporary data directories. The suite also exercises actual local PDF/OCR extraction with synthetic fixtures. Passing these tests is not evidence of a live model response. Successful portable export routes, original-byte integrity, revision/selection binding, review state, and recovery are covered by those executed tests.

Rebuilt primary assets:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/assets/index-Ct3qjvkH.js` | 330393 | `5f0d3edebb2e40c8c058c8aecc7f982f771781e5b55de9f9f5f8fb05d4c3e38f` |
| `dist/assets/index-Bwsc99On.css` | 62971 | `c4e280ae26e5e66393dfbae54ab528a9f83c17f6809a29f25c9ee374322b4f94` |
| `dist/index.html` | 429 | `5177b481556718fd75b1bc31bd51f437eb4af8f984a61f287aa21034d67182ae` |

The other five matching files are the two local fonts and three font/license documents. The complete size/hash comparison is preserved in `rebuilt-asset-check.json`. A final check after runtime verification again matched all 102 candidate files to the manifest.

## Isolated runtime results

The service ran from the fresh extraction with `node server/index.mjs`, bound to **127.0.0.1:4327**, with these overrides:

```text
PORT=4327
WAGEPROOF_DATA_DIR=/Users/anshul/Documents/Codex/2026-09-23/no/wageproof/work/upgrade/clean-setup/candidate-20260924-po_ge6h1/runtime-data
WAGEPROOF_DIST_DIR=/Users/anshul/Documents/Codex/2026-09-23/no/wageproof/work/upgrade/clean-setup/candidate-20260924-po_ge6h1/wageproof/dist
WAGEPROOF_RELEASE=upgrade-candidate-1-clean-setup
```

The port was free before startup. The unique data directory did not previously exist, and the initial case list was empty. Existing host model configuration was inherited without changing `HOME` or `CODEX_HOME`. Services or data on ports 4324, 4325, and 4326 were not used.

All **24 checks** in `runtime-check.json` passed:

- Health identified the exact extracted source, launch, data, and build directories. Its source and built-assets hashes matched the frozen candidate, and its provider status continued to report live access as unverified.
- The home page and all eight packaged static files were served byte-identically over localhost, including the local fonts.
- A new fictional case started at unknown claim stage, with no revision or active job. New fictional TXT and CSV evidence imported successfully. Source-read text, downloaded originals, and stored hashes matched the submitted bytes. Byte-identical reimport added no source or version.
- A stale version write returned `409 STALE_VERSION`. A creation request from an unrelated origin returned `403 ORIGIN_REJECTED` and created no case.
- The bundled synthetic mixed text/image PDF imported through real Poppler and Tesseract, retained its consequential scanned figures and identifier, and exposed the OCR/provenance warning. Downloaded PDF bytes matched the original fixture exactly.
- ZIP, preview, HTML, and Markdown exports on an unanalysed case all returned `404 NO_REVISION`. This verified that the service did not fabricate an update. No hand-built revision was inserted to make this test pass.
- All four fictional examples were available. Starting the first example and importing its employer-response phase added the expected one and then four sources, without a revision or analysis job.
- The final case list contained only the two intended fictional test cases. The jobs directory remained empty. The verifier contains an explicit guard against requests to `/analyze`; **zero inference requests** were made.

The tracked process, PID **88571**, received SIGTERM after the checks and exited **0**, without forced termination. Port **4327 was confirmed closed**. Fictional verification data and logs remain in the evidence directory for inspection; no original user/demo case was copied or changed.

## Evidence

- [Archive member verification](#omitted-artifact-1)
- [Fresh dependency install](#omitted-artifact-2)
- [Doctor output](#omitted-artifact-3)
- [All 75 test results](#omitted-artifact-4)
- [Build output](#omitted-artifact-5)
- [Rebuilt asset comparison](#omitted-artifact-6)
- [Health and runtime identity](#omitted-artifact-7)
- [All 24 runtime checks and shutdown evidence](#omitted-artifact-8)
- [Server log](#omitted-artifact-9)
- [Verification script](#omitted-artifact-10)
- [Final candidate integrity check](#omitted-artifact-11)

## What this establishes and leaves unverified

The candidate installs from its lockfile, passes its tests, rebuilds reproducibly, and supports the checked local import/read/export boundaries on this host. No failures occurred in this bounded verification.

This was a fresh extraction and dependency install on an **already provisioned host**, with existing system utilities and model authentication. It does not establish setup on a bare machine, another account, Windows, Linux, or another architecture. No real model request was made, so model availability, account quota, model quality, and end-to-end inference remain outside this report. The synthetic OCR check does not establish accuracy for arbitrary records.

The extracted folder sits below an existing Git worktree. Its reported Git HEAD (`5fbe77a1a47a44ef1b43bd0b4f38cd75a087bad6`) can come from that ancestor; archive and file hashes are the candidate identity evidence, not proof of a standalone Git checkout.

This verifies the frozen evaluation candidate. Final README/documentation packaging, media, final release archive verification, and model evaluation are separate work. No browser review was performed during this clean-setup pass. No push, deployment, upload, submission, purchase, or outreach occurred.


## Omitted raw supporting artifacts

These records remain in the original local workspace. Omission is a portability decision, not a reclassification or deletion of any failure. Directory contents are not packaged or summarized as if independently re-audited; the original reports and included diagnostic JSON retain their recorded hashes and outcomes.

### Omitted artifact 1

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/archive-check.json`.

SHA-256: `f58de2ae241cd3d7219585d18397c70da535cc576cc974537b9290be0f0c662e`; 690 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 2

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/npm-ci.log`.

SHA-256: `71f4ce27b80964ff59618f3e77733c083c31ade34fd4938f604e2a03e9db7314`; 140 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 3

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/doctor.log`.

SHA-256: `d152c58fdfd6449fcaf7d651d9711219928761a34b99c0c0a144307b17092191`; 2626 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 4

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/tests.log`.

SHA-256: `8d5025fb7d711c715bc6a8894ab1a6ebdf78084671f28dbc2db2e1929b96d442`; 18377 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 5

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/build.log`.

SHA-256: `92b3a6be48594bd9bb7c64efb66d925f6128c43fe31da50caddc568a335d8528`; 386 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 6

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/rebuilt-asset-check.json`.

SHA-256: `3f6861e9e16cae83f3db806e9a330b140cf33f3f10defe4da179fe646b935c09`; 2932 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 7

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/health.json`.

SHA-256: `befc14f13ecdf733213a1ba530443f6cf85f3450d40e0e52ac8fe886bf9770cc`; 2203 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 8

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/runtime-check.json`.

SHA-256: `445015d4c7200909166e2ec0338da0163d50cdf46048346f6e895811f773072d`; 11061 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 9

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/server.log`.

SHA-256: `75e11044252ba8b36e013e3ba18c6e9aa2d86f4d3063b3b6d52fcda73b321772`; 46 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 10

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/verify-runtime.py`.

SHA-256: `66bc34dd31daf5d9ac1675cc06f983bca5afb52329bef2f849c732fdbf78127f`; 14765 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 11

Workspace-only file: `work/upgrade/clean-setup/candidate-20260924-po_ge6h1/post-run-integrity.json`.

SHA-256: `938bb8e3d34b3f9a9f17ee71d5331b72f4158458faa7fae5d850dfcf3c1aa84b`; 138 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.
