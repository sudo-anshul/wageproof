# Upgrade diagnostic review — current result

> Portable derived copy of `work/upgrade/diagnostic-independent-review.md`. Original SHA-256: `5c189a06f17ca40d952244d52793450e7acb4100419a6757efdb22de3c2f22ea`. The full authored findings are retained. Only link destinations and this provenance/omission appendix were added or changed. Absolute paths quoted in the original identify workspace evidence; they are not portable download locations.

**Candidate-3 ordinary D1/D2 updates pass all nine released substantive targets. No material semantic error was observed in those four completed stages.** The earlier app D2 short-update omission and first-attempt citation failure remain recorded below, together with the separate renderer repair. These open diagnostics do not establish app superiority or human time savings.

The following sections preserve the review history. Statements about unavailable ordinary proposals describe the records available at that dated stage; the completed candidate-3 review at the end is current.

# Original diagnostic review of upgrade-candidate-1

The first visible D1/D2 case analyses preserve the required accounting distinctions and unresolved requests, but **D2 later has a material omission in its short portable update**: it says the service window was supplied without stating April 6–19, 2026. That date range is the central new fact. It survives correctly in the stored analysis and detailed supplement. The failure is in the short recipient artifact, not a finding that the model lost the fact everywhere.

This review covers **two synthetic diagnostic families and four sequential stages**, not four independent cases or a representative legal benchmark. No completed ordinary-comparator proposal was released for review. Its first startup failure is preserved, and no comparative superiority or time-saving claim is supported.

Reviewer: `/root/final_media_audit`. I was independent of D1/D2 corpus authorship and answer-key review, but **not independent of the product build**: I previously implemented UI/UX features and checked clean setup and packaging tooling. This is an agent review, not worker, practitioner or legal validation. I did not access reserved T1–T4/R1–R2 inputs, keys, authoring or QA, run inference, or modify source code in this review.

The [supporting JSON](UPGRADE-DIAGNOSTIC-REVIEW.json) records exact artifact hashes, candidate/public bindings, attempt status, timing, usage, packet checks and per-key judgments. The sealed answer-key files retain a stale `DRAFT_AWAITING_INDEPENDENT_KEY_REVIEW` header; the separately published review receipt states the keys were independently approved and sealed. This review does not alter either record.

## Material short-update finding

