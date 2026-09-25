# Independent integration review before semantic freeze

24 September 2026 · Review only · Four reproduced findings

The named reviewed baseline, receipt-based recovery and bounded portable-preview routing are substantial improvements. The present regression suite passes, but the checks below found four correction/disposition gaps that should be repaired before freezing the semantic candidate. No application code was edited during this review.

## Scope and method

Read `domain/correction-review.mjs`, `revision.mjs`, `validation.mjs`, `server/jobs.mjs`, `store.mjs`, `index.mjs`, `corrections.mjs`, `domain/user-correction.mjs`, the focused payment helper/UI, and the upgrade/server tests. No `evaluation/upgrade/private` files or raw reserved families were read. No actual inference or shared browser was used.

Ran `node --test tests/upgrade.test.mjs tests/server.test.mjs`: **18/18 passed**. The transport tests use their explicitly fake model process and isolated stores. Additional reproductions loaded the existing fictional demo into memory, cloned its final analysis, and ran focused editing → correction preparation → attributed correction → validation. The original case file was not written. Its SHA-256 remained `3c235658cd4d1f2cdf04720195e976b0d38c5542226c194497bd694588a5ed14`.

## 1. Partial receipt cannot be saved through the focused correction

**Priority: P1.** Evidence: `src/experience.mjs`, `focusedPaymentCorrection`, receipt branch around lines 66–70; validation around lines 141–145. This is a normal partial-payment input, not a deliberately malformed request.

From the demo's supported $60 gross/$48 net correction, choose **Money received → I received it** and enter **$30**. The helper changes `receivedNetCents` to `3000` and receipt status to `worker_reported`, but retains `creditStatus: proposed_credit`. Its preview uses `reconcile`, which correctly excludes the full gross credit because actual receipt differs from expected net. Saving runs stricter validation and rejects the same proposal:

```text
receivedNetCents: 3000
creditStatus: proposed_credit
reconcile(...).payments[0].credited: false
validateAnalysis(...).valid: false
payment-001: differing expected and received net amounts do not establish receipt of the full correction.
```

The person sees a sensible preview but cannot retain the factual receipt they entered. The application must not credit all $60 or infer a proportional gross credit from the $30 receipt. It should keep the $30 factual receipt, mark the gross treatment unresolved and allow the factual update to finish.

**Repair and regression:** when a focused receipt edit establishes a known mismatch, downgrade an existing proposed credit to unresolved. Preserve explicit exclusions. Test the complete save path for full receipt, partial receipt, zero receipt and unknown receipt, asserting both the persisted typed status and deterministic calculation. A helper-only preview test does not cover the validator mismatch.

## 2. Payment allocation edits leave contradictory weekly notes active

**Priority: P1.** Evidence: `domain/correction-review.mjs` around lines 16–17 and 49–55. Invalidating directly edited payments and directly edited periods does not invalidate prose in periods affected by that payment.

Change the demo correction's supported split from **$25/$35** to **$30/$30**, supplying an attributed reason. This reproduction is a hypothetical correction, not a proposed modification to the demo. The prepared and annotated analysis validates successfully. Its typed schedule becomes:

| Week | Gross allocation | Remaining difference |
|---|---:|---:|
| A | $30 | $50 |
| B | $30 | $30 |

Nevertheless the active period notes still say:

> The supplied allocation detail now assigns $25 of the later gross correction to this week.

> The supplied allocation detail assigns $35 of the later gross correction to this week, not the entire $60 correction.

Those notes are rendered as the current work-account explanation in the detailed supplement. Keeping the old source as contrary evidence is correct; retaining its old interpretation as active current prose without qualification is not. The preparation pass already neutralizes the edited payment's `creditReason`, so the remaining contradiction is specifically the missing cross-entity dependency handling.

**Repair and regression:** include the before/after covered period IDs of changed payments in the affected period-prose set. Similarly reconsider unchanged payment prose when its linked work account or scope changes. Preserve explicitly rewritten human notes, but label/reopen unchanged dependent prose and retain originals in history. Test a saved allocation correction and inspect the rendered full supplement, not only totals or response-claim coverage.

