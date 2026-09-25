# Public source release

This repository publishes the verified `lexhack-requests-2` WageProof source for local execution. It was imported from the preserved source archive with SHA-256 `0e3638adc9d87d471954edcd9f1e2b334062f9df3f0e18c40f7832a681b6d776`. Application code, tests, example data and dependencies retain the released bytes; the publication adds current documentation, gallery assets and ignore rules.

## Commit history

The five public commits organize this release import into runtime scaffolding, accounting/provenance, interface, examples/tests, and documentation. Their timestamps are the actual publication-preparation times. They are not a reconstruction of the original development chronology. The original local Git history is preserved separately.

## Verification

In the publication working copy on the existing macOS host with Node22.20.0:

- `npm ci` completed; its dependency audit reported zero known vulnerabilities. This is a bounded package audit, not a security guarantee.
- `npm test` passed124 tests, with zero failures or skips.
- `npm run doctor -- --inspection` passed without a model request.
- Production build and byte comparison with the eight released assets are recorded in `PUBLICATION-VERIFICATION.json`.
- A bounded text/PDF and screenshot review found no credential files, private case stores or private evaluation answers in the published selection. No comprehensive security or legal assurance is claimed.

These are local checks. No new live model evaluation, worker/practitioner observation or cross-platform validation was performed for publication.

## What is included

The normal app setup,124-test suite, fictional demonstration data, read-only prepared example, original-source inspections, export and saved-request code are included. Use the README for setup. The declared supported environment is macOS; Windows is not supported by the POSIX storage lock and Linux was not independently verified.

The public evaluation summaries preserve the original failures, deterministic repairs and the ordinary comparator's matching results. The evaluation harness and baseline scripts are historical audit references: they include original host paths and depend on omitted private seals/corpus, so they are not an independently runnable public evaluation benchmark. Previously used cases are not fresh evidence.

Generated build output, node_modules, credentials, case storage, private evaluation materials, orchestration state and video binaries are excluded from Git. Font licenses are included. The demo link and gallery are in the README.

## Submission status

Source repository: https://github.com/sudo-anshul/wageproof

Current unlisted demo: https://youtu.be/l9BUFbmUFzg — actual application capture with disclosed Neha AI narration. The organizer asks for the creator's own pitch and says to avoid AI voiceovers. Human narration and final Devpost submission remain pending. There is no public app deployment.

Older release/submission documents are retained as historical snapshots. Their local paths and prior publication status refer to their named stages; this note and the README provide current links.
