# Portable update and runtime support review

24 September 2026 · Local implementation · No inference or publishing

## Delivered contracts

`server/export-bundle.mjs` exports:

```js
await createExportBundle({
  caseRecord,          // snapshot; cloned before the first await
  revision,            // selected revision; cloned before the first await
  selectedSourceIds,   // undefined = cited originals; [] = omit all originals
  // readOriginal, maxBytes and generatedAt are optional test/internal controls
})
// { buffer, files, manifest, filename,
//   summaryMarkdown, summaryHtml, supplementMarkdown, supplementHtml }
```

`files` is the same internal array used to create the ZIP, with `{path, bytes, role}` entries. It adds no buffer copies. A preview endpoint may serve only an exact member of this generated array and rewrite local navigation to a revision/selection-bound preview route. Portable relative URLs must not be served unmodified under `/api/.../export` because those adjacent package files do not exist there. Root owns endpoint selection, MIME headers and preview link mapping.

The helper uses `renderSupplement({caseRecord,revision,sourceLinkResolver})`; the optional resolver receives `{sourceId,source,citation}` and returns a generated relative original path or `null` for an omitted original. Root supplied this additive integration. Live supplement behavior remains its default.

`domain/portable.mjs` exports citation collection, revision export status, short-update rendering, a restricted Markdown-to-HTML renderer, evidence-index rendering and exact extracted-line rendering. Direct `renderShortUpdate` callers must provide actual source entries for usable links; the bundle is the complete artifact path.

## Packet behavior

The ZIP contains `update.html/.md`, `supplement.html/.md`, `evidence.html/.md`, `manifest.json`, selected immutable original bytes, exact UTF-8 extracted-text companions and numbered HTML line readers. Line IDs correspond to retained extraction, including trailing empty lines. They do not identify original PDF bounding boxes. Both short and full documents retain scope, unknowns, source interpretation limits and reviewed/draft/historical/stale distinctions.

The short update derives payment amounts and weekly results from the stored calculation. It includes the named prior-reviewed weekly difference when that baseline is available; otherwise it labels the pre-correction account explicitly. Allocation and remaining differences have separate columns. It prioritizes a disputed employer position, labels it an attributed paraphrase with its assessed coverage, and retains specific open/partly-answered questions and external information requests. Full model summaries and all additional positions remain in the detailed supplement. Source-inspection and sending-the-update controls are not reprinted as generic evidence requests. Routing uncertainty remains explicit.

The original three-revision fictional demo was read, rendered in memory and left unchanged. Its revision-3 opening was approximately **343 words before the final paraphrase-label cleanup**. It exposed `$20–$80 → $55`, `$0–$60 → $25`, the `$25/$35` gross allocation, the unchanged `$80` combined difference, payroll's unsupported full-correction position and the outstanding payroll reconciliation request. This is a reading/packaging check, not fresh inference or independent semantic evaluation. Review/package boilerplate begins at a print page break; actual printed pagination still needs final rendered inspection.

Defaults include every cited source in the selected analysis. Explicit selections can include other context from that revision. Missing selections are listed, and cited omissions are prominent. Sources outside `revision.sourceIds` cannot be selected or cited. Later-source names, bytes and extracted text, current intake fallback values, job logs, prompts, model credentials and unrelated case metadata are excluded. Quoted spans in the detailed supplement remain even when their original is omitted; the evidence index states that the recipient cannot inspect that omitted original from the packet.

The helper verifies selected original SHA-256 values and checks cited spans against the retained extraction before packaging. A missing or changed original, invalid citation, unsafe source ID or out-of-snapshot source rejects export. Generated numbered filenames avoid traversal and case-insensitive collisions. The ZIP is bounded to **128 MiB**, uses stored entries with CRC-32, and needs no new package or external archive process. It is ZIP32, not a general archive platform.

HTML escapes raw markup, disables remote images, restricts hyperlinks to generated package paths/anchors and two pinned official DLSE pages, and carries a restrictive content-security policy. Originals remain byte-identical rather than being rewritten. File hashes establish integrity, not authenticity or legal correctness.

## Attempt telemetry and diagnostics

`runModel` keeps its `{analysis,metadata}` return and adds an optional async `onMetadata(metadata)` callback. The callback runs once for completed, output-failed, process-failed, timed-out and cancelled attempts, including pre-aborted attempts. Thrown errors expose the same object as `error.modelMetadata`. Each attempt directory receives `attempt-metadata.json`, alongside the existing local prompt, structured response and bounded process logs.

Metadata version 2 includes `startedAt`, `modelStartedAt`, `completedAt`, `durationMs`, `processDurationMs`, `status`, `errorCode`, process exit/signal, timeout, byte counts and allowlisted observed usage. `durationMs` covers preparation through response parsing; `processDurationMs` covers the spawned CLI interval. Final metadata persistence/callback time is included in the caller's whole-job timing, not retroactively added to the attempt record. Monetary cost remains null. Missing usage remains null. Model tools and MCP servers remain disabled using the existing controls; no lower-effort experiment or inference reuse was added.

Root owns the full job attempt ledger, validation status, queue/commit/whole-job timing, cancellation-safe callback persistence and `createdByJobId` crash receipt. The callback reloads cancellation state; it must not revive a cancelled job. Receipt recovery distinguishes a saved revision from an interrupted pre-commit attempt. It is not a power-loss durability guarantee.