In [D2 later's short update](#omitted-artifact-1), line 13 foregrounds Owen's earlier uncertain understanding of an oral explanation. Line 23 says “Service window supplied; workweek allocation and calculation remain missing,” but neither the Markdown nor HTML short update states April 6–19. A recipient reading the short update cannot recover the new service dates without following a reference into another document.

In contrast, the [detailed supplement](#omitted-artifact-2) leads with the exact date range at line 22. Lines 41–43 distinguish the historical worker-reported call from the new direct payroll letter and its exclusions. The accepted raw response and stored case also preserve that distinction. The complete packet therefore contains the fact, but the appendix does not cure its omission from the short factual update's main purpose.

**Classification: `D2-L-dates`, material completeness failure in the short portable update; pass in raw analysis, first visible stored case and detailed supplement.** No arithmetic or whole-claim conclusion error was observed in this stage. The missing dates must be repaired in the renderer and verified as a separate regression result, preserving these first artifacts.

## Per-key substantive judgments

“Pass” means the reviewed output conveyed the required meaning on the released synthetic evidence. It is not a citation-count, schema-field or legal-validity score.

| Key | Raw analysis / first visible case | Portable result | Basis |
|---|---|---|---|
| D1-I-account | Pass | Pass | Retains adopted gross earned $865/$930 and original gross credited $800/$850, without inventing daily work, rate or legal applicability. |
| D1-I-event | Pass | Pass | Treats PS-071 as one additional $70 gross correction with $14 deductions and $56 received; retains conditional combined difference $75 and linked period bounds. |
| D1-I-action | Pass | Pass | Requests both the weekly allocation and supporting calculation. Payroll's “fully corrected” conclusion remains attributed and unsupported. |
| D1-L-split | Pass | Pass | Applies $30/$40 to the existing payment; period differences become $35/$40, combined $75. No second payment is invented. |
| D1-L-compound | Pass | Pass | Allocation request is answered; supporting reconciliation remains partly answered and active. New revision still requires review despite unchanged total. |
| D2-I-types | Pass | Pass in complete packet | Separates $224 current gross wages, $37.60 deductions, $18 nonwage reimbursement and $204.40 received. $4,924 wages/$138 reimbursement are YTD, not additional current amounts. |
| D2-I-unknown | Pass | Pass | Does not adopt the rough $300 estimate or convert scheduled 480/510 minutes into attendance. A useful payment update remains available with no invented residual. |
| D2-L-dates | Pass | **Material failure in short update; pass in supplement** | Direct payroll letter supplies April 6–19 with attribution; short update omits the range and highlights the earlier uncertain oral account. |
| D2-L-open | Pass | Pass | Actual attendance, regular rate, original pay, workweek reconciliation and excluded travel-time/late-penalty questions remain unresolved. No residual or whole-claim disposition is invented. |

D1 initial's period ranges are −$5…$65 and $10…$80, linked by the one $70 correction; their endpoints cannot be independently summed. D1 later correctly narrows them to $35/$40. The [later supplement](#omitted-artifact-3), lines 71 and 75, retains the missing supporting reconciliation while recording the allocation portion answered; the [short update](#omitted-artifact-4), line 29, also retains the calculation request. No proposed communication is represented as sent.

D2 initial's short payment paragraph does not show the full deduction/reimbursement decomposition. The [initial supplement](#omitted-artifact-5), lines 22 and 32, does. No wrong wage credit or residual follows from the shorter wording, so this is recorded as a presentation limitation rather than automatically promoted to a material failure. The released receipt image was visually inspected; its visible amount and reference match the extracted text.

D2 later does not turn payroll's service window into proof of attendance or established employer workweeks. The model updates the request to `partly_answered`; actual work, calculation and original-pay questions remain open. Its `amountUnchanged:false` is not evidence that the payment amount changed: both complete balances are unassessed, so an established equal monetary balance does not exist.

## First raw attempts, visible proposals and review state

D1 initial **did not pass on its first raw model attempt**. Attempt 1 failed exact-quote validation with `analysis.scope.citations[1]: quote does not occur verbatim in the cited lines.` The rejected quotation was whitespace-equivalent to the PDF text, but lacked its layout space after a newline. Attempt 2 became the first user-visible proposal. Apart from citation changes, the only wording change was the credit reason's shift from “Credit the gross correction once…” to “The proposed account credits the gross correction once…”. No substantive accounting correction was observed between those attempts.

| Stage | Raw attempts | First visible proposal | Job total |
|---|---|---|---:|
| D1 initial | Attempt 1 validation failed; attempt 2 completed | Attempt 2 | 164.478 s |
| D1 later | Attempt 1 completed | Attempt 1 | 141.143 s |
| D2 initial | Attempt 1 completed | Attempt 1 | 142.500 s |
| D2 later | Attempt 1 completed | Attempt 1 | 225.598 s |

These are observed job durations, not user task completion times. Usage per attempt is retained in the JSON; dollar cost and human effort are not inferred.

Every captured first visible revision has `review:null` and requires review. To exercise the lifecycle, the evaluator later marked each initial revision with: “Technical evaluator lifecycle marker only. First unreviewed artifacts were saved and hashed. This is not worker/practitioner validation or a gold-derived correction.” Both later outputs preserve their prior marked revision exactly and create a new unreviewed revision. **No worker- or practitioner-reviewed artifact was observed.**

## Packet consistency and comparator boundary

All four downloaded ZIPs passed CRC and embedded-manifest checks. The selected revision and source set match the stored case; every packaged original matches the released original bytes, and every extracted-text companion matches its stored source. Both later packets preserve the prior technically marked history. Local references were checked, but external legal-reference URLs were not fetched in this audit. These are provenance and portability checks, not proof that an interpretation is accurate, a record is authentic, or a legal conclusion is correct.

At the original candidate-1 review, the only released ordinary-comparator record was [D1 initial's first startup](#omitted-artifact-6). It exited 1 after 0.386 seconds with `Error: Operation not permitted (os error 1)`, no proposal and no usage/events. **Score: unobserved; classification: infrastructure failure before inference.** It must not count as a substantive baseline failure or support an app-superiority claim. Subsequently released comparator attempts are scored separately below without replacing this record.

Observed outcome: no material case-analysis error, one material short-update omission, no false complete closure of an unresolved request, and one first-attempt quote-validation failure. These diagnostic results support repairing and retesting the short-export selection logic. They do not establish general accuracy, human usability, legal reliability or superiority to the ordinary workflow.

## Separate renderer regression — 2026-09-24 01:30 UTC

Root subsequently released [the repaired D2 short Markdown](#omitted-artifact-7) and [HTML](#omitted-artifact-8), regenerated from the unchanged frozen D2 later case. **The reported omission is repaired in these artifacts.** Both formats lead with payroll's direct April 6–19, 2026 clarification, explicitly retain its missing-attendance/rate/original-pay limitations, and show the coverage exclusions before the historical uncertain oral account. Payment amounts remain $224 gross/$204.40 received, the complete balance remains unassessed, the workweek request remains active and the new revision remains unreviewed. The changed assessment of the unchanged pay-advice statement is also printed.

I inspected the relevant exporter/renderer and two new regression tests. The server supplies the baseline identified by the **selected revision's** `sinceReviewed.baselineRevisionId`, provided that baseline has a review timestamp; it does not simply choose the newest reviewed case version. The short renderer includes all new or changed positions, shows a coverage-only change, retains a disputed older position, and keeps all current positions when no baseline exists. Root reported the new tests passing; I did not rerun that test suite.

I additionally ran a read-only, in-memory export probe using only the released D2 case and originals. Its ordinary rerender exactly matched the repaired Markdown and HTML. After appending a deliberately distinguishable future reviewed revision and changing the current intake name in memory, exporting the selected D2 later revision still used reviewed revision 1 and contained no future identity or position. Exporting the selected initial revision had no comparison baseline, included only its four original sources, excluded the later date clarification and displayed historical/stale labels. No stored case or original was changed.

All **37 recorded candidate-1 artifact hashes** still match, including the failed short update. This result is **a renderer regression pass, not a fresh model success or a replacement for the first diagnostic failure**. No model call, source edit or browser action was performed by this reviewer. Printed layout and interactive behavior were not inspected in this regression. Hashes and individual probe outcomes are appended under `rendererRegression` in the supporting JSON.

## Final ordering regression — 2026-09-24 01:38 UTC

**Pass for the final ordered D2 export**, separately bound to candidate 2 and the final ordering manifest. The same artifact paths above have been regenerated; their earlier observed hashes remain unchanged under `rendererRegression` in the JSON. This entry does not replace that record or candidate 1's first failure.

| Binding | SHA-256 |
|---|---|
| Candidate-2 public freeze | `09d0908ca1344b728d1a700a6c71fa9cc86357a74a836b6776234453249e925c` |
| Final ordering manifest | `5dc614880291e43a1cd937764bdfa2740863f28331d593520718b5f84999f365` |
| Final D2 short Markdown | `120af932f84a33ba663dd775280e98260dc61f4b6743a95bfee5177649b11339` |
| Final D2 short HTML | `f8f503fe559104ae9524052d592cd39f77064b05bff6918e1baa790b5c81cf61` |

Every current attributed statement remains in the short update. Payroll's direct dates and exclusions precede the calculation and historical oral explanation. The unchanged advice statement's changed coverage assessment follows the useful payment/uncertainty/request opening, with its full content retained. The balance stays unassessed, the workweek request stays active and the new revision stays unreviewed.

I repeated the in-memory export and temporal probes against this ordering. The generated Markdown/HTML exactly match the final files. Selecting a historical later revision still uses its named initial baseline despite a future reviewed revision and changed intake name; selecting the initial revision excludes later dates and sources. A further in-memory scenario containing only coverage changes keeps one lead assessment before calculation and retains all additional coverage assessments after the requests. An initial probe assertion overlooked Markdown escaping in its own hyphenated sentinel; correcting the probe marker required no product change. All 37 candidate-1 artifact hashes and the first repair's recorded result remain intact.

I visually inspected the released [D2 first printed page](diagnostic-evidence/D2-final-first-page.png). It contains the attributed April 6–19 dates, exclusions, unassessed balance and all three substantive requests: attendance/original pay, workweek/pay basis and workweek reconciliation. No clipping or overlap was visible. The image and PDF hashes match the final manifest. I did not inspect the demo page or subsequent PDF pages. This remains a renderer-only regression with no inference or source edit; details are under `finalOrderingRegression` in the JSON.

## Candidate-2 ordinary initial attempts — 2026-09-24 01:39 UTC

The evaluator subsequently released only the D1 and D2 `staging-v2-first/initial` ordinary attempts. **Both are infrastructure failures during source access and incomplete workflows; substantive scores remain unobserved.** Both model processes completed with exit 0 and emitted explicit source-access-blocked notes, so these differ from candidate 1's failure before inference. An output file and successful process exit do not make them completed case updates.

Both notes report `sandbox-exec: sandbox_apply: Operation not permitted` on local read attempts and explicitly state that no case facts were verified. Their stderr records two filesystem sandbox violations each. The JSON event stream contains no separate shell-result items, so exact command-level traces are not available here. It also records fallback model-metadata and exceeded-skills-context errors. The visible notes match the final model messages exactly.

| Ordinary initial attempt | Wall clock | Process time | Input / cached input | Output / reasoning output |
|---|---:|---:|---:|---:|
| D1 staging-v2-first | 27.005 s | 26.920 s | 51,360 / 33,953 | 659 / 290 |
| D2 staging-v2-first | 33.372 s | 33.288 s | 51,399 / 33,948 | 684 / 312 |

Preparation was 0.084 seconds for each run. Reported cache-write counts were 17,203 for D1 and 17,247 for D2; full usage events are retained in the JSON. Monetary cost and human active time were not supplied. No speedup, cost advantage or quality superiority follows from these incomplete attempts.

Each captured workspace contains exactly seven manifest-matching files: scope, task, blocked output and four initial sources. Each of those source hashes matches its released initial-family original. **No later source files are present in either snapshot.** This checks the recorded staging boundary; it does not prove that the model read the initial documents—it explicitly reported that it could not.

The [D1 blocked note](#omitted-artifact-9), [D2 blocked note](#omitted-artifact-10), events, stderr and run records are hash-bound under `ordinaryCandidate2InitialReview`. No later ordinary stage or reserved T/R material was read, and this reviewer made no inference calls. The comparator still has no completed case-based proposal to score.

## Candidate-3 completed ordinary diagnostics — 2026-09-24 02:17 UTC

The native-sandbox `native-v3-first` runs complete all four D1/D2 stages with substantive cited updates. I independently read each full update against the released open key and original text/CSV/PDF sources; the D2 receipt image had been visually inspected in the original app review and its unchanged source hash is verified again here. All nine required substantive findings pass. No material or minor semantic error was observed within this bounded review.

| Target | Ordinary result | Basis |
|---|---|---|
| D1-I-account | Pass | Adopted earned $865/$930 and original gross credits $800/$850 retained; no invented daily or legal inputs. |
| D1-I-event | Pass | One $70 gross / $56 net correction with $14 deductions. Conserved `x` and `$70 − x` allocations preserve the unknown split and $75 combined signed amount. |
| D1-I-action | Pass | Both split and worksheet requested; payroll's full-correction statement stays attributed and unreconciled. |
| D1-L-split | Pass | $30/$40 allocated to the same correction; $35/$40 remains; no extra payment invented. |
| D1-L-compound | Pass | Split request retired, calculation request active; new update explicitly needs review. |
| D2-I-types | Pass | $224 wages, $37.60 deductions, $18 reimbursement and $204.40 receipt separated; YTD excluded from current credit. |
| D2-I-unknown | Pass | Rough estimate and planned minutes not adopted; useful update without an invented residual. |
| D2-L-dates | Pass | Main “What changed” section quotes payroll's April 6–19 clarification and retains its attribution. |
| D2-L-open | Pass | Actual work, rate, original pay, workweek basis and excluded categories remain open; unknown is not zero. |

D1's initial ordinary output also distinguishes the signed $75 summary from positive per-period shortfalls of $75–$80 when one possible allocation creates a $5 first-week excess. Its later output narrows both periods after the documented split. This is an informative equivalent representation permitted by the released key; it is not a claim of legal permission to offset periods. D2's date statement narrows correction coverage, without establishing attendance, entitlement or employer-defined workweeks. Both ordinary later artifacts remain proposals, not reviewed, sent, filed or settlement acceptances.

| Completed ordinary stage | Wall clock | Model/tools process | Input / cached input | Output / reasoning output |
|---|---:|---:|---:|---:|
| D1 initial | 64.045 s | 63.187 s | 92,224 / 72,017 | 2,490 / 1,091 |
| D1 later | 46.395 s | 45.569 s | 96,491 / 74,999 | 1,609 / 143 |
| D2 initial | 52.458 s | 51.601 s | 92,473 / 72,148 | 1,604 / 516 |
| D2 later | 52.872 s | 52.046 s | 113,878 / 92,433 | 1,686 / 440 |

The native-v3 comparator successfully read local sources. D1 initial and later each encountered one recoverable tool failure: the system `python3` launcher reported a missing `xcrun` developer path after the preceding PDF extraction had already succeeded. The same run recovered with `awk` or shell arithmetic; there was no extra case-run retry. Both failures and all usage remain in their event streams. D2 initial used successful receipt OCR; later read the unchanged initial result and its original sources plus the new letter. Fallback model-metadata warnings remain recorded. The four final files exactly match their final model messages.

Each initial snapshot has seven manifest-matching files, including exactly four original initial sources and no later files. Each later snapshot has eleven manifest-matching files, including those four originals plus the two released later sources. Every original-source byte hash matches the released family input. The initial output bytes are exactly preserved in each later snapshot, independently confirming both `prior-output-integrity.json` receipts. All **37 original candidate-1 artifact hashes** remain unchanged.

Configuration binds all four runs to candidate-3 freeze SHA-256 `6c5bb468c87abc5e59e1222bf4ed6cd17b4626360d9ba4337c41203533537825` (103 files), protocol `43747a565c8c6df8d3e160bc6cb9744bd9eee9a7202fbe5596712c0a77422f37`, model `gpt-6-astra`, high reasoning effort. The recorded preflight reports successful allowed reads/writes, denied app/private/other-family/history reads, denied source writes and network, and successful innocuous PNG/PDF extraction. I read these receipts, not reran the sandbox. The runtime's system-temp boundary remains explicitly limited; the receipt does not support a universal work-only-write or temp-secrecy claim. The public tool-smoke receipt reports a real successful command and exact proof creation, but is not a scored case.

**These diagnostics show no semantic advantage for the app over the ordinary workflow.** The ordinary process times were shorter than the recorded app jobs on these stages, but these are not measured human completion times, and the app additionally produces structured revision state and a portable package. Neither superiority nor human savings should be inferred. These are reused, evaluator-authored synthetic diagnostic families after infrastructure repairs, with one completed ordinary sequence each—not representative legal validation or fresh technical-family results. Monetary cost, practitioner/user judgment and active human time remain unobserved. CLI usage events do not establish individual API-request counts.

Exact hashes, preserved failures, run boundaries and findings are appended under `ordinaryCandidate3CompletedReview` in [the JSON](UPGRADE-DIAGNOSTIC-REVIEW.json). This entry reads no T/R material and makes no model calls or source edits.


## Omitted raw supporting artifacts

These records remain in the original local workspace. Omission is a portability decision, not a reclassification or deletion of any failure. Directory contents are not packaged or summarized as if independently re-audited; the original reports and included diagnostic JSON retain their recorded hashes and outcomes.

### Omitted artifact 1

Workspace-only file: `evaluation/upgrade/runs/upgrade-candidate-1/D2/first/later/first-output/portable-unpacked/update.md`.

SHA-256: `55aae5180e0433c3d0ed40756f3372fa5e2c1a8b878403a9dbeb3d7cc52a53f2`; 4410 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 2

Workspace-only file: `evaluation/upgrade/runs/upgrade-candidate-1/D2/first/later/first-output/portable-unpacked/supplement.md`.

SHA-256: `0407e98f66f398d360fcc6e9b035c361fcc1132bd30d0c7b7d0ff73ed215ae55`; 27135 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 3

Workspace-only file: `evaluation/upgrade/runs/upgrade-candidate-1/D1/first/later/first-output/portable-unpacked/supplement.md`.

SHA-256: `8a5f59203f2aa193764ab2b0b8f6042dc0938ab6b62e2e545d4e06b98a73db0f`; 21119 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 4

Workspace-only file: `evaluation/upgrade/runs/upgrade-candidate-1/D1/first/later/first-output/portable-unpacked/update.md`.

SHA-256: `c40f2b2bc159af291204eb784b6742f2661310f09babf166f84e1abae161b032`; 3347 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 5

Workspace-only file: `evaluation/upgrade/runs/upgrade-candidate-1/D2/first/initial/first-output/portable-unpacked/supplement.md`.

SHA-256: `bdd4a6be25615837849c79208d599af2be062d6bb7a2c0fc70f5963630cc8593`; 19733 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 6

Workspace-only directory: `evaluation/upgrade/baseline/records/upgrade-candidate-1/D1/first/initial`.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 7

Workspace-only file: `work/upgrade/diagnostic-export-repair/D2-later/update.md`.

SHA-256: `120af932f84a33ba663dd775280e98260dc61f4b6743a95bfee5177649b11339`; 6346 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 8

Workspace-only file: `work/upgrade/diagnostic-export-repair/D2-later/update.html`.

SHA-256: `f8f503fe559104ae9524052d592cd39f77064b05bff6918e1baa790b5c81cf61`; 10243 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 9

Workspace-only file: `evaluation/upgrade/baseline/records/upgrade-candidate-2/D1/staging-v2-first/initial/workspace-snapshot/outputs/initial/update.md`.

SHA-256: `c06779d1466ab44977f88b14df131babd2e39e2ac05fb878272a9820a8d064bc`; 998 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 10

Workspace-only file: `evaluation/upgrade/baseline/records/upgrade-candidate-2/D2/staging-v2-first/initial/workspace-snapshot/outputs/initial/update.md`.

SHA-256: `c5c18bb3692cedf9691a2a1558d23c827b07b48c6c5d4757611ec76d52813a96`; 907 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.
