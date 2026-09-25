# WageProof domain contract

`domain/index.mjs` is dependency-free Node/browser ESM. Money is integer cents; worked time is integer minutes. Values produced by the model are proposals. A reviewed revision adopts a calculation basis, not a legal finding. Human edits use the same schema and must be revalidated.

## Public functions

- `analysisSchema`: strict JSON schema for `analysis` below.
- `buildAnalysisPrompt({sources,previousAnalysis=null,context={}})`: string containing task, numbered immutable source text and previous proposal. `sources` use `{id,name,text}`; `sourceId`/`content` are supported aliases. Returned prompt never reads the filesystem or development answers.
- `validateAnalysis(analysis,sources)`: `{valid,errors,warnings,analysis}`. Errors are readable strings. Checks schema, IDs, references, exact line/quote anchors, numeric prerequisites and allocation conservation. It does not verify authenticity or certify the interpretation.
- `reconcile(analysis)`: `{periods,payments,totals,knownSubtotal,allocationGroups,warnings,unassessedCategories}`. `periods` retain `id,label` and return `earnedMinCents,earnedMaxCents,originalGrossPaidCents,initialDifferenceMinCents,initialDifferenceMaxCents,knownCreditCents,differenceMinCents,differenceMaxCents,calculated,alternatives,allocationGroupIds`. `totals` returns `earnedMinCents,earnedMaxCents,originalGrossPaidCents,initialDifferenceMinCents,initialDifferenceMaxCents,creditedGrossCents,differenceMinCents,differenceMaxCents,calculable,conditional,label`. A null amount is unknown, not zero. Signed differences may be negative; they do not close other claims. Individual interval extremes from shared allocation groups cannot be added.
- `compareAnalyses(previous,next)`: `{summary,changes,requiresReview,amountUnchanged}`; changes include typed human-readable before/after fields, source citations and importance. An unchanged amount requires two established, calculable totals; two null totals are not an unchanged amount. Per-period changes, support changes and conservative entity addition/removal remain visible.
- `revisionComparison(baseline,candidate)` binds the compared revision IDs/numbers and baseline review time. New revisions persist both `sinceReviewed` and `sincePrevious`; `changes` retains the adjacent comparison for compatibility. Multiple unreviewed drafts cannot silently move the primary review baseline. `withRevisionComparisons` projects legacy displays without rewriting stored originals or using a review that happened after the candidate was created.
- `renderSupplement({caseRecord,revision})`: Markdown using `revision.analysis`, optional `revision.reconciliation`, `revision.id`, `revision.createdAt`, `revision.review` and case context. `revision.review.status === 'reviewed'` marks human-reviewed; everything else stays draft. The supplement never says sent/filed or replaces a filed original.
- `annotateUserCorrection(previousAnalysis,nextAnalysis,{sourceId,reason,actor='User'})`: `{analysis,text,changed,changes}`. Use a newly generated source ID. Atomically persist `text` as an attributed correction source plus the returned `analysis`, then validate against all originals plus that source. The helper checks schema shape, records readable old→new fields, adds exact correction-source quotes to changed entities/days, and retains prior cited evidence explicitly as prior/potentially contrary context. Unchanged entity citations remain intact. Top-level narrative/category edits and removals use `caseContext.attribution` for provenance. A required reason is recorded; this does not adjudicate the new statements. No edit gives `changed:false,text:''`; citation-only mutation throws `CORRECTION_PROVENANCE_ONLY` and should be routed through add-note/reanalysis. `changes` retains machine-readable path/before/after/presence flags and readable display text.

## Analysis shape (all keys required)

```js
{
  schemaVersion: '1.0', summary: 'Proposed change in plain language',
  caseContext: {workerName:null, employerName:null, claimNumber:null,
    claimStatus:'unknown', purpose:'Factual claim update', recipient:null,
    asOf:null, attribution:'Source-reported context', citations:[]},
  scope: {jurisdiction:'CA', rule:'ca_ordinary_hourly', basisStatus:'supplied',
    assumptions:[], workweek:null, workday:null, exclusions:[], citations:[]},
  periods:[{id:'stable-id',label:'Week ending …',startDate:null,endDate:null,
    rateCents:2000, originalGrossPaidCents:80000,
    calculationBasis:'daily_minutes',reviewedGrossEarnedCents:null,
    days:[{date:null,label:'Monday',minutes:600,citations:[]}],
    alternatives:[],notes:'Attribution and uncertainty',citations:[]}],
  payments:[{id:'stable-event-id',label:'Correction',eventReference:null,
    grossCents:6000,netCents:4800,receivedNetCents:4800,paymentDate:null,
    receiptStatus:'documented',identityStatus:'supported',
    additionality:'supported',creditStatus:'proposed_credit',
    creditReason:'Source supports a distinct additional correction',
    allocationStatus:'unknown',allocationScope:'exclusive_supported',
    periodIds:['stable-id'],allocations:[],citations:[]}],
  issues:[{id:'new-issue',title:'Allocation missing',status:'open',
    detail:'…',materiality:'allocation',periodIds:[],paymentIds:[],citations:[]}],
  responseClaims:[{id:'claim-id',statement:'Both periods corrected',author:'Payroll',
    status:'partly_supported',coverage:'What records answer and leave open',
    periodIds:[],paymentIds:[],issueIds:[],citations:[]}],
  actions:[{id:'action-id',title:'Review allocation detail',detail:'…',status:'open',
    route:'review_available',priority:'high',custodian:null,dateRange:null,
    establishes:'What this information would resolve',dependsOnIssueIds:[],citations:[]}],
  unassessedCategories:['Payment timing and remedies'],changeNarrative:'…'
}
```