`providerIdentity`/`providerStatus` report only allowlisted model/provider identity and local credential-presence bits. They do not expose auth contents, headers, endpoint query strings or environment credential values. Local presence is not successful authentication. No model request is launched by these checks.

`runtimeIdentity()` returns source/build hashes, launch/source/data directories, process identity and the actual build directory. **`WAGEPROOF_DIST_DIR` is respected**; a staged build is not mislabeled as the default `dist`. The doctor reports executable availability, English Tesseract data, configuration/local-auth evidence and runtime identity. `node scripts/doctor.mjs --json` provides structured output. The inspected host had all required executables and English OCR data; live model access remained explicitly unverified. The supported setup is macOS. Other POSIX setup remains unverified; Windows is unsupported by the POSIX lock.

## Verification and limits

`node --test tests/portable.test.mjs` passes **9/9** focused tests:

- Original/extracted bytes and every manifest hash; Python's independent ZIP reader validates archive CRCs; every generated HTML file/line link resolves within the packet.
- Referenced defaults, explicit omissions and absence of later/private intake/job markers.
- Missing/changed originals, changed extracted citation text, out-of-snapshot citations, traversal, filename collisions and bounded size failures.
- A frozen export during caller mutation, factual-only unknown totals and a known subtotal that excludes an unknown outside balance.
- Markup/link escaping and offline content restrictions.
- Exact `$55/$25` current results against prior reviewed linked ranges, `$25/$35` allocations, unchanged `$80`, employer coverage and the continuing payroll request.
- Actual selected-build path/hash identity.
- Pre-commit versus post-commit restart recovery and repeat-recovery idempotence with isolated stores.
- Success, invalid output, timeout and cancellation attempt records with an explicitly fake CLI; no real inference.

The combined transport/state run, `node --test tests/portable.test.mjs tests/server.test.mjs`, passed **17/17**, including existing stale edits, cancellation, restart and duplicate-server behavior after the model adapter changed.

The first focused run exposed two test assertions that expected unescaped Markdown; those assertions now inspect rendered text. No semantic failure was hidden or relabeled. The tests do not establish general document interpretation accuracy, agency acceptance, field usefulness or competition outcomes. The final integrated preview/UI, actual-release packaging and human recording cut remain the parent task's release work.

## Integrated packet follow-up — 24 September 2026

The earlier word-count and print-pending paragraphs describe this lane before final integration. Root subsequently shortened the known fictional revision-3 opening to **275 words**, retained the payment, employer position, before/after weekly schedule and outstanding request, and moved the detailed coverage discussion to the supplement. An actual A4 print check places the useful update on page one and evidence/review record on page two. The full packet remains longer.

The extracted ZIP was opened in a separate directory: **25 members**, **24 manifest-listed file hashes**, **207 relative links/anchors** and **6 original files** passed the bounded checks. Only the pinned official contextual link is external. Evidence is in `work/upgrade/packet-check-v3/`. The original demo case file remained unchanged. These are output/layout checks of known development material; fresh model evaluation is separate.

## Fresh diagnostic and final renderer follow-up — 24 September 2026

The preceding 275-word opening describes an earlier known example, not a universal output limit. Fresh D2 evaluation exposed a material omission: the short update dropped the newly supplied service dates while the model account and detailed supplement retained them. The preserved failure and repair are documented in `docs/UPGRADE-EXPORT-REPAIR.md`.

The final renderer retains new and changed attributed positions relative to the selected revision's named reviewed baseline, preserves unresolved earlier positions and includes assessment changes even when the quoted statement is unchanged. One changed assessment leads the opening; further coverage discussion follows the payment, schedule and requests. No fixture-specific dates or amounts were inserted into the renderer.

Candidate 2's integrated suite passed **77/77**. Actual A4 page-one inspection retained the material dates, payment, unknown balance and requests in the D2 opening (**380 words**) and the useful facts and requests in the fresh fictional demo opening (**322 words**). Both full documents are longer. Independent content and temporal-boundary rechecks passed, including absence of later review/intake leakage into the selected older revision. These checks are renderer regression evidence, not fresh model or worker validation.

Candidate 3 amends evaluation tooling only. Its application and build bytes match candidate 2, as recorded in `work/upgrade/candidate3-equality.json`. Model comparison and final-source setup outcomes remain separately recorded release evidence.

## Candidate 4 factual-output repair

Primary technical evaluation exposed one material omission of a new work issue in the short artifact and two minor obsolete-request-title findings. Candidate 4 retains all new/changed active issues and outward requests with their current detail, distinguishes partly answered requests, and applies the same non-truncation rule to changed payments and periods. Unchanged context can still be summarized. The full repair history and length/scope tradeoffs are in `docs/UPGRADE-EXPORT-REPAIR.md`.

The integrated suite now passes **80/80**. The frozen candidate-4 product differs from candidate 3 only in the deterministic renderer, selected baseline projection and portable tests; client build assets are unchanged. The known four regenerated updates occupy three or four printed A4 pages, replacing the earlier short-opening measurements. No model run or case revision was changed by this repair. Final regression, fresh reserve cases, exact-source setup and media checks retain their own evidence boundaries.
