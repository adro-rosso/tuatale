/**
 * db/ barrel. Surfaces the query helpers + the shared error class so
 * route handlers and server actions can import from a single place:
 *
 *   import { createDraft, DatabaseError } from '@/db';
 *
 * Add new modules here as they land. Do NOT add cross-table queries to
 * the per-table modules — put those in db/queries/ if/when needed.
 */
export { DatabaseError } from './errors';

export * as drafts from './drafts';
export * as orders from './orders';
export * as previewEvents from './preview-events';