See `analysisSchema` for exact enums. Citation objects are `{sourceId,lineStart,lineEnd,quote}` (one-based inclusive lines; quote must occur in the cited span). `alternatives` are `{id,label,days}` using the same day objects. Use either ordinary `days` or complete factual alternatives; do not arbitrarily choose an uncertain work date. `reviewed_earned` is only for an explicitly supplied prior adopted gross calculation, never an invented shortcut when facts are missing.

An explicitly supplied `reviewed_earned` amount supports retained-account subtraction when its original gross payment is known, even if the premises for a **new** legal/hour calculation are absent. Its derivation remains unverified; scope fields remain unknown. `knownSubtotal` is `{periodIds,excludedPeriodIds,earnedMinCents,earnedMaxCents,originalGrossPaidCents,initialDifferenceMinCents,initialDifferenceMaxCents,creditedGrossMinCents,creditedGrossMaxCents,differenceMinCents,differenceMaxCents,calculable,complete,label}`. It includes only periods with supplied earned and original-paid accounts. Display a separate partial subtotal when `calculable && !complete`; do not replace the complete all-period `totals` with it. Fixed outside credits stay outside; shared credits crossing this boundary create subtotal ranges. Monetary fields are null when no period has a usable account. This correction and its retained first failure are documented in [RETAINED-ACCOUNT-REGRESSION.md](RETAINED-ACCOUNT-REGRESSION.md).

Computed ordinary California slice: ordinary adult hourly nonexempt work; declared workweek/workday; daily time-and-a-half after 8 hours, double time after 12; weekly overtime only on remaining regular minutes above 40, preventing double counting. Seven worked days, alternative workweeks, variable/unclear regular rates and undeclared rule applicability are unsupported. Missing facts leave amounts null. Later work outside the recorded account remains an open issue until its duration and inclusion basis are actually supplied/adopted. Rule scope stays visible.

Credit is proposed only if distinct identity, additionality and exclusive period scope are supported and receipt is documented or worker-reported. Assertions of an unsupported second payment remain visible but uncredited. Net receipt is never substituted for gross. Unknown allocation between known exclusive periods is a shared constraint: one full gross credit in the combined amount, per-period linked ranges. Known allocation must conserve the full payment. Reprints/bank rows are supporting views of one event; do not create a payment per source. Equal same-date payments with distinct references can be separate events. Source IDs/filenames never select calculation logic.

## Verification and limits

`npm test` now includes domain, extraction, portable packet, transport/recovery and frontend decision-helper tests. The pre-evaluation upgrade candidate passed **75/75** on 24 September 2026; see `work/upgrade/all-suites-before-freeze.tap` and `release/upgrade-candidate-1/candidate-freeze.json` for that scope. These checks cover accounting, source/provenance and lifecycle mechanisms. They are hand-specified tests, not model evaluation, practitioner validation or held-out product results; 6,001 enumerated allocations are one defined accounting relation, not 6,001 independent cases.

Interpretation remains the model/person boundary. Quote existence cannot establish that a numeric edit follows from a quote. Corrections that introduce facts should first add an attributed worker/reviewer note as a new source, then reanalyse. Calendar validation prevents the same explicit worked date from appearing in distinct periods; it cannot detect duplication when all dates are unknown. Unsupported seventh-day regimes and unsupplied rule applicability intentionally leave wage calculations unassessed while preserving useful factual updates.

Prompt version `ANALYSIS_PROMPT_VERSION` is exported. Version `2026-09-24.4` preserves the earlier language and internal-inspection fixes and makes action dispositions explicit. `answered` requires all parts to be answered; `partly_answered` retains an incomplete request; `superseded` replaces older wording. Answered/partly answered/superseded actions need citations. Closed factual actions also need support; closed or superseded actions must preserve any still-open linked issue in an open/partly answered action. A closed legacy internal software action can remain without implying factual work was performed. These guards validate explicit relations, not the semantic truth of the evidence.

`prepareConsequentialCorrection` handles focused edits through the existing attributed correction mechanism. Changed payment/work premises reopen unchanged related claims, questions and request prose. Payment and period dependencies also invalidate stale weekly/payment explanations. Explicit simultaneous human rewrites remain attributed and intact; an explicitly edited question still invalidates unchanged dependent request wording. Routing-context changes reopen dependent deputy instructions and clear an unchanged old recipient/claim number when the claim stage changes away from pending. A partial net receipt is retained as a factual receipt while the full gross credit stays unresolved; no proportional gross amount is inferred.

`review_available` is internal inspection work, omitted from the outward request list without claiming completion. `renderSupplement` accepts an optional source-link resolver. The portable bundle builds its short update, full supplement, evidence index, exact text companions and selected originals from one frozen revision. New/changed attributed positions are compared with that revision’s named reviewed baseline and retained in the update. Changed assessments remain visible even when the statement is unchanged; additional assessments follow the useful opening. An initial export has no invented comparison baseline. There is no universal one-page guarantee. It verifies source membership, literal citation spans, selected original hashes and generated paths. Omitted sources and later excluded sources are explicit. ZIP integrity and quotes do not establish authenticity, legal truth or agency acceptance.
