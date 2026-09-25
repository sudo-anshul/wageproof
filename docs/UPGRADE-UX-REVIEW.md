# WageProof upgrade experience review

> Portable derived copy of `docs/UPGRADE-UX-REVIEW.md`. Original SHA-256: `ce3b2ec6457f66ee0cb58e74ae1732cfc20af39cba61e7345479fb0d8122ed5c`. The full authored findings are retained. Only link destinations and this provenance/omission appendix were added or changed. Absolute paths quoted in the original identify workspace evidence; they are not portable download locations.

24 September 2026 · Alina interface implementation and rendered review · local fictional data

## Outcome and scope

The upgraded interface carries the user from a new record through a review of consequential changes, a focused payment correction, an explicit review of the selected version, and a portable factual-update package. It keeps the accepted cobalt design, Manrope/DM Sans fonts, native dialogs, original-source access, historical accounts, uncertain facts and the full editor.

This pass owns `src/**`, the interface build, and this review. Domain comparison, correction invalidation, validation and ZIP construction were coordinated with the root implementation and separately reviewed. No model job was started by this UI pass. No private records, remote push, deployment, upload or communication were used. The human narration and final media capture are a later release step.

## Implemented behavior

- **Changes since the reviewed account.** The page names the baseline and candidate versions. Payment interpretation, changed action and amount comparisons are prominent. Other consequential changes, supporting explanations and every supplied citation remain available. The complete-account control scrolls and focuses the account without changing the hash route. A new source or proposal never gains approval from an earlier review.
- **Focused correction.** Five plain-language checks cover receipt, event identity, additionality, exclusive period scope and allocation. A person can keep the existing interpretation without recording approval, supply an attributed correction, or retain uncertainty. The preview uses the same deterministic reconciliation code as the account. Saving creates a draft. An unsaved choice prevents switching to another topic; the full editor remains the fallback.
- **Conservative credit semantics.** Unknown identity, additionality, receipt or exclusive coverage removes unsupported credit. Unknown allocation alone preserves an otherwise supported correction once, with linked period bounds. A stated split must conserve gross pay and cannot silently interpret a blank as zero. Empty period scope cannot become supported merely by choosing a positive option. Partial receipt against a known expected net changes credit to unresolved before server validation.
- **Readable evidence.** A valid CSV can be read as rows with original column names, exact cell strings and physical source line references. Raw extracted text remains available. Invalid, ragged or oversized CSV falls back to raw text. A cited interpretation, optional detailed basis and exact excerpt stay separate from the original-source view. Standard, larger and largest text settings remain available.
- **Lower-friction intake.** The initial form asks for an optional workspace name and claim stage, defaulting to unknown. Names, claim number and recipient are optional details. Creation leads directly to Source records and does not run analysis. The model-service boundary appears at intake and near analysis decisions.
- **Explicit review.** Review names the selected revision, calculation, excluded payments and retained questions. The checkbox is required. Successful review leads to Prepare update. Viewing sources or closing a focused check does not mark anything reviewed.
- **Portable update preparation.** The user checks purpose and routing facts, selects revision-bound originals, previews the exact short packet with that selection, then downloads a ZIP. Cited sources are selected initially; omitted cited sources are called out. The count, preview and ZIP use the same source selection, including explicitly selecting none. Markdown and full HTML remain available as individual formats.
- **Local diagnostics.** About this local workspace is a collapsed secondary disclosure with the running build label, startup time, source hash, data/interface directories and provider boundary. It states that identity is observed at server startup; rebuilding files afterward does not refresh the recorded identity.

## Meaningful feedback and repair

The first rendered comparison was too dense: twelve citation chips and long payment explanations dominated the cards, while the changed request was hidden below them. The repair foregrounds short typed fields, the consequential request-status change and the payment split. Long explanations and additional excerpts remain in native disclosures. Recent cited sources are offered first; this is presentation order, not a claim that they are more authoritative.

The 320px source context also consumed too much of the initial viewport. The detailed interpretation is now a disclosure while its subject, location, raw view and original remain accessible. The largest CSV view was then recaptured and inspected successfully.

