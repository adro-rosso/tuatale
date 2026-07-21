/**
 * Server-only feature flags. Read at call time (a function, not a const) so a test or
 * a deploy can flip an env var without a rebuild.
 *
 * FAIL-CLOSED by construction: the flag is on ONLY for the exact string 'on'. Unset,
 * missing, '', 'true', 'ON' — anything else is OFF. Never a NEXT_PUBLIC_* var, so it
 * cannot be read or flipped from the browser.
 */

/**
 * The adult book branch. Gates the adult path at EVERY layer (UI, submit-hero,
 * checkout-session, create-order) — see project_adult-controlled-launch. Default OFF:
 * adult is unreachable in prod until this is deliberately turned on AFTER the schema
 * migration lands. The specific failure it prevents: a customer paying for an adult
 * book on unmigrated prod, whose order insert is then rejected by the child_age CHECK
 * post-payment (charged, no book).
 */
export const isAdultBranchEnabled = (): boolean => process.env.ADULT_BRANCH_ENABLED === 'on';
