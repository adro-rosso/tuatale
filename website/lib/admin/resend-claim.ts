/**
 * Marker the resend action writes into notification_error while a delivery email is being
 * sent, so a second press can't send a second email. Lives here, not in the action: a
 * 'use server' module may only export async functions (exporting this const broke the build).
 */
export const RESEND_CLAIM_PREFIX = 'resend in progress since ';
