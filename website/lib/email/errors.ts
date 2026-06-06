/**
 * Email-layer error types.
 *
 * EmailConfigError fires when a runtime env var is missing
 * (RESEND_API_KEY) — distinct from a send-time failure because
 * the right response is different: config errors are operator
 * problems we want surfaced loudly; send failures are
 * recoverable per-message events the caller decides how to
 * handle.
 *
 * EmailSendError wraps anything that came back from the Resend
 * SDK or a network throw. Carries `cause` for Sentry breadcrumbs.
 */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailConfigError';
  }
}

export class EmailSendError extends Error {
  public override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EmailSendError';
    this.cause = cause;
  }
}