A related code-inferred edge is worth covering with the repair: `affectedIssues` currently contains only issues whose unchanged wording the preparation pass rewrites. If a person simultaneously corrects an issue's detail, an unchanged dependent action may evade invalidation because that issue was not inserted into `affectedIssues`. Dependency relevance and whether a particular field needs rewriting should be separate decisions. This edge was inspected in code, not independently reproduced during this bounded review.

## 3. `closed` bypasses the new request-retirement safeguards

**Priority: P1.** Evidence: `domain/validation.mjs` around lines 88–94 and outward action selection in `domain/supplement.mjs`.

The new guard requires citations for `answered`, `partly_answered` and `superseded`, rejects an answered request that retains unresolved dependencies, and requires successor actions for superseded requests. `closed` is exempt from all three checks even though the UI/export removes it from the current request agenda.

Reproduction: retain only the final demo's payroll reconciliation action, set its status to `closed`, clear its citations, and leave its linked `issue-004` open. No successor action exists. Result:

```text
validateAnalysis(...).valid: true
action.status: closed
action.citations: []
dependent issue status: open
active replacement actions: none
```

The source-supported unresolved payroll question remains, but its sole current request can disappear through a different enum value. This does not prove the model will make that mistake; it demonstrates that the intended continuation invariant is bypassable on an ordinary schema-valid model output.

**Repair and regression:** define the semantics of `closed` explicitly. If it is another retired/superseded request, apply the outstanding-work continuation rule and require support or an explicit attributed human retirement reason. Do not simply require every issue to resolve before retirement: legitimate compound requests may be replaced by a narrower remaining request. Preserve the existing demo's legacy closed requests where the outstanding portion is actually carried forward. Test `closed` with no successor, with a valid narrower successor, and with a deliberate supported retirement.

## 4. Claim-stage corrections retain an active pending-claim route

**Priority: P2.** Evidence: `domain/correction-review.mjs` around lines 18–20 and 38–45.

Change only `caseContext.claimStatus` from `pending` to `not_filed`. `prepareConsequentialCorrection` returns `notice: null`, because its context trigger checks only worker and employer names. After the normal attribution step, the analysis validates, and the detailed supplement still contains the open outward request **“Provide a factual supplement to the verified deputy.”**

```text
prepared.notice: null
corrected claimStatus: not_filed
validateAnalysis(...).valid: true
active deputy_update actions: 1
```

The supplement's final procedural paragraph now says there is no established pending claim, but the active request agenda still directs an update to its deputy. This is especially relevant when correcting an initially mistaken stage or finishing an unfamiliar-document workflow with uncertain routing.

**Repair and regression:** treat claim-stage, claim-number and recipient changes as consequential routing-context changes. Reassess unchanged dependent purpose/routing prose and deputy-update actions while retaining explicit simultaneous human rewrites. Do not invent a recipient or require a claim number to complete the factual account. Test pending → unknown, pending → not filed and changed recipient independently of any money edit.

## Reproduction outline

Use the original fictional demo solely as open regression material:

```js
const c = JSON.parse(await readFile(
  '.data-demo/cases/644901a9-ee06-46a3-8a82-85bccf128464/case.json', 'utf8'));
const before = c.revisions.at(-1).analysis;
const proposal = focusedPaymentCorrection(
  before, before.payments[0].id, 'receipt', 'received', {received: '30.00'});
const prepared = prepareConsequentialCorrection(before, proposal);
const annotated = annotateUserCorrection(before, prepared.analysis, {
  sourceId: 'isolated-review-note', actor: 'Unit reviewer',
  reason: 'Synthetic isolated integration reproduction; do not save.'
});
const result = validateAnalysis(annotated.analysis, [
  ...c.sources, {id: 'isolated-review-note', name: 'Test.txt', text: annotated.text}
]);
```

For the allocation finding, substitute topic `allocation`, choice `known`, and an `allocations` map assigning `'30.00'` to both payment period IDs. For the routing finding, clone the analysis and change only `caseContext.claimStatus`. No `saveCase`, API mutation or real model call is needed to reproduce these boundaries.

## Areas without a reproduced defect in this review

