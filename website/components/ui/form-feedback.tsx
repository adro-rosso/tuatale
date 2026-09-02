'use client';

/**
 * Shared validation-visibility helpers for the wizard steps, so a blocked "Continue" is
 * unmissable and consistent everywhere — WARM, not hostile (brand voice: visible, not a red
 * wall). Three pieces:
 *   - FieldError: the per-field error text, stronger than a plain caption (⚠ + medium weight).
 *   - FormBlockedNotice: a message by the Continue button explaining why nothing happened.
 *   - useScrollToFirstError: on a failed submit, scroll to + focus the first offending field.
 *
 * The field itself is highlighted via `aria-invalid` on the input (see fieldControl's
 * aria-[invalid] styling in form-styles.ts) and a `data-error-field` marker on its wrapper,
 * which is also the scroll target.
 */
import { useEffect } from 'react';

/** Per-field error text. Renders nothing when there's no error. */
export function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="font-body text-iron-oxide text-caption pt-xs gap-1 flex items-start font-medium">
      <span aria-hidden="true" className="leading-none">
        ⚠
      </span>
      <span>{children}</span>
    </p>
  );
}

/** A warm notice by the Continue button when a submit was blocked by validation. */
export function FormBlockedNotice({ show, message }: { show: boolean; message?: string }) {
  if (!show) return null;
  return (
    <p
      role="alert"
      className="font-body text-iron-oxide text-body border-iron-oxide bg-iron-oxide/[0.04] px-md py-sm rounded-r-lg border-l-[3px] font-medium"
    >
      {message ?? 'Please fix the highlighted fields above, then continue.'}
    </p>
  );
}

/** True when there are any field errors — for gating FormBlockedNotice. */
export function hasFieldErrors(errors: Record<string, string> | undefined | null): boolean {
  return Boolean(errors && Object.keys(errors).length > 0);
}

/**
 * On a failed submit (errors object changes to a non-empty set), scroll to + focus the FIRST
 * offending field in DOM order. Targets `[aria-invalid="true"]` (the input) first, else the
 * `[data-error-field="true"]` wrapper. Re-fires on every new submit because the caller passes
 * a fresh errors object each time (useActionState state, or setErrors in the client path).
 */
export function useScrollToFirstError(errors: Record<string, string> | undefined | null): void {
  useEffect(() => {
    // Wizard forms always load with empty errors, so gating on a non-empty error set is
    // enough — no initial-mount guard needed, and this works whether the form re-mounts on
    // submit (ChildForm's key={formKey}) or re-renders in place (Theme etc.).
    if (!hasFieldErrors(errors)) return;
    // Defer a tick so the just-rendered aria-invalid / data-error-field attributes are in the DOM.
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-field="true"]');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusTarget =
        el.matches('input, textarea, select, button') || typeof el.focus !== 'function'
          ? el
          : el.querySelector<HTMLElement>('input, textarea, select, button') ?? el;
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        /* focus is best-effort */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [errors]);
}
