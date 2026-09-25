# Fresh diagnostic export failure and repair

24 September 2026. This is a recorded renderer failure and regression repair, not a new model success or user study.

## Observed failure

The open D2 diagnostic's later model account correctly identified payroll's newly supplied April 6–19, 2026 service period, retained attribution and exclusions, left actual work/rate/original pay unresolved, and did not invent a remaining balance. Its detailed supplement preserved those facts.

The short update omitted the actual service dates. It displayed the older uncertain oral account as its sole attributed position and only said “Service window supplied” in a retained question. The exporter had sorted positions by dispute status and selected one. The corpus evaluator and a separate reviewer independently classified the short recipient artifact as materially incomplete. That is an output-summary failure, not a model arithmetic failure. The original candidate-1 output and first model attempts remain preserved under `evaluation/upgrade/runs/upgrade-candidate-1/`.

## Repair

The exporter now compares current attributed positions with the selected revision's named reviewed baseline. New and changed statements appear ahead of retained positions. A changed assessment is included even when its statement has not changed. Current unresolved positions remain visible. No fixed one-position cut can remove a newly introduced statement. Initial exports without a reviewed baseline retain the current positions.

The output labels positions new, changed or retained relative to that named revision. Source attribution and assessed support remain explicit. Only the selected revision's facts are rendered; a later review or changed intake cannot supply its baseline or identity.

The first complete renderer repair was too long in the fresh filmed example: repeated changed assessments pushed its useful schedule and request off the first page. Additional coverage-only assessments now follow the payment, schedule and request, with a lead changed assessment in the opening. All changed content remains in the document. This ordering repair improves the useful opening without concealing the additional assessments.

## Executed checks

- Two new portable regression tests cover newly supplied dates/exclusions despite an older disputed position, useful initial/no-baseline output, and an unchanged statement with a consequential changed assessment.
- The integrated candidate-2 suite passed **77/77**, with no failures or skips, at `work/upgrade/candidate2-final-tests.tap`.
- The saved D2 account was rendered again without another model call or factual edit. Dates, direct payroll attribution, exclusions, historical oral attribution, unknown balance and retained requests are present. The original case bytes remain unchanged.
- Independent review of the first renderer repair checked content and temporal boundaries. A later reviewed revision and changed intake did not leak into the selected earlier output; the initial historical export excluded later dates and sources. A separately recorded final-ordering recheck also passed content, temporal isolation and D2 first-page inspection; its hashes match the candidate-2 freeze and final ordered artifact manifest.
- Root inspected actual A4 first-page images of the final ordered D2 output and the fresh three-phase demonstration. D2's opening is **380 words** and the demonstration's is **322 words**, measured from rendered text before further changed assessments. Both first pages contain their relevant factual changes and retained requests. Full update documents are longer; the entire packet is not one page.
- The two clarified interface labels were observed from the current built JavaScript at 1440px and 390px. The excluded correction is labelled “Gross correction counted here,” and an empty outward agenda acknowledges available records and unresolved questions. No horizontal overflow or clipped money label was observed in those states.

## Binding and limits

The frozen replacement is `release/upgrade-candidate-2/candidate-freeze.json`. It includes the output repair, two interface labels, two new tests and the independently documented comparator staging amendment. Prompt, schema, extraction, accounting and configured model/effort were unchanged. This does not turn the failed candidate-1 artifact into a passing first result.

Final ordered export/print hashes are recorded in `work/upgrade/diagnostic-export-repair/final-ordering-manifest.json`. The independent diagnostic review is `work/upgrade/diagnostic-independent-review.md`. These are synthetic technical and developer-rendered checks. They do not establish general summary completeness, a universal one-page output, legal accuracy or reduced human effort.

## Primary technical findings and candidate 4

All eight candidate-3 technical stages finished before the next renderer change. Independent inspection found one material omission in T3's later short artifact: worker-reported work after clocking out, with unknown duration and unresolved prior payment, was present in the accepted account and detailed supplement but fell beyond the first-three display limit. T2 and T4 also exposed a minor wording defect: an obsolete compound request title appeared without its partly-answered status/current scope. These failures remain primary results; later corrected rendering does not erase them.

Candidate 4 includes every new or changed active question and outward request, followed by limited unchanged context. It prints current detail for changed items and explains the remaining scope of partly answered requests. The same selection principle protects late new/changed payments and accounting periods beyond the old four-item cap. Selected historical revisions still compare against their own named reviewed baseline, with cloned inputs before asynchronous original-file reads. No fixture text, dates or amounts were added to the renderer. Prompt, schema, extraction and calculation are unchanged.

Three new regression tests cover compound request wording, new/changed work questions beyond the old caps and their historical isolation, and payments/periods beyond four. All **80 integrated tests pass**. The first new payment test incorrectly expected credit for a payment now reported not received; the observed $110 result correctly excluded that $60 credit. The test expectation was corrected, and its first failed log remains at `work/upgrade/candidate4-portable-test.log`. Application code was not changed to satisfy that erroneous assertion.

Root regenerated exposed D2, T2, T3 and fresh-demo artifacts without inference or case edits. Their complete updates print to **four, three, four and three A4 pages**, respectively. All four inspected HTML documents fit a 390px document width with no page errors. Actual printed pages 1–2 of T3 and the demonstration were visually inspected: the newly reported work is on T3 page 1, its request is on page 2, and the demo's partly answered request explicitly says the supplied allocation need not be requested again. Detailed text can continue onto another page. The older one-page opening measurements above are historical.

The output receipts are in `work/upgrade/candidate4-export-check/result.json`. Read-only independent code review found no new blocking semantic or temporal regression. The final evaluation reports the separate frozen eight-stage regression and untouched reserve outcomes. These are distinct from the original primary results.

The selection is not literally a printout of every change: closed/superseded actions and review/routing actions are outside its active outward-request scope; citation-only attributed-position changes may remain in the detailed supplement. Full detail can make complex updates longer. The complete case view and detailed supplement remain available.
