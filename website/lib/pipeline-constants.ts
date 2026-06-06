/**
 * Shared constants for the pipeline stub + integration points.
 *
 * Lives in its own module (no Inngest / DB imports) so consumers
 * like shipJobAction can identify a stub PDF without pulling in
 * the full Inngest client at module-load time. That kept the
 * server-action unit tests from tripping when the inngest mock
 * didn't define createFunction.
 *
 * STUB_PDF_URL is the placeholder URL the Cycle A.2 stub writes
 * into pipeline_jobs.pdf_url on awaiting_review. Track B will
 * replace stub generation with real PDFs at proper Storage URLs.
 */
export const STUB_PDF_URL = 'https://placeholder.tuatale.com/stub-book.pdf';
export const STUB_SLEEP_MS = 20_000;