The named `sinceReviewed` baseline persists across multiple unreviewed drafts while adjacent comparisons remain available. Reversion and unknown-total cases are covered. Legacy projections avoid using a review timestamp later than the candidate and leave stored revisions unchanged. Entity-ID replacement remains an explicit addition/removal rather than an invented match.

Case locks now serialize cancellation with the commit boundary. A durable `createdByJobId` receipt wins when cancellation arrives after commit, and startup recovery restores the corresponding job without replacing a newer case. Tests cover those paths, stale writes, interruption, duplicate servers and visible corrupt cases. The file-based store still does not claim power-loss durability or full multi-file transactions.

Portable preview links preserve explicit revision and source-selection query parameters, including empty selection. The server serves only an exact generated bundle member. Later-source selection is rejected, originals are returned as downloads, and generated HTML retains restrictive CSP. The API test follows the preview to its evidence index and selected original. I did not use a browser or inspect final print layout here; root's print/wording work was intentionally outside this review.

These passing mechanisms do not erase the four findings above. Repair those paths, add their regressions, then freeze a candidate for genuinely fresh semantic assessment. This review establishes neither representative document accuracy nor a competition score.

## Repair recheck — 24 September 2026, 06:22:37 IST

Rechecked at **2026-09-24T00:52:37.406Z**, using prompt version **2026-09-24.4**. All four original reproductions now pass their repair expectations. File hashes were taken before dynamic module loading and again after the checks; the eight files listed below were unchanged during the run. The earlier findings remain above as the failure record, not as claims that the repaired bytes still fail.

| Original finding | Recheck observation |
|---|---|
| Partial receipt cannot save | $30 remains recorded against the $48 stated net; status is `unresolved`, the full gross correction is uncredited, and preparation + attribution + validation succeeds. |
| Stale period prose after allocation change | $30/$30 produces $50/$30 remaining differences; both unchanged period notes are reopened/qualified and no longer assert the previous $25/$35 split as current. The prepared and attributed account validates. |
| `closed` retirement bypass | A closed factual request without citations and without continuation of its open dependency is rejected with both source-support and replacement-request errors. |
| Stale pending-claim route | Changing only `claimStatus` to `not_filed` creates a routing-change notice, clears unchanged claim number/recipient, and leaves no active `deputy_update` action. The account validates; work inputs and calculation scope remain unchanged. |

The immediate dependency edge noted under finding 2 was also reproduced and checked: simultaneously entering a corrected issue explanation with the $30/$30 split preserves that human explanation while reopening the unchanged dependent payroll request as `review_available`. Its old $25/$35 request wording is absent from the active outward action agenda. The old wording may still appear inside attributed correction/source quotations; that is retained history, not an active request, and is not a failing substring match.

**No residual material defect was reproduced in these four paths and that immediate dependency edge.** This is a bounded regression recheck, not a renewed audit of every application path. Root's full-suite run was underway separately; this recheck did not duplicate it or claim its result. No code was edited, no reserved case was read, no actual inference ran, and the original demo remained byte-identical.

| File | SHA-256 at recheck |
|---|---|
| `domain/correction-review.mjs` | `62e6a039aeb44c71a8609a40ff3c43ed8cd70ffa3d35cb14ff74e7c132e5229e` |
| `domain/validation.mjs` | `def03caf205ae3240cb9b4a412c0c236b86e263468653842c54395097fb442b4` |
| `src/experience.mjs` | `7480d780c596cca45cdf8e2b5c3754c8df5d42ad8e2f201ad3828ae4843aeeb2` |
| `domain/prompt.mjs` | `2f520fd7b4e415f0bfdec4d362ae837bcc4c3cd3a5beb50623ba17fe0712d5b5` |
| `domain/revision.mjs` | `9424b98587dda7bb535ea055f3a31e74a2de8518c00d0521f206d395e17fa2df` |
| `server/jobs.mjs` | `3a0ab8962d15f47b39b6ec81d4e993de1df38ca1b4ab7e8c833dfaaf79a5d89f` |
| `server/store.mjs` | `20062c620f49668eb1e5c4420ec395846cb99a3ab0845e0c54cdf9dc1755f668` |
| `server/index.mjs` | `051be48d31ffd3f12fab38436739437d287e5fa23c5f8f1995fed3fa9213d85d` |
