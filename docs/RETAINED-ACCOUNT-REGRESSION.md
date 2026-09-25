# Disclosed retained-account failure and repair

> Portable derived copy of `docs/RETAINED-ACCOUNT-REGRESSION.md`. Original SHA-256: `bf10b399771420f697fd29c6d81058351986027e4126a062f123e1a2684f5371`. The full authored findings are retained. Only link destinations and this provenance/omission appendix were added or changed. Absolute paths quoted in the original identify workspace evidence; they are not portable download locations.

24 September 2026. The first reserved run exposed a material engine failure: its model correctly extracted previously adopted gross-earned figures, but the engine suppressed their accounting differences because fresh hourly-rule premises were absent. The failure remains preserved. This case is now development/regression material; passing it after repair is not a fresh held-out success.

The domain agent was authorized to read only these disclosed case-A phase-2 artifacts:

- `evaluation/runs/first-reserved/reserve-a/phase-2/case-after.json`
- `evaluation/runs/first-reserved/reserve-a/phase-2/independent-audit.json`
- `evaluation/runs/first-reserved/reserve-a/phase-2/supplement.md`

No other reserved cases, private oracle material or baseline outputs were inspected. No first-run artifact was edited.

## Why the first output was wrong

The typed account expressly carried two `reviewed_earned` figures:

| Account | Adopted gross earned | Original gross paid | Later allocated gross credit | Retained difference |
|---|---:|---:|---:|---:|
| Reviewed A | $1,008 | $924 | $25 | $59 |
| Reviewed B | $960 | $900 | $45 | $15 |
| Outside reviewed account | Unknown | Unknown | $30 | Unknown |
| **Known-account subtotal** | **$1,968** | **$1,824** | **$70** | **$74** |

The $100 gross correction is one event, with $30 allocated outside the two supplied accounts. The mixed $110 receipt includes a separate $30 reimbursement and $80 net wages; gross wage credit remains $100. Neither the outside allocation nor the reimbursement belongs in the known two-account subtraction.

The earlier `calculatePeriod` checked California hourly applicability, workweek and workday before handling `reviewed_earned`. Those premises are necessary to derive new earned amounts from hours; they are not necessary to subtract already adopted account figures. The gate incorrectly returned null for all three differences. This hid the useful $59/$15/$74 result.

## Repair

`reviewed_earned` now carries the expressly supplied adopted amount before any gate for a new hours/rate calculation. Its basis remains **“Supplied previously adopted gross amount; not independently recalculated.”** New calculations from daily minutes retain all previous applicability requirements. Unknown `rule`, `basisStatus`, workweek, workday, rate and underlying legal questions are not filled in or relabeled.

The result now has a separate `knownSubtotal`. It contains only periods with both an earned account and an original gross payment. Its `excludedPeriodIds` identifies accounts still lacking a balance. The complete `totals` object remains unassessed if any listed account is unassessed. A partial subtotal never replaces that complete total.

Allocation treatment is preserved:

- A fixed credit assigned to an excluded period stays there.
- An unresolved allocation entirely within the known accounts is credited once in their subtotal.
- An unresolved allocation shared between known and unknown accounts creates a subtotal range; none-to-all of that group's credit may belong to the known accounts. The implementation does not infer exclusive coverage.
- Signed excesses remain signed. A zero subtotal or total is not a whole-claim conclusion.

The supplement shows each period, a separately labeled partial subtotal when useful, and an all-listed-period combined row that remains unassessed. It also labels generated employer-position statements as **paraphrases**, without wrapping them in invented verbatim quotation marks. Exact quoted source excerpts remain in the citation index.

## Verification performed

`node --test tests/domain.test.mjs`: **24 passed, 0 failed**. Added tests cover the disclosed amounts and outside allocation, shared allocation crossing the known/unknown boundary, an exclusive shared allocation within the subtotal, missing original gross pay, equality between subtotal and whole total only when complete, unchanged legal scope and paraphrase presentation.

An offline replay of the actual disclosed model snapshot produced:

```json
{
  "analysisUnchanged": true,
  "scope": "unassessed",
  "periodDifferencesCents": [5900, 1500, null],
  "outsideKnownCreditCents": 3000,
  "knownSubtotalCents": 7400,
  "knownSubtotalCreditedCents": 7000,
  "allPeriodDifferenceCents": null,
  "validationValid": true
}
```

The replay preserves an input SHA-256 and the original null results alongside the repaired derivation in [`work/regression-a-domain/offline-replay.json`](#omitted-artifact-1). Its [recomputed supplement](#omitted-artifact-2) is explicitly labeled as an offline regression replay, not a new application revision or model result. Live application rerun and evaluator review are separate work owned by the integrator/evaluator; this document does not claim they have passed.


## Omitted raw supporting artifacts

These records remain in the original local workspace. Omission is a portability decision, not a reclassification or deletion of any failure. Directory contents are not packaged or summarized as if independently re-audited; the original reports and included diagnostic JSON retain their recorded hashes and outcomes.

### Omitted artifact 1

Workspace-only file: `work/regression-a-domain/offline-replay.json`.

SHA-256: `05eab118969648f0cb5bac4b765f865443a56705d05e7f644063434ad8f499d8`; 6048 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.

### Omitted artifact 2

Workspace-only file: `work/regression-a-domain/offline-replay-supplement.md`.

SHA-256: `82f3a6314219682265e5ec007761ed8101386731ea2516860d8b2276ee496bc8`; 37025 bytes.

Raw supporting artifact remains in the original local workspace; this portable report preserves the authored finding and names the omitted evidence.