Independent review found that entering a partial receipt could display an excluded calculation but leave `creditStatus` as `proposed_credit`, causing server rejection. The helper now sets it to unresolved when receipt differs from a known stated net, preserving an explicit exclusion. This was covered by a regression test and then saved successfully through the actual browser/API flow.

The root implementation also repaired comparison wording when both complete totals are unassessed, reopened stale dependent explanations and titles after a factual correction, and provided selection-bound short packet previews. Those contracts are used directly by the interface; the client does not rewrite outward requests or account explanations.

## Executed verification

The upgrade was served at `http://127.0.0.1:4324` from `dist-upgrade`, using `.data-upgrade`. The original `.data-demo`, its first three revisions and the existing 4319 interface were not mutated by this pass.

| Check | Observed result |
|---|---|
| `node --test src/experience.test.mjs` | Eight tests passed, zero failed. Covers exact multiline CSV, recursive source selection, coupled allocation, uncertainty, partial receipt, conservation/blank input and empty scope. |
| `npm run build -- --outDir dist-upgrade` | Passed. Final interface assets at handoff: `index-Ct3qjvkH.js`, `index-Bwsc99On.css`. |
| `git diff --check -- src index.html` | Passed before handoff. |
| 1440 × 1000 desktop | Home, repaired comparison, source entry, historical Prepare update inspected. No document horizontal overflow. |
| 390 × 844 narrow | Case/prepare states inspected; document scroll width was 390. The review action led to Prepare update with the correct reviewed status. |
| 320 × 640, 24px source text | CSV reader and dialog scroll widths matched their client widths (256px and 298px respectively). All ten fixture cell values remained exact; screenshot inspected. |
| 900 × 480 short dialog | Reason field, preview, full-editor fallback, Cancel and Save remained reachable in the native dialog's scroll. Screenshot inspected. |
| Native dialog and route | Escape returned focus to the opening citation. Read complete account retained the case hash and focused `#full-account`. |
| Unknown-stage intake | Created the isolated `UX intake — unknown claim stage` workspace. Stage remained unknown; landed on Source records with zero records and no analysis progress. |
| Required correction reason | Attempting an empty save focused the invalid textarea; no correction was submitted. |
| Uncertain coverage correction | Saved revision 4 on the copied case. Coverage became unknown, credit became unresolved, credited gross became zero, and the $140 account explicitly excluded one payment. Review stayed null until the separate review action. |
| Explicit review | Unchecked confirmation was disabled. Checking and saving reviewed revision 4 and opened Prepare update; retained uncertainties and excluded-payment note remained visible. |
| Multiple unreviewed proposals | Restored the original coverage in test revision 5, then recorded $30 against $48 stated net in revision 6. The partial receipt saved successfully as unresolved with zero credit. Revision 6 still compared with reviewed revision 4. |
| Historical account | Inspecting revision 3 suppressed correction/review actions, showed historical status and restricted source selection to its six records despite nine records in the current case at that point. |
| New unanalyzed source | Added a fictional stale-state note after revision 6. Prepare update changed to “Earlier version · newer sources pending,” withheld the edit-details action and offered only the revision's nine records while ten existed in the case. No analysis ran. |
| Empty source selection | Preview carried `sources=` and showed seven omitted cited records for revision 4. Evidence-index links retained the same revision and empty selection. |
| Actual ZIP download | Browser downloaded `WageProof-update-r4.zip`. Inspection found seven document/manifest members, zero included original sources and seven explicit omitted-source entries. |
| Restarted six-source ZIP | Downloaded historical revision 3 using the restarted packet renderer: 25 archive members, six originals, no omitted sources. All 207 relative HTML links/anchors resolved inside the archive and all 24 manifest file hashes matched. Generated HTML contained no scripts. |
| Diagnostics disclosure | Rendered build label, startup time, source hash and `.data-upgrade`/`dist-upgrade` directories matched health metadata. Startup identity and unverified live-model access were explicit. |

The copied case used for correction tests is `644901a9-ee06-46a3-8a82-85bccf128464`. The new intake test case is `fa192aee-28b4-46ba-ace2-f885e0867aa0`. Corrections were intentionally made only in the isolated service; their fictional test wording must not become the primary demonstration narrative.

