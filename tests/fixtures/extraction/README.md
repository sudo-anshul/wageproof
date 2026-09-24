# Synthetic extraction regressions

These fixtures were independently authored for the local input-format review using `work/format-probes/generate.py` (ReportLab and Pillow). They contain no evaluation cases or actual wage claims.

- `text-two-pages.pdf`: a two-page digital-text record. Its exact pre-repair extracted text is retained in `text-two-pages.expected.txt`.
- `mixed-text-and-image-pages.pdf`: a digital-text first page plus a scanned correction on the second page.
- `mixed-text-and-image-same-page.pdf`: a digital-text cover note plus a scanned correction on the same page.
- `image-only.pdf`: a wholly raster PDF, which retains the documented page-image/transcription recovery path.

The hybrid fixtures originally imported without warnings while omitting the correction reference `FMT-LATE-725` and replacement gross `$287.40`/net `$244.10`. They are now regression material, not held-out evaluation cases. Actual local extraction tests require Poppler (`pdfinfo`, `pdftotext`, `pdfimages`, `pdftoppm`) and Tesseract English. Stub-tool tests concern failure behavior only.
