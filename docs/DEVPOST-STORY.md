## Inspiration

“We corrected both weeks.” A payment arrives, but a worker still needs to know which week it covers, what remains unpaid, and what to ask for next.

Wage disputes can unfold across payslips, bank receipts, messages and later corrections. A new document can change the explanation without changing the total. I built WageProof around that moment: helping a worker or someone assisting them maintain an understandable, checkable account as evidence changes.

The first version focuses on an existing wage dispute within a declared ordinary California hourly-pay calculation scope.

## What it does

WageProof turns imported wage records into a proposed account that a person can inspect, correct and review. It connects payment interpretations to source excerpts, compares later evidence with the last reviewed version, and prepares a factual case update with an evidence packet.

The fictional demo follows **$140 → $80 → $80** in remaining calculated differences. A **$60 gross correction** has a **$48 net receipt**; they must not be counted as two payments. Later evidence allocates that correction between two weeks. The remaining weekly differences become **$55 and $25**, while the combined **$80** stays the same. One question is answered, but payroll's supporting calculation and reconciliation are still missing.

The workflow lets a user:

- Import supported text, PDF and image records, then inspect extracted text and source citations.
- Check whether a payment is additional, received and allocated to the right period, keeping uncertain interpretations explicit.
- Correct the account with an attributed explanation and review a specific revision.
- Compare new evidence with the last reviewed account without losing the earlier history.
- Export a ZIP containing a readable update, detailed explanation, selected original records and evidence links that work after extraction without the app running.
- Turn an unresolved records request into editable wording, save it locally, and copy or download the exact saved draft. Later evidence makes an older draft read-only.

A bundled, read-only example exposes three recorded revisions and six fictional originals without model credentials. Fresh analysis uses the configured model service. Preparing an update or request does not send it, file it or decide the claim.

## How I built it

The interface uses **React, JavaScript and Vite**, with a **Node.js** server and **Python** utilities. **Poppler** extracts PDF text and **Tesseract** provides labelled OCR. The model is accessed through **Codex CLI** and proposes a structured interpretation with tools disabled. Recorded analysis used `gpt-6-astra` with the configured `azure` provider. **Ajv** validates the schema; application code checks exact quoted source anchors and performs the supported wage calculations in integer cents.

Versioned local storage keeps original files, account revisions and review state connected. Request drafts use deterministic starting text from the retained request, without another model call. Atomic writes, conflict checks and revision binding help prevent stale work from silently replacing a newer account.

Original files and case storage remain local. Fresh inference sends extracted text and case context to the configured model service; it is not offline processing.

## Challenges I ran into

The hardest challenge was preserving meaning across revisions. An unchanged total can hide a changed weekly allocation or an unresolved request. An early short export omitted a material detail even though the detailed analysis retained it. I repaired the export path and kept the original failure in the evaluation record.

Other consequential cases included distinguishing net receipts from gross corrections, avoiding duplicate payments, keeping cleared claim and recipient details unknown, and retaining a user's draft through save errors or competing edits.

## Accomplishments

The released local workflow carries imported records through account review, evidence export and an unsent follow-up draft. The source passed **124 automated tests** and **30 setup/runtime checks** on the development macOS host. Desktop and narrow layouts were inspected across source review, saving, conflicts, stale drafts and recovery states.

Small synthetic evaluations also compared the workflow with a strong ordinary model workflow. **Both passed all eight targets across two previously unused synthetic reserve families.** Targets are not independent cases or an accuracy estimate. These results do not establish model superiority, real-world accuracy or time saved for workers.

## What I learned

Getting a number right is only part of the job. A useful account must also explain where that number came from, what changed, what is still unknown and which next action the evidence supports. Source matching makes an interpretation traceable; it does not prove that a document is authentic or that the interpretation is legally correct.

## What's next for WageProof

The next step is consent-based observation with workers or advocates: does maintaining a reviewed history and reusable request wording help enough to justify another tool? I would compare that experience with their current process before expanding scope.

This prototype supports English records and a limited California hourly calculation slice. It does not determine legal entitlement, penalties or case closure. Worker/practitioner validation and a public multi-user deployment remain future work.

## Credits and demo disclosure

Built as a solo student project with **OpenAI Codex** assistance for planning, design, implementation, tests, documentation and media automation. Existing libraries and tools include React, Vite, Ajv, Lucide React, Marked, Poppler and Tesseract; the interface uses Manrope and DM Sans fonts.

The linked demo uses actual application captures, fictional records, captions and disclosed shortened processing waits. **ElevenLabs Neha — Messy and Relatable** provides the AI narration; it is not the creator's human voice. The edit uses Node.js, Python and FFmpeg. The main film demonstrates the core account/update workflow; the newer request editor is also shown in the image gallery.