At UI handoff the copied case has six revisions and ten sources; revision 6 remains a draft with newer evidence pending. Revisions 1–3 retain the original demonstration history, and revision 4 is the explicit uncertainty review. Revisions 5–6 and the latest source are named fictional verification actions.

## Rendered evidence

- [Desktop home](upgrade-ux-evidence/upgrade-home-desktop.png)
- [Initial overly dense comparison, preserved as failure evidence](upgrade-ux-evidence/upgrade-case-desktop.png)
- [Repaired comparison](upgrade-ux-evidence/upgrade-changes-repaired.png)
- [Short dialog with reachable reason and save controls](upgrade-ux-evidence/upgrade-payment-short.png)
- [Narrow reviewed/preparation state](upgrade-ux-evidence/upgrade-prepare-narrow.png)
- [320px readable CSV at largest text](upgrade-ux-evidence/upgrade-source-readable-320.png)
- [Historical update preparation with six revision-bound sources](upgrade-ux-evidence/upgrade-prepare-historical.png)
- [Downloaded packet integrity/link check](upgrade-ux-evidence/packet-browser-download-check.json)
- [Preserved six-source historical packet downloaded through the UI](#omitted-artifact-1)

## Limits and preserved failures

This is a bounded developer UI review with fictional records. It is not participant research, a measured time-saving result, a complete screen-reader audit, or a guarantee of competition performance. Root's independent evaluation and final release verification remain separate evidence.

One intermediate JSX edit failed compilation because of a missing closing tag; it was repaired before a successful build. A screenshot request outside the browser's allowed output roots was denied, then moved to the workspace. The old browser tab later produced repeated screenshot timeouts, and one onboarding dialog unexpectedly returned to the case desk. The cause was not established. A fresh test tab captured normally; onboarding and the 320px source checks then completed successfully. These failures were not silently counted as successful checks.

A later browser session reset to `about:blank` while this report was being written. Selector checks failed before any intended mutation succeeded. The service was reloaded and the stale-state and restarted-packet checks were then completed. This was recorded as a tooling/session failure, not attributed to an unproven application defect.

The copied case points to an earlier completed job that was not included in the two-case fixture copy, producing a 404 when its job history is queried. Its account and sources still load. Sandbox script-block messages appeared when browser automation traversed the generated no-script iframe; the packet's rendered document and links loaded. No safety setting was relaxed to suppress these messages.

The interface was built into `dist-upgrade` only. Root should restart the final release after its semantic/source freeze so the health metadata records the final assets, complete any remaining package/release checks, and recapture the actual final workflow for the recording-ready human-narration cut.

## Fresh demonstration follow-up — 24 September 2026

Root inspected the actual newly generated three-revision fictional case `10ac0219-9a99-4319-a052-5e5381fb4f99` on the candidate-2 media service using the final `index-BUlYS_9Q.js` interface. Candidate 3's application/build bytes are identical; its comparator tooling changed. This check used fresh navigation rather than retaining an earlier loaded script.

The 1440×1000 and 390×844 initial case views showed the named reviewed revision 2 → revision 3 comparison, the unchanged-total warning and the fictional context without document horizontal overflow. Desktop Prepare update correctly marked revision 3 reviewed, recipient unconfirmed, claim number absent, all six originals selected and the scoped difference $80. Browser console inspection returned zero errors/warnings. No inference, source import or case mutation was performed. The main proof and exact screenshot hashes are recorded in `work/upgrade/fresh-demo-ui-check.json`; this is a bounded view check, not another complete usability or accessibility study.


## Omitted raw supporting artifacts

These records remain in the original local workspace. Omission is a portability decision, not a reclassification or deletion of any failure. Directory contents are not packaged or summarized as if independently re-audited; the original reports and included diagnostic JSON retain their recorded hashes and outcomes.

### Omitted artifact 1

Workspace-only file: `docs/upgrade-ux-evidence/historical-review-packet-r3.zip`.

SHA-256: `205df49f772974bc2531a008552f723c2c8ecc59ce66598beaa09d98ef920750`; 142524 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.
