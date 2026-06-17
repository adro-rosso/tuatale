// worker/src/incomplete-pipeline-error.js — R1 completeness-gate failure type.
//
// Thrown by run-pipeline.js's completeness gate when generateBook returns a
// book that is NOT shippable: missing PDF bytes, any failed page, or any
// required subject (protagonist or a ref-anchored secondary) short of its full
// sheet set. Mirrors WallCeilingError (src/wall-ceiling.js): a named Error with
// structured fields + a toJSON() carrying a `kind` discriminator.
//
// This is the contract R2 (the on-failed hook → alert + customer recovery) and
// R3 (the resume controller) consume — so the shape is fixed here deliberately:
//   { failedPages: number, missingSheets: Array<{subjectId,name,expected,actual,skipped}>, reason: string }

export class IncompletePipelineError extends Error {
  /**
   * @param {object} fields
   * @param {number}  fields.failedPages   count of pages that failed to render
   * @param {Array<{subjectId:string,name:string,expected:number,actual:number,skipped:boolean}>} fields.missingSheets
   * @param {string}  fields.reason        short human-readable summary
   */
  constructor({ failedPages, missingSheets, reason }) {
    super(`Incomplete book: ${reason}`);
    this.name = "IncompletePipelineError";
    this.failedPages = failedPages;
    this.missingSheets = missingSheets;
    this.reason = reason;
  }

  /** Plain object for error_details / status logs (R2/R3 read `kind`). */
  toJSON() {
    return {
      kind: "incomplete_pipeline",
      reason: this.reason,
      failed_pages: this.failedPages,
      missing_sheets: this.missingSheets,
      message: this.message,
    };
  }
}
