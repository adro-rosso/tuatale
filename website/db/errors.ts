/**
 * DatabaseError — uniform wrapper around Supabase / PostgREST errors so
 * callers don't have to interrogate Supabase's response shape directly.
 *
 * The `operation` field is a short identifier of which query helper
 * raised the error (e.g. "drafts.create", "orders.getByStripeSessionId").
 * The `cause` field carries the raw Supabase / PostgREST error object
 * for callers that want to drill in (Sentry breadcrumbs, dev logs).
 *
 * If you're catching a DatabaseError at an API route boundary, render
 * it as 500 to the client and stash the cause in the error report —
 * never expose Postgres internals to the customer.
 */
export class DatabaseError extends Error {
  public readonly operation: string;
  public override readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'object' && cause !== null && 'message' in cause
          ? String((cause as { message: unknown }).message)
          : String(cause);
    super(`Database operation "${operation}" failed: ${causeMessage}`);
    this.name = 'DatabaseError';
    this.operation = operation;
    this.cause = cause;
  }
}
