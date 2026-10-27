# Document recognition and worker sheet

Warehouse staff can open a print-ready internal working copy from an order. It contains an authoritative point-in-time order view, including ordering customer, receiving destination, preparation and quantities. Marking the paper does not update stock. It is not a customer invoice or recipient label.

Recognition is an optional, review-only transcription of one selected private image. It never creates or edits stock, orders or quantities. Compare every line with the original: labels, handwriting, amounts and pack sizes may be incorrect or missing. Historical marks and prices remain unconfirmed. Originals and resulting text may contain sensitive information; access is limited to receiving staff in the active company and warehouse. The result is retained with the job in the database; a configurable retention policy is not implemented.

## Local

Install Tesseract and the required language data on the worker host. Set `OCR_LOCAL_LANGUAGES` to an installed Tesseract language code or `+`-joined codes; `eng` is the default. English alone does not reliably read Chinese. The Documents screen shows whether the configured languages are installed. Local recognition sends no image to Google. JPEG, PNG and WebP are supported; PDF recognition is not configured. Manual entry remains available.

## Google Gemini

Set `GEMINI_API_KEY` and `GEMINI_MODEL` on the server and worker only, never in browser code. Choose a model your Google account supports for image input. Configure outbound network access and your provider's privacy, cost and retention settings before use. Staff must explicitly confirm for each request that the selected document will be sent to Google. It is not sent unless they choose Gemini and confirm. Recognition is not configured without both values.

The database-backed worker must run (`npm run worker` in a separately managed process when using PostgreSQL). Jobs have a bounded number of attempts; rejected credentials/input fail without repeated retries. Temporary failures may retry and create provider charges; a crash after a provider responds but before the database transaction commits can cause a repeat request. Review failure status and use manual entry if needed. Provider calls currently hold a database transaction for up to 30 seconds; this must be redesigned and tested under load before production. No live Gemini request has been verified in this environment.

## Recovery

A request saved on a device can be retried using the same operation ID if a response is lost; the server returns the existing job. Check status in Documents. Conflicts, session expiry and device storage failure require operator attention. No automatic offline sync or automated review/approval is provided. Retain the original private files and database together in backups.
